'use strict';

// Read-only inspection. Output contains only fixed labels, positions and ordinal IDs.
const fs = require('node:fs');
const path = require('node:path');
let ts;
try {
  ts = require('../../front/node_modules/typescript');
} catch {
  if (require.main === module) {
    process.stderr.write('Inspection unavailable; TypeScript dependency could not be loaded.\n');
    process.exit(1);
  }
  throw new Error('Inspection dependency unavailable');
}

const properties = new Set(['accessToken', 'refreshToken', 'password', 'currentPassword', 'newPassword', 'confirmPassword', 'ACCESS_TOKEN', 'REFRESH_TOKEN']);
const targets = [
  'F01/front/src/app/providers/authStore.test.ts',
  'F01/front/src/app/providers/authStore.ts',
  'F01/front/src/features/consumer/ConsumerProfile.test.tsx',
];

function propertyName(node) {
  if (!ts.isPropertyAssignment(node) && !ts.isShorthandPropertyAssignment(node)) return null;
  let name = node.name;
  if (ts.isComputedPropertyName(name)) {
    if (!ts.isStringLiteral(name.expression)) return null;
    name = name.expression;
  }
  if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return null;
  return properties.has(name.text) ? name.text : null;
}

function callKind(node) {
  if (!ts.isCallExpression(node)) return null;
  const expression = node.expression;
  const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
  if (['expect', 'toEqual', 'toBe', 'toHaveBeenCalledWith', 'toMatchObject', 'toBeDefined'].includes(name)) return 'assertion';
  if (['mock', 'mockResolvedValue', 'mockReturnValue', 'fn', 'spyOn'].includes(name)) return 'mock';
  if (['setItem', 'getItem', 'removeItem'].includes(name)) return 'storage-call';
  if (['min', 'max', 'minLength', 'maxLength', 'validate'].includes(name)) return 'validation-call';
  return null;
}

function contexts(node) {
  const found = new Set();
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isCallExpression(current)) {
      const expression = current.expression;
      const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
      if (['expect', 'toEqual', 'toBe', 'toHaveBeenCalledWith', 'toMatchObject'].includes(name)) found.add('assertion');
      if (['mock', 'mockResolvedValue', 'mockReturnValue', 'fn', 'spyOn'].includes(name)) found.add('mock');
      if (['setItem', 'getItem', 'removeItem'].includes(name)) found.add('storage-call');
      if (['min', 'max', 'minLength', 'maxLength', 'validate'].includes(name)) found.add('validation-call');
    }
  }
  return [...found].sort();
}

function lengthBand(length) {
  if (length === 0) return '0';
  if (length < 4) return '1-3';
  if (length < 8) return '4-7';
  if (length < 16) return '8-15';
  return '16+';
}

function inspectSources(inputs) {
  const parsed = inputs.map(({ name, text }, index) => {
    const source = ts.createSourceFile(`/input/F${index + 1}.` + (name.endsWith('.tsx') ? 'tsx' : 'ts'), text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    if (source.parseDiagnostics.length) throw new Error('Source parse failed');
    return { source, file: `F${index + 1}` };
  });
  const sourceMap = new Map(parsed.map(({ source }) => [source.fileName, source]));
  const options = { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => sourceMap.get(name);
  host.fileExists = (name) => sourceMap.has(name);
  host.readFile = () => undefined;
  const checker = ts.createProgram([...sourceMap.keys()], options, host).getTypeChecker();
  const nodeIds = new Map();
  for (const { source } of parsed) {
    function assign(node) {
      nodeIds.set(node, `N${nodeIds.size + 1}`);
      ts.forEachChild(node, assign);
    }
    assign(source);
  }
  const ids = new Map();
  const otherLiteralIds = new Map();
  const identifierIds = new Map();
  const symbolIds = new Map();
  function symbolData(node) {
    if (!ts.isIdentifier(node)) return null;
    const symbol = ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    const declarations = symbol?.declarations?.map((item) => nodeIds.get(item)).filter(Boolean) || [];
    if (!declarations.length) return null;
    if (!symbolIds.has(symbol)) symbolIds.set(symbol, `S${symbolIds.size + 1}`);
    return { symbolId: symbolIds.get(symbol), declarationNodeIds: declarations };
  }
  const ambiguities = [];
  function location(source, node) {
    return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  }
  function gather({ source, file }) {
    function visit(node) {
      const property = propertyName(node);
      if (ts.isIdentifier(node)) {
        if (!identifierIds.has(node.text)) identifierIds.set(node.text, `I${identifierIds.size + 1}`);
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ids.has(node.text)) ids.set(node.text, `L${ids.size + 1}`);
      if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isRegularExpressionLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
        const key = `${node.kind}:${node.getText(source)}`;
        if (!otherLiteralIds.has(key)) otherLiteralIds.set(key, `V${otherLiteralIds.size + 1}`);
      }
      if (property && ts.isPropertyAssignment(node)) {
        if (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
          if (!ids.has(node.initializer.text)) ids.set(node.initializer.text, `L${ids.size + 1}`);
        } else {
          ambiguities.push({ file, line: location(source, node), property, reason: 'nonliteral initializer' });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  parsed.forEach(gather);
  const occurrences = [];
  const identifierOccurrences = [];
  const propertyInventory = [];
  const sites = [];
  const identifiers = [];
  const flows = [];
  const argumentsInventory = [];
  function collect({ source, file }) {
    function visit(node) {
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const name = node.name;
        const form = ts.isShorthandPropertyAssignment(node) ? 'shorthand' : ts.isComputedPropertyName(name) ? 'computed' : ts.isStringLiteral(name) ? 'quoted' : 'identifier';
        const initializer = ts.isPropertyAssignment(node) ? node.initializer : node.name;
        const direct = ts.isIdentifier(initializer) ? symbolData(initializer) : null;
        propertyInventory.push({ file, line: location(source, node), nodeId: nodeIds.get(node), valueNodeId: nodeIds.get(initializer), form, property: propertyName(node), symbolId: direct?.symbolId || null, literalId: (ts.isStringLiteral(initializer) || ts.isNoSubstitutionTemplateLiteral(initializer)) ? ids.get(initializer.text) : null, resolution: form === 'computed' ? 'computed-unresolved' : direct ? 'direct-symbol' : 'unresolved' });
      }
      if (ts.isIdentifier(node) && identifierIds.has(node.text)) {
        const declaration = (ts.isVariableDeclaration(node.parent) || ts.isParameter(node.parent) || ts.isBindingElement(node.parent) || ts.isFunctionDeclaration(node.parent)) && node.parent.name === node;
        identifierOccurrences.push({ file, line: location(source, node), identifierId: identifierIds.get(node.text), role: declaration ? 'declaration' : 'occurrence', resolution: 'unresolved-text-equality-only' });
        const symbol = symbolData(node);
        identifiers.push({ file, line: location(source, node), nodeId: nodeIds.get(node), role: declaration ? 'declaration' : 'occurrence', symbolId: symbol?.symbolId || null, declarationNodeIds: symbol?.declarationNodeIds || [], resolution: symbol ? 'checker-local-symbol' : 'unresolved' });
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const target = symbolData(node.name);
        const initial = node.initializer;
        const direct = ts.isIdentifier(initial) ? symbolData(initial) : null;
        const literal = ts.isStringLiteral(initial) || ts.isNoSubstitutionTemplateLiteral(initial) ? ids.get(initial.text) : null;
        flows.push({ file, line: location(source, node), nodeId: nodeIds.get(node), initializerNodeId: nodeIds.get(initial), kind: direct || literal ? 'direct-binding' : 'unresolved-binding', targetSymbolId: target?.symbolId || null, sourceSymbolId: direct?.symbolId || null, literalId: literal || null });
      }
      if (ts.isCallExpression(node)) {
        node.arguments.forEach((arg, index) => {
          const direct = ts.isIdentifier(arg) ? symbolData(arg) : null;
          argumentsInventory.push({ file, line: location(source, arg), callNodeId: nodeIds.get(node), nodeId: nodeIds.get(arg), index, kind: callKind(node) || 'other-call', symbolId: direct?.symbolId || null, literalId: (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? ids.get(arg.text) : null, resolution: direct ? 'direct-symbol' : ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg) ? 'direct-literal' : 'unresolved' });
        });
      }
      const kind = callKind(node);
      if (kind) {
        const boundary = kind === 'validation-call' && node.arguments.find((arg) => ts.isNumericLiteral(arg));
        sites.push({ file, line: location(source, node), nodeId: nodeIds.get(node), kind, resolution: 'unresolved', boundaryNodeId: boundary ? nodeIds.get(boundary) : null, boundaryBand: boundary ? lengthBand(Number(boundary.text)) : null });
      }
      if (ts.isBinaryExpression(node)) {
        const isLength = (part) => ts.isPropertyAccessExpression(part) && part.name.text === 'length';
        const boundary = isLength(node.left) && ts.isNumericLiteral(node.right) ? node.right : isLength(node.right) && ts.isNumericLiteral(node.left) ? node.left : null;
        if (boundary) sites.push({ file, line: location(source, node), nodeId: nodeIds.get(node), leftNodeId: nodeIds.get(node.left), rightNodeId: nodeIds.get(node.right), boundaryNodeId: nodeIds.get(boundary), kind: 'length-comparison', resolution: 'unresolved', boundaryBand: lengthBand(Number(boundary.text)) });
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && ids.has(node.text)) {
        const property = node.parent && propertyName(node.parent);
        occurrences.push({ file, line: location(source, node), nodeId: nodeIds.get(node), kind: ts.isStringLiteral(node) ? 'StringLiteral' : 'NoSubstitutionTemplateLiteral', property: property || null, literalId: ids.get(node.text), lengthBand: lengthBand(node.text.length), contexts: contexts(node) });
      }
      if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node) || ts.isRegularExpressionLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) {
        occurrences.push({ file, line: location(source, node), nodeId: nodeIds.get(node), kind: 'OtherLiteral', property: null, literalId: otherLiteralIds.get(`${node.kind}:${node.getText(source)}`), lengthBand: null, contexts: contexts(node) });
      }
      if (ts.isTemplateExpression(node)) sites.push({ file, line: location(source, node), nodeId: nodeIds.get(node), kind: 'dynamic-template', resolution: 'unresolved', boundaryBand: null });
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  parsed.forEach(collect);
  return JSON.stringify({ files: parsed.map(({ file }, index) => ({ file, ordinal: index + 1 })), occurrences, ambiguities, properties: propertyInventory, identifierOccurrences, identifiers, flows, arguments: argumentsInventory, sites, limitations: ['Checker symbol links are limited to declarations in the supplied sources; imports, dynamic properties and external dependencies may be unresolved.', 'Direct bindings record syntax only, not mutations, runtime flow, shadow effects or transitive alias evaluation.', 'Identifier IDs indicate textual equality only; use symbol IDs for local checker identity.', 'Property, call and context labels are heuristic; length bands are not validation outcomes.', 'JSX text and dynamic template fragments are not literal equality-inventoried; dynamic templates are unresolved sites.'] }, null, 2);
}

function targetDetail(reportText) {
  const report = JSON.parse(reportText);
  const selectedProperties = report.properties.filter((entry) => entry.property !== null || entry.form === 'computed' || entry.form === 'shorthand');
  const symbolIds = new Set(selectedProperties.map((entry) => entry.symbolId).filter(Boolean));
  let changed;
  do {
    changed = false;
    for (const flow of report.flows) {
      if (flow.sourceSymbolId && flow.targetSymbolId && (symbolIds.has(flow.sourceSymbolId) || symbolIds.has(flow.targetSymbolId))) {
        for (const id of [flow.sourceSymbolId, flow.targetSymbolId]) if (!symbolIds.has(id)) { symbolIds.add(id); changed = true; }
      }
    }
  } while (changed);
  const selectedSites = report.sites.filter((entry) => ['storage-call', 'validation-call', 'length-comparison', 'assertion', 'mock'].includes(entry.kind));
  const siteIds = new Set(selectedSites.map((entry) => entry.nodeId));
  return JSON.stringify({ files: report.files, properties: selectedProperties, identifiers: report.identifiers.filter((entry) => symbolIds.has(entry.symbolId)), flows: report.flows.filter((entry) => symbolIds.has(entry.targetSymbolId) || symbolIds.has(entry.sourceSymbolId)), occurrences: report.occurrences, sites: selectedSites, arguments: report.arguments.filter((entry) => siteIds.has(entry.callNodeId)), ambiguities: report.ambiguities, limitations: [...report.limitations, 'Alias closure follows only direct identifier initializers and is structural, not proof of runtime equivalence.'] }, null, 2);
}

if (require.main === module) {
  try {
    if (process.argv.length > 3 || (process.argv[2] && !['--summary', '--detail'].includes(process.argv[2]))) throw new Error('Arguments not accepted');
    const root = path.resolve(__dirname, '..');
    const inputs = targets.map((name) => ({ name, text: fs.readFileSync(path.join(root, name), 'utf8') }));
    const report = inspectSources(inputs);
    if (process.argv[2] === '--summary') {
      const result = JSON.parse(report);
      process.stdout.write(JSON.stringify({ files: result.files.length, occurrences: result.occurrences.length, ambiguities: result.ambiguities.length, properties: result.properties.length, identifiers: result.identifiers.length, flows: result.flows.length, arguments: result.arguments.length, sites: result.sites.length }) + '\n');
    } else process.stdout.write((process.argv[2] === '--detail' ? targetDetail(report) : report) + '\n');
  } catch {
    process.stderr.write('Inspection failed; no report generated.\n');
    process.exitCode = 1;
  }
}

module.exports = { inspectSources, targetDetail };
