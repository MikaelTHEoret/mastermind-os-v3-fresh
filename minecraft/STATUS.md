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

- Hybrid body foundation: the default-off `family-core` 0.5.0 authenticated server bridge is managed and live-verified. A fresh file-only token is created after exact artifact verification, rechecked immediately before spawn, bound to the exact hello identity and enabled capability set, retained only for an authenticated surviving server, and removed on normal exit. Rotation, tamper, orphan, recovery, launch-order, cleanup, sanitized-status, isolated loopback socket, disposable real Fabric-server boot, live Family Server authentication, empty-server heartbeat continuity, identity resolution, and bounded public-chat transport checks pass.
- The schema-v2 authenticated first-party artifact registry, verified-snapshot gate, atomic install/rollback boundary, exact launch binding, and bounded status endpoint are active for `family-core`. Generation `36d6c9feca61bcc4e871c5845be869adf784c751ef13f561e20cf534d9cce093` is bound to verified backup `bkp-11b63348072b30a539b347740236fb7f`; Fabric live-loaded the pinned 50,772-byte 0.5.0 JAR with SHA-256 `9c3138dc8c7830b514a9714d4f1df329a220fa87ec06f53d6bc516a03b333ac8`, authenticated the loopback bridge, and advertised only deterministic Computer requests, identity events, and public-chat capture. Rollback to the accepted 0.4.0 artifact is available. Third-party mod mutations remain deliberately blocked until combined dependency-graph validation is added.
- Minecraft 26.2 pauses game ticks after 60 empty seconds. Live acceptance exposed that 0.3.0 incorrectly tied bridge liveness to those ticks; 0.3.1 moves only the transport heartbeat to a daemon wall clock. At 105 seconds after authentication, the empty live server had exactly one connection event, no disconnect/reconnect, no server error, and remained authoritative `running`.
- Disabled automatic-backup policies now exit after a bounded policy-file read instead of opening the full Windows filesystem-safety broker every minute. Focused regression tests and a live quiet-cycle check passed with no scheduler errors or helper processes; the running manager then independently reverified both snapshots.
- The exact pinned Zenith runtime, three minimal core patches, secure credential bootstrap, Mastermind plugin, and server-signed telemetry mod are privately staged. Parent takeover and automatic handback are live-verified in an isolated copy of the Family world with all movement/action automation off; the candidate is not yet a managed command-center service.
- The reproducible 50,772-byte `family-core` 0.5.0 artifact with SHA-256 `9c3138dc8c7830b514a9714d4f1df329a220fa87ec06f53d6bc516a03b333ac8` is promoted and live. Its separately authenticated `chat.capture` capability forwards bounded signed public text, resolves identity centrally, and emits an internal event only. On 2026-08-22, bound parent `MISS_LENKA` joined, sent `hello alchemist`, the enabled hook and authenticated loopback session remained stable with no protocol rejection, and no model reply or profile write occurred. The live transport intentionally retains no chat text.
- Deterministic dual-character intake now classifies explicit Computer requests, exact companion addressing, direct replies, and a bounded continuation window. Authenticated chat receipts feed a redacted counter/status projection that stores no chat text, name, or player identifier. Model calls, persona speech, profile capture, and task execution remain disabled; this source change is offline-verified and awaits a later maintenance restart before live acceptance.

## M3F foundation completed

- Canonical dual-character requirements, role matrix, resource limits, profile boundaries, release gates, and four-state feature manifest.
- Strict brain domain contracts, disabled adapters, provider-neutral model-broker boundary, deterministic fakes, prompt placeholders, and focused tests.
- Authenticated and sequenced `family-core` protocol v1 with strict JSON parsing, bounded payloads, allowlisted administration operations, replay protection, schema, and tests.
- Separate server-only Fabric `family-core` for Minecraft 26.2 / Java 25. The pinned 0.5.0 artifact is installed through the managed first-party lane and live-verified in the Family Server. Its authenticated server bridge, deterministic `/computer help` and `/computer status`, identity events, and bounded public-chat capture are enabled; every other Computer request receives a typed rejection without a model call. The live launch authenticated with exactly the `computer.request`, `identity.events`, and `chat.capture` capabilities. `MISS_LENKA` completed the player-visible help/status, identity, and public-chat transport checks on 2026-08-22. Administration, shutdown, companion telemetry, and companion events remain disabled.
- Companion bridge v2 observation/action inventory and runtime validators. Negotiation remains v1 and no v2 capability is advertised.
- Authenticated dashboard status placeholder and a loopback-only reasoning route that validates requests and returns `FEATURE_DISABLED`.
- Only the bounded `family-core` bridge and deterministic Computer/identity/public-chat transport features are installed into the live server through its authenticated artifact lock; model reasoning, companion conversation, profiles, administration, survival, and gameplay behavior remain off. A one-use typed administration plan temporarily granted `MISS_LENKA` operator access to execute `/setworldspawn`; the server set the Overworld spawn to `149, 63, -645`, the paired de-op plan succeeded, and `ops.json` was verified empty afterward.

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
- The isolated admission patch adds a synchronous deny-by-default event, revokes old-controller packet input before atomic replacement, and preserves the new lease during old-session disconnect cleanup. A third minimal hook gates every native bot tick; stock behavior remains unchanged when the plugin is absent, while Mastermind denies ticks outside `ZENITH_FALLBACK`.
- The plugin's admission policy permits only an authenticated parent to replace the exact service controller. The Family-account isolated acceptance verified parent replacement, immediate service revocation, user-confirmed physical control, recovery hold on disconnect, and automatic fallback only after fresh matching server-signed telemetry remained stable. Managed core promotion is complete; gameplay safe-stop acceptance remains required before unattended activation.
- The previous rendered Fabric bridge remains available for regression/reference work but is no longer the intended production body.

## Offline Zenith staging evidence

- ZenithProxy JAR — 61,674,658 bytes — SHA-256 `CCA682A4B83E494DEF1F71E53CE056B912F0385809A92DD40843A700E709F3A2`
- Patched ZenithProxy candidate JAR — 61,675,883 bytes — SHA-256 `700E9E91F38725A068D1F8E93D3B6F56F36221BB6F25EC174A36ED59110D8161`
- Mastermind Zenith plugin JAR — 17,880 bytes — SHA-256 `C7FD53C476C6BC11C39D959A6D633518F800C60C18080FEC5A2BCC0DC309F561`
- Controller-admission patch — 6,521 bytes — SHA-256 `616598AFDE4AA976DEF6008FDD929BC837AD9F545C3835B73AE7AE2DFEBB7934`
- Native bot-tick admission patch — 2,834 bytes — SHA-256 `37FD01424395880104376A5256AA1C9E0A7C33358D814400ECCF3149315E6230`
- Exact upstream build: 74 tests, zero failures/errors, three skips.
- Final plugin build: 20 tests, zero failures/errors/skips; JAR 35,436 bytes, SHA-256 `FAFD35F0B28A7F1D520EC47DA44AB7706DAA13E6D17558A8EA0CAC8ED1CDD10A`.
- Final `family-core` build: 7 tests, zero failures/errors/skips; JAR 18,481 bytes, SHA-256 `755B4E01F2C268C92F1BDC95FB8295602C0EB064EFC227A30D6264BE9E4870BE`.
- Reproducible `family-core` 0.3.0 bridge predecessor: 13 tests, zero failures/errors/skips; JAR 46,765 bytes; SHA-256 `94D226ED5A576FC556643D913B8D2D9E8293E458C25AEE37C1D220CC910BF526`. It authenticated in the live server and remains the rollback artifact, but empty-server acceptance exposed its game-tick heartbeat defect.
- Reproducible `family-core` 0.3.1 bridge: 15 tests, zero failures/errors/skips; JAR 48,754 bytes; two clean builds produced the same SHA-256 `F344CE2363BE26CF24EE0E9DC9BDF1C105614343883721A5D75710B15B502E7B`. The exact artifact is installed and live-verified past the empty-server pause boundary.
- Family Core credential stage: 46 focused Node protocol, bridge, credential, and process-lifecycle checks pass. The isolated socket fixture authenticated with the generated file-only token and accepted only the matching per-launch session/server identity; no Minecraft process or live-world file was touched.
- Isolated Minecraft boot: a disposable empty Minecraft 26.2/Fabric 0.19.3 server loaded `mastermind-family-core` 0.3.0, reported all eight runtime flags disabled, bound only `127.0.0.1:25569`, reached `Done`, accepted a clean console stop, released the port, and left no Java process. The Family world, live server, and Zenith runtime were not read into the staging world or modified.
- Patched upstream result files: 75 tests, zero failures/errors, three skips; Gradle's result socket reset after writing the results, and the hook test reran alone with a clean successful exit.
- Offline fake-identity simulation: patched hook detected, no account/upstream/listener enabled, then configuration restored to all-false flags and blank identities.
- Stock-runtime negative simulation: takeover request failed plugin preflight because the pinned hook was absent; no module registered, then configuration was restored to disabled blank defaults.
- Disabled idle boot: approximately 162.8 MB working set, 216.3 MB private memory, 0.015% normalized CPU, zero observed TCP connections, and no leaked process or listener after stop.
- Observation-only headless controller: six tests pass; shaded JAR 29,479,224 bytes; SHA-256 `E1C397C69A4B1C6545E459F80CD464063F1D86F256A2CD3F42853B27B6DB3581`.
- Loopback protocol fixture: service reached play, unknown identity failed closed, authorized parent preempted and revoked the service, parent exited cleanly, and the service re-entered. No family account, Family Server, or live world was used.
- Secure Family live candidate: combined Zenith JAR 61,678,737 bytes, SHA-256 `C11FF1A6B69DF5AD99C95203605AB5389D21BE8CCB919130CF8AC279A3F20A17`; secure bootstrap JAR 9,227 bytes, SHA-256 `53D611DA8C8796184D05741DEE21160FBD4C23E0E35194502C8861DAF313F433`.
- Family live acceptance: verified offline managed-instance copy, clean managed restart, DPAPI-backed session injection, `The_AlChemist___` upstream login, loopback listener, no plaintext auth cache or fallback device flow, exact stop, and successful hardened relaunch.
- Isolated Family-account handback acceptance: an observation-only service controller authenticated, the allowlisted `MISS_LENKA` account preempted it, the service socket was revoked before parent admission, and the parent confirmed physical control. Parent disconnect entered `RECOVERY_HOLD`; about three seconds later, fresh HMAC-authenticated server telemetry matched identity, session, sequence, dimension, position, life, ground, idle, connection, and kill-switch state and admitted `ZENITH_FALLBACK` without restart.
- A final-artifact replay repeated service-controller disconnect and automatic signed handback with runtime SHA-256 `00C2AE1ED1D74C2B3AFF4E3872C69CA034D7FB3CB91032FC7E8A0C0ED5A050B5`. The isolated processes stopped cleanly and the previously accepted safe proxy was restored. All built-in action automation remains disabled.
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
