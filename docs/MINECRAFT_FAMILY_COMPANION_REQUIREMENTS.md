# Mastermind Family Companion Requirements

Status: accepted foundation requirements. Runtime features described as `stubbed` remain disabled until their acceptance gate passes.

## Product identities

### Computer

- The server administrative mind, invoked through `/computer`.
- Uses deterministic handlers for help and status before any model call.
- Speaks as `[Computer]`, publicly by default and privately for sensitive, approval-related, or long responses.
- May create server, world, mod, and approval plans, but cannot bypass the existing typed control-plane boundaries.
- Never speaks through the companion account and never receives the unrestricted Stargate MCP catalog.

### The_AlChemist___

- The embodied companion and normal conversational character.
- Responds when addressed or when continuing an active conversation.
- Keeps one stable, friendly, calm, slightly eager personality while adapting detail, humor, vocabulary, and initiative to the player and context.
- Maintains at most one foreground physical task while conversation remains available as a side channel.
- Narrates meaningful starts, discoveries, danger, blockers, and completion rather than routine per-block progress.

## Roles and approvals

| Role | Conversation | Safe play tasks | Feature requests | Privileged production changes |
| --- | --- | --- | --- | --- |
| Parent | Yes | Yes | Yes | Approval required and permitted |
| Child | Yes | Yes, prioritized | Yes | Cannot approve |
| Guest | Yes | No by default | No by default | Never |
| Service | Internal only | Policy-bound | Internal only | Never acts as parent |

Parent approval is mandatory for production mod promotion, persistent-world deletion, networking or authentication changes, backup-retention changes, untrusted artifact sources, and generated native code.

## Profile depth

- Parent profiles may contain deep longitudinal preferences, communication style, routines, projects, feedback, and confidence-scored predictions. The local parent profile may be retrieved by the Mastermind Context Gateway for ordinary Codex work.
- Child profiles contain friendship continuity: identity, interests, play style, shared adventures and builds, recurring jokes, promises, boundaries, and recent shared history. They do not infer sensitive psychographics, diagnoses, protected traits, or commercial propensity.
- Guest interactions are not retained unless a parent registers the player and enables capture.
- Only the parent console may inspect, correct, export, forget, or restore profile material.
- Complete interaction history is retained until parent-authorized deletion. Raw content is encrypted at rest; derived claims retain provenance and confidence.

## Runtime hierarchy

Physical priority is fixed:

1. local F8 kill switch or operator stop;
2. immediate survival emergency;
3. parent direct task;
4. child requested task;
5. temporary parent-approved to-do list;
6. active behavior-mode maintenance;
7. safe idle.

The supported behavior-mode contract is `disabled`, `stay_alive`, `home_steward`, `assist`, `follow_adventure`, `independent`, and `custom`. Only tested skills may be enabled in a production mode.

Routine survival and home maintenance make no model calls. Models are reserved for conversation, natural-language task compilation, unfamiliar planning, bounded diagnosis, and future visual escalation.

## Architectural boundaries

- `mastermind-command-center` is the canonical repository.
- The family system does not import or mutate the isolated 2b2t client.
- No model call runs in the Minecraft JVM.
- No player text is forwarded to unrestricted MCP tools.
- Minecraft and server actions are typed, versioned, bounded, cancellable, and capability-advertised only after implementation.
- Memory synchronization is downstream of gameplay and cannot block survival, cancellation, chat intake, or server ticks.
- The brain begins as modules inside the existing Minecraft control-plane process; it does not add an always-on Python or Node service.
- Skeleton code returns `FEATURE_DISABLED` or `FEATURE_NOT_IMPLEMENTED` and never pretends to act.
- The primary companion body is a pinned ZenithProxy runtime with a Mastermind plugin. The rendered Fabric client is retained only as a reference and rollback path.
- Native Zenith is the conservative default/fallback driver. The enhanced headless Mastermind controller enters through Zenith's normal Minecraft-protocol controller login, using the same embodiment path as a real player client.
- Zenith owns the authenticated upstream player session, fallback Baritone behavior, reconnect/respawn, and private controller login; `family-core` provides authoritative server telemetry and policy enforcement.
- Integration starts with Zenith's public plugin API. A maintained Zenith core fork is permitted only if a required safety hook is unavailable and its AGPL, review, testing, and upgrade obligations are explicitly accepted.
- Raw Zenith terminal commands, Web APIs, packets, and credentials are never exposed to player chat or a model.

## Parent manual control

- A parent can connect a normal Minecraft client to a private Zenith endpoint and directly place, inspect, or unstuck `The_AlChemist___`.
- Driver priority is parent, enhanced Mastermind service controller, native Zenith fallback, then idle. A lease permits only one physical driver.
- An authenticated controller admitted by Zenith suspends fallback movement before Mastermind assigns its role. Status pings and unauthenticated sockets do not affect body state. Only an explicitly allowlisted parent UUID may receive parent authority.
- Manual control is exclusive: Baritone and all queued physical actions are cancelled and remain unavailable while the parent is connected.
- Handback is fail-closed and returns first to native Zenith fallback. Enhanced control must authenticate a new service-controller lease.
- Stock Zenith's single-controller admission must not make the parent wait indefinitely behind the service controller. Activation requires verified service disconnection/preemption behavior; if the plugin API cannot provide it, a minimal reviewed Zenith hook is required.
- The endpoint is restricted to loopback or the private LAN. Public tunnels, UPnP, public binding, and IP-only authorization are forbidden.

## Resource budgets

- No additional Cloudflare tunnel for Minecraft chat.
- No process creation per message or survival tick.
- At most two model calls system-wide and one physical action.
- No continuous screenshots.
- Added brain modules target less than 250 MB idle memory and less than 1% average control-plane CPU over five minutes on the family PC, excluding Minecraft and the existing Next process.
- No local model remains loaded merely to keep the companion alive.

## Activation and acceptance

The compileable foundation must not install a server mod or alter the live world. Each functional slice advances from `planned` to `stubbed`, `implemented`, then `live-verified`. Staging, a verified snapshot, controlled promotion, and rollback evidence are required before `family-core` enters the Family Server core artifact set.
