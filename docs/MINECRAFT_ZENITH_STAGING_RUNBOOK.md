# Mastermind Zenith staging and activation runbook

## Current result

ZenithProxy `3.5.8+26.2.0` is built from the exact source commit `550257ac720c06e4902c8d5dcbc7869b898ea7bd` and staged under Mastermind's private local data root. The live candidate applies the minimal controller-admission patch in `minecraft/zenith-core-patches/0001-controller-admission-preemption-hook.patch` plus the fail-closed secure-session patch in `minecraft/zenith-core-patches/0002-secure-session-injection.patch`. The two primary baseline staging directories remain disabled; the separate `mastermind-secure.1` candidate is the only enabled runtime.

On 2026-08-21 the Family Server was stopped cleanly and its entire managed instance was copied offline. Source and copy each contained 180 files and 110,315,855 bytes with tree digest `EB6EE69B32FE7FB6E95F06D46285A074031689F54919D4DCA3BEE9BB0F206593`. A supervised control-agent restart re-authenticated all nine terminal update receipts and cleared a stale post-startup recovery latch. The Family Server then started through the managed lifecycle boundary and reported ready on Java port 25565 and Bedrock UDP 19132.

The secure candidate refreshed the existing CurrentUser-DPAPI Microsoft account, passed only the current short-lived Minecraft session through the bounded MFC1 standard-input frame, and authenticated `The_AlChemist___` to the Family Server. The refresh token never entered Zenith, no credential was placed in process arguments or environment variables, no `mc_auth_cache.json` was written, and a failed injection cannot fall back to Zenith's device-login flow. The proxy controller entrance binds only to `127.0.0.1:25568`; UPnP, Discord, database, auto-updating, LAN broadcast, and all built-in movement/action automation remain off. The exact-process stop launcher was live-verified, followed by a successful hardened relaunch.

A disposable loopback-only protocol fixture now provides stronger evidence without using family data or credentials. It ran an empty offline Minecraft 26.2 server on `127.0.0.1:25567`, the patched Zenith candidate on `127.0.0.1:25566`, and the observation-only headless controller. The service identity reached play, an unknown identity was rejected, the allowlisted parent atomically preempted and revoked the service, the parent disconnected cleanly, and the service subsequently re-entered. Both primary staging configurations remain disabled with blank controller identities.

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
- The headless controller accepts one bounded launch envelope on standard input, permits only IPv4 loopback, keeps tokens out of command-line arguments and logs, exposes no game actions, and disconnects after a bounded hold.
- The pinned MCProtocolLib palette contract was verified against Zenith 3.5.8: 32,366 block states, air ID 0, 66 biomes, plains ID 40, and 15/7 global palette widths.
- Six headless-controller tests pass. Its shaded JAR is 29,479,224 bytes with SHA-256 `E1C397C69A4B1C6545E459F80CD464063F1D86F256A2CD3F42853B27B6DB3581`.
- The protocol fixture verified `MASTERMIND_CONTROLLER`, fail-closed unknown identity rejection, authenticated `HUMAN_PARENT` preemption, immediate service socket revocation, clean parent exit, and later service re-entry.

This proves artifact identity, secure Microsoft account injection, loopback-only Family Server connection, exact stop/relaunch, idle resource behavior, and the local two-controller admission path. It does not prove family-account parent takeover, live gameplay actions, stable telemetry-gated native handback, or audit all external Zenith code.

## Secure Family live acceptance

- Combined patched Zenith JAR: 61,678,737 bytes; SHA-256 `C11FF1A6B69DF5AD99C95203605AB5389D21BE8CCB919130CF8AC279A3F20A17`.
- Secure bootstrap JAR: 9,227 bytes; SHA-256 `53D611DA8C8796184D05741DEE21160FBD4C23E0E35194502C8861DAF313F433`; six tests pass.
- The secure-session and controller-admission patches apply cleanly together to the pinned official commit; the five focused upstream tests pass from a fresh checkout.
- The first injection attempt failed closed on Mojang's compact UUID representation. Its temporary private device-code log was cleared, the exact process was stopped, UUID canonicalization was added, and a regression test now covers both UUID forms.
- A required-session latch prevents any later authentication retry from falling through to normal device-code or cached authentication.
- Live logs verify injected-session acceptance, authenticated upstream connection, plugin loading, and no fallback flow. Family Server logs verify the exact companion UUID joined from localhost.
- The stop launcher rejects arguments, verifies the state hashes, Java executable, staging command line, exact PID, and listener release. It stopped the hardened candidate with no leaked listener or process, after which the candidate relaunched successfully.
- The final runtime uses `-Xms64M -Xmx512M`. The formal five-minute final idle sample is recorded in the staging manifest.

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

The loopback fixture is live protocol evidence for authentication ordering, service revocation, atomic replacement, disconnect ordering, and fail-closed identity rejection. Paired-telemetry recovery hold and stable native handback remain unimplemented at runtime. The separate secure Family candidate has native fallback, enhanced-controller admission, and parent takeover policy enabled, but no family parent controller has connected yet and no gameplay action surface is enabled. The disabled primary baselines remain the rollback artifacts.

## Live activation gates

The first loopback-only Family activation is complete. Before gameplay or unattended activation expands:

1. Review the minimal Zenith admission patch and its AGPL/source-distribution obligations.
2. Preserve the passing two-controller protocol fixture evidence and re-run all upstream, plugin, lease, protocol, and process-leak tests after any core or plugin change.
3. Bind the private controller entrance to loopback or a specifically approved private-LAN address. Never use `0.0.0.0`, UPnP, a public firewall rule, or Cloudflare.
4. Keep exact family identities in Mastermind's private data root; repository configuration contains no credentials.
5. Keep account credentials in the existing encrypted credential system; never put tokens on a command line, environment variable, log, or staging manifest.
6. Preserve the verified stopped snapshot before installing `family-core` or changing live-world artifacts.
7. Keep all behavior flags off and enable only one tested bounded lane at a time.
8. Live-test family parent takeover, service rejection while the parent owns the lease, stable handback, kill switch, and gameplay safe stop before any unattended behavior.

## Stop and rollback

For any unexpected movement, identity mismatch, stale telemetry, repeated reconnect, CPU/memory breach, or unclear controller state:

1. Trigger the local operator kill switch and run `node scripts/stop-zenith-live-staging.mjs` to stop the exact Zenith process.
2. Confirm the proxy listener and all Zenith-owned Java processes are gone.
3. Leave the Minecraft account disconnected; do not allow an automatic reconnect.
4. Remove the candidate plugin from the isolated Zenith installation or restore the prior pinned runtime directory.
5. If `family-core` was installed, stop the Family Server and restore the pre-install snapshot and artifact lock before restart.
6. Preserve bounded redacted logs and hashes as acceptance evidence. Do not copy tokens, profiles, worlds, or raw family chat into Git.

The rendered Fabric bridge remains the reference/rollback implementation until the full headless route is live-verified.
