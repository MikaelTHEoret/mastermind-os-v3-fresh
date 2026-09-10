# Public source candidate checks

The workflow checks the web source on a fresh Windows runner with Node 22 and
Python 3.14.5. It uses the committed dependency lock, pinned actions, read-only
repository permissions and synthetic fixtures. It does not deploy, upload build
artifacts, read the private core repository, load operator secrets, run a model,
pair a worker or apply a migration. A successful source build is separate from
authenticated owner/OAuth and browser acceptance.

The exact sequence is `npm ci --ignore-scripts --no-audit --no-fund`,
`node scripts/check-public-source.mjs`, the two Python unittest discovery commands
in the workflow, TypeScript `--noEmit`, and the production Next build. The Node
runner rejects local environment files and configured operator keys before tests.
All standard Next dotenv filename variants are refused, including development
and test local overrides. The release build uses the exact GitHub checkout SHA as
`MASTERMIND_RELEASE_WEB_REVISION` and verifies `.next/BUILD_ID` equals it. The Next
callback accepts only a full 40-hex revision; on Vercel it can also use the platform's
`VERCEL_GIT_COMMIT_SHA`, and conflicting pins fail. Unpinned ordinary local builds
retain Next's fallback. This binds the build identity to a revision; two independent
artifact builds and byte comparison remain separate acceptance work.

The Python activation fixtures inject an inert canonical-target module and a mock
driver. Those fixtures verify control flow, not a live database or a standalone
activation installation.

## Operator utility prerequisite

`services/mastermind-context-gateway/scripts/canonical-schema-activation.py` is a
source-only operator utility. Its reviewed implementation imports `db_target.py`
from the existing sibling `mastermind-client` checkout. A clean public checkout
does not include that private companion or its database configuration. Do not run
activation from the public checkout or infer activation readiness from this CI.
Before an authorized operator uses that utility, verify the private companion is
present at the expected sibling path and matches the reviewed resolver pin, the
normal Python runtime has its approved driver, and a fresh target/preimage manifest
matches the requested scope. The existing apply/rollback owner and hash checks
remain mandatory. No fallback target is supplied by this source bundle.

The separate `checkpoint-ordering-fixture.mjs` is an explicitly invoked local
operator regression, excluded from CI execution. It requires the configured
canonical memory URL and the existing local Python driver. It captures the actual
project-state query, exercises only a unique temporary table, and rolls back.

## Optional local domains

The preserved archive-extension sources, three genealogy worker scripts and
Brittany handwriting service retain their existing local prerequisites. The
handwriting `.venv` and private workspace are excluded from Git and deployment;
models, image archives and credentials are not part of this web source. These
workers are not started by a web build, and local-only routes remain unavailable
on Vercel. The deployed source originally had `gitDirty=1`; this explicit source
candidate does not claim byte-for-byte reconstruction of that uncommitted build.
