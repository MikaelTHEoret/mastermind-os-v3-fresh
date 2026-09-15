# Revise a saved review proposal

Choose **Resume latest review** to recover the most recent authorized proposal even after a later capability lookup. After recovering a successful review receipt, choose **Revise review proposal**. The editor starts from its saved requirements and examples, without uploading another file. Draft edits use a review-specific browser key and survive reload. Saving creates a new operation against the same original Wizard request; the previous proposal and its receipt remain in history. Discard removes only the unsent draft.

The editor remains unavailable when the worker does not advertise the review capability. While editing, task changes and unrelated submissions are disabled. These controls do not approve code, execute tests or activate candidates. Existing backend ownership, hash, permission and replay checks remain authoritative.

Validation: focused review/editor, remote-workflow, owner-route and store tests; production Next build and type checks passed. The build reports existing warnings outside these changed components and a local standalone symlink-copy warning from the shared dependency directory; hosted preview acceptance is still required.

Rollback: deploy the preceding compatible web revision. Saved review records require no migration. Keep migration029 because existing review exchange replay records depend on its bounded response size.
