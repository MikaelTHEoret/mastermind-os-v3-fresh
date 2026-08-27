# Verified Baritone runtime

The provider compiles against and requires exactly one Baritone runtime JAR:

- Upstream: `https://github.com/cabaletta/baritone`
- Branch: `26.2`
- Source commit: `2991d9218050707df9c8daca5efd371091a92d36`
- Baritone version: `1.18.0`
- Minecraft version: `26.2`
- Fabric Loader metadata: `>=0.19.3` (Mastermind launches exactly `0.19.3`)
- File: `libs/baritone-api-fabric-1.18.0.jar`
- Size: `4,820,839` bytes
- SHA-256: `B0E67DCD272453E5DBD7D264CA35E18902D63B87605C3470D95ABE2C970526E9`
- License: LGPL-3.0; see `BARITONE-LICENSE-LGPL-3.0.txt`

The upstream artifact name includes `api`, but it is the minimum single-JAR
runtime for this integration: it contains the Fabric implementation, mixins,
and the public typed API. The `baritone-standalone-fabric-1.18.0.jar` artifact
is not used because ProGuard intentionally removes most public API classes.
Installing both would also duplicate the `baritone` mod ID.

The artifact was produced from the source commit above. The local build used
JDK 26 only to run Gradle and ProGuard while retaining Java 25 bytecode; its two
local source changes only made the compiler and ProGuard launcher JDKs
configurable. No Baritone runtime source was changed.

`verifyBaritoneApiArtifact` checks the full hash, Fabric metadata, mixin, core
implementation, and required public API classes before provider compilation.
The runtime bootstrap repeats the exact version and SHA-256 checks in the
launched client before linking the typed adapter. A missing, modified, stripped,
or version-mismatched Baritone therefore exposes zero navigation capabilities.

