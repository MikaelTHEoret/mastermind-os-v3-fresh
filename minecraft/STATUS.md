# Family Minecraft status

Current milestone: M3F — Family Companion foundation (implemented; review checkpoint pending)

## Completed

- M1 Family Server manager: managed Java/Fabric provisioning, start/stop, logs, readiness, transactional updates, Geyser/Floodgate, and LAN firewall workflow.
- Verified operator backups: stopped-state quiescence across both game ports, private mutable-state snapshots, explicit re-verification, deferred automatic policy, protected retention, hash-bound restore approval, mandatory rescue snapshots, current-stack preservation, atomic publication, and interrupted-restore recovery.
- Backup lifecycle, restore recovery, retention, and filesystem defenses are covered by deterministic serialized control-plane tests; TypeScript and targeted ESLint checks are clean.
- Typed Family Server administration is implemented without a raw console: exact-process stdin ownership, bounded actions, launch-bound one-use approval plans, immutable request tombstones, durable cross-tab operation reconciliation, and redacted fsynced audit records.
- The Family-only Modrinth add-on manager now provides read-only catalog search/detail plus stopped, quiescent install/update/remove/rollback plans. It enforces exact Minecraft/Fabric and server-safe metadata, recursive required dependencies, SHA-512 and Fabric JAR validation, unmanaged-file mutation fences, HMAC-authenticated audit/recovery state, opaque public responses, and a stack-update fence while add-ons exist.
- The current full serialized control-plane suite contains 292 tests: 290 pass and two Windows symlink-defense cases are expected skips when the test account cannot create symlinks.
- Family and 2b2t projects are isolated by version, installation, lifecycle, storage, and UI context.
- Protocol v1 schemas, strict runtime validation, authentication, sequencing, heartbeats, snapshots, typed actions, cancellation, and shutdown.
- Standalone `family-agent-bridge` Fabric client mod for Minecraft 26.2 / Java 25.
- Direct chat, look, movement, jump, and attack controls with dead-man release and local F8 emergency stop.
- Hash-only per-launch bridge authentication and fail-closed exact child-process lifecycle foundation.
- The local agent now owns the authenticated companion WebSocket, sanitized status, typed action/cancel endpoints, and safe shutdown ordering.
- The Family dashboard shows redacted companion state and exposes only bounded typed controls; it never receives launch paths, process identity, Microsoft tokens, or the bridge credential.
- A separate, hash-pinned Baritone 1.18.0 provider for Minecraft 26.2 implements navigate, follow, bounded gather/explore, escape, and return-to-named-waypoint through the typed API.
- Live acceptance on 2026-08-21 verified account authentication, managed provisioning, client launch, bridge readiness with all 15 v1 capabilities, and `direct.say` from `The_AlChemist___` in the Family Server.
- The protocol-null defect that rejected required nullable fields was fixed by preserving explicit JSON nulls in the Java codec; focused Node and Gradle protocol checks passed.
- A dependency-free Java 25 credential bootstrap keeps the Minecraft access token off the operating-system command line and passes it to Fabric only inside the launched JVM.
- The locked Mojang/Fabric 26.2 client provisioner, local public-client registration, Microsoft device-code/Xbox/Minecraft exchange, CurrentUser DPAPI vault, and async verified launch factory are implemented.
- The client command uses only verified Java/classpath/native/logging/profile inputs; private account fields are carried only by the bounded MFC1 stdin frame. Minecraft 26.2 auto-connect uses `--quickPlayMultiplayer`.

## In progress

- Hybrid body foundation: extend the live native Zenith fallback with an enhanced headless controller, server-enhanced telemetry, and a parent-only manual takeover lease.
- The exact pinned Zenith runtime, two minimal core patches, secure credential bootstrap, and Mastermind plugin are privately staged. The loopback-only secure candidate is authenticated to the Family Server with all movement/action automation off; it is not yet a managed command-center service.

## M3F foundation completed

- Canonical dual-character requirements, role matrix, resource limits, profile boundaries, release gates, and four-state feature manifest.
- Strict brain domain contracts, disabled adapters, provider-neutral model-broker boundary, deterministic fakes, prompt placeholders, and focused tests.
- Authenticated and sequenced `family-core` protocol v1 with strict JSON parsing, bounded payloads, allowlisted administration operations, replay protection, schema, and tests.
- Separate server-only Fabric `family-core` skeleton for Minecraft 26.2 / Java 25. All runtime flags are false and the isolated Gradle build passes.
- Companion bridge v2 observation/action inventory and runtime validators. Negotiation remains v1 and no v2 capability is advertised.
- Authenticated dashboard status placeholder and a loopback-only reasoning route that validates requests and returns `FEATURE_DISABLED`.
- Nothing from this foundation is installed into the live server or added to its artifact lock.

## Remaining M2 acceptance

- Navigate, follow, gather/mine, cancellation, and safe stop still require fresh controlled live acceptance evidence.
- Implemented or capability-advertised is not treated as live-verified.

## Accepted body direction

- ZenithProxy `3.5.8+26.2.0` at source commit `550257ac720c06e4902c8d5dcbc7869b898ea7bd` is the pinned external body candidate.
- The Mastermind integration uses Zenith's plugin API first; a core fork is a reviewed fallback only.
- `family-core` remains the authoritative server telemetry and enforcement layer, while the control plane remains the brain.
- A private parent login takes an exclusive physical-control lease and cancels AI input before human control begins. Handback requires stable paired telemetry.
- Native Zenith is the fallback driver; an authenticated headless Mastermind controller is the enhanced driver and uses the same controller entrance as the parent's real client.
- Stock Zenith accepts only one controller. Upstream inspection proved its public plugin event occurs too late to enforce replacement, so a minimal core hook is required for seamless parent preemption.
- The isolated four-file patch candidate adds a synchronous deny-by-default admission event, revokes old-controller packet input before atomic replacement, and preserves the new lease during old-session disconnect cleanup. The plugin detected the hook during an account-free/listener-free fake-identity simulation.
- The plugin's admission policy permits only an authenticated parent to replace the exact service controller. The isolated live protocol fixture verified parent replacement, immediate service revocation, disconnect ordering, unknown-identity rejection, and later service re-entry. Stable paired-telemetry handback remains required before activation.
- The previous rendered Fabric bridge remains available for regression/reference work but is no longer the intended production body.

## Offline Zenith staging evidence

- ZenithProxy JAR — 61,674,658 bytes — SHA-256 `CCA682A4B83E494DEF1F71E53CE056B912F0385809A92DD40843A700E709F3A2`
- Patched ZenithProxy candidate JAR — 61,675,883 bytes — SHA-256 `700E9E91F38725A068D1F8E93D3B6F56F36221BB6F25EC174A36ED59110D8161`
- Mastermind Zenith plugin JAR — 17,880 bytes — SHA-256 `C7FD53C476C6BC11C39D959A6D633518F800C60C18080FEC5A2BCC0DC309F561`
- Controller-admission patch — 6,521 bytes — SHA-256 `616598AFDE4AA976DEF6008FDD929BC837AD9F545C3835B73AE7AE2DFEBB7934`
- Exact upstream build: 74 tests, zero failures/errors, three skips.
- Plugin build: 13 tests, zero failures/errors/skips.
- Patched upstream result files: 75 tests, zero failures/errors, three skips; Gradle's result socket reset after writing the results, and the hook test reran alone with a clean successful exit.
- Offline fake-identity simulation: patched hook detected, no account/upstream/listener enabled, then configuration restored to all-false flags and blank identities.
- Stock-runtime negative simulation: takeover request failed plugin preflight because the pinned hook was absent; no module registered, then configuration was restored to disabled blank defaults.
- Disabled idle boot: approximately 162.8 MB working set, 216.3 MB private memory, 0.015% normalized CPU, zero observed TCP connections, and no leaked process or listener after stop.
- Observation-only headless controller: six tests pass; shaded JAR 29,479,224 bytes; SHA-256 `E1C397C69A4B1C6545E459F80CD464063F1D86F256A2CD3F42853B27B6DB3581`.
- Loopback protocol fixture: service reached play, unknown identity failed closed, authorized parent preempted and revoked the service, parent exited cleanly, and the service re-entered. No family account, Family Server, or live world was used.
- Secure Family live candidate: combined Zenith JAR 61,678,737 bytes, SHA-256 `C11FF1A6B69DF5AD99C95203605AB5389D21BE8CCB919130CF8AC279A3F20A17`; secure bootstrap JAR 9,227 bytes, SHA-256 `53D611DA8C8796184D05741DEE21160FBD4C23E0E35194502C8861DAF313F433`.
- Family live acceptance: verified offline managed-instance copy, clean managed restart, DPAPI-backed session injection, `The_AlChemist___` upstream login, loopback listener, no plaintext auth cache or fallback device flow, exact stop, and successful hardened relaunch.
- The final live candidate uses `-Xms64M -Xmx512M`; five-minute resource evidence is recorded in the manifest. Family parent takeover and stable telemetry handback remain pending.
- Evidence manifest: `minecraft/zenith-staging/manifest.v1.json`; operator procedure: `docs/MINECRAFT_ZENITH_STAGING_RUNBOOK.md`.

## Verified build artifacts

- `family-agent-bridge-0.1.0.jar` — 88,196 bytes — SHA-256 `5D9131746122CE17AC5B197A72BB6ABB159C7B2E4599755A2F89EFAAECE693C6`
- `family-agent-baritone-provider-0.1.0.jar` — 21,932 bytes — SHA-256 `3116BAF8BFD88E5E68C162EB293E65CA005A7131CA10C8C10B2153D2E25636EE`
- `baritone-api-fabric-1.18.0.jar` — 4,820,839 bytes — SHA-256 `B0E67DCD272453E5DBD7D264CA35E18902D63B87605C3470D95ABE2C970526E9`
- `fabric-api-0.157.0+26.2.jar` — 2,533,297 bytes — SHA-256 `ACB7DC90A0430519C49548074D3FBF6FD81D13063F08F0AF344B2A6B08A42620`
- `family-client-bootstrap-0.1.0.jar` — 16,015 bytes — SHA-256 `D7998DCB630675D2F2BEEDFF3D9605ED7D8A49DFC0D45F08D82FC68B351AC820`

## Safety boundary

The legacy `mastermind-client` remains the separate Minecraft 1.21.4 2b2t project and must not be reused by the Family companion. No live client or server process is modified by bridge builds or unit tests.

The backup implementation and its automated tests do not create, purge, or restore the live Family world. The first real operator snapshot remains an explicit action in **MINECRAFT > FAMILY SERVER** after the server has been safely stopped.

The Modrinth manager tests likewise do not install an add-on into the live Family Server. Verified hashes establish artifact identity, not code safety: mods execute arbitrary Java code with the current Windows user's authority. A dedicated restricted Windows service account with narrow filesystem and network permissions is the recommended next hardening step.
