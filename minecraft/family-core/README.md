# Mastermind Family Core

This directory is the compileable, server-only Fabric foundation for the Family Companion chat bridge.

Version 0.5.0 adds the separately gated authenticated public-chat event lane to the compileable server bridge. Its WebSocket is pinned to `ws://127.0.0.1:43100/v1/family-core/bridge`, requires a private bearer-token file and session UUID, enforces strict bounded protocol-v1 envelopes, and reconnects with bounded backoff. Transport heartbeats use a dedicated daemon clock because Minecraft 26.2 pauses game ticks on an empty server; ordinary gameplay logic remains tick-driven. The control plane provisions a fresh launch credential only after exact artifact verification, verifies it again immediately before process creation, binds the first hello to the generated server-instance UUID and exact advertised capability set, and removes the token and private configuration when the owned server exits. Tokens never enter process arguments, environment variables, logs, Git, or the status API.

`/computer` is independently gated by `computerCommand.enabled=true`; it cannot be enabled without the server bridge. `help` and `status` are deterministic. Other requests cross the typed bridge and currently receive an explicit disabled response from the control plane. `identityEvents.enabled=true` emits server-authoritative UUID/name join and leave events, always marked unbound guest at the JVM boundary. `chatCapture.enabled=true` emits bounded signed public player text through `chat.received`; the control plane rejects unadvertised use, discards JVM role claims, resolves UUIDs against an HMAC-authenticated private registry, and emits only an internal event. This slice makes no model call, stores no profile, and sends no response. Administration, shutdown, companion telemetry, profiles, and gameplay actions are not advertised by this bridge candidate.

The older authenticated companion handback-attestation lane remains separately configurable and disabled by default. It activates only from the private `config/mastermind-family-core.properties` file containing the exact companion UUID plus absolute paths to a 32-byte HMAC key and atomic attestation target.

Build and test it in isolation from the repository root:

```powershell
.\minecraft\family-agent-bridge\gradlew.bat -p .\minecraft\family-core test build --no-daemon
```

The exact 50,772-byte 0.5.0 JAR was reproduced twice with SHA-256 `9C3138DC8C7830B514A9714D4F1DF329A220FA87EC06F53D6BC516A03B333AC8`. Thirty focused Node protocol/bridge/credential/identity tests and eight Java tests pass, including role-claim rejection, registry-tamper failure, schema-v1 credential recovery, and rejection of unadvertised chat events. The managed live server loaded the exact artifact and authenticated the three-capability bridge; bound parent `MISS_LENKA` then completed a public-chat transport check with no protocol rejection, model reply, or profile write. Model reasoning, profile capture, administration, shutdown, companion telemetry, and companion events remain disabled.
