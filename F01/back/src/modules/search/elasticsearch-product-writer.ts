/** Low-level writer only: callers must arrange durable delivery and ordering. */
export class ElasticsearchProductWriter {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch) {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('ELASTICSEARCH_URL_INVALID');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
      throw new Error('ELASTICSEARCH_URL_INVALID');
    }
    this.baseUrl = url.toString().replace(/\/$/, '');
  }

  async put(id: string, document: Record<string, unknown>): Promise<void> {
    await this.write(id, document);
  }

  async putVersioned(id: string, document: Record<string, unknown>, revision: number, signal?: AbortSignal): Promise<void> {
    if (typeof id !== 'string' || !id || id === '.' || id === '..') throw new Error('ELASTICSEARCH_PRODUCT_ID_INVALID');
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('PRODUCT_SEARCH_REVISION_INVALID');
    const source = { ...document, search_revision: revision };
    try {
      // A full replacement avoids retaining fields removed from the Mongo snapshot.
      // Equal revisions are immutable: retries and delayed sends must be no-ops.
      const body = `${JSON.stringify({ update: { _id: id, retry_on_conflict: 3 } })}\n${JSON.stringify({
        script: { lang: 'painless', source: "if (!ctx._source.containsKey('search_revision') || ctx._source.search_revision < params.revision) { ctx._source.clear(); ctx._source.putAll(params.document); } else { ctx.op = 'noop'; }",
          params: { revision, document: source } },
        upsert: source,
      })}\n`;
      const timeout = AbortSignal.timeout(5000);
      const response = await this.fetcher(`${this.baseUrl}/products/_bulk?require_alias=true`, {
        method: 'POST', headers: { 'content-type': 'application/x-ndjson' }, body,
        redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { errors?: unknown; items?: Array<Record<string, any>> };
      if (result?.errors !== false || !Array.isArray(result.items) || result.items.length !== 1) throw new Error();
      const entry = result.items[0];
      if (!entry || Object.keys(entry).length !== 1) throw new Error();
      const item = entry.update;
      if (!item || item._id !== id || item.error !== undefined) throw new Error();
      if ((item.status === 201 && item.result === 'created')
        || (item.status === 200 && ['updated', 'noop'].includes(item.result))) return;
    } catch {
      // Never expose response bodies or transport errors to callers/loggers.
    }
    throw new Error('ELASTICSEARCH_WRITE_FAILED');
  }

  async delete(_id: string): Promise<void> {
    throw new Error('ELASTICSEARCH_DELETE_UNAVAILABLE');
  }

  private async write(id: string, document: Record<string, unknown>): Promise<void> {
    if (!id || id === '.' || id === '..') throw new Error('ELASTICSEARCH_PRODUCT_ID_INVALID');
    try {
      // Bulk API specifies require_alias and per-item results:
      // https://www.elastic.co/guide/en/elasticsearch/reference/8.15/docs-bulk.html
      const body = `${JSON.stringify({ index: { _id: id } })}\n${JSON.stringify(document)}\n`;
      const response = await this.fetcher(`${this.baseUrl}/products/_bulk?require_alias=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-ndjson' },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { errors?: unknown; items?: Array<Record<string, any>> };
      if (result.errors !== false || !Array.isArray(result.items) || result.items.length !== 1) throw new Error();
      const entry = result.items[0];
      if (!entry || Object.keys(entry).length !== 1) throw new Error();
      const item = entry.index;
      if (!item || item._id !== id || item.error !== undefined) throw new Error();
      if ((item.status === 200 && item.result === 'updated') || (item.status === 201 && item.result === 'created')) return;
    } catch {
      // Do not propagate provider errors that may contain credentials or request data.
    }
    throw new Error('ELASTICSEARCH_WRITE_FAILED');
  }
}
