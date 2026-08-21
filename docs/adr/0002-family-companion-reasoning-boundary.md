# ADR 0002: Constrained reasoning boundary

Status: accepted.

The family companion uses a provider-neutral reasoning interface behind a dedicated local Mastermind route. It does not call the existing `/chat` Stargate agentic path because that path can expose a broad MCP catalog.

The dedicated lane accepts exact, bounded reasoning requests and only the already-authorized Minecraft tool descriptors supplied by the control plane. Provider credentials remain server-side. Deterministic survival never depends on this lane.
