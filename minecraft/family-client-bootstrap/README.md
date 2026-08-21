# Mastermind Family Client Bootstrap

This dependency-free Java 25 process is the stable, local credential boundary in
front of Fabric Loader's `net.fabricmc.loader.impl.launch.knot.KnotClient`. It is
only for the isolated Family AI client. It is not shared with or installed into
the Minecraft 1.21.4 2b2t client.

## Why it exists

Minecraft normally receives `--accessToken` on the operating-system command
line. Process inspection can then expose the bearer token. This bootstrap keeps
all account material off its command line: the control plane starts this main
class with only a verified classpath and non-secret profile options, writes one
binary credential frame to the child's stdin, and closes its write end. The
bootstrap closes stdin after the declared frame, creates the normal Minecraft
arguments in memory, and calls KnotClient reflectively in the same JVM.

No credential class is a record, no credential value is formatted into an
exception or diagnostic, and dependency exception messages are discarded.
Received byte/character buffers and the temporary argument array are cleared on
a best-effort basis. Java `String` is immutable, so zeroization cannot be
guaranteed; the access-token string is retained only by the in-process game
launch for as long as Minecraft needs it.

## Process command line

The trusted provisioner constructs exactly these bootstrap arguments:

```text
--game-dir <absolute managed Family client game directory>
--assets-dir <absolute managed Family client assets directory>
--asset-index <verified Mojang asset index id>
--version <verified Fabric/Minecraft profile id>
--version-type <bounded non-secret label>
```

The command line must also supply the verified client/Fabric/library classpath,
the usual verified JVM/native/logging options, and this main class:

```text
com.mastermind.minecraft.familyclientbootstrap.FamilyClientBootstrap
```

The lifecycle manager supplies `MASTERMIND_FAMILY_SERVER_PORT`; the bootstrap
validates it as `1..65535`. The server host is fixed to `127.0.0.1` and is not
configurable. The bridge token remains a separate
per-launch environment variable consumed by the bridge mod.

After reading credentials, the bootstrap passes the following deterministic
game arguments to KnotClient:

```text
--username, --version, --gameDir, --assetsDir, --assetIndex, --uuid,
--accessToken, --clientId, --xuid, --versionType,
--quickPlayMultiplayer 127.0.0.1:<trusted environment port>
```

Unknown, duplicate, missing, relative-path, control-character, and malformed
values fail before Fabric is invoked.

## Credential frame v1

All integers are unsigned big-endian. The enclosing frame is limited to 32 KiB.
The reader consumes exactly the declared frame, requires EOF immediately after
it, and closes stdin. The parent must close its pipe after writing the frame;
truncation and any byte appended after the declared frame are rejected.

```text
u32 frame_length
byte[4] magic = "MFC1"
u16 username_utf8_length   + strict UTF-8 bytes (1..16)
u16 uuid_utf8_length       + strict UTF-8 bytes (32 compact or 36 canonical)
u16 access_token_length    + strict UTF-8 visible ASCII bytes (1..24576)
u16 xuid_utf8_length       + strict UTF-8 decimal bytes (1..20)
u16 client_id_length       + strict UTF-8 UUID bytes (32 compact or 36 canonical)
```

The UUID is normalized to 32 lowercase hexadecimal characters for Minecraft;
the Microsoft public-client application ID is normalized to a lowercase
canonical UUID. The parent must use an anonymous pipe, write this frame once,
then close and discard its mutable source buffers. It must never put any of
these five values into the command, environment, manifest, logs, lifecycle
record, or browser response.

Exit status `64` means a non-secret profile input was invalid, `65` means the
credential frame was invalid, and `70` means Fabric could not be loaded or
terminated with an error. Diagnostics contain fixed safe text only.

## Build and test

No network or third-party dependency is needed. Either run the Gradle build
with a Java 25 toolchain or use the standalone PowerShell build:

```powershell
.\build.ps1 -Task build -JavaHome C:\path\to\verified\java-25
```

The standalone build compiles with `--release 25 -Xlint:all -Werror`, runs the
dependency-free contract/security suite, and writes
`build/libs/family-client-bootstrap-0.1.0.jar`.
