const registry = {
  schemaVersion: 1,
  registryId: 'mastermind.node',
  capabilities: [
    {
      id: 'node.status.read',
      version: 1,
      kind: 'query',
      policyClass: 'routine',
      hardGate: false,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 0,
      },
    },
    {
      id: 'family-ecosystem.ensure-running',
      version: 1,
      kind: 'command',
      policyClass: 'routine',
      hardGate: false,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        maxProperties: 0,
      },
    },
  ],
};

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The runtime copy of the frozen v1 capability registry. The adjacent JSON
 * artifact is byte-independent but contract-tested to contain the same value.
 */
export const MASTERMIND_NODE_CAPABILITY_REGISTRY = deepFreeze(registry);

