import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Real handlers, signature verification and PostgreSQL execute. Only Google's
// public signing-key download is mocked; no identity provider or AI is contacted.
const db = new PGlite();
function sql(strings, ...values) {
  const statement = strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
  return db.query(statement, values).then(result => result.rows);
}
sql.query = async (statement, values = []) => (await db.query(statement, values)).rows;
mock.module('@neondatabase/serverless', { exports: { neon: () => sql } });

const ORIGIN = 'https://synthetic-school.test';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const CLIENT_ID = '1234567890-synthetic.apps.googleusercontent.com';
const NEXT_CLIENT_ID = '1234567890-rotated.apps.googleusercontent.com';
const SCHOOL = 'school.test';
const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keyPair.publicKey.export({ format: 'jwk' }), kid: 'synthetic-school-google-key', alg: 'RS256', use: 'sig' };
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const signedCredentials = [];
function googleCredential(start, overrides = {}, privateKey = keyPair.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: jwk.kid });
  const payload = encode({
    iss: 'https://accounts.google.com', aud: start.data.clientId, sub: 'synthetic-google-student-a',
    email: 'google-a@school.test', email_verified: true, hd: SCHOOL,
    given_name: 'Synthetic', family_name: 'Google Writer', iat: now, exp: now + 1800,
    nonce: start.data.nonce, ...overrides,
  });
  const input = `${header}.${payload}`;
  const credential = `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  signedCredentials.push(credential);
  return credential;
}
const cookiePart = value => value?.split(';')[0] || '';
let networkSequence = 1;
function request(body, cookie = '', headers = {}) {
  return new Request(`${ORIGIN}/api/department`, {
    method: 'POST', headers: {
      origin: ORIGIN, 'content-type': 'application/json', cookie,
      'x-vercel-forwarded-for': `203.0.113.${networkSequence++ % 200 + 1}`, ...headers,
    }, body: JSON.stringify(body),
  });
}

test('school Google access preserves restricted EnScribe identities, writing and private-link access', async t => {
  const environment = {
    DATABASE_URL: 'postgres://isolated-google.test/never-production',
    ENDEPTH_TEACHER_CODE: 'synthetic-school-morgan-credential',
    ENDEPTH_SECOND_TEACHER_CODE: 'synthetic-school-second-credential',
    ENDEPTH_SECOND_TEACHER_EMAIL: 'marksd@ensworth.com',
    ENDEPTH_ADMIN_CODE: 'synthetic-school-administrator-credential',
  };
  const savedEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const logs = [];
  const externalRequests = [];
  t.mock.method(console, 'error', (...values) => logs.push(values));
  t.mock.method(console, 'warn', (...values) => logs.push(values));
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    assert.equal(String(url), JWKS_URL, 'only the fixed Google public-key endpoint may be fetched');
    externalRequests.push({ url: String(url), body: options.body });
    return Response.json({ keys: [jwk] }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  });
  t.after(async () => {
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.close();
  });

  const { ensurePilotSchema } = await import('../lib/endepth-db.js');
  await ensurePilotSchema();
  const { default: schema } = await import('../lib/department-schema.js');
  await db.exec(schema);
  const security = await import('../lib/department-security.js');
  const endpoint = (await import('../api/department.js')).default;
  async function call(body, cookie = '', headers = {}) {
    const response = await endpoint.fetch(request(body, cookie, headers));
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie'), response };
  }
  const staffA = await security.login(request({}), environment.ENDEPTH_TEACHER_CODE, '', sql);
  const staffB = await security.login(request({}), environment.ENDEPTH_SECOND_TEACHER_CODE, '', sql);
  const administrator = await security.login(request({}), environment.ENDEPTH_ADMIN_CODE, '', sql);
  async function assignment(staff, title, fields = {}) {
    const result = await call({ action: 'writing-save', assignment: {
      title, course: 'Synthetic course', section: 'Synthetic section', prompt: 'Interpret a fictional character’s choices.',
      instructions: 'The writer does the thinking.', rubric: 'Synthetic teacher-provided rubric.', timing: '',
      status: 'open', boundaries: 'moderate', ...fields,
    } }, staff.cookie);
    assert.equal(result.status, 200);
    return result.data.assignment;
  }
  const classA = await assignment(staffA, 'Synthetic Google class A');
  const classB = await assignment(staffB, 'Synthetic Google class B');
  const original = '\n  Preserved independent reasoning about a fictional character.\nA second paragraph with the writer’s own analysis.  \n';
  async function invite(email, draft = original, firstName = 'Preserved', lastName = 'Imported Writer') {
    const invited = await call({ action: 'writing-invite', assignmentId: classA.id, student: {
      firstName, lastName, email, original: draft,
    } }, staffA.cookie);
    assert.equal(invited.status, 200);
    return invited.data;
  }
  const imported = await invite('imported@school.test');
  // Existing ambiguous imports remain untouched; Google must not choose one.
  const duplicateA = await invite('ambiguous@school.test', 'Independent synthetic draft one.');
  const duplicateB = await invite('ambiguous@school.test', 'Independent synthetic draft two.');
  const privateToken = new URLSearchParams(imported.studentPath.split('#')[1]).get('access');
  const enteredPrivate = await call({ action: 'student-enter', studentId: imported.studentId, token: privateToken });
  assert.equal(enteredPrivate.status, 200);
  const privateCookie = cookiePart(enteredPrivate.cookie);
  const importedSnapshot = async () => ({
    student: await sql`SELECT id,assignment_id,original,working,reflection,version,submitted_at,successful_checks FROM enscribe_students WHERE id=${imported.studentId}`,
    revisions: await sql`SELECT * FROM enscribe_revisions WHERE student_id=${imported.studentId} ORDER BY version`,
    checks: await sql`SELECT * FROM enscribe_checks WHERE student_id=${imported.studentId} ORDER BY request_id`,
  });
  const preservedImported = await importedSnapshot();
  const read = (studentId, cookie) => call({ action: 'student-read', studentId }, cookie);
  const configure = (fields = {}) => call({
    action: 'google-school-configure', enabled: true, clientId: CLIENT_ID, domains: [SCHOOL], ...fields,
  }, administrator.cookie);
  const toggle = (a, staff, enabled) => call({ action: 'writing-google-access', assignmentId: a.id, enabled }, staff.cookie);
  async function start(a = classA, cookie = '') {
    const result = await call({ action: 'student-google-start', assignmentSlug: a.public_slug }, cookie);
    if (result.status === 200) result.bindingCookie = cookiePart(result.cookie) || cookie;
    return result;
  }
  async function signIn(a = classA, overrides = {}, binding = '') {
    const begun = await start(a, binding);
    assert.equal(begun.status, 200);
    const credential = googleCredential(begun, overrides);
    const result = await call({ action: 'student-google-login', assignmentSlug: a.public_slug, credential }, begun.bindingCookie);
    return { ...result, credential, begun, studentCookie: cookiePart(result.cookie) };
  }
  let googleA, googleB, importedGoogle, otherClassGoogle;

  await t.test('feature and assignments default off, administrator configures domains, and only the owner opts in', async () => {
    const settings = await call({ action: 'google-school-settings' }, administrator.cookie);
    assert.equal(settings.status, 200); assert.equal(settings.data.settings.enabled, false);
    assert.equal(classA.school_google_access, false);
    assert.ok((await start()).status >= 400);
    assert.equal((await call({ action: 'google-school-settings' }, staffA.cookie)).status, 403);
    assert.equal((await call({ action: 'google-school-configure', enabled: true, clientId: CLIENT_ID, domains: [SCHOOL] }, staffA.cookie)).status, 403);
    const configured = await configure();
    assert.equal(configured.status, 200); assert.equal(configured.data.settings.enabled, true);
    assert.equal(configured.data.settings.clientId, CLIENT_ID);
    assert.deepEqual(configured.data.settings.domains, [SCHOOL]);
    assert.ok((await start()).status >= 400, 'global enablement must not opt an assignment in');
    assert.equal((await toggle(classA, staffB, true)).status, 403);
    assert.equal((await toggle(classA, staffA, true)).status, 200);
    assert.equal((await toggle(classB, staffB, true)).status, 200);
    const example = await call({ action: 'writing-test' }, staffA.cookie);
    assert.equal(example.status, 200);
    assert.ok((await toggle(example.data.assignment, staffA, true)).status >= 400);
    const foreignOrigin = await call({ action: 'student-google-start', assignmentSlug: classA.public_slug }, '', { origin: 'https://foreign.test' });
    assert.equal(foreignOrigin.status, 403);
    assert.deepEqual(await importedSnapshot(), preservedImported);
  });

  await t.test('verified school Google login creates one private workspace, binds the nonce cookie, and grants no staff role', async () => {
    const begun = await start();
    assert.equal(begun.status, 200); assert.equal(begun.data.clientId, CLIENT_ID);
    assert.match(begun.data.nonce, /^[A-Za-z0-9_-]{43}$/);
    assert.match(begun.cookie, /HttpOnly/); assert.match(begun.cookie, /Secure/); assert.match(begun.cookie, /SameSite=Strict/);
    assert.ok(!JSON.stringify(begun.data).includes(begun.bindingCookie.split('=')[1]), 'the HttpOnly binding must never appear in JSON');
    const credential = googleCredential(begun);
    const missingBinding = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential });
    assert.ok(missingBinding.status >= 400);
    googleA = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential }, begun.bindingCookie);
    assert.equal(googleA.status, 200); googleA.studentCookie = cookiePart(googleA.cookie);
    assert.match(googleA.cookie, /^enscribe_student=/); assert.match(googleA.cookie, /HttpOnly; Secure; SameSite=Strict/);
    assert.ok(googleA.data.writerPath.includes(encodeURIComponent(googleA.data.studentId)));
    assert.equal(new URL(googleA.data.writerPath, ORIGIN).origin, ORIGIN);
    assert.ok(!googleA.data.writerPath.includes('access='), 'Google credentials must not appear in writer links');
    const student = await read(googleA.data.studentId, googleA.studentCookie);
    assert.equal(student.status, 200); assert.equal(student.data.student.email, 'google-a@school.test');
    const replay = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential }, begun.bindingCookie);
    assert.ok(replay.status >= 400);
    assert.equal((await call({ action: 'writing-list', role: 'admin' }, googleA.studentCookie)).status, 401);
    assert.equal((await call({ action: 'google-school-settings' }, googleA.studentCookie)).status, 401);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students WHERE assignment_id=${classA.id} AND email='google-a@school.test'`)[0].n, 1);
  });

  await t.test('invalid Google identity claims, a forged signature and a typed school email cannot enroll students', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM enscribe_students`)[0].n;
    const badKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    for (const [name, changes, signingKey] of [
      ['personal Gmail', { sub: 'personal-account', email: 'personal@gmail.com', hd: 'gmail.com' }],
      ['unverified email', { sub: 'unverified-account', email_verified: false }],
      ['email and hosted-domain mismatch', { sub: 'mismatched-domain', email: 'forged@outside.test' }],
      ['wrong audience', { sub: 'wrong-audience', aud: NEXT_CLIENT_ID }],
      ['wrong issuer', { sub: 'wrong-issuer', iss: 'https://forged.example.invalid' }],
      ['expired token', { sub: 'expired-token', iat: Math.floor(Date.now() / 1000) - 3600, exp: Math.floor(Date.now() / 1000) - 60 }],
      ['wrong nonce', { sub: 'wrong-nonce', nonce: 'x'.repeat(43) }],
      ['forged signature', { sub: 'forged-signature' }, badKey],
    ]) {
      const begun = await start(); assert.equal(begun.status, 200);
      const result = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: googleCredential(begun, changes, signingKey) }, begun.bindingCookie);
      assert.ok(result.status >= 400, name);
    }
    const emailOnly = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, email: 'typed@school.test', email_verified: true, hd: SCHOOL });
    assert.ok(emailOnly.status >= 400);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students`)[0].n, before);
  });

  await t.test('repeat and concurrent school sign-ins use one subject-owned document and never another student’s ID', async () => {
    const firstStart = await start(); assert.equal(firstStart.status, 200);
    const binding = firstStart.bindingCookie;
    const secondStart = await start(classA, binding); assert.equal(secondStart.status, 200);
    const sameSubject = await Promise.all([firstStart, secondStart].map(begun => call({
      action: 'student-google-login', assignmentSlug: classA.public_slug, credential: googleCredential(begun),
    }, binding)));
    assert.ok(sameSubject.every(result => result.status === 200));
    assert.ok(sameSubject.every(result => result.data.studentId === googleA.data.studentId));
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students WHERE assignment_id=${classA.id} AND email='google-a@school.test'`)[0].n, 1);
    googleB = await signIn(classA, { sub: 'synthetic-google-student-b', email: 'google-b@school.test' });
    assert.equal(googleB.status, 200);
    assert.equal((await read(googleB.data.studentId, googleA.studentCookie)).status, 401);
    assert.equal((await read(googleA.data.studentId, googleB.studentCookie)).status, 401);
    const forgedSave = await call({ action: 'student-save', studentId: googleB.data.studentId, version: 0, draft: 'Attempted foreign overwrite.' }, googleA.studentCookie);
    assert.equal(forgedSave.status, 401);
    const changedEmail = await signIn(classA, { email: 'another-address@school.test' });
    assert.equal(changedEmail.status, 409);
  });

  await t.test('nonce hashes expire after five minutes and bind one atomic admission to the browser and assignment', async () => {
    const before = (await sql`SELECT count(*)::int AS n FROM enscribe_students`)[0].n;
    const expired = await start(); assert.equal(expired.status, 200);
    const nonceHash = security.digest(expired.data.nonce);
    const bindingRaw = expired.bindingCookie.split('=')[1];
    const stored = (await sql`SELECT nonce_hash,binding_hash,expires_at,consumed_at FROM enscribe_school_google_nonces WHERE nonce_hash=${nonceHash}`)[0];
    assert.equal(stored.nonce_hash, nonceHash); assert.equal(stored.binding_hash, security.digest(bindingRaw));
    assert.equal(stored.consumed_at, null);
    const lifetime = new Date(stored.expires_at).getTime() - Date.now();
    assert.ok(lifetime > 4 * 60_000 && lifetime <= 5 * 60_000);
    assert.ok(!JSON.stringify(stored).includes(expired.data.nonce)); assert.ok(!JSON.stringify(stored).includes(bindingRaw));
    await sql`UPDATE enscribe_school_google_nonces SET expires_at=NOW()-INTERVAL '1 second' WHERE nonce_hash=${nonceHash}`;
    const expiredResult = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: googleCredential(expired, { sub: 'synthetic-expired-nonce', email: 'expired-nonce@school.test' }) }, expired.bindingCookie);
    assert.equal(expiredResult.status, 401);
    const bound = await start(); const otherBrowser = await start();
    assert.equal(bound.status, 200); assert.equal(otherBrowser.status, 200);
    const boundCredential = googleCredential(bound, { sub: 'synthetic-bound-nonce', email: 'bound-nonce@school.test' });
    assert.equal((await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: boundCredential }, otherBrowser.bindingCookie)).status, 401);
    assert.equal((await call({ action: 'student-google-login', assignmentSlug: classB.public_slug, credential: boundCredential }, bound.bindingCookie)).status, 401);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students`)[0].n, before);
    const oneUse = await start(); assert.equal(oneUse.status, 200);
    const credential = googleCredential(oneUse, { sub: 'synthetic-one-use-google', email: 'one-use@school.test' });
    const simultaneous = await Promise.all([0, 1].map(() => call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential }, oneUse.bindingCookie)));
    assert.equal(simultaneous.filter(result => result.status === 200).length, 1);
    assert.equal(simultaneous.filter(result => result.status === 401).length, 1);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students WHERE assignment_id=${classA.id} AND email='one-use@school.test'`)[0].n, 1);
  });

  await t.test('a Google workspace uses the real four-check quota and excludes identities and credentials from academic input', async () => {
    const draft = 'The fictional neighbor accepts responsibility after hesitation. The choice changes the consequences of the journey.';
    const saved = await call({ action: 'student-save', studentId: googleB.data.studentId, version: 0, draft }, googleB.studentCookie);
    assert.equal(saved.status, 200);
    const { studentWriting } = await import('../lib/enscribe-service.js');
    const academicPayloads = [];
    const diagnostic = 'Your explanation identifies a choice but leaves its relationship to the consequence unstated. Compare the details you already selected before deciding how much the choice explains. Which detail in your own draft best supports that connection?';
    const body = {
      action: 'student-coach', studentId: googleB.data.studentId,
      focus: 'Analysis', goal: 'Explain the relationship.', passage: 'accepts responsibility',
      tried: 'I reread the two sentences.', question: 'Where does the connection need more reasoning?',
      firstName: 'NEVER_SEND_GOOGLE_FIRST', lastName: 'NEVER_SEND_GOOGLE_LAST',
      email: 'never-send-google@school.test', studentEmail: 'google-b@school.test',
      credential: googleB.credential, googleSubject: 'synthetic-google-student-b',
      nonce: googleB.begun.data.nonce, binding: googleB.begun.bindingCookie,
      invitationToken: privateToken,
    };
    const beforeExternal = externalRequests.length;
    await assert.rejects(studentWriting(sql, request({}, googleB.studentCookie), {
      ...body, requestId: 'google-failed-request-0001',
    }, async academic => { academicPayloads.push(academic); throw new Error('Synthetic coach failure.'); }), /Synthetic coach failure/);
    const withheld = await studentWriting(sql, request({}, googleB.studentCookie), {
      ...body, requestId: 'google-withheld-request-0001',
    }, async academic => { academicPayloads.push(academic); return { withheld: true }; });
    assert.equal(withheld.withheld, true);
    assert.equal((await sql`SELECT successful_checks FROM enscribe_students WHERE id=${googleB.data.studentId}`)[0].successful_checks, 0);
    let successfulCoachCalls = 0;
    const coach = async academic => { successfulCoachCalls++; academicPayloads.push(academic); return { reply: diagnostic }; };
    for (let turn = 1; turn <= 4; turn++) {
      const coachingBody = { ...body, requestId: `google-success-request-000${turn}` };
      const success = await studentWriting(sql, request({}, googleB.studentCookie), coachingBody, coach);
      assert.equal(success.reply, diagnostic);
      const replay = await studentWriting(sql, request({}, googleB.studentCookie), coachingBody, coach);
      assert.equal(replay.cached, true); assert.equal(replay.reply, diagnostic);
      assert.equal((await sql`SELECT successful_checks FROM enscribe_students WHERE id=${googleB.data.studentId}`)[0].successful_checks, turn);
    }
    await assert.rejects(studentWriting(sql, request({}, googleB.studentCookie), {
      ...body, requestId: 'google-fifth-request-0001',
    }, coach), /Four successful/);
    assert.equal(successfulCoachCalls, 4);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_checks WHERE student_id=${googleB.data.studentId} AND state='complete'`)[0].n, 4);
    assert.equal(externalRequests.length, beforeExternal, 'the acceptance suite must never call an AI provider');
    const serialized = JSON.stringify({ academicPayloads, logs });
    for (const sensitive of [
      'NEVER_SEND_GOOGLE_FIRST', 'NEVER_SEND_GOOGLE_LAST', 'never-send-google@school.test', 'google-b@school.test',
      googleB.credential, 'synthetic-google-student-b', googleB.begun.data.nonce, googleB.begun.bindingCookie,
      googleB.studentCookie, googleB.data.studentId, privateToken,
    ]) assert.ok(!serialized.includes(sensitive), 'Google and student identity metadata must not enter academic input or logs');
    assert.ok(academicPayloads.every(academic => academic.draft === draft));
  });

  await t.test('Google sessions save an exact immutable original, resolve stale versions and record a real submission', async () => {
    const ownOriginal = '\n  Independent Google-path fictional analysis.\n\nThe writer explains their own reasoning.  \n';
    const first = await call({ action: 'student-save', studentId: googleA.data.studentId, version: 0, draft: ownOriginal }, googleA.studentCookie);
    assert.equal(first.status, 200); assert.equal(first.data.student.original, ownOriginal);
    const revised = await call({ action: 'student-save', studentId: googleA.data.studentId, version: 1, draft: `${ownOriginal}A qualification.`, explanation: 'I added a limitation to my own interpretation.', original: 'Must not replace original.' }, googleA.studentCookie);
    assert.equal(revised.status, 200); assert.equal(revised.data.student.original, ownOriginal);
    const conflict = await call({ action: 'student-save', studentId: googleA.data.studentId, version: 1, draft: 'Stale tab writing.', explanation: 'A stale edit.' }, googleA.studentCookie);
    assert.equal(conflict.status, 409);
    await assert.rejects(sql`UPDATE enscribe_students SET original='Direct forbidden original replacement' WHERE id=${googleA.data.studentId}`, /ORIGINAL_IMMUTABLE/);
    const submitted = await call({ action: 'student-save', studentId: googleA.data.studentId, version: 2, draft: revised.data.student.working, reflection: 'I reconsidered the connection and explained my own revision.', submit: true }, googleA.studentCookie);
    assert.equal(submitted.status, 200); assert.ok(submitted.data.student.submittedAt);
    const persisted = await read(googleA.data.studentId, googleA.studentCookie);
    assert.equal(persisted.data.student.original, ownOriginal); assert.ok(persisted.data.student.submittedAt);
    assert.equal(persisted.data.revisions.length, 3);
    const afterSubmit = await call({ action: 'student-save', studentId: googleA.data.studentId, version: 3, draft: 'Unapproved post-submission change.', explanation: 'Another edit.' }, googleA.studentCookie);
    assert.equal(afterSubmit.status, 409);
    const records = await call({ action: 'writing-records', assignmentId: classA.id }, staffA.cookie);
    assert.equal(records.status, 200);
    assert.ok(records.data.students.find(student => student.id === googleA.data.studentId).submittedAt);
  });

  await t.test('an exact single imported email adopts the existing draft while ambiguous imports are never guessed', async () => {
    importedGoogle = await signIn(classA, { sub: 'synthetic-google-imported', email: 'imported@school.test' });
    assert.equal(importedGoogle.status, 200); assert.equal(importedGoogle.data.studentId, imported.studentId);
    assert.deepEqual(await importedSnapshot(), preservedImported);
    assert.equal((await read(imported.studentId, privateCookie)).status, 200);
    const duplicates = await sql`SELECT id,original,working FROM enscribe_students WHERE id IN (${duplicateA.studentId},${duplicateB.studentId}) ORDER BY id`;
    const rejected = await signIn(classA, { sub: 'synthetic-google-ambiguous', email: 'ambiguous@school.test' });
    assert.equal(rejected.status, 409);
    assert.deepEqual(await sql`SELECT id,original,working FROM enscribe_students WHERE id IN (${duplicateA.studentId},${duplicateB.studentId}) ORDER BY id`, duplicates);
    const competingSubject = await signIn(classA, { sub: 'synthetic-google-competing', email: 'imported@school.test' });
    assert.equal(competingSubject.status, 409);
    assert.deepEqual(await importedSnapshot(), preservedImported);
  });

  await t.test('teacher imports cannot create a competing original for a Google-enrolled email', async () => {
    const before = await sql`SELECT * FROM enscribe_students WHERE id=${googleA.data.studentId}`;
    const attempted = await call({ action: 'writing-invite', assignmentId: classA.id, student: {
      firstName: 'Replacement', lastName: 'Import', email: 'google-a@school.test', original: 'This independent import must not replace or duplicate the existing writer.',
    } }, staffA.cookie);
    assert.equal(attempted.status, 409);
    assert.deepEqual(await sql`SELECT * FROM enscribe_students WHERE id=${googleA.data.studentId}`, before);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students WHERE assignment_id=${classA.id} AND email='google-a@school.test'`)[0].n, 1);
  });

  await t.test('server rate limits bind repeated starts and login failures to the browser', async () => {
    const begun = await start(); assert.equal(begun.status, 200);
    for (let attempt = 1; attempt < 30; attempt++) assert.equal((await start(classA, begun.bindingCookie)).status, 200);
    assert.equal((await start(classA, begun.bindingCookie)).status, 429);
    const before = (await sql`SELECT count(*)::int AS n FROM enscribe_students`)[0].n;
    for (let attempt = 0; attempt < 30; attempt++) {
      const rejected = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: 'not.a.valid-token' }, begun.bindingCookie);
      assert.equal(rejected.status, 401);
    }
    const limited = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: 'not.a.valid-token' }, begun.bindingCookie);
    assert.equal(limited.status, 429);
    assert.equal((await sql`SELECT count(*)::int AS n FROM enscribe_students`)[0].n, before);
  });

  await t.test('configuration versions invalidate pending sign-ins and Google sessions without affecting private links or writing', async () => {
    const pending = await start(); assert.equal(pending.status, 200);
    const pendingCredential = googleCredential(pending, { sub: 'synthetic-pending-config', email: 'pending@school.test' });
    const configured = await configure({ domains: [SCHOOL, 'other.school.test'] }); assert.equal(configured.status, 200);
    const stale = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: pendingCredential }, pending.bindingCookie);
    assert.ok(stale.status >= 400);
    assert.equal((await read(googleA.data.studentId, googleA.studentCookie)).status, 401);
    assert.equal((await read(imported.studentId, importedGoogle.studentCookie)).status, 401);
    assert.equal((await read(imported.studentId, privateCookie)).status, 200);
    assert.deepEqual(await importedSnapshot(), preservedImported);
    const rotated = await configure({ clientId: NEXT_CLIENT_ID }); assert.equal(rotated.status, 200);
    googleA = await signIn(); assert.equal(googleA.status, 200);
    otherClassGoogle = await signIn(classB, { sub: 'synthetic-other-class', email: 'other-class@school.test' });
    assert.equal(otherClassGoogle.status, 200);
    assert.equal((await toggle(classA, staffA, false)).status, 200);
    assert.ok((await start()).status >= 400);
    assert.equal((await read(googleA.data.studentId, googleA.studentCookie)).status, 401);
    assert.equal((await read(otherClassGoogle.data.studentId, otherClassGoogle.studentCookie)).status, 200);
    assert.equal((await read(imported.studentId, privateCookie)).status, 200);
    assert.deepEqual(await importedSnapshot(), preservedImported);
    assert.equal((await toggle(classA, staffA, true)).status, 200);
  });

  await t.test('teacher credential rotation and disabling still revoke Google workspace sessions permanently', async () => {
    const before = await sql`SELECT id,assignment_id,original,working,version FROM enscribe_students WHERE assignment_id=${classB.id} ORDER BY id`;
    const rotated = await call({ action: 'rotate', teacherId: staffB.staff.teacherId }, administrator.cookie);
    assert.equal(rotated.status, 200);
    assert.equal((await read(otherClassGoogle.data.studentId, otherClassGoogle.studentCookie)).status, 401);
    const fresh = await signIn(classB, { sub: 'synthetic-other-class', email: 'other-class@school.test' });
    assert.equal(fresh.status, 200); assert.equal(fresh.data.studentId, otherClassGoogle.data.studentId);
    const disabled = await call({ action: 'disable', teacherId: staffB.staff.teacherId }, administrator.cookie);
    assert.equal(disabled.status, 200);
    assert.equal((await read(fresh.data.studentId, fresh.studentCookie)).status, 401);
    assert.equal((await start(classB)).status, 403);
    const enabledWithFreshCode = await call({ action: 'rotate', teacherId: staffB.staff.teacherId }, administrator.cookie);
    assert.equal(enabledWithFreshCode.status, 200);
    assert.equal((await read(fresh.data.studentId, fresh.studentCookie)).status, 401);
    assert.deepEqual(await sql`SELECT id,assignment_id,original,working,version FROM enscribe_students WHERE assignment_id=${classB.id} ORDER BY id`, before);
    assert.equal((await read(imported.studentId, privateCookie)).status, 200);
  });

  await t.test('closed assignments deny new and pending admissions while restrictive assignments still reject AI on the server', async () => {
    const pending = await start(); assert.equal(pending.status, 200);
    const closed = await call({ action: 'writing-save', assignment: { ...classA, status: 'closed' } }, staffA.cookie);
    assert.equal(closed.status, 200);
    assert.ok((await start()).status >= 400);
    const late = await call({ action: 'student-google-login', assignmentSlug: classA.public_slug, credential: googleCredential(pending, { sub: 'synthetic-late-student', email: 'late@school.test' }) }, pending.bindingCookie);
    assert.ok(late.status >= 400);
    const restricted = await assignment(staffA, 'Synthetic restrictive Google class', { boundaries: 'restrictive' });
    assert.equal((await toggle(restricted, staffA, true)).status, 200);
    const admitted = await signIn(restricted, { sub: 'synthetic-restricted-student', email: 'restricted@school.test' });
    assert.equal(admitted.status, 200);
    const saved = await call({ action: 'student-save', studentId: admitted.data.studentId, version: 0, draft: 'An independent restricted-setting draft about a fictional choice.' }, admitted.studentCookie);
    assert.equal(saved.status, 200);
    const beforeExternal = externalRequests.length;
    const withheld = await call({ action: 'student-coach', studentId: admitted.data.studentId, requestId: 'synthetic-restrictive-check', focus: 'Analysis', goal: 'Clarify a distinction.', passage: 'fictional choice', tried: 'I reread the passage.', question: 'What reasoning needs development?' }, admitted.studentCookie);
    assert.ok([403, 409].includes(withheld.status));
    assert.equal(externalRequests.length, beforeExternal, 'restrictive assignments must not contact an AI provider');
    assert.equal((await sql`SELECT successful_checks FROM enscribe_students WHERE id=${admitted.data.studentId}`)[0].successful_checks, 0);
  });

  await t.test('global disable revokes school sessions, keeps every draft and leaves legacy private credentials usable', async () => {
    const before = await sql`SELECT id,assignment_id,original,working,reflection,version,submitted_at FROM enscribe_students ORDER BY id`;
    const disabled = await configure({ enabled: false, clientId: NEXT_CLIENT_ID }); assert.equal(disabled.status, 200);
    assert.ok((await start(classB)).status >= 400);
    const oldGoogle = await read(googleB.data.studentId, googleB.studentCookie); assert.equal(oldGoogle.status, 401);
    // Closing a class denies all writes; reopening proves the private credential itself survived.
    const reopened = await call({ action: 'writing-save', assignment: { ...classA, status: 'open' } }, staffA.cookie);
    assert.equal(reopened.status, 200);
    assert.equal((await read(imported.studentId, privateCookie)).status, 200);
    const privateAgain = await call({ action: 'student-enter', studentId: imported.studentId, token: privateToken });
    assert.equal(privateAgain.status, 200);
    assert.deepEqual(await sql`SELECT id,assignment_id,original,working,reflection,version,submitted_at FROM enscribe_students ORDER BY id`, before);
    assert.deepEqual(await importedSnapshot(), preservedImported);
    assert.ok(externalRequests.length >= 1);
    assert.ok(externalRequests.every(entry => entry.url === JWKS_URL && entry.body === undefined));
    const serializedLogs = JSON.stringify(logs);
    for (const sensitive of [privateToken, 'imported@school.test', 'google-a@school.test', 'google-b@school.test', 'synthetic-google-student-a']) {
      assert.ok(!serializedLogs.includes(sensitive), 'identity metadata, invitation secrets and Google claims must not be logged');
    }
    assert.ok(signedCredentials.every(credential => !serializedLogs.includes(credential)), 'signed Google credentials must never be logged');
  });
});
