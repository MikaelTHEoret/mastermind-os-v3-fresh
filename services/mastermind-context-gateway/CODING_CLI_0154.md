# Compatible exact CLI update

The previous executable was removed by an app update. The runtime now recognizes
the separately observed 0.154.0-alpha.6.2 SHA256
`081e4de4be8e38fac6ed4d95e3b1a0b9f6d31c090ddc36e1696b349fe406f575` while retaining
the earlier accepted hash. An old coding grant cannot authorize the new executable.

Node and SQL validate only the exact scope metadata. They do not claim account,
source, host or execution acceptance. The native worker adds bounded effective
configuration checks and explicit per-server MCP disables, because an empty TOML
table does not erase inherited servers. Ordinary approvals and sandboxing stay active.

`coding_permission_cli_update.py` reuses the existing catalog, owner, lock, preimage
and postcondition guards. The migration changes only the existing validator body;
setters, task records and history remain unchanged. Apply/replay are idempotent.
Rollback is held while any task refers to the newly accepted pin. Old scopes remain
valid and need no migration. The original migrations remain immutable.

`verify-coding-cli-update-sql.py` runs the original fixture plus the second-pin
apply/replay/negative/actual-scope/rollback controls in an explicitly named empty
loopback database. The entire fixture rolls back. It never reads production DB
configuration. Tests may run privately before public publication or deployment.
