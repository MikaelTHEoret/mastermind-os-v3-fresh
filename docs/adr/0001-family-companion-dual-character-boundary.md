# ADR 0001: Dual character boundary

Status: accepted.

Computer and The_AlChemist___ are separate actors in protocol, prompts, sessions, output channels, permissions, and audit records.

`/computer` is the canonical administrative intake. Ordinary addressed chat belongs to the companion. Computer emits server-authored `[Computer]` messages through `family-core`; companion responses use the existing typed `direct.say` action and therefore originate from the real companion account.

The boundary prevents administrative responses from impersonating a player and prevents conversational context from silently gaining server authority.
