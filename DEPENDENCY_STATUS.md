# Dependency management

## Current source baseline — 7 September 2026 UTC

The source-check baseline is web commit `b00f820a9f2e784fb543bbce7f10ae988da23ee0`.
Use the committed `package-lock.json` with `npm ci --ignore-scripts --no-audit --no-fund`
for the documented source checks. Keep the lockfile in Git; deployment must not
silently generate a different dependency tree. The source-check baseline lockfile
SHA256 is `1b2e5fb6bf14d827616dcaee80d43384f14cc9f7053c84e452345f2186cfdc7c`.

`package.json` declares version ranges; the lockfile selects the exact installed
versions. Its current principal selections are:

| Package | Lock-selected version |
| --- | --- |
| `@clerk/nextjs` | 7.5.12 |
| `next` | 15.5.18 |
| `react` | 19.2.6 |
| `react-dom` | 19.2.6 |

See [Public source checks](docs/PUBLIC_SOURCE_CHECKS.md) for the clean Windows,
Node 22 and Python 3.14.5 procedure, environment restrictions, operator-only
prerequisites and separation of build acceptance from remote/runtime acceptance.
Clean CI passed at that exact source revision; this does not establish a fresh
vulnerability audit, all optional integrations, or production deployment.
Dependency updates require a deliberate package/lock change and relevant review
and verification. The source-check install deliberately does not run an audit.

## Historical v3.0.5 notes — superseded

The earlier note described Clerk 6.9.0, Next 15.3.3 and React/React DOM 18.3.1 as
exact compatible versions. It recorded removing problematic install scripts and
resolving older package-range conflicts. Those statements described an earlier
source state and are not the current dependency inventory or compatibility proof.

The old recommendation to let Vercel create a fresh lockfile is superseded by the
committed-lock procedure above. The original note is preserved in local recovery
evidence; no dependency or install behavior changed in this documentation repair.
