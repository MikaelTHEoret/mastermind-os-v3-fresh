# Mastermind Zenith headless controller

Minimal Minecraft-protocol controller for the private Zenith controller entrance.

Safety properties:

- accepts exactly one bounded JSON launch envelope on standard input;
- connects only to IPv4 loopback;
- never accepts credentials in command-line arguments or environment variables;
- never logs the access token or raw disconnect details;
- accepts a second bounded JSON-lines channel on the same private stdin pipe;
- currently exposes only `chat.say`, rejects command-prefixed or unsafe text, and never echoes chat content;
- exposes no movement, inventory, or interaction commands yet;
- disconnects after a bounded hold period, invalid command, or transport failure and closes its Netty resources.

This controller is not yet an autonomous player. The first action slice allows the companion
to converse through the same embodied controller path as a real client while movement remains
with the safe native fallback or an authenticated parent.

The pinned Minecraft 26.2 palette dimensions are supplied explicitly because Zenith's
MCProtocolLib fork delegates that metadata to its embedding client. This probe does not
retain or interpret chunks; it only remains connected long enough to verify the lease.
