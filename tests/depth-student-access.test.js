import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const sql = (strings, ...values) => {
  const statement = strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ""), "");
  return db.query(statement, values).then((result) => result.rows);
};
sql.query = async (statement, values) => values ? (await db.query(statement, values)).rows : db.exec(statement);
mock.module("@neondatabase/serverless", { exports: { neon: () => sql } });
const secret = () => randomBytes(24).toString("base64url");
process.env.DATABASE_URL = "postgres://isolated.test/never-production";
process.env.ENDEPTH_TEACHER_CODE = secret();
process.env.ENDEPTH_SECOND_TEACHER_CODE = secret();
process.env.ENDEPTH_ADMIN_CODE = secret();
process.env.ENDEPTH_ACCESS_CODE = secret();
process.env.OPENAI_API_KEY = secret();
const security = await import("../lib/department-security.js");
const access = await import("../lib/depth-student-access.js");
const base = await import("../lib/endepth-db.js");
const submissionApi = (await import("../api/submissions.js")).default;
const coachApi = (await import("../api/coach.js")).default;
const requests = await import("../lib/depth-coach-requests.js");
const schema = (await import("../lib/department-schema.js")).default;
const origin = "https://synthetic.test";
const request = (body, cookie = "") => new Request(origin + "/api/department", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie.split(";")[0], "x-vercel-forwarded-for": "203.0.113.90" },
  body: JSON.stringify(body),
});
const call = async (handler, body, cookie = "") => {
  const response = await handler.fetch(request(body, cookie));
  return { status: response.status, data: await response.json() };
};
let staff;
before(async () => {
  await base.ensurePilotSchema();
  await db.exec(schema);
  const teacher = (await sql`SELECT * FROM endepth_teachers WHERE slug='morgan-towle'`)[0];
  staff = { role: "teacher", teacherId: teacher.teacher_id, displayName: teacher.display_name };
});
after(async () => { await db.close(); });
let sequence = 0;
async function assignment() {
  return base.saveAssignmentForStaff(staff, {
    title: `Synthetic private access ${++sequence}`, course: "Synthetic course", section: "S",
    prompt: "What tension appears in the fictional garden?", sourceTitle: "Fictional passage",
    passage: "The neighbors shared a garden, but they disagreed about its purpose.",
    directions: "Develop your own thinking.", status: "open",
  });
}
async function invite(a, email = `synthetic-${secret()}@example.invalid`) {
  return access.staffDepthAccess(sql, staff, { action: "depth-student-invite", assignmentId: a.assignmentId,
    firstName: "PrivateFirst", lastName: "PrivateLast", email });
}
async function login(a, invitation) {
  return access.studentDepthAccess(sql, request({}), {
    action: "depth-student-login", assignmentId: a.assignmentId, code: invitation.code,
  });
}
const academic = {
  initialResponse: "Shared responsibility in a fictional garden may reveal unresolved disagreement.",
  evidence: "The neighbors disagreed about the garden's purpose.",
  significance: "A shared responsibility can conceal different expectations.", claim: "The disagreement complicates the initial cooperation.",
  complication: "Sharing a space does not imply identical priorities.", openQuestion: "What does their disagreement establish?", messages: [],
};
const coachBody = (a, requestId) => ({ assignmentId: a.assignmentId, requestId,
  ...academic, selectedMove: "complicate", messages: [{ role: "student", text: "How can I test the tension in this reading?" }],
  accessCode: process.env.ENDEPTH_ACCESS_CODE, studentCoachKey: security.digest(secret()),
  firstName: "ForgedIdentity", email: "forged-student@example.invalid", invitationToken: "private-invitation-marker" });
function mockProvider(t, responses) {
  const original = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith("https://api.openai.com/"));
    payloads.push(JSON.parse(options.body));
    if (String(url).endsWith("moderations")) return Response.json({ results: [{ flagged: false, categories: {} }] });
    const response = responses.shift();
    return typeof response === "function" ? response() : Response.json(response);
  };
  t.after(() => { globalThis.fetch = original; });
  return payloads;
}
const feedback = { status: "completed", output_text: "Your reading notices a disagreement, but the relationship between cooperation and different expectations needs testing. Examine what the garden's shared purpose establishes before deciding how much disagreement qualifies it. Which detail most directly exposes that unresolved relationship?" };

test("private student access is owner-issued, scrypt hashed, origin protected and assignment bound", async () => {
  const a = await assignment(), b = await assignment();
  await assert.rejects(access.staffDepthAccess(sql, { role: "teacher", teacherId: "other-teacher" }, {
    action: "depth-student-invite", assignmentId: a.assignmentId, firstName: "Synthetic", lastName: "Writer", email: "synthetic@example.invalid",
  }), (error) => error.status === 403);
  const invitation = await invite(a);
  assert.equal(invitation.studentPath, `/?assignment=${a.publicSlug}`);
  const row = (await sql`SELECT * FROM endepth_student_access WHERE student_id=${invitation.studentId}`)[0];
  assert.equal(row.code_hash.length, 128);
  assert.equal(row.code_hash.includes(invitation.code.split(".")[1]), false);
  await assert.rejects(access.studentDepthAccess(sql, request({}), { action: "depth-student-login", assignmentId: a.assignmentId, code: row.email }), (error) => error.status === 401);
  await assert.rejects(access.studentDepthAccess(sql, request({}), { action: "depth-student-login", assignmentId: b.assignmentId, code: invitation.code }), (error) => error.status === 401);
  await assert.rejects(access.studentDepthAccess(sql, new Request(origin + "/api/department", { method: "POST", headers: { Origin: "https://attacker.invalid", "Content-Type": "application/json" } }), {
    action: "depth-student-login", assignmentId: a.assignmentId, code: invitation.code,
  }), (error) => error.status === 403);
  const signedIn = await login(a, invitation);
  assert.match(signedIn.cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.deepEqual(signedIn.student, { studentId: invitation.studentId, firstName: "PrivateFirst", lastName: "PrivateLast", email: row.email });
  assert.equal((await access.requireDepthStudent(request({}, signedIn.cookie), a.assignmentId, sql)).coachKey, security.digest(`${a.assignmentId}:${row.email}`));
  await assert.rejects(access.requireDepthStudent(request({}, signedIn.cookie), b.assignmentId, sql), (error) => error.status === 401);
});

test("concurrent reissuance preserves one canonical identity and revokes all previous codes/sessions", async () => {
  const a = await assignment(), email = "canonical-private@example.invalid";
  const initial = await invite(a, email), oldSession = await login(a, initial);
  const [first, second] = await Promise.all([invite(a, email), invite(a, email)]);
  assert.equal(first.studentId, second.studentId); assert.equal(first.studentId, initial.studentId);
  assert.equal((await sql`SELECT COUNT(*)::int AS n FROM endepth_student_access WHERE assignment_id=${a.assignmentId} AND email=${email}`)[0].n, 1);
  await assert.rejects(login(a, initial), (error) => error.status === 401);
  await assert.rejects(access.requireDepthStudent(request({}, oldSession.cookie), a.assignmentId, sql), (error) => error.status === 401);
  const stored = (await sql`SELECT * FROM endepth_student_access WHERE student_id=${initial.studentId}`)[0];
  assert.equal(stored.credential_version, 3);
  const winner = await security.passwordMatches(first.code.split(".")[1], { ...stored, auth_scheme: "scrypt" }) ? first : second;
  assert.equal((await login(a, winner)).student.studentId, initial.studentId);
});

test("the seventeenth invitation slot is atomic and existing legacy submissions keep their admission", async () => {
  const a = await assignment();
  await sql`INSERT INTO endepth_submissions (submission_id,assignment_key,teacher_name,course,assignment_title,central_question,
    student_first_name,student_last_name,student_email,assignment_id,teacher_id,student_key)
    VALUES ('synthetic-legacy-private',${a.assignmentId},'Synthetic','Synthetic','Synthetic','Synthetic','Legacy','Writer',
      'legacy-private@example.invalid',${a.assignmentId},${staff.teacherId},${a.assignmentId + ':legacy-private@example.invalid'})`;
  for (let index = 0; index < 15; index++) await invite(a, `admitted-${index}@example.invalid`);
  const concurrent = await Promise.allSettled([invite(a, "slot-seventeen@example.invalid"), invite(a, "slot-eighteen@example.invalid")]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.find((result) => result.status === "rejected").reason.status, 409);
  const legacy = await invite(a, "legacy-private@example.invalid");
  assert.ok(legacy.code);
  assert.equal((await sql`SELECT COUNT(*)::int AS n FROM endepth_student_access WHERE assignment_id=${a.assignmentId}`)[0].n, 17);
  assert.equal((await sql`SELECT submission_id FROM endepth_submissions WHERE student_key=${a.assignmentId + ':legacy-private@example.invalid'}`)[0].submission_id, "synthetic-legacy-private");
});

test("submissions ignore forged email/ID and preserve existing records; rotation wins stale write epochs", async () => {
  const a = await assignment(), first = await invite(a, "first-private@example.invalid"), second = await invite(a, "second-private@example.invalid");
  const firstSession = await login(a, first), secondSession = await login(a, second);
  const body = { assignmentId: a.assignmentId, work: academic, student: { firstName: "Forged", lastName: "Identity", email: "second-private@example.invalid" },
    accessCode: process.env.ENDEPTH_ACCESS_CODE };
  assert.equal((await call(submissionApi, body)).status, 401);
  const submitted = await call(submissionApi, body, firstSession.cookie);
  assert.equal(submitted.status, 200);
  const rows = await sql`SELECT * FROM endepth_submissions WHERE assignment_id=${a.assignmentId}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].student_email, "first-private@example.invalid");
  assert.equal(rows[0].student_first_name, "PrivateFirst");
  const same = await call(submissionApi, { ...body, submissionId: "other-private-submission", work: { ...academic, initialResponse: "My own changed synthetic thinking." } }, firstSession.cookie);
  assert.equal(same.data.submissionId, submitted.data.submissionId);
  assert.equal((await call(submissionApi, body, secondSession.cookie)).status, 200);
  const stale = await access.requireDepthStudent(request({}, firstSession.cookie), a.assignmentId, sql);
  await invite(a, "first-private@example.invalid");
  await assert.rejects(access.submitDepthStudent(sql, stale, academic), /STUDENT_ACCESS_CHANGED/);
  assert.equal((await call(submissionApi, body, firstSession.cookie)).status, 401);
  assert.equal((await sql`SELECT initial_response FROM endepth_submissions WHERE submission_id=${submitted.data.submissionId}`)[0].initial_response, "My own changed synthetic thinking.");
});

test("coach ignores arbitrary client keys and identities, rejects incomplete/refused/empty output, and retries without extra charges", async (t) => {
  const a = await assignment(), invitation = await invite(a), signedIn = await login(a, invitation);
  const payloads = mockProvider(t, [
    { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "Partial feedback" },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "Withheld" }] }] },
    { status: "completed", output_text: "" }, feedback, feedback, feedback, feedback,
  ]);
  for (let index = 0; index < 3; index++) {
    assert.equal((await call(coachApi, coachBody(a, "synthetic_failed_request_" + index), signedIn.cookie)).status, 502);
  }
  const firstBody = coachBody(a, "synthetic_success_request_01");
  const first = await call(coachApi, firstBody, signedIn.cookie);
  assert.equal(first.status, 200); assert.equal(first.data.usage.successfulQuestions, 1);
  assert.equal((await call(coachApi, { ...firstBody, studentCoachKey: security.digest(secret()) }, signedIn.cookie)).data.reply, first.data.reply);
  const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    call(coachApi, coachBody(a, "synthetic_concurrent_req_" + index), signedIn.cookie)));
  assert.equal(concurrent.filter((result) => result.status === 200).length, 3);
  assert.equal((await call(coachApi, coachBody(a, "synthetic_fifth_request_01"), signedIn.cookie)).status, 409);
  for (const payload of payloads) {
    const encoded = JSON.stringify(payload);
    for (const privateValue of [invitation.code, signedIn.student.email, "PrivateFirst", "PrivateLast", "ForgedIdentity", "forged-student@example.invalid", "private-invitation-marker", process.env.ENDEPTH_ACCESS_CODE, process.env.OPENAI_API_KEY])
      assert.equal(encoded.includes(privateValue), false);
    if (payload.instructions) assert.equal(payload.store, false);
  }
});

test("credential rotation, teacher disabling and closed assignments reject pending feedback and release its lease", async () => {
  const a = await assignment(), email = "pending-private@example.invalid";
  const initial = await invite(a, email), signedIn = await login(a, initial);
  const authenticated = await access.requireDepthStudent(request({}, signedIn.cookie), a.assignmentId, sql);
  const reservation = await requests.reserveDepth(request({}, signedIn.cookie), a.assignmentId, authenticated.coachKey,
    coachBody(a, "pending_rotation_req_001"), authenticated);
  await invite(a, email);
  await assert.rejects(requests.finishDepth(a.assignmentId, authenticated.coachKey, reservation, { reply: feedback.output_text }), (error) => error.status === 401);
  let quota = (await sql`SELECT * FROM endepth_coach_usage WHERE assignment_id=${a.assignmentId} AND student_email=${authenticated.coachKey}`)[0];
  assert.equal(quota.successful_count, 0); assert.equal(quota.in_flight_count, 0);
  const fresh = await invite(a, email), freshSession = await login(a, fresh);
  const current = await access.requireDepthStudent(request({}, freshSession.cookie), a.assignmentId, sql);
  const closedReservation = await requests.reserveDepth(request({}, freshSession.cookie), a.assignmentId, current.coachKey,
    coachBody(a, "pending_closed_req_0001"), current);
  await sql`UPDATE endepth_assignments SET status='closed' WHERE assignment_id=${a.assignmentId}`;
  await assert.rejects(requests.finishDepth(a.assignmentId, current.coachKey, closedReservation, { reply: feedback.output_text }), (error) => error.status === 401);
  await sql`UPDATE endepth_assignments SET status='open' WHERE assignment_id=${a.assignmentId}`;
  const disabledReservation = await requests.reserveDepth(request({}, freshSession.cookie), a.assignmentId, current.coachKey,
    coachBody(a, "pending_disable_req_001"), current);
  await sql`UPDATE endepth_teachers SET active=FALSE,activation_state='disabled',credential_version=credential_version+1 WHERE teacher_id=${staff.teacherId}`;
  await assert.rejects(requests.finishDepth(a.assignmentId, current.coachKey, disabledReservation, { reply: feedback.output_text }), (error) => error.status === 401);
  await assert.rejects(access.requireDepthStudent(request({}, freshSession.cookie), a.assignmentId, sql), (error) => error.status === 401);
  quota = (await sql`SELECT * FROM endepth_coach_usage WHERE assignment_id=${a.assignmentId} AND student_email=${current.coachKey}`)[0];
  assert.equal(quota.successful_count, 0); assert.equal(quota.in_flight_count, 0);
  await sql`UPDATE endepth_teachers SET active=TRUE,activation_state='active' WHERE teacher_id=${staff.teacherId}`;
  await assert.rejects(access.requireDepthStudent(request({}, freshSession.cookie), a.assignmentId, sql), (error) => error.status === 401);
  const afterReactivation = await login(a, fresh);
  assert.equal((await access.requireDepthStudent(request({}, afterReactivation.cookie), a.assignmentId, sql)).studentId, fresh.studentId);
  await access.studentDepthAccess(sql, request({}, afterReactivation.cookie), { action: "depth-student-logout" });
  await assert.rejects(access.requireDepthStudent(request({}, afterReactivation.cookie), a.assignmentId, sql), (error) => error.status === 401);
});
