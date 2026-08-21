# Mastermind Zenith companion plugin

This disabled-by-default skeleton pins the plugin build to ZenithProxy `3.5.8+26.2.0` / Minecraft `26.2.0`. It models one body with three exclusive drivers:

1. an authenticated parent client;
2. an authenticated headless Mastermind controller;
3. conservative native Zenith fallback.

It registers no player command, raw remote API, credential, or model tool. The default configuration cannot enable because both controller identities are intentionally blank.

The current module observes Zenith controller events and stops Baritone while a lease changes. It is not production-safe yet: stock Zenith restarts native bot ticks immediately after a controller disconnect and rejects a second controller while one is active. Activation therefore requires a verified hold/preemption hook, paired server telemetry, transport authentication, and staging acceptance. Do not copy this JAR into a live Zenith installation.

ZenithProxy is an external AGPL-3.0 project and is not vendored here. This repository builds only the separately authored Mastermind plugin against Zenith's published development artifact.

The published Zenith 26.2 development artifact requires Java 25 and the Zenith development Gradle plugin requires Gradle 9.6.1 or newer.
