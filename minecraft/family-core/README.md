# Mastermind Family Core

This directory is the compileable, server-only Fabric foundation for the Family Companion chat bridge.

Chat, commands, WebSocket control, administration, and shutdown remain disabled. One isolated staging lane can publish authenticated companion handback attestations. It is also disabled by default and activates only from a private `config/mastermind-family-core.properties` file containing the exact companion UUID plus absolute paths to a 32-byte HMAC key and atomic attestation target. It exposes no socket or gameplay action.

Build and test it in isolation from the repository root:

```powershell
.\minecraft\family-agent-bridge\gradlew.bat -p .\minecraft\family-core test build --no-daemon
```

The generated JAR is a build artifact only. Promote the attestation lane separately from later chat features, after isolated tests, a verified world snapshot, and an explicit activation decision.
