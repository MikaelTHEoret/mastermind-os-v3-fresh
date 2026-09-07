import {
  digestMastermindNodeCredential,
  parseMastermindNodeCredential,
  parseMastermindNodePairingCredential,
} from '../../../protocol/mastermind-node-exchange/contract.mjs';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;

export class MastermindNodeCredentialStoreError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'MastermindNodeCredentialStoreError';
    this.code = code;
  }
}

function credentialError(code, message, cause) {
  return new MastermindNodeCredentialStoreError(code, message, cause ? { cause } : undefined);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.');
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.');
  }
  return value;
}

function canonicalTimestamp(value) {
  return typeof value === 'string' && value.length === 24
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function displayName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64
    || value.trim() !== value || CONTROL_CHARACTERS.test(value)) {
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node display name is invalid.');
  }
  return value;
}

/**
 * Validate the exact record encrypted by a platform credential store. A
 * pending record deliberately retains both opaque credentials so an ambiguous
 * pair request can be retried byte-for-byte. A paired record erases the
 * one-time pairing credential.
 */
export function validateMastermindNodeCredentialRecord(value) {
  exactKeys(value, [
    'schemaVersion', 'state', 'nodeId', 'nodeCredential', 'pairingId',
    'pairingCredential', 'displayName', 'createdAt', 'pairedAt',
  ]);
  if (value.schemaVersion !== 1 || !['pending', 'paired'].includes(value.state)) {
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.');
  }
  let node;
  try { node = parseMastermindNodeCredential(value.nodeCredential); }
  catch (error) { throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.', error); }
  if (node.nodeId !== value.nodeId || !canonicalTimestamp(value.createdAt)) {
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.');
  }
  displayName(value.displayName);
  if (value.state === 'pending') {
    let pairing;
    try { pairing = parseMastermindNodePairingCredential(value.pairingCredential); }
    catch (error) { throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.', error); }
    if (pairing.pairingId !== value.pairingId || value.pairedAt !== null) {
      throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.');
    }
  } else if (value.pairingCredential !== null || !canonicalTimestamp(value.pairedAt)) {
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.');
  }
  return structuredClone(value);
}

export function assertMastermindNodeCredentialStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store) || typeof store.load !== 'function') {
    throw new TypeError('credentialStore must expose an asynchronous load() boundary');
  }
  return store;
}

export async function loadMastermindNodeCredentialRecord(store) {
  assertMastermindNodeCredentialStore(store);
  let record;
  try { record = await store.load(); }
  catch (error) {
    if (error instanceof MastermindNodeCredentialStoreError) throw error;
    throw credentialError('NODE_CREDENTIAL_UNAVAILABLE', 'The protected node credential is unavailable.', error);
  }
  if (record === null) return null;
  try { return validateMastermindNodeCredentialRecord(record); }
  catch (error) {
    if (error instanceof MastermindNodeCredentialStoreError) throw error;
    throw credentialError('NODE_CREDENTIAL_INVALID', 'The protected node credential record is invalid.', error);
  }
}

/** Return only non-secret enrollment state for health and request shaping. */
export async function inspectMastermindNodeCredentialState(store) {
  const record = await loadMastermindNodeCredentialRecord(store);
  if (!record) {
    return Object.freeze({
      state: 'unpaired', nodeId: null, pairingId: null, credentialSha256: null,
      displayName: null, createdAt: null, pairedAt: null,
    });
  }
  return Object.freeze({
    state: record.state,
    nodeId: record.nodeId,
    pairingId: record.pairingId,
    credentialSha256: digestMastermindNodeCredential(record.nodeCredential),
    displayName: record.displayName,
    createdAt: record.createdAt,
    pairedAt: record.pairedAt,
  });
}

/** Compatibility helper for exchange-only consumers; pending is not paired. */
export async function loadMastermindNodeCredential(store) {
  const record = await loadMastermindNodeCredentialRecord(store);
  if (!record || record.state !== 'paired') return null;
  return Object.freeze({ credential: record.nodeCredential, nodeId: record.nodeId });
}

export async function markMastermindNodePaired(store, scope) {
  assertMastermindNodeCredentialStore(store);
  if (typeof store.markPaired !== 'function') {
    throw new TypeError('credentialStore must expose markPaired() for pending enrollment');
  }
  try {
    return await store.markPaired(scope);
  } catch (error) {
    if (error instanceof MastermindNodeCredentialStoreError) throw error;
    throw credentialError('NODE_CREDENTIAL_WRITE_FAILED', 'The paired node credential state could not be saved.', error);
  }
}

/**
 * Retire only the exact pending enrollment that the hosted pairing service has
 * authoritatively reported as expired. This deliberately is not a generic
 * credential clear operation: paired identities and changed pending claims
 * must survive unchanged.
 */
export async function retireMastermindNodePendingPairing(store, scope) {
  assertMastermindNodeCredentialStore(store);
  if (typeof store.retirePendingPairing !== 'function') {
    throw new TypeError('credentialStore must expose retirePendingPairing() for expired enrollment');
  }
  try {
    return await store.retirePendingPairing(scope);
  } catch (error) {
    if (error instanceof MastermindNodeCredentialStoreError) throw error;
    throw credentialError(
      'NODE_CREDENTIAL_WRITE_FAILED',
      'The expired node enrollment could not be retired.',
      error,
    );
  }
}
