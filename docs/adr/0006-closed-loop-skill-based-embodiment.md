# ADR 0006: Closed-loop, skill-based companion embodiment

Status: accepted.

## Context

The rendered Fabric bridge proved chat, movement, following, gathering attempts, direct
interaction, placement, and a bounded furnace slice. It also exposed the wrong scaling
property: each new Minecraft task required another client-specific action and repeated protocol
changes. The model could select those actions, but the system did not have a general mechanism
for composing abilities, observing their real effects, and recovering from mismatches.

Minecraft agent research and production libraries consistently separate high-level planning from
low-level control. The reusable pattern is observation, goal decomposition, skill selection,
deterministic execution, effect verification, and bounded retry or replanning. Mastermind adopts
that mechanism without allowing models to emit raw packets, clicks, JavaScript, or server
commands.

## Decision

The companion brain depends on an embodiment adapter rather than a Fabric session directly.
Fabric, Mineflayer-through-Zenith, and a future Zenith plugin must present the same bounded
adapter surface.

Every physical plan step includes:

- a typed action;
- explicit expected observable effects;
- a deadline;
- a failure policy of retry, replan, or abort.

An executor acknowledgement is never sufficient evidence of success. The verifier evaluates a
fresh observation. Initial effect predicates cover inventory minimums and deltas, arrival within
a bounded goal, world phase, and opened container type. Additional predicates must remain typed,
bounded, and independently testable.

The action hierarchy is:

1. conversation and intent interpretation;
2. goal and dependency planning;
3. reusable skills and semantic inventory/workstation transactions;
4. embodiment-specific navigation and interaction primitives;
5. server and body observations;
6. effect verification and retry/replan/abort.

Normal survival and execution remain deterministic. Models may choose or revise plans at semantic
boundaries but do not control the tick loop.

## Primary body

Zenith remains the authenticated upstream body, fallback driver, and parent takeover boundary.
The first enhanced driver is Mineflayer 4.37.1 speaking Minecraft 1.21.11 to Zenith's loopback
Player Client entrance. Zenith's pinned ViaVersion layer translates that controller session while
Zenith remains connected to the Minecraft 26.2 Family Server.

The enhanced controller exposes general primitives for observation, navigation, container open
and close, semantic inventory transfer, cancellation, chat, and clean stop. It contains no
recipe-specific command and cannot execute arbitrary code.

If a required capability cannot be implemented reliably through the translated Player Client
path, the same adapter contract will be implemented in the pinned Zenith plugin. The brain and
task library must not change when the body implementation changes.

## Security and lifecycle

- Controller launch credentials use one bounded standard-input envelope and remain absent from
  arguments, environment variables, logs, and files.
- The controller connects only to `127.0.0.1` and never directly to the Family Server.
- Only one physical action runs at once; cancellation can preempt navigation immediately.
- Parent takeover continues to revoke the service controller at Zenith's admission boundary.
- Runtime-generated JavaScript is forbidden.
- Mineflayer and its transitive dependencies remain staging-only until dependency advisories are
  either fixed upstream, safely overridden and tested, or explicitly accepted with compensating
  controls.

## Acceptance evidence

On 2026-08-24 the pinned Zenith 3.5.8+26.2.0 candidate connected upstream as
`The_AlChemist___`. Zenith admitted an authenticated Mineflayer 1.21.11 session as the controlling
player and entered `MASTERMIND_CONTROLLER`.

The compatibility scenario live-verified:

- authentication and play spawn through Zenith;
- protocol translation from 1.21.11 to the 26.2 body;
- navigation with observed goal satisfaction;
- opening and observing the existing chest;
- opening and observing the existing furnace;
- a one-coal chest deposit and withdrawal round trip verified from active-window player slots;
- clean controller disconnect with no leaked controller process;
- Zenith remaining connected upstream after controller exit.

This proves the embodiment mechanism and compatibility path. It does not yet promote the new
controller as the command center's managed production companion. Process supervision, existing
bridge-protocol adaptation, continuous observations, chat routing, survival interruption, parent
preemption with the long-lived pilot, dependency disposition, and resource soak remain promotion
gates.
