# Historical lockfile note — superseded

This file previously instructed deleting `package-lock.json` to force fresh
dependency resolution. That advice belongs to an earlier troubleshooting state
and must not be used for the current source-check or release workflow.

Preserve the committed lockfile and use `npm ci --ignore-scripts --no-audit --no-fund`
for source checks. See [Dependency management](DEPENDENCY_STATUS.md) and
[Public source checks](docs/PUBLIC_SOURCE_CHECKS.md). A deliberate dependency
update must include a reviewed package/lock change and relevant verification.
