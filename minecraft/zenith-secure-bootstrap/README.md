# Mastermind Zenith secure bootstrap

Dependency-free credential boundary in front of the pinned Zenith runtime.

It accepts the existing bounded `MFC1` Minecraft session frame on standard input,
rejects command-line and pre-seeded property credentials, transfers only the current
short-lived profile session to the patched Zenith authenticator, closes standard input,
sets a required-session latch that blocks fallback authentication, and clears its temporary
in-process properties when Zenith exits. It never receives the DPAPI refresh token and never
writes an authentication cache.

This bootstrap must be launched with both its JAR and the exact pinned patched Zenith JAR
on the Java classpath. It is not a standalone proxy and must not be used with stock Zenith.
