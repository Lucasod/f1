const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const { inspect } = require('node:util');
const ts = require('typescript');

// Compile only this source file; never import application or test setup modules.
const source = readFileSync(path.join(__dirname, 'index.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

function loadConfig(environment, executable = compiled) {
  const sentinels = [randomUUID(), randomUUID()];
  const output = [];
  let dotenvCalls = 0;
  const capture = (...args) => {
    // Inspect nested console arguments without invoking getters or custom inspectors.
    // Keep the rendered output internal, including when an assertion fails.
    output.push(args.map((value) => inspect(value, {
      depth: null,
      customInspect: false,
      getters: false,
      maxArrayLength: null,
      maxStringLength: null,
    })).join(' '));
  };
  const sandbox = {
    exports: {},
    __dirname,
    process: {
      env: { ...environment, TEST_USER_PASSWORD: sentinels[0] },
      cwd: () => '/synthetic-config-test',
    },
    console: Object.fromEntries(
      ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir'].map((method) => [method, capture]),
    ),
    require: (name) => {
      if (name === 'path') return path;
      if (name === 'dotenv') {
        return { config: () => {
          dotenvCalls += 1;
          return { parsed: { SYNTHETIC_CONFIG_VALUE: sentinels[1] } };
        } };
      }
      throw new Error('Unexpected module requested by isolated configuration');
    },
  };
  let failed = false;
  let errorMessage = '';
  try {
    runInNewContext(executable, sandbox, { timeout: 1000 });
  } catch (error) {
    // Never forward a raw error or captured output to the test reporter.
    failed = true;
    errorMessage = typeof error.message === 'string' ? error.message : '';
  }
  return {
    exports: sandbox.exports,
    failed,
    errorMessage,
    dotenvCalls,
    disclosed: sentinels.some((sentinel) => output.some((line) => line.includes(sentinel))),
  };
}

test('startup diagnostics do not disclose dotenv or environment values', () => {
  const result = loadConfig({ NODE_ENV: 'test' });
  assert.equal(result.failed, false, 'Isolated configuration must load');
  assert.equal(result.dotenvCalls, 1, 'Configuration must still load dotenv');
  assert.equal(result.disclosed, false, 'Startup diagnostics must not disclose configuration values');
});

test('capture detects nested object disclosure in synthetic unsafe diagnostics', () => {
  const unsafeDiagnostics = `${compiled}\nconsole.error({ nested: [require('dotenv').config()] });`;
  const result = loadConfig({ NODE_ENV: 'test' }, unsafeDiagnostics);
  assert.equal(result.failed, false, 'Synthetic configuration must run in the isolated sandbox');
  assert.equal(result.disclosed, true, 'Capture must detect nested configuration values');
});

test('production validation retains useful field-only configuration errors', () => {
  const requiredNames = ['MONGO_URI', 'REDIS_URL', 'ELASTICSEARCH_URL', 'JWT_SECRET'];
  const validEnvironment = {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://example.invalid',
    ...Object.fromEntries(requiredNames.map((name) => [name, randomUUID()])),
  };
  for (const name of requiredNames) {
    const result = loadConfig({ ...validEnvironment, [name]: '   ' });
    assert.equal(result.failed, true, 'Empty required production fields must still fail');
    assert.equal(
      result.errorMessage === `Configuration error: ${name} is required in production but is empty or whitespace`,
      true,
      'Validation must identify the missing field without its value',
    );
    assert.equal(result.disclosed, false, 'Rejected configuration must not disclose values');
  }
  for (const origin of ['', '*']) {
    const result = loadConfig({ ...validEnvironment, CORS_ORIGIN: origin });
    const expected = origin === ''
      ? 'Configuration error: CORS_ORIGIN is required in production and must contain at least one valid origin'
      : 'Configuration error: Wildcard (*) CORS origin is not allowed in production when credentials are enabled';
    assert.equal(result.failed, true, 'Unsafe production CORS must still fail');
    assert.equal(result.errorMessage === expected, true, 'CORS errors must remain useful and value-free');
    assert.equal(result.disclosed, false, 'Rejected CORS must not disclose values');
  }
  const valid = loadConfig(validEnvironment);
  assert.equal(valid.failed, false, 'Configured production startup must still succeed');
  assert.equal(valid.disclosed, false, 'Production startup must not disclose values');
  let validationFailed = false;
  try {
    valid.exports.validateConfig();
  } catch {
    validationFailed = true;
  }
  assert.equal(validationFailed, false, 'Valid production configuration must pass explicit validation');
});
