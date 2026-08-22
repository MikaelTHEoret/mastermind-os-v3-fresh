# Mastermind Family Core

This directory is the compileable, server-only Fabric foundation for the Family Companion chat bridge.

Version 0.4.0 adds the separately gated authenticated player-identity event lane to the compileable server bridge. Its WebSocket is pinned to `ws://127.0.0.1:43100/v1/family-core/bridge`, requires a private bearer-token file and session UUID, enforces strict bounded protocol-v1 envelopes, and reconnects with bounded backoff. Transport heartbeats use a dedicated daemon clock because Minecraft 26.2 pauses game ticks on an empty server; ordinary gameplay logic remains tick-driven. The control plane provisions a fresh launch credential only after exact artifact verification, verifies it again immediately before process creation, binds the first hello to the generated server-instance UUID and exact advertised capability set, and removes the token and private configuration when the owned server exits. Tokens never enter process arguments, environment variables, logs, Git, or the status API.

`/computer` is independently gated by `computerCommand.enabled=true`; it cannot be enabled without the server bridge. `help` and `status` are deterministic. Other requests cross the typed bridge and currently receive an explicit disabled response from the control plane. `identityEvents.enabled=true` emits server-authoritative UUID/name join and leave events, always marked unbound guest at the JVM boundary. The control plane discards role claims, resolves UUIDs against an HMAC-authenticated private registry, and leaves every unknown player unbound. Administration, shutdown, ambient chat capture, companion telemetry, profiles, and gameplay actions are not advertised by this bridge candidate.

The older authenticated companion handback-attestation lane remains separately configurable and disabled by default. It activates only from the private `config/mastermind-family-core.properties` file containing the exact companion UUID plus absolute paths to a 32-byte HMAC key and atomic attestation target.

Build and test it in isolation from the repository root:

```powershell
.\minecraft\family-agent-bridge\gradlew.bat -p .\minecraft\family-core test build --no-daemon
```

The exact 0.4.0 candidate JAR is reproducibly built with SHA-256 `1A9BABBCE78C4105A71A9BB35C121CAD4D567E988D2035F2CDBC1667324105F1`. Twenty-seven focused Node protocol/bridge/credential/identity tests and the Java build pass, including role-claim rejection and registry-tamper failure. Promotion and live join/leave acceptance remain separate gates. Chat capture, administration, shutdown, companion telemetry, profiles, and companion events remain disabled.
