# Mastermind Family Core

This directory is the compileable, server-only Fabric foundation for the Family Companion chat bridge.

Version 0.3.0 adds a compileable authenticated server-bridge candidate while keeping every runtime feature disabled by default. Its WebSocket is pinned to `ws://127.0.0.1:43100/v1/family-core/bridge`, requires a private bearer-token file and session UUID, enforces strict bounded protocol-v1 envelopes, and reconnects with bounded backoff. The control plane still rejects every production bridge connection until managed credentials are provisioned.

`/computer` is independently gated by `computerCommand.enabled=true`; it cannot be enabled without the server bridge. `help` and `status` are deterministic. Other requests cross the typed bridge and currently receive an explicit disabled response from the control plane. Administration, shutdown, ambient chat capture, identity events, companion telemetry, and gameplay actions are not advertised by this bridge candidate.

The older authenticated companion handback-attestation lane remains separately configurable and disabled by default. It activates only from the private `config/mastermind-family-core.properties` file containing the exact companion UUID plus absolute paths to a 32-byte HMAC key and atomic attestation target.

Build and test it in isolation from the repository root:

```powershell
.\minecraft\family-agent-bridge\gradlew.bat -p .\minecraft\family-core test build --no-daemon
```

The generated 0.3.0 JAR is a candidate build artifact only. Do not replace the live pinned 0.2.0 JAR until credential provisioning, isolated staging, a fresh verified world snapshot, and explicit promotion acceptance are complete.
