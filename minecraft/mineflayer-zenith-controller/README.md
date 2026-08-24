# Mastermind Mineflayer-through-Zenith controller

Compatibility spike for a reusable, non-rendering embodiment layer.

The process connects to Zenith's loopback-only Player Client entrance. Zenith continues to own
the upstream family account, reconnect behavior, conservative fallback, and parent takeover.
This controller is only a temporary enhanced pilot and never connects directly to the Family
Server.

Security and behavior boundaries:

- one bounded launch envelope is accepted through standard input;
- the destination must be IPv4 loopback;
- the short-lived Minecraft access token is never accepted in arguments, environment variables,
  logs, status output, or files;
- commands are a fixed typed vocabulary; arbitrary JavaScript and Minecraft commands are rejected;
- one physical action runs at a time and cancellation stops pathfinding and closes open windows;
- actions report success only after a fresh observation verifies their expected effect;
- the initial controller protocol is a staging spike, not a live control-plane capability claim.

Implemented primitives are deliberately general:

- state observation;
- chat through the embodied account;
- navigation with observed arrival verification;
- opening a block-backed workstation or storage container;
- semantic inventory transfers between the player and storage/input/fuel/output slots;
- close, cancel, and clean stop.

Smelting, cooking, crafting, and storage tasks are composed above these primitives. They are not
hard-coded controller commands.
