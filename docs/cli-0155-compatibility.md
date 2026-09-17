# Exact Codex 0.155 compatibility

The desktop update removes the earlier executable. This change accepts the separately reviewed 0.155.0-alpha.2.6 executable (`be793ab45adbcbd9fa716df04cb6bc68eb9e353c6e6af20886af45c11abc2413`) alongside the two existing suppressed-profile pins. It does not widen an existing grant or authorize a coding request. A fresh profile must bind the account, configuration layers, executable and current task authority.

The runtime must enumerate effective MCP entries, disable each one and verify the resulting effective configuration before a coding turn, just as for the accepted 0.154 executable. Failure prevents model invocation. Existing completed-job recovery keeps its original source and executable evidence.

`coding_permission_cli_0155_update.py` admits only the exact additive validator change. Its guarded apply and rollback preserve schema, function ownership, ACLs, setters and task history. A current grant using the new executable blocks rollback to the earlier validator. The raw migration is reviewed input to these guards, not an instruction to execute unguarded DDL.

`verify-coding-cli-0155-sql.py` executes the legacy, suppressed, 0.154 and 0.155 fixtures and their nested rollbacks in an explicitly empty loopback fixture database. The regular SQL workflow now runs this entire sequence. All account credentials and canonical databases remain outside CI.

Deploy compatible readers before granting the new executable. SQL fixture acceptance, source CI, canonical preflight/readback and a live bounded coding operation are separate acceptance results; source checks alone do not establish deployment or successful model execution.
