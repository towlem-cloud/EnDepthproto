# School Google access to EnScribe

This feature lets students enter an open EnScribe assignment through one class link and prove their identity with their school Google account. Teachers do not have to invite each student to a ChatGPT Site or create every workspace individually. The department application creates or opens the authenticated student's assignment workspace on the server. Existing staff credentials, private student links, original writing, revision history, and coaching limits remain in place.

This is an addition to `https://en-depthproto.vercel.app/`. It does not edit the original ChatGPT Site, transfer its private records, or make its existing assignment codes valid in the department application.

## Release and activation

The feature defaults to disabled. A successful build or mocked sign-in test does not establish that the school's Google connection works. Before announcing availability, complete all of the following:

1. Review the implementation and run the automated suite and production build.
2. Validate the additive migration in an isolated database. Confirm effective Preview and Production database bindings before any hosted migration; project-level variables targeting both environments do not establish isolation. Use the guarded migration and existing production recovery procedure in [Department rollout](department-rollout.md). The migration must preserve every existing row and pre-existing column and must not seed or reset accounts.
3. Deploy the reviewed commit to the existing project. No additional API function or paid authentication service is required.
4. Complete the one-time Google setup below, then configure the administrator's school Google settings inside the department portal.
5. Verify an actual school Google sign-in, individual workspace isolation, an original draft save, logout/revocation, and an intentionally rejected personal Google account using synthetic classroom work. Live Google and live AI verification are separate checks; neither follows from the frontend build.

## One-time school Google setup

A school Google administrator or someone authorized to manage the school's Google Cloud project creates a **Web application** OAuth client in the school's project. Add the exact application origin:

`https://en-depthproto.vercel.app`

Google's **Authorized JavaScript origins** field contains the origin only, without a query string or assignment path. A preview used for a real Google test needs its own exact authorized origin. Never substitute a preview deployment for the production classroom link.

Use the school's internal Google Workspace audience where available. An external app left in Google's **Testing** state may require adding individual test users, which defeats department-wide self-service. The school administrator must approve the application if its Google Workspace policy blocks third-party sign-in. This is a one-time application approval, not an invitation for each student.

The application uses Google Identity Services ID tokens. It needs the public **client ID** ending in `.apps.googleusercontent.com`; it does not ask the owner for a client secret or Google password. Enter the client ID in the authenticated department administrator screen. Do not paste credentials or access tokens into chat, source files, pull requests, or student materials.

Configure the students' actual school email domain or domains in that screen. Do not infer the student domain from the teacher roster. Personal `gmail.com` accounts are not school accounts. The server checks Google's signed Workspace `hd` claim, the verified email domain, issuer, audience, expiry, and one-use nonce. A domain hint shown in Google's account chooser is not authorization.

Official Google documentation: [Display the sign-in button](https://developers.google.com/identity/gsi/web/guides/display-button), [Verify ID tokens](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), and [OpenID Connect identity claims](https://developers.google.com/identity/openid-connect/openid-connect).

## Teacher and student workflow

The administrator connects Google once and enables school access. This never changes the approved staff registry or promotes a Google user to a teacher.

A teacher creates or opens an assignment, explicitly enables school Google access for that assignment, and shares the generated class link. Enabling access authorizes students with the configured school Google identity to join that assignment. An assignment link alone cannot reveal student drafts. Closed and draft assignments reject student admission, and testing sandboxes keep their separate teacher-controlled access.

Students open the class link, choose their school Google account, and enter their own writing workspace. Each student gets a revocable, HttpOnly, Secure, SameSite cookie. The Google ID token is verified on the server and is not stored as an application credential or placed in the URL. The student's verified identity is kept separate from academic request construction.

When a teacher has already imported an original under that same email, Google admission can bind only an unambiguous matching student record. It preserves that record's ID, original, working draft, and history. Duplicate matches or an existing different Google identity must be resolved by the teacher rather than selecting a draft arbitrarily. New students receive separate workspaces; students cannot retrieve another student's draft by changing an email or writer ID.

Google profile names, when supplied, are identity metadata; names are not inferred from the email address. Academic writing itself can identify its author. Live coaching sends academic writing to the AI provider under the existing privacy and safety controls.

This change does not add Exam.net integration, PDF parsing, or batch Word import. Teacher paste/import and independent original preservation remain available as before.

## Disable or roll back

Disabling school Google access for an assignment revokes that assignment's Google-created sessions. Changing or disabling the administrator's school Google configuration revokes Google-created sessions across the department. Existing private-link sessions and writing records are preserved. Existing teacher credential rotation and account disabling continue to revoke affected student access.

Keep the additive schema and student records on rollback. Disable Google access through the administrator screen and turn off assignment Google admission; never drop or truncate original writing, reset teacher credentials, restore an obsolete environment-code fallback, or reassign existing records. Existing individual private links provide the prior access workflow.

If code must be rolled back, use the previously reviewed production commit while retaining the additive tables and columns. Retain the production recovery branch until the release is verified. Record the exact remote commit, migration result, hosted deployment, and whether an actual Google login and a bounded live AI exchange were performed.

## Verification record: October 22, 2026

The local production build, `git diff --check`, and all 106 automated checks pass with no skipped tests. The suite uses isolated PGlite PostgreSQL databases, synthetic RSA signatures and Google public-key responses, mocked coaching, and Chromium on desktop and mobile. It exercises existing access as well as the new school Google path. The production migration fixture also preserves populated Google configuration, nonces, subject bindings, and sessions on rerun.

An actual school Google login and an actual bounded live AI exchange have not been verified for this change. No production migration, Google client configuration, student enrollment, credential reset, or production deployment was performed during this implementation.

The existing production deployment was verified at `6bf59f282713b63a959b4a09f61f7c2779e51195`. Vercel project access works, but sensitive database values are not returned by its environment API and no database connection or Neon management credential is available in this workspace. The `DATABASE_URL` project record targets both Preview and Production; this does not establish the effective deployment's branch or prove isolation. A verified database connection is required before applying the guarded migration. The school must also provide its authorized Google Web client and actual student domains through the authenticated setup screen before students can use this feature.
