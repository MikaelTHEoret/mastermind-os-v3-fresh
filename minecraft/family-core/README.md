# Mastermind Family Core

This directory is the compileable, server-only Fabric foundation for the Family Companion chat bridge.

Version 0.3.1 provides the compileable authenticated server bridge while keeping every behavior feature disabled by default. Its WebSocket is pinned to `ws://127.0.0.1:43100/v1/family-core/bridge`, requires a private bearer-token file and session UUID, enforces strict bounded protocol-v1 envelopes, and reconnects with bounded backoff. Transport heartbeats use a dedicated daemon clock because Minecraft 26.2 pauses game ticks on an empty server; ordinary gameplay logic remains tick-driven. The control plane provisions a fresh launch credential only after exact artifact verification, verifies it again immediately before process creation, binds the first hello to the generated server-instance UUID and disabled feature state, and removes the token and private configuration when the owned server exits. Tokens never enter process arguments, environment variables, logs, Git, or the status API.

`/computer` is independently gated by `computerCommand.enabled=true`; it cannot be enabled without the server bridge. `help` and `status` are deterministic. Other requests cross the typed bridge and currently receive an explicit disabled response from the control plane. Administration, shutdown, ambient chat capture, identity events, companion telemetry, and gameplay actions are not advertised by this bridge candidate.

The older authenticated companion handback-attestation lane remains separately configurable and disabled by default. It activates only from the private `config/mastermind-family-core.properties` file containing the exact companion UUID plus absolute paths to a 32-byte HMAC key and atomic attestation target.

Build and test it in isolation from the repository root:

```powershell
.\minecraft\family-agent-bridge\gradlew.bat -p .\minecraft\family-core test build --no-daemon
```

The exact 0.3.1 JAR is reproducibly built, promoted through the verified-snapshot gate, and live-verified on the Family Server. Credential rotation, tamper rejection, stopped-state cleanup, active-process recovery, authenticated loopback launch, and empty-server heartbeat continuity are passing. Computer, chat capture, identity, administration, shutdown, companion telemetry, and companion events remain disabled until their separate acceptance gates.
