# Recover saved core status in the Nodes panel

Previously, a browser reload discarded the panel's request state even though the node ledger retained the result. On opening Nodes, the panel now reads the latest core-status job for each visible node. Completed observations retain their original timestamp; unfinished requests resume exact-job polling. Recovery never enqueues a request.

The new GET /api/nodes/[nodeId]/core-status route requires the existing owner authorization and active household parent profile. It selects at most one version-1 core-status job from the existing ledger and returns the existing validated public projection. Empty history is explicit; failed retrieval is shown as unavailable. No schema migration or new store is required.

A delayed history response cannot overwrite a request already present in the tab. Recovery is aborted on unmount. Worker connectivity remains independent of a previously successful observation.

Validation: focused store, parser, UI, route, HTTP and hosted API boundary tests; production build. Browser acceptance after publishing must recover a previously saved result on reload without submitting or executing it again.

Rollback: restore the preceding web revision. This change does not alter saved jobs, worker credentials or the database schema.
