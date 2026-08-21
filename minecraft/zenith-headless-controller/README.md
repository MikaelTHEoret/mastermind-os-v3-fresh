# Mastermind Zenith headless controller

Minimal Minecraft-protocol controller used to prove the private Zenith controller entrance.

Safety properties:

- accepts exactly one bounded JSON launch envelope on standard input;
- connects only to IPv4 loopback;
- never accepts credentials in command-line arguments or environment variables;
- never logs the access token or raw disconnect details;
- exposes no movement, chat, inventory, or interaction commands yet;
- disconnects after a bounded hold period and closes its Netty resources.

This probe is not an autonomous player. It exists only to validate authenticated login,
controller admission, revocation, and clean shutdown before the action surface is added.

The pinned Minecraft 26.2 palette dimensions are supplied explicitly because Zenith's
MCProtocolLib fork delegates that metadata to its embedding client. This probe does not
retain or interpret chunks; it only remains connected long enough to verify the lease.
