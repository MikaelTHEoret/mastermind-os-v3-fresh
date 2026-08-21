# Mastermind Family Core

This directory is the compileable, server-only Fabric foundation for the Family Companion chat bridge.

All runtime switches are false. The mod currently registers no `/computer` command, chat listener, WebSocket connection, administration executor, or shutdown handler. It is intentionally absent from the live Family Server provisioner and artifact lock.

Build and test it in isolation from the repository root:

```powershell
.\minecraft\family-agent-bridge\gradlew.bat -p .\minecraft\family-core test build --no-daemon
```

The generated JAR is a build artifact only. Do not copy it into a live server until the server-chat milestone has isolated staging evidence, a verified world snapshot, and an explicit promotion decision.
