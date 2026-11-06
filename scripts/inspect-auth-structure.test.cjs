const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { inspectSources, targetDetail } = require('./inspect-auth-structure.cjs');

test('reports deterministic equality and contexts without exposing literals', () => {
  const access = JSON.stringify('demo-access-123');
  const refresh = JSON.stringify('demo-refresh-456');
  const password = JSON.stringify('demo-password-789');
  const sample = `const record = { accessToken: ${access}, refreshToken: ${refresh}, password: ${password} }; expect(result).toEqual(${access});`;
  const input = [{ name: 'fixture.ts', text: sample }];
  const first = inspectSources(input);
  assert.equal(first, inspectSources(input));
  for (const value of ['demo-access-123', 'demo-refresh-456', 'demo-password-789']) {
    assert.equal(first.includes(value), false);
    assert.equal(first.includes(createHash('sha256').update(value).digest('hex')), false);
  }
  const report = JSON.parse(first);
  const matches = report.occurrences.filter((item) => item.literalId === 'L1');
  assert.equal(matches.length, 2);
  assert.equal(matches[0].property, 'accessToken');
  assert.ok(matches[1].contexts.includes('assertion'));
  assert.notEqual(report.occurrences.find((item) => item.property === 'refreshToken').literalId, 'L1');
});

test('rejects malformed syntax without emitting source or diagnostics', () => {
  const value = JSON.stringify('demo-secret-123');
  assert.throws(() => inspectSources([{ name: 'fixture.ts', text: `const x = { password: ${value} ` }]), { message: 'Source parse failed' });
});

test('reports nonliteral credential properties as ambiguous and redacts unknown names', () => {
  const value = JSON.stringify('demo-value-123');
  const report = JSON.parse(inspectSources([{ name: 'fixture.tsx', text: `const sensitiveName = { password: variableName, accessToken: ${value} };` }]));
  assert.deepEqual(report.ambiguities.map((entry) => entry.property), ['password']);
  assert.equal(JSON.stringify(report).includes('sensitiveName'), false);
  assert.equal(JSON.stringify(report).includes('variableName'), false);
});

test('inventories unresolved identifier flow and nonstandard property forms', () => {
  const sample = 'const privateVar = input; const obj = { accessToken: privateVar, [dynamicKey]: privateVar, "password": privateVar, privateVar }; consume(privateVar);';
  const report = JSON.parse(inspectSources([{ name: 'fixture.ts', text: sample }]));
  assert.ok(report.properties.some((item) => item.form === 'computed'));
  assert.ok(report.properties.some((item) => item.form === 'quoted' && item.property === 'password'));
  assert.ok(report.properties.some((item) => item.form === 'shorthand'));
  const flow = report.identifierOccurrences.filter((item) => item.identifierId === report.identifierOccurrences.find((entry) => entry.role === 'declaration').identifierId);
  assert.ok(flow.length >= 4);
  assert.ok(flow.every((item) => item.resolution === 'unresolved-text-equality-only'));
  assert.equal(JSON.stringify(report).includes('privateVar'), false);
  assert.equal(JSON.stringify(report).includes('dynamicKey'), false);
});

test('inventories standalone storage and validation calls without seed literals', () => {
  const report = JSON.parse(inspectSources([{ name: 'fixture.ts', text: 'localStorage.getItem(input); validator.minLength(8); if (input.length < 4) reject(); expect(input).toBeDefined();' }]));
  assert.ok(report.sites.some((item) => item.kind === 'storage-call'));
  assert.ok(report.sites.some((item) => item.kind === 'validation-call'));
  assert.ok(report.sites.some((item) => item.kind === 'assertion'));
  assert.ok(report.sites.some((item) => item.kind === 'validation-call' && item.boundaryBand === '8-15'));
  assert.ok(report.sites.some((item) => item.kind === 'length-comparison' && item.boundaryBand === '4-7'));
});

test('distinguishes shadowed symbols and records direct alias flow', () => {
  const text = 'const hidden = "demo-outer-unique";\nconst renamed = hidden;\nfunction scope() {\nconst hidden = "demo-inner-unique"; return hidden;\n} use(renamed);';
  const report = JSON.parse(inspectSources([{ name: 'fixture.ts', text }]));
  const declarations = report.identifiers.filter((item) => item.role === 'declaration' && item.symbolId);
  assert.ok(new Set(declarations.map((item) => item.symbolId)).size >= 3);
  const outer = declarations.find((item) => item.line === 1);
  const inner = declarations.find((item) => item.line === 4);
  assert.ok(outer && inner);
  assert.notEqual(outer.symbolId, inner.symbolId);
  assert.ok(report.identifiers.some((item) => item.line === 2 && item.symbolId === outer.symbolId));
  assert.ok(report.flows.some((flow) => flow.kind === 'direct-binding' && flow.sourceSymbolId && flow.targetSymbolId && flow.sourceSymbolId !== flow.targetSymbolId));
  assert.equal(JSON.stringify(report).includes('demo-outer-unique'), false);
  assert.equal(JSON.stringify(report).includes('renamed'), false);
});

test('relates standalone call arguments to distinct literal identities', () => {
  const text = 'store.getItem("demo-key-one"); store.getItem("demo-key-one"); store.getItem("demo-key-two");';
  const report = JSON.parse(inspectSources([{ name: 'fixture.ts', text }]));
  const keys = report.arguments.filter((item) => item.literalId);
  assert.equal(keys.length, 3);
  assert.equal(keys[0].literalId, keys[1].literalId);
  assert.notEqual(keys[1].literalId, keys[2].literalId);
  assert.ok(keys.every((item) => item.callNodeId && item.nodeId && item.index === 0));
});

test('links shorthand property to declaration and use value symbol', () => {
  const report = JSON.parse(inspectSources([{ name: 'fixture.ts', text: 'const local = input; const record = { local }; consume(local);' }]));
  const shorthand = report.properties.find((item) => item.form === 'shorthand');
  const declaration = report.identifiers.find((item) => item.role === 'declaration' && item.symbolId === shorthand.symbolId);
  const references = report.identifiers.filter((item) => item.symbolId === shorthand.symbolId);
  assert.ok(shorthand.symbolId && declaration);
  assert.ok(references.length >= 3);
});

test('links same-line call and comparison sites to distinct AST nodes', () => {
  const report = JSON.parse(inspectSources([{ name: 'fixture.ts', text: 'validator.minLength(4); validator.minLength(8); if (input.length < 4 || input.length < 8) reject();' }]));
  const validations = report.sites.filter((site) => site.kind === 'validation-call');
  const comparisons = report.sites.filter((site) => site.kind === 'length-comparison');
  assert.equal(new Set(validations.map((site) => site.nodeId)).size, 2);
  assert.ok(validations.every((site) => site.boundaryNodeId && report.arguments.some((arg) => arg.callNodeId === site.nodeId && arg.nodeId === site.boundaryNodeId)));
  assert.equal(new Set(comparisons.map((site) => site.nodeId)).size, 2);
  assert.ok(comparisons.every((site) => site.leftNodeId && site.rightNodeId && site.boundaryNodeId));
});

test('target detail preserves structural links without source values', () => {
  const text = 'const hidden = "synthetic-sensitive-marker"; const obj = { accessToken: hidden }; localStorage.setItem(hidden, hidden);';
  const detail = targetDetail(inspectSources([{ name: 'fixture.ts', text }]));
  assert.equal(detail.includes('synthetic-sensitive-marker'), false);
  assert.equal(detail.includes('hidden'), false);
  const result = JSON.parse(detail);
  assert.ok(result.properties.some((entry) => entry.property === 'accessToken' && entry.symbolId));
  assert.equal(result.arguments.length, 2);
});

test('target detail preserves multi-hop alias paths and assertion and mock equality', () => {
  const text = 'const origin = "synthetic-detail-marker"; const alias = origin; const later = alias; const obj = { accessToken: later }; expect(origin).toEqual("synthetic-detail-marker"); mockResolvedValue("synthetic-detail-marker");';
  const resultText = targetDetail(inspectSources([{ name: 'fixture.ts', text }]));
  const result = JSON.parse(resultText);
  assert.ok(result.flows.filter((entry) => entry.sourceSymbolId).length >= 2);
  assert.ok(result.sites.some((entry) => entry.kind === 'assertion'));
  assert.ok(result.sites.some((entry) => entry.kind === 'mock'));
  const same = result.occurrences.filter((entry) => entry.literalId === result.occurrences[0].literalId);
  assert.equal(same.length, 3);
  assert.equal(resultText.includes('synthetic-detail-marker'), false);
  assert.equal(resultText.includes('origin'), false);
});
