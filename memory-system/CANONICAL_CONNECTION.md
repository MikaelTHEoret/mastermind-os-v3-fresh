# Legacy memory script configuration

These historical scripts now obtain the memory connection from the existing explicit runtime handoff: `NEON_MEMORY_URL` for Node scripts and `NEON_MEMORY_DSN` for Python scripts. The caller supplies that variable from its canonical local configuration. The helpers do not load configuration files, connect to a database, or fall back to a generic `DATABASE_URL`.

Each script retains its original required connection options. A missing option is added; a conflicting configured option stops execution with a typed configuration error. Other configured options, the configured credentials and the configured target are preserved. There are no embedded fallback credentials.

This source cleanup did not run any historical script. Several scripts create or alter tables, insert memories, rebuild indexes or persist derived data. The three historical configuration-table scripts in `scripts/` still use the memory target established by their original source; their names do not establish a different database authority. Review each script's effects and target before a deliberate run.

The resolver tests are isolated from those effects:

```text
node --test memory-system/canonical-memory-target.test.cjs
cd memory-system
python -m unittest test_canonical_memory_target -q
```

Historical source connection details in the inventory are redacted; exact originals are retained only in private local recovery evidence outside the repositories.
