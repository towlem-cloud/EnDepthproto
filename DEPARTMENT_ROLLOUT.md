# Department portal: rollout and rollback

## Scope

Additive EnScribe implementation in EnDepthproto. The existing homepage and `?assignment=` links remain. The separate ChatGPT EnScribe Site and the unfinished tree in towlem-cloud/EnDepth are not deployed or migrated. No original student records are copied into this repository.

Staff entry: `/?department=1`. EnScribe student links: `/?writing=<public slug>`. EnDepth links retain `/?assignment=<public slug>`.

## Data and migration

The existing endepth_teachers registry is shared. IDs, existing credential values, assignment IDs, public slugs and submission ownership remain. Legacy SHA credentials are upgraded to scrypt on successful sign-in with the same code. Existing administrator environment code seeds a dedicated administrator record once. Environment codes never restore revoked credentials or reactivate disabled accounts. Existing teacher accounts are matched by normalized email; no full names are inferred. Unmatched roster members are seeded inactive, awaiting activation.

Migrations in server/department-schema.js and server/atomic-schema.js are additive and idempotent. New writing tables use enscribe_ names; shared session, access and quota tables use department_. No production records are deleted or reassigned. Automatic legacy ownership backfilling on every login has been removed to avoid modifying unrelated records during login.

Vercel environment inspection showed DATABASE_URL and its aliases target both preview and production. All API database clients now use server/db.js. On VERCEL_ENV=preview each query runs inside a transaction with search_path=department_preview_v1, without public in the path. The schema is created if permitted; failure stops the request rather than using production. Preview contains synthetic/new test data only, not copied production records. The isolation is a schema in the existing database, not a separately provisioned paid database. Preview and production still share infrastructure and existing environment credentials; preview is protected by Vercel's existing deployment protection.

Only eight actual API entrypoints are retained under api/; database and other helpers moved under server/. No new plan or service is required. Vercel's Git deployment context confirmed the Hobby plan; eight entrypoints remain below its 12-function ceiling.

## Administrator workflow

1. Use the existing administrator code at `/?department=1`.
2. Open Department accounts. Existing active accounts retain their code. Awaiting activation accounts have no working code yet.
3. Activate / issue code generates 256 random bits and stores only a scrypt hash. Copy the code shown once and deliver privately using an approved channel. No email is sent automatically.
4. Rotate code revokes old sessions through credential binding. Disable explicitly deletes sessions. The UI cannot disable the current administrator.
5. Administrators can view all assignments and student records in both modules. Staff cannot transfer assignment ownership, promote roles or enumerate other teachers' work. Generic account edits change only the verified display name.

## Teacher workflow

One code opens both modules with a Secure, HttpOnly, SameSite=Strict, 8-hour session. Staff codes are not stored in browser storage. Choose EnDepth or EnScribe. Create assignments, set Draft/Open/Closed, and share the assignment link. EnScribe duplicates begin as drafts. Select an assignment to issue an individual student code; deliver each privately. EnDepth now uses these private codes in place of the shared class pilot code, including for existing links. A teacher must issue codes for students returning to old assignments; an email alone cannot establish student identity. Existing submissions remain linked to the same assignment/email.

Paste an independent draft during student-code issuance or let the student preserve it before coaching. Original imports are one-time and atomic; failed replacement imports do not rotate the code. The database trigger rejects original edits. Students save versioned revisions with explanations and separately submit a reflection. Submitted writing is read-only until a teacher reopens it. A version conflict leaves unsaved text on screen and requires the student to reload and compare.

Try both tools creates one owned, clearly fictional sample per module. Reopening/rotating a sample's access does not reset four successful checks. EnScribe example reset affects only the current staff member's test draft and is rate-limited. EnDepth's browser workspace reset does not clear database quota.

## Coaching and privacy

Only successful checks count. Reservation and idempotency are database-backed; concurrent requests cannot reserve more than four slots. A five-minute lease and fenced completion prevent stale requests from finalizing after a retry. Existing EnDepth usage is included. Failed, empty or safety-withheld responses release reservations; there is no simulated fallback. Restrictive and closed assignments reject coaching on the server. OpenAI input uses an explicit academic-field allowlist and store:false. Identity fields and codes are excluded; academic writing itself can identify a student. Both input and output moderation must succeed.

Student codes are bearer credentials, so they must be kept private. Reissue a code to revoke a lost one. Teacher requests require same-origin JSON, a current server-side session, and ownership. No public self-registration. Exports escape spreadsheet formula prefixes.

## Verification and release gates

`npm ci`, `npm test`, `npx playwright install --with-deps chromium`, `npm run test:ui`, `npm run build`, `git diff --check`.

The browser suite starts a loopback-only synthetic backend, exercises teacher creation and student access, checks the writing workflow at 390px and teacher/EnDepth pages at 1440px, and captures screenshots with no real student data. Generated credentials remain in ignored local test output and are not uploaded as CI artifacts.

The acceptance suite runs actual SQL/PLpgSQL using isolated in-memory PGlite, with mocked OpenAI. It tests migration preservation, all seven teacher activations, both modules, hostile ownership edits, admin scope, student-code authentication, original immutability, revision persistence, optimistic conflicts, submission/reopen, four-turn concurrency/idempotency, moderation/provider failures, legacy quotas, capacity, sandbox isolation, CSV safety, code revocation and rate limits. PGlite serializes statements; it is not a multi-connection Neon load test. The database row locks and atomic functions provide the production concurrency boundary.

Production activation and a real bounded AI check must be reported separately from mocked tests. A preview deployment or green frontend build alone does not establish that production teachers can log in. Keep the PR unmerged until authorization/privacy gates pass and preview API checks succeed. Do not publish test codes or credentials in the PR, logs or build output.

## Rollback

Do not drop or truncate added tables. Prefer a forward fix with the secured authentication retained. A blanket rollback to the old main restores the insecure environment-code recovery path and shared student-code authentication and cannot verify newly scrypt-hashed teacher codes; it is therefore NOT a safe authentication rollback. If a UI-only issue occurs, keep the new backend and disable the new writing navigation while preserving stored work. If access is affected, restrict the deployment through Vercel's existing protection and repair on this same branch before promoting. Export/review data only through authenticated owner/admin endpoints. Never restore old teacher hashes to regain access; use authenticated administrator code rotation.

## Current verification and access boundary

Implementation is published in the single department-enscribe-endepth branch and PR #8. Automated backend tests, desktop/mobile browser workflow, production build and diff checks have run successfully in GitHub Actions. Vercel previews build from the remote commit; the deployed department shell and API method rejection were fetched successfully, and an isolated-preview database lookup returned the expected missing-assignment response.

Authenticated preview walkthrough and a bounded actual OpenAI exchange are not yet verified: the cloud browser is at Vercel sign-in, and Vercel keeps the existing administrator credential non-readable. No production teacher activation, credential rotation, data migration or merge was performed. The production statuses of the seven teachers have not been inspected, so they must not be reported as active. New unmatched accounts will be awaiting activation when production migration runs. The test suite activates all seven synthetic roster accounts, not their live accounts.

Remaining release gate: authenticate to the protected preview using the existing administrator credential, verify both modules against preview data and a bounded live AI check, then approve production release. After release, use Department accounts to inspect the real roster and privately issue codes only where needed. Do not reset existing codes merely to match the synthetic test fixture.
