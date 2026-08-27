# World Management reboot checkpoint — 2026-08-14

Status: **checkpoint only / NO-GO for rollout**. All agents stopped editing before this checkpoint. Do not reload the local command center or expose the World UI until the blockers below are closed and security gives an overall GO.

## Exact checkpoint hashes

| File | SHA-256 |
|---|---|
| `services/minecraft-control-plane/src/world-manager.mjs` | `91612B2B1D6D78FC11488C2F64D2261191F9A406ADF08E1D9A14758A8F697470` |
| `services/minecraft-control-plane/test/world-manager.test.mjs` | `A0E1904067AFDC379865EE51880946E560E1EBB038855FA0422E29C6D2F15D5F` |
| `services/minecraft-control-plane/src/update-manager.mjs` | `64D55AAC512988A1D99280FB1C957EB9B72078C6D6169B4E74C0B6C348CC4430` |
| `services/minecraft-control-plane/test/update-manager.test.mjs` | `40CDE154D4AB7B29DFBF706E109C8457635F38198D10B8A96A316048EAAFBFA0` |
| `services/minecraft-control-plane/src/provisioner.mjs` | `55C1159B7B28AD26C5F181EBB90D20B12A4FDB46E7901CD0564E912BF1BAA1DE` |
| `services/minecraft-control-plane/src/backup-manager.mjs` | `41AF79BB4061CDF892F1A75A32A74F4FDFAB2354250EF8E25F35EF7845B80471` |
| `services/minecraft-control-plane/test/backup-manager.test.mjs` | `996845EB7A0EAE67CA09E1632FAAE29894EB88822681D2E4488270C477D67D56` |
| `services/minecraft-control-plane/src/family-mod-manager.mjs` | `D519DD99BA5537F03D35F80DE27668AE7F11D20CB76966C7362523F519CAB2C9` |
| `services/minecraft-control-plane/test/family-mod-manager.test.mjs` | `38F38C411887076BFC93DF708CE11C8063537C22BDE53FF647905575B9769C6D` |
| `services/minecraft-control-plane/src/agent.mjs` | `2F65FC59F7DC998CB55B49CE58CBAE739C394B7DCF393F7ACE4BC21190B076BB` |
| `services/minecraft-control-plane/src/artifact-integrity.mjs` | `77E46E156290564C753331A702A12B83CF44F68AABC1E43AD62691621E3729BA` |
| `services/minecraft-control-plane/src/windows-filesystem-safety.mjs` | `28579E4EBA03B669273FCC293B5EE425219A971379FCCD58FC6EE405986F10E5` |

All listed source/test modules passed `node --check` at checkpoint time.

## Latest trustworthy test evidence

- World suite: 80 total, 79 pass, 0 fail, 1 platform symlink-capability skip. This is checkpoint evidence, not release GO, because native namespace/move/delete blockers remain.
- Updater suite: 70/70 pass in 218 seconds, including NTFS ADS, HMAC continuity, rollback source tamper, retained-backup substitution, quota, recovery, and DataVersion interlock cases. Native successful publication still uses the shared broken exact-parent pattern and is not proven.
- Provisioner suite: 12/12 pass.
- Backup targeted retention/restore subset: 8/8 pass. Full suite was not green/final after the latest ancestry edits; default-native publication remains blocked.
- Mod suite: 13 pass, 0 fail, 1 skip before the final guarded-preflight rewrite. The current mod hash is syntax-checked but needs a fresh full run.
- Artifact official-server-JAR boundary: prior 22/22 pass and scoped security GO; this does not cover the complete JVM launch/classpath boundary.

## Completed or provisionally sound slices

- Authenticated world catalogs/plans/transactions/operations, strict schemas, confirmations, idempotency, recovery fencing, quotas, NBT validation, DataVersion ceiling, stack binding, rescue-before-switch, and stopped/companion gates.
- World/backup/update external HMAC continuity design and guarded key roots.
- Official Mojang server JAR/DataVersion verification sub-boundary.
- Updater rollback now authenticates and verifies mutable, managed, official-server, and world state before and after restore; tampered/substituted backups do not displace the working server in injected-guard tests.
- Windows Modrinth mutations fail closed with `MOD_MUTATION_UNAVAILABLE`; raw Windows mod-mutation recovery is refused. Read-only proxy/UI truth is present.
- UI/proxy strict world-operation correlation and recovery handling were previously conditionally approved, but final combined agent/UI hashes still need re-audit.

## Open release blockers

1. **P0 — complete launch trust.** The live Fabric server classpath includes dozens of unbound `libraries/**/*.jar` files plus `.fabric` cache/runtime entries. `verifyFamilyServerInstall` currently proves only a subset. Build an authenticated exact inventory for the complete effective JVM/runtime/classpath (Mojang runtime files, launcher, Fabric/Minecraft libraries/caches, official server JAR, core and every managed user mod; reject unlisted JARs), bind it into stack/backup identity, and hold a native read/launch lease through process spawn/lifetime. Otherwise Windows start must remain fail-closed.
2. **P0 — world catalog publication leaf window.** `world-manager` releases the broad `.mastermind/worlds` leaf to replace `catalog.json`; a same-user actor can substitute `storage`, `plans`, `transactions`, or `operations` during that window. Snapshot exact child identities/types/native metadata and revalidate the bounded namespace plus journal quota under the rebound guard before continuing, or publish through a dedicated leaf.
3. **Functional/P1 — shared native mutable-parent publication.** Exact native parent guards allow child creation but block child file replacement and child directory rename. Apply the audited leaf-release/rebind contract with exact namespace snapshots to world, backup, and updater. Add default-native successful create/switch/rollback/backup/restore/update/purge cases and crash/outside-victim cases.
4. **P1 — native recursive move/delete.** World `renameGuardedDirectory`, `removeManagedTree`, and `deleteTombstonedTree` still conflict with exact-parent native guards. Backup and updater have analogous cleanup/publication paths.
5. **P1 — world journal admission atomicity.** Recheck exact journal namespace/count/aggregate bytes in the same guarded post-publication proof; the current pre-write check has an insertion window.
6. **P1 — mod/start lease composition.** Current guarded mod reads still need a single final lease composed with the complete launch inventory through spawn.
7. Refreeze agent/backup/mod/UI hashes, rerun their complete suites, then perform strict route/redaction and startup-order audit.

## Resume order

1. Re-read this file and verify the hashes above before editing.
2. Finish the shared safe mutable-parent publication pattern and the world exact-child/journal proof.
3. Migrate updater and backup to it; run default-native successful mutation, rollback, recovery, purge, and outside-victim tests.
4. Implement the authenticated complete launch inventory/lease and compose the mod lifecycle fence.
5. Refreeze hashes; run syntax checks, focused real-native suites, then the serialized broad control-plane suite, TSC, and targeted ESLint.
6. Obtain an independent zero-P0/P1 security verdict.
7. Only then use the signed supervisor takeover (`npm.cmd run dev:local` from a second PowerShell) and read-only health/overview/instances smoke checks. Never kill production PIDs or launch the agent directly.

## First resume commands

Run from `C:\Users\Mik\Documents\mastermind-command-center`:

```powershell
Get-FileHash -Algorithm SHA256 services/minecraft-control-plane/src/world-manager.mjs,services/minecraft-control-plane/src/update-manager.mjs,services/minecraft-control-plane/src/backup-manager.mjs,services/minecraft-control-plane/src/family-mod-manager.mjs,services/minecraft-control-plane/src/agent.mjs
node --check services/minecraft-control-plane/src/world-manager.mjs
node --check services/minecraft-control-plane/src/update-manager.mjs
node --check services/minecraft-control-plane/src/backup-manager.mjs
node --check services/minecraft-control-plane/src/family-mod-manager.mjs
node --check services/minecraft-control-plane/src/agent.mjs
```

No live rollout, process stop/start, or supervisor takeover was performed during this checkpoint turn.

## Resume progress ledger - 2026-08-14 02:30 EDT

Status remains **NO-GO / active implementation**. This section supersedes only the work-state notes above; the original hashes remain the reboot baseline.

- Shared batched native directory guarding is frozen and real-Windows green. One helper holds up to 256 exact directory handles with independent release/rename/delete and clean final exit. Exact hashes:
  - `services/minecraft-control-plane/src/windows-filesystem-safety.mjs`: `A8DB22ACA58A129FD806354FD1653B74805984428EAB266D16F9B75E69C44F7B`
  - `services/minecraft-control-plane/test/windows-filesystem-safety.test.mjs`: `EBBB517059CE1FEB13FBCDB109E07140644F947FE8F979E75C6F60B455FDD631`
  - `scripts/guard-minecraft-world-directories.ps1`: `A34610926E269FCD341C000919B60BD3C4FDC2883D0B368D7BB19DE3F4127D03`
  - Fake protocol 7/7; native batch 1/1 in 4.294s; helper PIDs confirmed exited.
- World Manager now uses directory batches for anchored chains and rebinds, bounded `opendir` iteration everywhere, guarded root creation, exact authenticated journal transitions, and deterministic recoverable cleanup. Its portable batch regression passes. The full real-native clone rollback must be rerun after file batching freezes; current world files are moving and are not a release hash.
- A separate exact file-guard batch is in progress. Backup and updater migrations are in progress; no full native mutation lane is currently running.
- Backup/Modrinth pre-batch handoff was portable-green (backup 42/0 including static ADS; mods 32/0/2 capability skips). Backup is moving again for batching and explicit launch-digest binding.
- Launch inventory/capability work is non-native green but independent audit found two authentication P0s (launch key continuity and bypass of FamilyModManager key continuity) plus exact-schema/bounded-namespace P1s. The launch owner is fixing them. Windows production start remains deliberately fail-closed with `LAUNCH_TRUST_UNAVAILABLE`.
- Both `javaRuntime.launchAssetDigest` and `javaRuntime.launchInventoryDigest` are now explicitly included in the world-stack generation and backup stack identity; focused regressions pass. Agent/backup files are moving and not release hashes.
- The isolated pre-batch world native test timed out at 600.8s from per-path PowerShell process amplification. This is classified as a liveness blocker; timeouts will not be raised as a substitute for batching.
- Two exact orphaned Node test children from a timed-out agent suite (PIDs 7688 and 31144) were revalidated by PID/path/start time/no TCP ownership and stopped. No application, supervisor, game, or unrelated process was touched.

## Resume progress ledger - 2026-08-14 03:15 EDT

Status remains **NO-GO / active validation**. This is a durable resume point if another reboot is required.

- Shared native batches are frozen and real-Windows green:
  - `services/minecraft-control-plane/src/windows-filesystem-safety.mjs`: `BC8CE9BEA12C9AC3237DE6C226BB696084D3146C866197824B51D28FDDB082C4`
  - `services/minecraft-control-plane/test/windows-filesystem-safety.test.mjs`: `1F7E86E9AEF05E25A16B0284D9865AF7922C1B5CF50713B22160E06E92937FD2`
  - `scripts/guard-minecraft-world-directories.ps1`: `A34610926E269FCD341C000919B60BD3C4FDC2883D0B368D7BB19DE3F4127D03`
  - `scripts/guard-minecraft-world-files.ps1`: `BCC69181CAE799144E5ED0783D342F712201EDA8812DA82993300FC0D3EEE723`
  - Directory native batch: 1/1 in 4.294s; file native batch: 1/1 in 4.77s; all exact helper PIDs were confirmed absent after exit.
- World Manager candidate is independently code-audited GO with zero P0/P1:
  - source `07CB2875497BAFDFECB89081076661D4F8F7E605DAA8CA368C8A4CDDE8FF8C55`
  - test `C24C5E336B5ECCDC728288CF0A4C5F046695B34EBE7FAA7FF34E7E92EC31ECF3`
  - exact portable suite: 87 pass, 0 fail, 1 unavailable symlink-capability skip in 200.5s.
  - immediately preceding success-equivalent native candidate: authenticated record publication plus two junction/outside-victim cases 3/3; clone -> forced rollback -> nonempty guarded cleanup 1/1. The exception-only guard-accounting follow-up is portable-green and code-audited; an exact-hash native rerun remains the final world validation gate.
- World now has anchored root creation, bounded `opendir` enumeration, exact authenticated pre/post journal admission, protected catalog siblings, deterministic recoverable tombstones, and bounded directory/file batching. Crash regressions assert every rebound and peer guard is released.
- Launch trust now uses one external guarded process-continuity key and an exact FamilyModManager launch-binding capability retained by ProcessManager through child lifetime. Agent boot-pins launch-authenticated inventories and binds both launch digests into world/backup stack identity. Focused launch suites are green, but independent audit found residual unbounded `readdir` calls in provisioner cleanup and mod launch scanning; Windows Start remains deliberately `LAUNCH_TRUST_UNAVAILABLE` until remediation and final audit.
- Backup portable batching is green and its isolated native test is next in the serialized lane. Updater bounded batching plus the authenticated `.fabric`/`libraries` legacy-launch migration is actively in progress. Neither slice is frozen/GO yet.
- Two short-lived Node children observed at 03:00:06 were attributed to the completed ProcessManager test window and naturally exited before any action. No process was terminated.

## Resume progress ledger - 2026-08-14 06:34 EDT

Status: **control-plane code audit GO; rollout still NO-GO pending the final Windows backup cleanup proof and the intentional Windows launch gate**. This is the current durable resume point and supersedes earlier moving-candidate hashes.

### Exact frozen control-plane hashes

| File | SHA-256 |
|---|---|
| `services/minecraft-control-plane/src/agent.mjs` | `3DB27659AF14EB1F3DE5EA302D5038DB4E8E47A7F3D6049A314595EB7AF483C0` |
| `services/minecraft-control-plane/test/agent.test.mjs` | `FBDE6BCBBB377DCF4CF7F8FF56C28AF82223C0CDEF586E1FAA88010934A6DBCE` |
| `services/minecraft-control-plane/src/world-manager.mjs` | `07CB2875497BAFDFECB89081076661D4F8F7E605DAA8CA368C8A4CDDE8FF8C55` |
| `services/minecraft-control-plane/test/world-manager.test.mjs` | `C24C5E336B5ECCDC728288CF0A4C5F046695B34EBE7FAA7FF34E7E92EC31ECF3` |
| `services/minecraft-control-plane/src/update-manager.mjs` | `187BAB730BDBFB9A90B6C23ABAEE3B4B8AB9CE71CC24D1F3C49960B3F3945A65` |
| `services/minecraft-control-plane/test/update-manager.test.mjs` | `7D9AE5AA5EA7F8B7BAE6A0FF1B9F2FD846801CB23C293A1063B4A58FAFAEEB91` |
| `services/minecraft-control-plane/src/backup-manager.mjs` | `E72B8AC96EA5A9ADBEFDA036752640B3BCA2E793BCC3939D58892FB06934DA7A` |
| `services/minecraft-control-plane/test/backup-manager.test.mjs` | `CE5AE46867CA3174CDA71E79A20531827830493C27BBB2A2ED12B6581EF94C31` |
| `services/minecraft-control-plane/src/family-mod-manager.mjs` | `BBD284929223567D5CC16263A1537755812662D6EFC8AD007AA6D117199139FA` |
| `services/minecraft-control-plane/src/process-manager.mjs` | `997516C387CE618363E4CD1DE16E5BC6A177A193B286B5E3867E732720418AA5` |
| `services/minecraft-control-plane/src/artifact-integrity.mjs` | `D59351C60F4CFE8DE4DAE39A5CB454B52F4FDF10B097349CA3025F2F7B472C5F` |
| `services/minecraft-control-plane/src/backup-windows-safety-scope.mjs` | `4E79E59DC322BB205869B1C357875BBDF60440279A36E624F0D1E5DC960D5A0E` |
| `services/minecraft-control-plane/src/windows-filesystem-safety.mjs` | `83E8D5F3D553DB51EBB945B16FF3C935D2CCE7F749A70A790F2BC38535ECFDE9` |

### Closed since the 03:15 ledger

- Independent final control-plane audit: GO, zero concrete P0/P1 at the exact agent/world/updater/mod/process/artifact/broker/shared-guard bytes above.
- Agent now dynamically latches update, backup, mod, and world recovery states; stop-only mode cannot perform hidden reconciliation; scheduled backups and mod/world inventory routes recheck the exact shared lifecycle fence under the instance lock; legacy import waits for clean multi-domain recovery admission; public error envelopes remain fixed and sanitized.
- Updater uses one operation-scoped persistent Windows safety broker. Portable partitions are 72/72; native publish, purge, forced rollback, and recovery-key ADS cases are green with zero surviving helper PIDs. Independent updater audit: GO, zero P0/P1.
- World Manager portable suite is 87 pass, 0 fail, 1 capability skip; native publication/cleanup evidence and independent code audit are GO.
- Shared one-shot guards and the persistent broker have exact-path validation, bounded batches, exact close/exit accounting, and real-Windows native tests with zero surviving helper PIDs. Both exact slices were independently audited GO.
- Backup portable suite is 67/67, with 9/9 focused publication/restore tests. Atomic JSON publication and directory publication now release only the owned immediate parent leaf while retaining ancestor and exact source custody, then rebind the parent and prove BigInt/native identity plus the exact namespace delta. Independent delta audit: GO, zero P0/P1.
- Final `npx.cmd tsc --noEmit --incremental false` and targeted ESLint over agent/world/updater/backup/broker sources and backup tests passed at this checkpoint.

### Remaining rollout blockers / exact resume action

1. **Windows backup recursive cleanup is still approval-gated.** The last real-native backup run now passes manifest file replacement but fails safely when a child directory is renamed while its exact parent lease is held. The smallest reviewed design avoids recursive renames entirely: inside only the authenticated disposable restore candidate or deterministic top-level cleanup tombstone, delete exact-held files and postorder-empty directories directly by their native guards. Only `removeManagedTree`'s single authenticated target-to-deterministic-tombstone rename needs the proven parent-leaf release/rebind pattern with BigInt/native identity and exact namespace receipts. Automatic reboot deletion remains off until a signed marker schema binds the tombstone's native identity, so a same-name replacement can never be adopted. Recursive deletion code was intentionally not changed without explicit user authorization.
2. After approval and portable adversarial/crash tests, run exactly one serialized native test named `persistent native backup broker publishes and restores with zero surviving helper PIDs`. Do not rerun before the cleanup delta is audited GO.
3. Windows production server start remains intentionally fail-closed with `LAUNCH_TRUST_UNAVAILABLE`: Fabric Loader 0.19.3 unconditionally scans a same-user-creatable mods directory, so the complete launch lease cannot yet prove an immutable effective classpath. This is safe unavailability, not an integrity bypass.
4. Updater legacy launch migration and malicious-candidate ADS cleanup remain fail-closed pending separate explicit authorization to delete only the authenticated candidate `.fabric`, `libraries`, superseded canonical server JAR, and generated candidate tombstone payloads.

07:07 EDT safety-gate note: the user approved the scoped cleanup hardening, but the irreversible direct-delete implementation was rejected before landing because the approval did not explicitly acknowledge handle-bound permanent deletion. Preparatory edits were removed and the backup files were restored byte-for-byte to `E72B8AC96EA5A9ADBEFDA036752640B3BCA2E793BCC3939D58892FB06934DA7A` / `CE5AE46867CA3174CDA71E79A20531827830493C27BBB2A2ED12B6581EF94C31`; both syntax checks passed. A fresh approval must explicitly authorize permanent deletion only after exact authentication/isolation, with manual fencing on any ambiguity.

No rollout, supervisor takeover, server start, process termination, or modification of `mastermind-client` was performed during this resume work.
