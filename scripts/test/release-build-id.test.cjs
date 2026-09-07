const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseBuildId } = require('../release-build-id.cjs');
const pin = 'a' + '1234567890'.repeat(3) + '123456789';
test('ordinary unpinned local builds retain Next fallback', () => {
  assert.equal(releaseBuildId({}), null);
  assert.equal(releaseBuildId({ VERCEL_GIT_COMMIT_SHA: pin }), null);
});
test('full explicit and hosted revisions bind the same build identity', () => {
  assert.equal(releaseBuildId({ MASTERMIND_RELEASE_WEB_REVISION: pin.toUpperCase() }), pin);
  assert.equal(releaseBuildId({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: pin }), pin);
  assert.equal(releaseBuildId({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: pin, MASTERMIND_RELEASE_WEB_REVISION: pin }), pin);
});
test('malformed and conflicting release pins fail closed', () => {
  for (const value of ['', 'main', pin.slice(0, 39), pin + '0', pin + '\n', ' ' + pin]) {
    assert.throws(() => releaseBuildId({ MASTERMIND_RELEASE_WEB_REVISION: value }), /REVISION_INVALID/);
    assert.throws(() => releaseBuildId({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: value }), /REVISION_INVALID/);
  }
  assert.throws(() => releaseBuildId({ VERCEL: '1', VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40), MASTERMIND_RELEASE_WEB_REVISION: pin }), /REVISION_CONFLICT/);
});
test('actual Next callback is wired to the release selector', () => {
  const config = require('../../next.config.js');
  assert.equal(typeof config.generateBuildId, 'function');
  assert.equal(config.generateBuildId(), releaseBuildId());
});
