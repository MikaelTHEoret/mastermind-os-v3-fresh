# Mastermind Zenith staging and activation runbook

## Current result

ZenithProxy `3.5.8+26.2.0` is built from the exact source commit `550257ac720c06e4902c8d5dcbc7869b898ea7bd` and staged under Mastermind's private local data root. A separately staged candidate applies the minimal controller-admission patch in `minecraft/zenith-core-patches/0001-controller-admission-preemption-hook.patch`. The Mastermind plugin loads against both runtimes and remains disabled. No account, upstream Minecraft server, proxy listener, firewall rule, Family Server, or live world was touched.

The machine-readable hashes and acceptance measurements are recorded in `minecraft/zenith-staging/manifest.v1.json`. Binary JARs, generated configuration, logs, identities, and credentials stay outside Git.

## Integrity and offline acceptance

- The runtime JAR embeds Zenith release `26.2.0` and commit `550257ac`.
- The stored patch is a zero-context diff so Git whitespace checks remain clean; apply it only to the pinned commit with `git apply --unidiff-zero` after verifying the base hash.
- The exact upstream checkout produced 74 tests with no failures or errors and three skips.
- The patched checkout wrote results for 75 tests with no failures or errors and three skips. Gradle then lost its local result-reporting socket; the new hook test was rerun alone and exited successfully.
- The Mastermind plugin produced 13 tests with no failures, including the controller-admission matrix.
- A disabled offline boot loaded `mastermind-companion` version `0.1.0` and reported `enabled=false`.
- An offline simulation with fake UUIDs and every network path disabled explicitly detected the patched hook and enabled the lease module. It was then stopped and restored to all-false flags and blank identities.
- The same fake-identity simulation against stock Zenith produced an explicit plugin load failure before module registration. This proves takeover cannot silently run without the pinned hook.
- The boot used no upstream auto-connect, no listener, no LAN broadcast, no UPnP, no updater, no login browser, no Discord, and no database.
- Fifteen idle samples observed about 162.8 MB working set, 216.3 MB private memory, 0.015% normalized CPU, and no TCP connection.
- After shutdown there was no staging Java process and no listener on the reserved staging port.

This proves artifact identity, disabled startup, and idle resource behavior. It does not prove live gameplay safety or audit all external Zenith code.

## Parent-preemption hook candidate

Stock Zenith accepts a controller only when `currentPlayer.compareAndSet(null, candidate)` succeeds. A second authenticated controller is rejected while the first remains connected. The plugin receives `PlayerConnectedEvent` only after successful admission, so its public hook is too late to let a parent take control from an active Mastermind service controller.

`ControllerAdmissionPolicy` now defines and tests the required pre-admission behavior:

1. The policy is called only after Minecraft profile authentication and whitelist validation, never for a status ping, raw socket, or unauthenticated session.
2. An authorized service or parent may enter an empty lease.
3. Only an authenticated allowlisted parent may preempt the exact configured service UUID.
4. The service cannot displace a parent or another service session.
5. Unknown identities and ambiguous current-controller identities fail closed.
6. Before parent login completes, the old service session must be marked revoked, its incoming control packets blocked, and Baritone/current AI input stopped.
7. The core must atomically replace the exact old service session with the parent candidate. The old session's later disconnect cleanup must not clear the new parent lease.
8. Parent disconnect enters recovery hold. Native fallback resumes only after the stable paired-telemetry handback gate.

The isolated patch candidate implements this sequence with a synchronous, deny-by-default admission event, an old-session packet-revocation flag, and an atomic exact-session replacement. The plugin discovers the hook without requiring stock Zenith to contain the new class; it refuses to enable parent takeover when the hook is absent. This candidate compiles, its tests pass as recorded above, and the plugin detected it during the offline simulation.

This is still not live takeover evidence. Authentication, packet-race behavior under two real controllers, disconnect ordering, recovery hold, and handback require controlled live acceptance. Until those checks pass, `parentTakeoverEnabled`, enhanced control, and native fallback remain disabled.

## Live activation gates

Live activation is a separate, explicitly approved change. Before it begins:

1. Review the minimal Zenith admission patch and its AGPL/source-distribution obligations.
2. Add a two-controller integration fixture for revocation, atomic replacement, disconnect ordering, and failed compare-and-set races; then re-run all upstream, plugin, lease, protocol, and process-leak tests and update hashes.
3. Bind the private controller entrance to loopback or a specifically approved private-LAN address. Never use `0.0.0.0`, UPnP, a public firewall rule, or Cloudflare.
4. Configure exact parent and service Minecraft UUIDs in Mastermind's private data root, never in Git or logs.
5. Keep account credentials in the existing encrypted credential system; never put tokens on a command line or in the staging manifest.
6. Take a stopped, verified Family Server snapshot before installing `family-core` or changing live artifacts.
7. Start with all behavior flags off, verify health, then enable one bounded lane at a time.
8. Live-test parent takeover, service rejection while parent owns the lease, stable handback, kill switch, safe stop, and resource limits before any unattended run.

## Stop and rollback

For any unexpected movement, identity mismatch, stale telemetry, repeated reconnect, CPU/memory breach, or unclear controller state:

1. Trigger the local operator kill switch and stop the exact Zenith process.
2. Confirm the proxy listener and all Zenith-owned Java processes are gone.
3. Leave the Minecraft account disconnected; do not allow an automatic reconnect.
4. Remove the candidate plugin from the isolated Zenith installation or restore the prior pinned runtime directory.
5. If `family-core` was installed, stop the Family Server and restore the pre-install snapshot and artifact lock before restart.
6. Preserve bounded redacted logs and hashes as acceptance evidence. Do not copy tokens, profiles, worlds, or raw family chat into Git.

The rendered Fabric bridge remains the reference/rollback implementation until the full headless route is live-verified.
