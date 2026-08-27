# Minecraft foundation recovery inventory

Inventory date: 2026-08-21
Recovery checkpoint: `07bfb12` (`checkpoint: preserve family Minecraft control plane and live bridge`)

The recovery began from a working tree whose short status contained 106 entries. Untracked directories represented multiple files, so the curated checkpoint ultimately recorded 234 files. No user file was deleted, moved, or rewritten as part of classification.

## Included in the recovery checkpoint

| Class | Scope | Treatment |
| --- | --- | --- |
| Source | `services/minecraft-control-plane`, Family bridge/bootstrap sources, Minecraft API/UI integration | Included where it belonged to the existing Family Server and companion control plane |
| Tests | Minecraft control-plane, bridge, lifecycle, protocol, provisioning, memory-event, and safety tests | Included |
| Protocols | Family bridge and Mastermind domain-event contracts and fixtures | Included |
| Documentation | Minecraft status, architecture, operations, setup, and acceptance material | Included when it described the recovered system |
| Migrations | Additive family identity/consent and domain-event migrations | Included; old migrations were not rewritten |
| Scripts | Family server/client setup, local supervisor, account registration, migration, and verification scripts | Included where required by the recovered system |

## Left outside the checkpoint

| Class | Examples | Reason |
| --- | --- | --- |
| Runtime data | worlds, player/profile/account data, `%LOCALAPPDATA%\Mastermind`, private journals | User/private mutable state must never enter Git |
| Logs | Minecraft, tunnel, supervisor, stdout/stderr logs | Runtime evidence, potentially sensitive and unbounded |
| Generated artifacts | Gradle/Next caches, JAR build directories, Python caches, temporary backups | Reproducible or machine-local output |
| Credentials and secrets | `.env*`, account tokens, DPAPI payloads, private keys, bootstrap identity files | Explicitly excluded from version control |
| Unrelated work | research papers, math/cosmology notes, node-exchange/context-gateway work, unrelated dashboard changes | User work outside the Minecraft recovery scope |
| Legacy secret-bearing edits | modified legacy MCP/session-logger files found by the broad scan | Not part of the curated checkpoint and not made safe by this branch |

## Secret-scan result

The broad working-tree review found credential-like material in unrelated legacy files, so those files were excluded from the recovery checkpoint. A scan of the exact staged checkpoint found only documented environment-variable names and placeholder values in `.env.local.example`; no new credential value was staged.

Every later commit on this branch must be scanned from its exact staged diff. This statement is not a certification that unrelated historical repository content contains no secrets.

## Foundation worktree policy

- `family-core` build output remains ignored and its JAR is not added to the managed server artifact lock.
- Profile projections belong under Mastermind's private data root, never the repository.
- No tunnel is added for Minecraft chat.
- No extra always-on Node or Python process is introduced.
- Unrelated dirty-tree changes remain owned by the user and outside this branch's commits.
