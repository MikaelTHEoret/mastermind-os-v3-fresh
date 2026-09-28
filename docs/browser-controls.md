# Remembered browser controls

Replaces temporary connection-code entry with automatic detection of the companion browser extension. The room panel offers status, find/reconnect, check reply, pause discussion and disconnect. The owner enables a remembered room permission once in the extension; the extension checks the authenticated room and exact saved transfer independently on every operation.

The browser transport sends only a fixed action, request ID, room reference and turn ID. It accepts only a response from this window and origin with the matching request ID, and validates the returned room and turn. Switching rooms drops late results. Captured text is rendered as text, never provider HTML. Detection itself reveals no conversation data and grants no authority.

No prompt sending or room saving is added. Existing prompt review, owner-reviewed response acceptance and saved operation receipts remain in force. Timeouts never retry automatically. A stopped or ambiguous tab discovery remains visible and does not claim recovery success. Browser privileges and client approval controls are unchanged.

Verification: focused browser transport tests plus companion extension tests (105 combined), and the complete TypeScript check. Live acceptance requires the approved website release, extension reload and one explicit remembered-room grant. Roll back to website59ca208 without modifying existing rooms or tasks.
