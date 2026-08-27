import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeMinecraftCredentialFrame,
  MINECRAFT_CREDENTIAL_FRAME_MAX_BYTES,
} from '../src/companion/credential-frame.mjs';

const session = Object.freeze({
  username: 'Agent_1',
  uuid: '00112233445566778899aabbccddeeff',
  accessToken: 'minecraft-access-token-1234567890',
  xuid: '281474976710655',
  clientId: '01234567-89ab-4def-8123-456789abcdef',
});

test('encodes the exact MFC1 big-endian frame consumed by the Java bootstrap', () => {
  const frame = encodeMinecraftCredentialFrame(session);
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  assert.equal(frame.subarray(4, 8).toString('ascii'), 'MFC1');
  let offset = 8;
  for (const key of ['username', 'uuid', 'accessToken', 'xuid', 'clientId']) {
    const length = frame.readUInt16BE(offset);
    offset += 2;
    assert.equal(frame.subarray(offset, offset + length).toString('utf8'), session[key]);
    offset += length;
  }
  assert.equal(offset, frame.length);
  assert.equal(frame.length <= MINECRAFT_CREDENTIAL_FRAME_MAX_BYTES + 4, true);
  frame.fill(0);
});

test('rejects extra, missing, malformed, and oversized credential fields without stringifying values', () => {
  for (const value of [
    { ...session, extra: 'secret' },
    Object.fromEntries(Object.entries(session).filter(([key]) => key !== 'xuid')),
    { ...session, username: 'bad name' },
    { ...session, uuid: 'not-a-uuid' },
    { ...session, accessToken: `valid${'x'.repeat(24 * 1024)}` },
    { ...session, accessToken: 'line\nbreak' },
    { ...session, xuid: 'xuid' },
    { ...session, clientId: 'invalid' },
  ]) {
    assert.throws(() => encodeMinecraftCredentialFrame(value), (error) => (
      error instanceof TypeError && !error.message.includes(session.accessToken)
    ));
  }
});
