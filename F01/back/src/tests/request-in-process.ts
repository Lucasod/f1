import { createServer, request } from 'node:http';
import { Duplex } from 'node:stream';
import type { Express } from 'express';

// Exercise Node's HTTP parser and the Express middleware over paired streams.
export function requestInProcess(
  app: Express,
  method: 'GET' | 'POST',
  path: string,
  options: { token?: string; body?: object } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const client = new Duplex({
      read() {},
      write(chunk, _encoding, done) { serverSocket.push(chunk); done(); },
      final(done) { serverSocket.push(null); done(); },
    });
    const serverSocket = new Duplex({
      read() {},
      write(chunk, _encoding, done) { client.push(chunk); done(); },
      final(done) { client.push(null); done(); },
    });
    const server = createServer(app);
    server.emit('connection', serverSocket);

    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const headers: Record<string, string | number> = { Connection: 'close' };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = request({ method, path, headers, createConnection: () => client }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        try {
          const content = Buffer.concat(chunks).toString();
          resolve({ status: res.statusCode!, body: content ? JSON.parse(content) : undefined });
        } catch (error) {
          reject(error);
        } finally {
          client.destroy();
          serverSocket.destroy();
        }
      });
    });
    req.on('error', error => {
      client.destroy();
      serverSocket.destroy();
      reject(error);
    });
    req.end(payload);
  });
}
