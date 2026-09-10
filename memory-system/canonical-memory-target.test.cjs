'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { resolveMemoryUrl, MemoryTargetConfigurationError } = require('./canonical-memory-target.cjs');
const sample = (query = '') => 'postgresql' + '://' + 'fixture-user:p%40ss%3Aword@memory.invalid:5544/archive' + query;
const resolve = (source, options = {}) => resolveMemoryUrl(options, { NEON_MEMORY_URL: source });

test('import performs no environment access, require, or I/O', () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('./canonical-memory-target.cjs'), 'utf8'), {
    module, process: new Proxy({}, { get() { throw new Error('environment forbidden'); } }),
    require() { throw new Error('dependency forbidden'); },
  });
  assert.equal(typeof module.exports.resolveMemoryUrl, 'function');
});
test('generic DATABASE_URL is never a fallback', () => {
  assert.throws(() => resolveMemoryUrl({}, { DATABASE_URL: sample() }), /NEON_MEMORY_URL_REQUIRED/);
});
test('retains target, encoded credentials and unrelated configured options', () => {
  const source = new URL(sample('?channel_binding=require&application_name=legacy+reader'));
  const actual = new URL(resolve(source.href, { sslmode: 'require' }));
  for (const key of ['protocol', 'username', 'password', 'hostname', 'port', 'pathname']) assert.equal(actual[key], source[key]);
  assert.deepEqual(Object.fromEntries(actual.searchParams), { channel_binding: 'require', application_name: 'legacy reader', sslmode: 'require' });
});
test('adds reviewed TLS and timeout without dropping other options', () => {
  assert.deepEqual(Object.fromEntries(new URL(resolve(sample(), { sslmode: 'require', connect_timeout: '15' })).searchParams), { sslmode: 'require', connect_timeout: '15' });
});
test('retains matching explicit options', () => {
  const source = sample('?sslmode=require&connect_timeout=15');
  assert.equal(resolve(source, { sslmode: 'require', connect_timeout: '15' }), source);
});
test('holds conflicting TLS and timeout', () => {
  for (const [query, options] of [['?sslmode=verify-full', { sslmode: 'require' }], ['?sslmode=disable', { sslmode: 'require' }], ['?connect_timeout=3', { connect_timeout: '15' }]]) {
    assert.throws(() => resolve(sample(query), options), /OPTION_CONFLICT/);
  }
});
test('rejects duplicate, malformed, unsafe and incomplete configuration', () => {
  for (const source of [sample('?sslmode=require&sslmode=disable'), sample('?sslmode'), sample() + '#fragment', sample().replace('/archive', '/'), '\n' + sample(), sample().replace(':5544', ':invalid'), 'https://memory.invalid/archive']) {
    assert.throws(() => resolve(source), MemoryTargetConfigurationError);
  }
});
test('rejects unreviewed or invalid caller options', () => {
  for (const options of [{ options: '-c search_path=private' }, { sslmode: 'disable' }, { connect_timeout: '0' }, { connect_timeout: '301' }, { connect_timeout: 15 }, [], null]) {
    assert.throws(() => resolve(sample(), options), MemoryTargetConfigurationError);
  }
});
test('configuration error contains no configured credential value', () => {
  assert.throws(() => resolve(sample('?sslmode=disable'), { sslmode: 'require' }), (error) => {
    assert.equal(error.message, 'CANONICAL_MEMORY_CONNECTION_OPTION_CONFLICT');
    assert.equal(error.message.includes('fixture-user'), false); return true;
  });
});
test('holds malformed and non-UTF8 percent-encoded option keys and values', () => {
  for (const query of ['?options=%FF', '?%FF=value', '?options=%', '?options=%2', '?options=%GG']) {
    assert.throws(() => resolve(sample(query), { sslmode: 'require' }), MemoryTargetConfigurationError);
  }
});
test('retains valid encoded Unicode options while adding required TLS', () => {
  const result = new URL(resolve(sample('?application_name=%E2%98%83+reader'), { sslmode: 'require' }));
  assert.equal(result.searchParams.get('application_name'), '\u2603 reader');
});
