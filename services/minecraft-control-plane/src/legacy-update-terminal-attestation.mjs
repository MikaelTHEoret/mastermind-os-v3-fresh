const SHA256 = /^[a-f0-9]{64}$/;

const ATTESTATION_KEYS = Object.freeze([
  'adoptedAt',
  'instanceRecordSha256',
  'instanceStoreSha256',
  'keySha256',
  'originalMarkerSha256',
  'schemaVersion',
  'state',
]);

export const LEGACY_TERMINAL_INSTANCE_ID = 'family-server';
export const LEGACY_TERMINAL_TRANSACTION_ID = '852e987b-c451-43d9-8bd2-e2e6ddb570c5';
export const LEGACY_TERMINAL_MARKER_SHA256 = 'f53bae918333fac06c8040f6d7924df7a21acf46af0b5a8aca5b0840f8b4ad2e';
export const LEGACY_TERMINAL_INSTANCE_STORE_SHA256 = '247f13a5e70103dc6bf044fe52ad9bf36d795e6ed6546bd7648b0347f1052697';
export const LEGACY_TERMINAL_INSTANCE_RECORD_SHA256 = '84fe3be3c11a04c835cecbc3310badae8814cc3eab8f13e8f4ed6df3a89cd272';

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function validLegacyUpdateTerminalAttestation(value) {
  return exactKeys(value, ATTESTATION_KEYS)
    && value.schemaVersion === 1
    && value.state === 'adopted-legacy-terminal'
    && canonicalTimestamp(value.adoptedAt)
    && SHA256.test(value.originalMarkerSha256 ?? '')
    && SHA256.test(value.instanceStoreSha256 ?? '')
    && SHA256.test(value.instanceRecordSha256 ?? '')
    && SHA256.test(value.keySha256 ?? '');
}

export function isAttestedLegacyUpdateTerminalMarker(marker) {
  return marker && typeof marker === 'object' && !Array.isArray(marker)
    && marker.schemaVersion === 1
    && marker.instanceId === LEGACY_TERMINAL_INSTANCE_ID
    && marker.transactionId === LEGACY_TERMINAL_TRANSACTION_ID
    && marker.phase === 'ready'
    && marker.updateKind === 'legacy-migration'
    && marker.retiredCleanup?.state === 'purged'
    && marker.managedBefore === undefined
    && marker.sourceDirectoryIdentity === undefined
    && validLegacyUpdateTerminalAttestation(marker.legacyTerminalAttestation)
    && marker.legacyTerminalAttestation.originalMarkerSha256 === LEGACY_TERMINAL_MARKER_SHA256
    && marker.legacyTerminalAttestation.instanceStoreSha256 === LEGACY_TERMINAL_INSTANCE_STORE_SHA256
    && marker.legacyTerminalAttestation.instanceRecordSha256 === LEGACY_TERMINAL_INSTANCE_RECORD_SHA256;
}

export function createLegacyUpdateTerminalAttestation({
  adoptedAt,
  originalMarkerSha256,
  instanceStoreSha256,
  instanceRecordSha256,
  keySha256,
}) {
  const value = {
    schemaVersion: 1,
    state: 'adopted-legacy-terminal',
    adoptedAt,
    originalMarkerSha256,
    instanceStoreSha256,
    instanceRecordSha256,
    keySha256,
  };
  if (!validLegacyUpdateTerminalAttestation(value)) {
    throw new TypeError('Invalid legacy update terminal attestation');
  }
  return Object.freeze({ ...value });
}
