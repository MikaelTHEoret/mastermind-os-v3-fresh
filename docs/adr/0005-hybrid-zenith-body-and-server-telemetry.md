# ADR 0005: Zenith body, authoritative server telemetry, and manual takeover

Status: accepted.

## Decision

The primary body for `The_AlChemist___` will be a pinned ZenithProxy runtime extended by a Mastermind plugin. The rendered Fabric client remains a reference and rollback path; it is not the production companion body. Zenith's native bot is the conservative default/fallback driver. An enhanced headless Mastermind controller connects through Zenith's normal Minecraft-protocol controller entrance, just as a real player client does.

The system keeps three explicit responsibilities:

- Zenith owns the authenticated upstream Minecraft player session, packet-level state, conservative fallback behavior, reconnect/respawn, and the private controller endpoint.
- The enhanced Mastermind controller is a separately authenticated headless controller session. It uses the same embodiment path as a real client and never needs desktop rendering or computer-use automation.
- `family-core` owns authoritative server observations, player identity, chat events, world-policy enforcement, home zones, and server-side facts that a remote client cannot safely infer.
- The existing Minecraft control plane owns conversation, profiles, planning, task arbitration, survival policy, approvals, resource limits, and reconciliation of the two observation sources.

No model receives Zenith terminal commands, its Web API, raw packets, or unrestricted server commands. The control plane exposes only typed, bounded, cancellable skills which are advertised after implementation and acceptance.

Physical driver priority is `HUMAN_PARENT`, `MASTERMIND_CONTROLLER`, `ZENITH_FALLBACK`, then safe idle. Only one driver may own the controller lease. Zenith's native `ClientBotTick` boundary already separates native bot input from a connected controlling player; Mastermind adds identity-aware lease and handback checks around that boundary.

## Integration policy

The first implementation uses Zenith's public plugin API against the exact stable release `3.5.8+26.2.0`, source commit `550257ac720c06e4902c8d5dcbc7869b898ea7bd`. Mastermind does not vendor or silently patch Zenith. A minimal core patch is allowed only when a required safety hook cannot be implemented through the plugin API. Seamless parent preemption of an already-connected service controller is one hook that must be proven before activation; stock Zenith otherwise admits only one controlling session and rejects a second controller. Any patch requires its own review, AGPL compliance decision, pinned diff, tests, and upgrade plan.

The Zenith runtime is an external AGPL-3.0 component. The Mastermind plugin is separately authored code. Release packaging must preserve third-party notices and must not imply that external code was audited merely because its hash was pinned.

## Parent manual takeover lease

Manual control is a first-class recovery feature, not an exceptional bypass.

1. An authenticated controller admitted by Zenith immediately moves physical control to `RECOVERY_HOLD` and cancels native fallback input. Status pings, scanners, and unauthenticated sockets do not alter body state.
2. The connection becomes `HUMAN_PARENT` only after Zenith authentication and an exact UUID match against the configured parent allowlist.
3. A non-parent connection never receives AI authority and leaves the body in the fail-closed hold state while Zenith's own authentication/whitelist policy rejects it.
4. During takeover, conversation and server telemetry may continue, but neither the enhanced controller nor native Zenith fallback can acquire the body.
5. Disconnect returns the body to `RECOVERY_HOLD`, not directly to AI.
6. The body returns first to conservative `ZENITH_FALLBACK`, and only after the controller is absent, the kill switch is clear, no physical action is active, and fresh correlated Zenith and server observations remain stable for the configured handback window. Enhanced control requires its service controller to authenticate again.
7. Ambiguous identity, stale telemetry, transport loss, or concurrent input always fails closed.

The proxy listener is loopback or private-LAN only. UPnP, public binding, Cloudflare exposure, and IP-address-only authorization are prohibited. The parent Minecraft UUID/profile is the identity boundary; the source IP is only an additional network restriction.

## Observation authority

Server observations are authoritative for identity, dimension, position, health, hunger, effects, damage, nearby threats, protected zones, and world-policy decisions. Zenith observations are authoritative for controller presence, packet-session health, Baritone state, input ownership, and action progress.

Reconciliation rejects wrong sessions, old sequences, stale timestamps, mismatched companion UUIDs, and excessive source skew. It never averages conflicting safety facts. A server/Zenith conflict makes physical actions unavailable until a fresh stable pair arrives.

Telemetry is bounded and event-driven, with a low-rate heartbeat. There is no per-message process creation, continuous screenshot capture, or unbounded every-tick journal.

## Consequences

Benefits include headless operation, lower idle resource use than a rendered client, automatic reconnect/respawn, existing Baritone support, and direct parent control without desktop automation. Expected limitations are the absence of rendered vision, release coupling to Zenith/Minecraft, and the need for server-assisted implementations for some inventories, containers, entities, and policy-sensitive actions.

All new components and protocol entries begin disabled. This ADR does not authorize installation, a server restart, account migration, or live-world mutation.
