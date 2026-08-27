# Mastermind Family Agent Bridge

Client-only Fabric mod for the isolated Minecraft 26.2 Family Agent. It is a
new project and shares no code, mod ID, state, credentials, or installation
with the version-pinned 2b2t research client.

## Security boundary

- Connects only to `ws://127.0.0.1:43100/v1/companion/bridge`.
- Requires the per-launch `MASTERMIND_COMPANION_BRIDGE_TOKEN` environment
  variable. The token is never accepted in an argument, URL, JVM property, or
  configuration file.
- Requires the non-secret `MASTERMIND_FAMILY_SERVER_PORT` environment variable
  to match the Java port assigned by the command center (integer `1..65535`).
- Negotiates only WebSocket subprotocol `mastermind.family.v1`.
- Accepts strict protocol-v1 JSON text no larger than 64 KiB. Unknown fields,
  duplicate JSON keys, stale sequences, session mismatches, and arbitrary
  Minecraft/Baritone command strings are rejected.
- Disconnect, heartbeat loss, world exit, shutdown, and the kill switch cancel
  the active action and release all input controls.
- Press `F8` to latch the local emergency kill switch. It immediately releases
  controls and rejects new actions until Minecraft restarts; the control plane
  cannot reset it.
- Direct actions are refused outside the loopback Family Server
  (`localhost`/`127.0.0.1`/`::1`, on the trusted launch-time port).
- A requested client shutdown queues `client.shutdownAck` before stopping on
  the following client tick, giving the serialized WebSocket sender a flush
  opportunity.

## Build

The project targets Minecraft 26.2, Java 25, Fabric Loader 0.19.3, Fabric API
0.157.0+26.2, Loom 1.17.19, and Gradle 9.5.1.

```powershell
.\gradlew.bat clean test build
```

The first build requires internet access to populate Gradle's Fabric and
Minecraft development caches.

## Navigation compatibility

The base bridge still has no hard Baritone dependency. The separate
`baritone-provider` subproject implements `NavigationProvider` through Java's
`ServiceLoader` and uses only Baritone's typed API—never Baritone chat commands.
It supports typed navigate, follow, bounded gather, bounded explore, escape,
and return-to-named-waypoint actions. Every cancellation path calls Baritone's
global cancellation, force-cancellation, and input-key release APIs.

The compatibility module accepts only the official Baritone 1.18.0 build for
Minecraft 26.2, source commit
`2991d9218050707df9c8daca5efd371091a92d36`. Build-time and runtime checks pin
`baritone-api-fabric-1.18.0.jar` to SHA-256
`B0E67DCD272453E5DBD7D264CA35E18902D63B87605C3470D95ABE2C970526E9`.
Despite its name, that is one complete Fabric runtime with its typed API kept;
the smaller `standalone` build strips the API and is deliberately rejected.

A managed Family client eventually needs these four separate mod JARs:

- `fabric-api-0.157.0+26.2.jar`
- `family-agent-bridge-0.1.0.jar`
- `family-agent-baritone-provider-0.1.0.jar`
- `baritone-api-fabric-1.18.0.jar`

They have only been built and verified; this work does not install them into
or launch a live Minecraft client. If Baritone is absent, modified, stripped,
or version-mismatched, the provider advertises zero navigation capabilities
and skill actions continue to fail closed as `navigation-unavailable`.

See `baritone-provider/BARITONE_ARTIFACT.md` for complete provenance and
license details.
