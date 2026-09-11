# Native capability discovery

`NativeTaskClient.catalog()` reads only `http://127.0.0.1:8770/task_catalog`.
It accepts a schema-versioned task reference and an opaque snapshot/cursor pair.
Its checked response contains one accepted option and input schema, or an empty catalog.
The response cannot carry grants, paths, saved results or claimed execution authority.
Failed, oversized, mismatched or interrupted reads are not retried automatically.

This is a source-only local adapter, not a remote gateway route or registered worker
capability. Hosted discovery still needs a typed operation on the existing Stargate
ledger, owner/task checks at admission and result reads, and an interface that gets its
bindings from that operation. Do not expose arbitrary kernel URLs or a generic proxy.

Local acceptance: six catalog tests plus the existing eight caller and nine worker
recovery checks pass. A synthetic catalog produced by the real Python ModuleCore fixture
passes the Node broker contract without executing a candidate. The matching private
runtime passes all 591 native-development tests. No production database or service
installation was changed by this development slice.
