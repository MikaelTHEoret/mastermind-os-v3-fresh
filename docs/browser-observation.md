# Browser observation panel

Adds an optional panel to the current shared-room turn. The paired extension supplies dated state and captured text; existing room messages and operation receipts remain authoritative. The panel exposes only status and checking the existing reply. It cannot submit prompts, save responses or advance discussions.

The owner explicitly enables observation in extension 0.3.0 for the original Mastermind tab, task, room and turn. The panel passes these identifiers to Chrome external messaging with the supplied connection code. The extension independently verifies the current authenticated room. Pairing expires after 30 minutes. The panel performs no automatic requests on mounting, reloading or switching rooms. It rejects mismatched responses and drops late results after navigation. React renders captured text as text, never HTML.

The original transfer page may close while the panel requests individual checks. This is not continuous streaming. Two spaced observations are required for stable capture. Pending writes are recovered through the existing mechanism; observation never replays them. Sending, saving and bounded discussion controls remain in the existing workflow for this first release.

Test the client contract with `node --test src/lib/chat-room/observation-client.test.mjs` and run the TypeScript check. A successful test does not establish installation or live provider capture. The new source requires publication approval before deployment. Rollback is the previous website revision, with all existing room data intact.
