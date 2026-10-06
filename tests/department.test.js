import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
function sql(strings, ...values) {
  let text = strings[0];
  values.forEach((v, i) => {
    text += "$" + (i + 1) + strings[i + 1];
  });
  return db.query(text, values).then((r) => r.rows);
}
sql.query = async (text, values) =>
  values ? (await db.query(text, values)).rows : db.exec(text);
mock.module("@neondatabase/serverless", { exports: { neon: () => sql } });
process.env.DATABASE_URL = "postgres://isolated.test/never-production";
process.env.ENDEPTH_TEACHER_CODE = "legacy-morgan-test-credential";
process.env.ENDEPTH_SECOND_TEACHER_CODE = "legacy-second-test-credential";
process.env.ENDEPTH_SECOND_TEACHER_EMAIL = "marksd@ensworth.com";
process.env.ENDEPTH_ADMIN_CODE = "legacy-admin-test-credential";
process.env.ENDEPTH_ACCESS_CODE = "synthetic-class-code";
process.env.OPENAI_API_KEY = "synthetic-provider-key";
const security = await import("../lib/department-security.js");
const writing = await import("../lib/enscribe-service.js");
const {
  saveAssignmentForStaff,
  listAssignmentsForStaff,
  listSubmissionsForStaff,
} = await import("../lib/endepth-db.js");
const auth = (await import("../api/staff-auth.js")).default;
const endpoint = (await import("../api/department.js")).default;
const request = (body, cookie = "", ip = "203.0.113.10") =>
  new Request("https://synthetic.test/api/department", {
    method: "POST",
    headers: {
      origin: "https://synthetic.test",
      "content-type": "application/json",
      cookie,
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
const call = async (handler, body, cookie = "", ip = "203.0.113.10") => {
  const response = await handler.fetch(request(body, cookie, ip));
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
};
let admin, A, B, morgan, legacy, assignment;
const snapshot = {};
test("legacy short administrator codes bootstrap with normalized environment input and remain governed by stored rotation", async () => {
  const adminDb = new PGlite();
  const previousCode = process.env.ENDEPTH_ADMIN_CODE;
  function adminSql(strings, ...values) {
    let text = strings[0];
    values.forEach((_, index) => (text += "$" + (index + 1) + strings[index + 1]));
    return adminDb.query(text, values).then((result) => result.rows);
  }
  try {
    await adminDb.exec(`
      CREATE TABLE endepth_teachers (
        teacher_id TEXT PRIMARY KEY,slug TEXT,display_name TEXT,email TEXT,
        active BOOLEAN,activation_state TEXT,credential_version INTEGER,
        auth_scheme TEXT,code_salt TEXT,code_hash TEXT,created_at TIMESTAMPTZ
      );
      CREATE TABLE department_admin (
        id INTEGER PRIMARY KEY,code_hash TEXT NOT NULL,code_salt TEXT NOT NULL,
        auth_scheme TEXT NOT NULL DEFAULT 'scrypt',credential_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE department_sessions (
        token_hash TEXT PRIMARY KEY,teacher_id TEXT,role TEXT NOT NULL,
        credential_version INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE department_rate_limits (
        bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at TIMESTAMPTZ NOT NULL
      );
    `);
    process.env.ENDEPTH_ADMIN_CODE = "\n  adm7  \t";
    const first = await security.login(request({}), "adm7", "", adminSql);
    assert.equal(first.staff.role, "admin");
    const bootstrapped = await adminSql`SELECT * FROM department_admin WHERE id=1`;
    assert.equal(bootstrapped[0].credential_version, 1);
    assert.equal(await security.passwordMatches("adm7", bootstrapped[0]), true);
    assert.equal(await security.passwordMatches(process.env.ENDEPTH_ADMIN_CODE, bootstrapped[0]), false);
    process.env.ENDEPTH_ADMIN_CODE = "different-synthetic-env-code";
    await assert.rejects(
      security.login(request({}), process.env.ENDEPTH_ADMIN_CODE, "", adminSql),
      (error) => error.status === 401,
    );
    assert.equal((await security.login(request({}), "adm7", "", adminSql)).staff.role, "admin");
    assert.deepEqual(await adminSql`SELECT * FROM department_admin WHERE id=1`, bootstrapped);
    const rotated = await security.manageAccount(adminSql, first.staff, { action: "admin-rotate" });
    assert.match(rotated.newCode, /^[A-Za-z0-9_-]{43}$/);
    for (const rejected of ["adm7", process.env.ENDEPTH_ADMIN_CODE, "", "   ", "x".repeat(301)]) {
      await assert.rejects(
        security.login(request({}), rejected, "", adminSql),
        (error) => error.status === 401,
      );
    }
    await assert.rejects(security.session(request({}, first.cookie), adminSql), /Sign in again/);
    assert.equal((await security.login(request({}), rotated.newCode, "", adminSql)).staff.role, "admin");
  } finally {
    if (previousCode === undefined) delete process.env.ENDEPTH_ADMIN_CODE;
    else process.env.ENDEPTH_ADMIN_CODE = previousCode;
    await adminDb.close();
  }
});
test("shared sessions preserve legacy IDs, records, credentials and links; approved roster activates individually", async () => {
  const { ensurePilotSchema } = await import("../lib/endepth-db.js");
  await ensurePilotSchema();
  const schema = (await import("../lib/department-schema.js")).default;
  const { statements } = await import("../lib/sql-statements.js");
  for (const statement of statements(schema)) await sql.query(statement);
  await security.database();
  const original =
    await sql`SELECT teacher_id,slug FROM endepth_teachers ORDER BY slug`;
  snapshot.ids = original;
  legacy = await security.login(
    request({}),
    process.env.ENDEPTH_SECOND_TEACHER_CODE,
    "",
    sql,
  );
  const morganLogin = await security.login(
    request({}), process.env.ENDEPTH_TEACHER_CODE, "", sql,
  );
  morgan = morganLogin.staff;
  snapshot.morganCookie = morganLogin.cookie;
  const old = await saveAssignmentForStaff(morgan, {
    teacherId: morgan.teacherId,
    course: "Synthetic",
    section: "Test",
    title: "Preserved",
    prompt: "Interpret",
    sourceTitle: "Synthetic",
    passage: "A passage.",
    directions: "Think independently.",
    status: "open",
  });
  await sql`INSERT INTO endepth_submissions(submission_id,assignment_key,teacher_name,course,assignment_title,central_question,student_first_name,student_last_name,assignment_id,teacher_id,student_email) VALUES('synthetic-legacy-record',${old.assignmentId},'Synthetic','Synthetic','Preserved','Interpret','Example','Learner',${old.assignmentId},${morgan.teacherId},'synthetic@example.invalid')`;
  admin = await security.login(
    request({}),
    process.env.ENDEPTH_ADMIN_CODE,
    "",
    sql,
  );
  await sql`INSERT INTO endepth_teachers(teacher_id,slug,display_name,email,code_salt,code_hash,active,activation_state,auth_scheme)
    VALUES('synthetic-slug-collision','approved-crumpk','Existing synthetic teacher','existing@example.invalid','preserved-salt','preserved-hash',FALSE,'disabled','scrypt')`;
  const beforeConflict =
    await sql`SELECT * FROM endepth_teachers ORDER BY teacher_id`;
  const blocked = await call(endpoint, { action: "onboard" }, admin.cookie);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /slug.*crumpk@ensworth\.com/);
  assert.deepEqual(
    await sql`SELECT * FROM endepth_teachers ORDER BY teacher_id`,
    beforeConflict,
    "Roster conflicts must preserve every existing ID, credential and activation state without partial onboarding",
  );
  await sql`DELETE FROM endepth_teachers WHERE teacher_id='synthetic-slug-collision'`;
  await security.onboard(sql);
  await security.onboard(sql);
  assert.deepEqual(
    await sql`SELECT teacher_id,slug FROM endepth_teachers WHERE slug IN('morgan-towle','teacher-two') ORDER BY slug`,
    original,
  );
  assert.equal(
    (
      await sql`SELECT public_slug FROM endepth_assignments WHERE assignment_id=${old.assignmentId}`
    )[0].public_slug,
    old.publicSlug,
  );
  assert.equal((await listSubmissionsForStaff(morgan)).length, 1);
  const accounts =
    await sql`SELECT * FROM endepth_teachers WHERE email = ANY(${security.APPROVED})`;
  assert.equal(accounts.length, 7);
  assert.equal(
    accounts.filter((r) => r.activation_state === "awaiting activation").length,
    6,
  );
  for (const [index, row] of accounts.entries()) {
    const code =
      row.teacher_id === legacy.staff.teacherId
        ? process.env.ENDEPTH_SECOND_TEACHER_CODE
        : (
            await security.manageAccount(sql, admin.staff, {
              action: "rotate",
              teacherId: row.teacher_id,
            })
          ).newCode;
    const verified = await call(
      auth,
      { code, email: row.email },
      "",
      `203.0.113.${100 + index}`,
    );
    assert.equal(verified.status, 200);
    const depthHandler = (await import("../api/assignments.js")).default;
    assert.equal(
      (await call(depthHandler, { action: "list" }, verified.cookie)).status,
      200,
    );
    const login = { staff: verified.data.staff, cookie: verified.cookie };
    const cookie = verified.cookie;
    assert.equal(
      (await call(endpoint, { action: "writing-list" }, cookie)).status,
      200,
    );
    assert.ok(Array.isArray(await listAssignmentsForStaff(login.staff)));
    if (!A) A = { ...login, cookie };
    else if (!B) B = { ...login, cookie };
  }
  const listed = await call(endpoint, { action: "accounts" }, admin.cookie);
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.data).includes("code_hash"), false);
  assert.equal((await call(auth, { code: "wrong-secret" })).status, 401);
  assert.equal((await call(endpoint, { action: "writing-list" })).status, 401);
});
test("teacher ownership is enforced on direct requests across both modules; admin sees all", async () => {
  const d = {
    title: "Synthetic writing",
    course: "Test",
    section: "1",
    prompt: "Analyze a fictional garden.",
    instructions: "Write independently.",
    rubric: "Teacher-provided test rubric",
    timing: "Test",
    status: "open",
    boundaries: "moderate",
    teacher_id: B.staff.teacherId,
  };
  assignment = (
    await writing.staffWriting(sql, A.staff, {
      action: "writing-save",
      assignment: d,
    })
  ).assignment;
  assert.equal(assignment.teacher_id, A.staff.teacherId);
  assert.equal(
    (await writing.staffWriting(sql, B.staff, { action: "writing-list" }))
      .assignments.length,
    0,
  );
  for (const action of [
    "writing-records",
    "writing-save",
    "writing-duplicate",
    "writing-invite",
    "writing-reopen",
    "writing-reset",
  ]) {
    const body = {
      action,
      assignmentId: assignment.id,
      assignment: { ...assignment },
      student: {
        firstName: "Example",
        lastName: "Other",
        email: "other@example.invalid",
      },
    };
    const response = await call(endpoint, body, B.cookie);
    assert.equal(response.status, 403, action);
  }
  assert.equal(
    (await writing.staffWriting(sql, admin.staff, { action: "writing-list" }))
      .assignments.length,
    1,
  );
  assert.equal(
    (
      await call(
        endpoint,
        { action: "rotate", teacherId: A.staff.teacherId },
        B.cookie,
      )
    ).status,
    403,
  );
  const depth = await saveAssignmentForStaff(A.staff, {
    teacherId: B.staff.teacherId,
    course: "Synthetic",
    section: "T",
    title: "Owner A",
    prompt: "Test",
    sourceTitle: "Test",
    passage: "Test",
    directions: "Test",
    status: "open",
  });
  assert.equal(depth.teacherId, A.staff.teacherId);
  await assert.rejects(
    saveAssignmentForStaff(B.staff, { ...depth, title: "Takeover" }),
    /FORBIDDEN/,
  );
  assert.equal(
    (await listAssignmentsForStaff(B.staff)).some(
      (a) => a.assignmentId === depth.assignmentId,
    ),
    false,
  );
  assert.equal(
    (await listSubmissionsForStaff(B.staff, depth.assignmentId)).length,
    0,
  );
  for (const path of ["assignments", "submissions-list", "teachers"]) {
    const handler = (await import("../api/" + path + ".js")).default;
    const response = await call(
      handler,
      {
        action: path === "assignments" ? "save" : "list",
        assignment: depth,
        assignmentId: depth.assignmentId,
        code: process.env.ENDEPTH_ADMIN_CODE,
      },
      B.cookie,
    );
    assert.equal(
      response.status,
      path === "submissions-list" ? 200 : path === "assignments" ? 403 : 403,
    );
    if (path === "submissions-list")
      assert.equal(response.data.submissions.length, 0);
  }
  snapshot.depth = depth;
});
let studentId, raw, studentRequest, student;
test("secure student links, immutable independent originals, revisions, conflicts, submission and reopen", async () => {
  const invite = await writing.staffWriting(sql, A.staff, {
    action: "writing-invite",
    assignmentId: assignment.id,
    student: {
      firstName: "Fictional",
      lastName: "Writer",
      email: "fictional@example.invalid",
    },
  });
  studentId = invite.studentId;
  raw = new URLSearchParams(invite.studentPath.split("#")[1]).get("access");
  const enter = await writing.studentWriting(sql, request({}), {
    action: "student-enter",
    studentId,
    token: raw,
  });
  studentRequest = request({}, enter.cookie.split(";")[0]);
  assert.match(enter.cookie, /HttpOnly; Secure; SameSite=Strict/);
  await assert.rejects(
    writing.studentWriting(sql, request({}), {
      action: "student-read",
      studentId,
      email: "fictional@example.invalid",
    }),
    /private student link/,
  );
  student = (
    await writing.studentWriting(sql, studentRequest, {
      action: "student-save",
      studentId,
      version: 0,
      draft: "The garden creates a shared responsibility for its neighbors.",
    })
  ).student;
  await assert.rejects(
    sql`UPDATE enscribe_students SET original='replace' WHERE id=${studentId}`,
    /ORIGINAL_IMMUTABLE/,
  );
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, {
      action: "student-save",
      studentId,
      version: 0,
      draft: "Lost work",
    }),
    /VERSION_CONFLICT/,
  );
  student = (
    await writing.studentWriting(sql, studentRequest, {
      action: "student-save",
      studentId,
      version: 1,
      draft:
        "The garden creates a shared responsibility, but neighbors disagree about its use.",
      explanation: "Added a complication.",
    })
  ).student;
  assert.equal(
    student.original,
    "The garden creates a shared responsibility for its neighbors.",
  );
  student = (
    await writing.studentWriting(sql, studentRequest, {
      action: "student-save",
      studentId,
      version: 2,
      draft: student.working,
      reflection: "I tested the limits of the claim.",
      submit: true,
    })
  ).student;
  assert.ok(student.submittedAt);
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, {
      action: "student-save",
      studentId,
      version: 3,
      draft: student.working,
    }),
    /ALREADY_SUBMITTED/,
  );
  await writing.staffWriting(sql, A.staff, {
    action: "writing-reopen",
    assignmentId: assignment.id,
    studentId,
  });
  student = (
    await writing.studentWriting(sql, studentRequest, {
      action: "student-read",
      studentId,
    })
  ).student;
  assert.equal(student.submittedAt, null);
  assert.equal(student.version, 4);
  const other = await writing.staffWriting(sql, A.staff, {
    action: "writing-invite",
    assignmentId: assignment.id,
    student: {
      firstName: "Another",
      lastName: "Example",
      email: "fictional@example.invalid",
      original: "A different original.",
    },
  });
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, {
      action: "student-read",
      studentId: other.studentId,
    }),
    /private student link/,
  );
});
test("mocked live checks: failed/withheld/retries/concurrency preserve four-success cap and privacy", async () => {
  let calls = 0;
  const payloads = [];
  const { liveWritingCheck } = await import("../lib/writing-coach.js");
  const mockFetch = async (url, opts) => {
    payloads.push(JSON.parse(opts.body));
    return Response.json(
      url.endsWith("moderations")
        ? { results: [{ flagged: false }] }
        : {
            status: "completed",
            output_text:
              "The claim identifies a shared responsibility but leaves disagreement unexplained. Examine which part of the passage supports that tension. What would distinguish disagreement from a failure of shared responsibility?",
          },
    );
  };
  const coach = async (academic) => {
    calls++;
    return liveWritingCheck(academic, mockFetch);
  };
  const base = {
    action: "student-coach",
    studentId,
    focus: "Analysis",
    goal: "Explain the tension.",
    passage: "shared responsibility",
    tried: "Added disagreement.",
    question: "How can I examine this tension?",
  };
  const fail = { ...base, requestId: "failed_request_0001" };
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, fail, async () => {
      throw new Error("synthetic failure");
    }),
    /synthetic failure/,
  );
  await writing.studentWriting(
    sql,
    studentRequest,
    { ...base, requestId: "withheld_request_001" },
    async () => ({ withheld: true }),
  );
  assert.equal(
    (
      await sql`SELECT successful_checks,in_flight FROM enscribe_students WHERE id=${studentId}`
    )[0].successful_checks,
    0,
  );
  const first = { ...base, requestId: "successful_request_1" };
  await writing.studentWriting(sql, studentRequest, first, coach);
  const repeated = await writing.studentWriting(
    sql,
    studentRequest,
    first,
    coach,
  );
  assert.equal(repeated.cached, true);
  assert.equal(calls, 1);
  const settled = await Promise.allSettled(
    Array.from({ length: 6 }, (_, i) =>
      writing.studentWriting(
        sql,
        studentRequest,
        { ...base, requestId: "concurrent_request_" + i },
        coach,
      ),
    ),
  );
  assert.ok(settled.some((r) => r.status === "rejected"));
  let current = (
    await sql`SELECT successful_checks FROM enscribe_students WHERE id=${studentId}`
  )[0].successful_checks;
  while (current < 4) {
    await writing.studentWriting(
      sql,
      studentRequest,
      { ...base, requestId: "remaining_request_" + current },
      coach,
    );
    current++;
  }
  await assert.rejects(
    writing.studentWriting(
      sql,
      studentRequest,
      { ...base, requestId: "fifth_request_00001" },
      coach,
    ),
    /Four successful/,
  );
  assert.equal(
    (
      await sql`SELECT successful_checks,in_flight FROM enscribe_students WHERE id=${studentId}`
    )[0].successful_checks,
    4,
  );
  assert.equal(calls, 4);
  for (const p of payloads) {
    const str = JSON.stringify(p);
    for (const secret of [
      "fictional@example.invalid",
      "Fictional",
      "Writer",
      raw,
      process.env.OPENAI_API_KEY,
      process.env.ENDEPTH_ADMIN_CODE,
    ])
      assert.equal(str.includes(secret), false, secret);
    if (p.instructions) assert.equal(p.store, false);
  }
});
test("closed/restrictive assignments reject coaching and saving; sandbox isolation", async () => {
  const body = {
    action: "student-coach",
    studentId,
    requestId: "restrictive_request_1",
    focus: "Analysis",
    goal: "Goal",
    passage: "shared responsibility",
    tried: "Tried",
    question: "Question",
  };
  await writing.staffWriting(sql, A.staff, {
    action: "writing-save",
    assignment: { ...assignment, boundaries: "restrictive" },
  });
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, body, async () => {
      throw new Error("must not run");
    }),
    /COACHING_DISABLED/,
  );
  await writing.staffWriting(sql, A.staff, {
    action: "writing-save",
    assignment: { ...assignment, status: "closed" },
  });
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, {
      action: "student-read",
      studentId,
    }),
    /not open/,
  );
  await assert.rejects(
    writing.studentWriting(sql, studentRequest, {
      action: "student-save",
      studentId,
      version: 4,
      draft: "overwrite",
    }),
    /not open/,
  );
  const sandbox = await writing.staffWriting(sql, A.staff, {
    action: "writing-test",
  });
  assert.equal(sandbox.assignment.sandbox, true);
  await assert.rejects(
    writing.staffWriting(sql, B.staff, {
      action: "writing-reset",
      assignmentId: sandbox.assignment.id,
    }),
    /Access denied/,
  );
  await assert.rejects(
    writing.staffWriting(sql, A.staff, {
      action: "writing-reset",
      assignmentId: assignment.id,
    }),
    /Only your own/,
  );
  await writing.staffWriting(sql, A.staff, {
    action: "writing-reset",
    assignmentId: sandbox.assignment.id,
  });
  assert.ok(
    (await sql`SELECT id FROM enscribe_students WHERE id=${studentId}`).length,
  );
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM endepth_submissions WHERE submission_id='synthetic-legacy-record'`
    )[0].n,
    1,
  );
});
test("rotation and disabling invalidate old codes/sessions including environment fallback; origins and rate limits", async () => {
  const secondId = legacy.staff.teacherId;
  const newCode = (
    await security.manageAccount(sql, admin.staff, {
      action: "rotate",
      teacherId: secondId,
    })
  ).newCode;
  await assert.rejects(
    security.login(
      request({}),
      process.env.ENDEPTH_SECOND_TEACHER_CODE,
      "",
      sql,
    ),
    /not accepted/,
  );
  const newer = await security.login(request({}), newCode, "", sql);
  await assert.rejects(
    security.session(request({}, legacy.cookie), sql),
    /Sign in again/,
  );
  await security.manageAccount(sql, admin.staff, {
    action: "disable",
    teacherId: secondId,
  });
  await assert.rejects(
    security.login(request({}), newCode, "", sql),
    /not accepted/,
  );
  await assert.rejects(
    security.login(
      request({}),
      process.env.ENDEPTH_SECOND_TEACHER_CODE,
      "",
      sql,
    ),
    /not accepted/,
  );
  await assert.rejects(
    security.session(request({}, newer.cookie), sql),
    /Sign in again/,
  );
  const bad = new Request("https://synthetic.test/api/department", {
    method: "POST",
    headers: {
      origin: "https://evil.test",
      "content-type": "application/json",
      cookie: admin.cookie,
    },
    body: JSON.stringify({ action: "accounts" }),
  });
  assert.equal((await endpoint.fetch(bad)).status, 403);
  for (let i = 0; i < 2; i++)
    await security.rateLimit(sql, "synthetic-rate-limit", 2, 600);
  await assert.rejects(
    security.rateLimit(sql, "synthetic-rate-limit", 2, 600),
    /Too many/,
  );
  const code = (
    await security.manageAccount(sql, admin.staff, { action: "admin-rotate" })
  ).newCode;
  await assert.rejects(
    security.session(request({}, admin.cookie), sql),
    /Sign in again/,
  );
  await assert.rejects(
    security.login(request({}), process.env.ENDEPTH_ADMIN_CODE, "", sql),
    /not accepted|Too many/,
  );
  await sql`DELETE FROM department_rate_limits WHERE bucket LIKE 'login:%'`;
  assert.equal(
    (await security.login(request({}), code, "", sql)).staff.role,
    "admin",
  );
});
test("EnDepth endpoint preserves richer moderated coaching, retries, concurrency and the fifth-call rejection", async () => {
  const handler = (await import("../api/coach.js")).default;
  // The earlier credential test disables Teacher A. Use a new assignment owned
  // by the still-active Teacher B, without reviving the disabled account.
  const depth = await saveAssignmentForStaff(B.staff, {
    course: "Synthetic", section: "Authenticated", title: "Synthetic bounded coaching",
    prompt: "Interpret the fictional garden.", sourceTitle: "Fictional garden",
    passage: "The garden gave neighbors shared responsibility.", directions: "Make your own interpretation.", status: "open",
  });
  snapshot.authenticatedDepth = depth;
  const { staffDepthAccess, studentDepthAccess } = await import("../lib/depth-student-access.js");
  const invitation = await staffDepthAccess(sql, B.staff, {
    action: "depth-student-invite", assignmentId: depth.assignmentId,
    firstName: "CanonicalPrivateName", lastName: "CanonicalPrivateLast", email: "authenticated-coach@example.invalid",
  });
  const login = await studentDepthAccess(sql, request({}), {
    action: "depth-student-login", assignmentId: depth.assignmentId, code: invitation.code,
  });
  const studentCookie = login.cookie.split(";")[0];
  const key = security.digest(`${depth.assignmentId}:authenticated-coach@example.invalid`);
  let providerCalls = 0;
  const payloads = [],
    logs = [];
  const oldFetch = globalThis.fetch,
    oldError = console.error;
  globalThis.fetch = async (url, opts) => {
    assert.ok(url.startsWith("https://api.openai.com/"));
    const p = JSON.parse(opts.body);
    payloads.push(p);
    if (url.endsWith("moderations"))
      return Response.json({ results: [{ flagged: false, categories: {} }] });
    providerCalls++;
    return Response.json({
      status: "completed",
      output_text:
        "The claim identifies a shared responsibility but leaves disagreement unexplained. This tension matters because cooperation does not guarantee consensus. Examine which part of the passage supports that tension before revising the claim. What would distinguish disagreement from a failure of shared responsibility?",
    });
  };
  console.error = (...args) => logs.push(args);
  try {
    const body = {
      accessCode: process.env.ENDEPTH_ACCESS_CODE,
      assignmentId: depth.assignmentId,
      assignment: { assignmentId: depth.assignmentId },
      studentCoachKey: security.digest("forged-client-coach-user"),
      firstName: "PrivateIdentityName",
      lastName: "PrivateIdentityLast",
      email: "privateidentity@example.invalid",
      invitationToken: "private-invitation-token",
      initialResponse:
        "A fictional shared garden may reveal disagreement in a community.",
      evidence: "The garden gave neighbors shared responsibility.",
      significance: "Shared responsibility need not imply agreement.",
      selectedMove: "complicate",
      messages: [
        {
          role: "student",
          text: "How can I test the tension in my interpretation?",
        },
      ],
    };
    const first = await call(handler, {
      ...body,
      requestId: "depth_retry_request_0001",
    }, studentCookie);
    assert.equal(first.status, 200);
    assert.equal(first.data.usage.successfulQuestions, 1);
    assert.ok(first.data.reply.split(/\s+/).length > 30);
    const again = await call(handler, {
      ...body,
      requestId: "depth_retry_request_0001",
    }, studentCookie);
    assert.equal(again.data.reply, first.data.reply);
    assert.equal(providerCalls, 1);
    const concurrent = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        call(handler, { ...body, requestId: "depth_concurrent_req_" + i }, studentCookie),
      ),
    );
    assert.equal(concurrent.filter((r) => r.status === 200).length, 3);
    assert.equal(providerCalls, 4);
    assert.equal(
      (await call(handler, { ...body, studentCoachKey: security.digest("another-forged-quota-key"), requestId: "depth_fifth_request_0001" }, studentCookie))
        .status,
      409,
    );
    const usage = (await sql`SELECT successful_count FROM endepth_coach_usage
      WHERE assignment_id=${depth.assignmentId} AND student_email=${key}`)[0];
    assert.equal(usage.successful_count, 4);
    for (const p of payloads) {
      const str = JSON.stringify(p);
      for (const secret of [
        "PrivateIdentityName",
        "PrivateIdentityLast",
        "privateidentity@example.invalid",
        "private-invitation-token",
        "CanonicalPrivateName",
        "CanonicalPrivateLast",
        "authenticated-coach@example.invalid",
        invitation.code,
        key,
        process.env.ENDEPTH_ACCESS_CODE,
        process.env.OPENAI_API_KEY,
      ])
        assert.equal(str.includes(secret), false);
      if (p.instructions) assert.equal(p.store, false);
    }
    assert.equal(logs.length, 0);
    // Closing is enforced by the same real API handler before the AI provider is called.
    await sql`UPDATE endepth_assignments SET status='closed' WHERE assignment_id=${depth.assignmentId}`;
    assert.equal(
      (await call(handler, { ...body, requestId: "depth_closed_request_0001" }, studentCookie))
        .status,
      409,
    );
  } finally {
    globalThis.fetch = oldFetch;
    console.error = oldError;
  }
});
test("EnDepth seventeenth-student admission is atomic and legacy ownership remains untouched", async () => {
  const { ensureAtomicCapacityGuard } = await import(
    "../lib/capacity-guard.js"
  );
  await ensureAtomicCapacityGuard();
  const old = (
    await sql`SELECT assignment_id,teacher_id FROM endepth_submissions WHERE submission_id='synthetic-legacy-record'`
  )[0];
  const depth = await saveAssignmentForStaff(B.staff, {
    course: "Synthetic", section: "Capacity", title: "Synthetic independent capacity fixture",
    prompt: "Interpret a fictional choice.", sourceTitle: "Fictional excerpt", passage: "A fictional traveler chooses a path.",
    directions: "Make your own decisions.", status: "open",
  });
  const inserts = await Promise.allSettled(
    Array.from(
      { length: 18 },
      (
        _,
        i,
      ) => sql`INSERT INTO endepth_submissions(submission_id,assignment_key,teacher_name,course,assignment_title,central_question,student_first_name,student_last_name,student_key,assignment_id,teacher_id,student_email)
 VALUES(${"capacity-test-" + i},${depth.assignmentId},'Example','Synthetic','Capacity','Synthetic','Fictional','Writer',${"capacity-" + i},${depth.assignmentId},${depth.teacherId},${"synthetic" + i + "@example.invalid"})`,
    ),
  );
  assert.equal(inserts.filter((r) => r.status === "fulfilled").length, 17);
  assert.match(
    inserts.find((r) => r.status === "rejected").reason.message,
    /CAPACITY_REACHED/,
  );
  assert.deepEqual(
    (
      await sql`SELECT assignment_id,teacher_id FROM endepth_submissions WHERE submission_id='synthetic-legacy-record'`
    )[0],
    old,
  );
});
test("additive migrations can run again without replacing accounts or originals", async () => {
  const schema = (await import("../lib/department-schema.js")).default;
  const teachers =
    await sql`SELECT teacher_id,code_hash,active FROM endepth_teachers ORDER BY teacher_id`;
  const original = (
    await sql`SELECT original FROM enscribe_students WHERE id=${studentId}`
  )[0];
  await sql.query(schema);
  await sql.query(schema);
  assert.deepEqual(
    await sql`SELECT teacher_id,code_hash,active FROM endepth_teachers ORDER BY teacher_id`,
    teachers,
  );
  assert.deepEqual(
    (
      await sql`SELECT original FROM enscribe_students WHERE id=${studentId}`
    )[0],
    original,
  );
});
test("runtime migration equals the audited SQL and works as individual prepared statements", async () => {
  const { readFile } = await import("node:fs/promises");
  const schema = (await import("../lib/department-schema.js")).default;
  assert.equal(
    schema,
    await readFile(
      new URL("../migrations/department.sql", import.meta.url),
      "utf8",
    ),
  );
  const { statements } = await import("../lib/sql-statements.js");
  for (const statement of statements(schema)) await sql.query(statement);
});
test("student link rotation and stalled-check recovery revoke old capabilities and stale leases", async () => {
  const a = (
    await writing.staffWriting(sql, B.staff, {
      action: "writing-save",
      assignment: {
        title: "Synthetic recovery",
        course: "Test",
        section: "T",
        prompt: "Test",
        status: "open",
        boundaries: "moderate",
      },
    })
  ).assignment;
  const invitation = await writing.staffWriting(sql, B.staff, {
    action: "writing-invite",
    assignmentId: a.id,
    student: {
      firstName: "Synthetic",
      lastName: "Recovery",
      email: "recovery@example.invalid",
      original: "The fictional garden gives neighbors shared responsibility.",
    },
  });
  const raw = new URLSearchParams(invitation.studentPath.split("#")[1]).get(
      "access",
    ),
    s = invitation.studentId;
  const body = { action: "writing-link", assignmentId: a.id, studentId: s };
  assert.equal((await call(endpoint, body, A.cookie)).status, 401);
  const rotated = await call(endpoint, body, B.cookie);
  assert.equal(rotated.status, 200);
  await assert.rejects(
    writing.studentWriting(sql, request({}, "enscribe_student=" + raw), {
      action: "student-read",
      studentId: s,
    }),
    /private student link/,
  );
  const newRaw = new URLSearchParams(
    rotated.data.studentPath.split("#")[1],
  ).get("access");
  const entered = await writing.studentWriting(sql, request({}), {
    action: "student-enter", studentId: s, token: newRaw,
  });
  assert.ok(
    (
      await writing.studentWriting(
        sql,
        request({}, entered.cookie.split(";")[0]),
        { action: "student-read", studentId: s },
      )
    ).student.original,
  );
  const key = security.digest(newRaw),
    req = "stalled_check_request_001",
    hash = security.digest("academic");
  await sql`SELECT * FROM enscribe_reserve(${s},${key},${req},${hash},'{}'::jsonb,'old-lease')`;
  await sql`UPDATE enscribe_checks SET created_at=NOW()-INTERVAL '6 minutes' WHERE student_id=${s} AND request_id=${req}`;
  assert.equal(
    (
      await call(
        endpoint,
        { action: "writing-cancel-stalled", assignmentId: a.id, studentId: s },
        B.cookie,
      )
    ).data.cancelled,
    true,
  );
  await sql`SELECT * FROM enscribe_reserve(${s},${key},${req},${hash},'{}'::jsonb,'new-lease')`;
  assert.equal(
    (
      await sql`SELECT enscribe_finish(${s},${req},'complete','stale reply','old-lease') AS accepted`
    )[0].accepted,
    false,
  );
  assert.equal(
    (
      await sql`SELECT successful_checks FROM enscribe_students WHERE id=${s}`
    )[0].successful_checks,
    0,
  );
  assert.equal(
    (
      await sql`SELECT enscribe_finish(${s},${req},'complete','new reply','new-lease') AS accepted`
    )[0].accepted,
    true,
  );
  assert.equal(
    (
      await sql`SELECT successful_checks FROM enscribe_students WHERE id=${s}`
    )[0].successful_checks,
    1,
  );
});
test("EnDepth testing data is teacher-owned even when a class code is supplied", async () => {
  const d = await call(endpoint, { action: "depth-test" }, B.cookie);
  assert.equal(d.status, 200);
  const slug = new URL(
    "https://synthetic.test" + d.data.studentPath,
  ).searchParams.get("assignment");
  const a = (
    await sql`SELECT * FROM endepth_assignments WHERE public_slug=${slug}`
  )[0];
  assert.equal(a.sandbox, true);
  const before = (
    await sql`SELECT count(*)::int AS n FROM endepth_submissions WHERE assignment_id=${snapshot.depth.assignmentId}`
  )[0].n;
  const handler = (await import("../api/coach.js")).default;
  const response = await call(
    handler,
    {
      accessCode: process.env.ENDEPTH_ACCESS_CODE,
      assignmentId: a.assignment_id,
      studentCoachKey: security.digest("other"),
      messages: [{ role: "student", text: "Test question" }],
      requestId: "sandbox_modified_req_0001",
    },
    snapshot.morganCookie,
  );
  assert.equal(response.status, 403);
  assert.equal(
    (
      await sql`SELECT count(*)::int AS n FROM endepth_submissions WHERE assignment_id=${snapshot.depth.assignmentId}`
    )[0].n,
    before,
  );
});
test("CSV export neutralizes spreadsheet formulas and preserves quoting", async () => {
  const { safeCsv } = await import("../src/departmentApi.js");
  const result = safeCsv([
    ["=SUM(1,2)", " +run", "@function", 'ordinary "quoted" text', "two\nlines"],
  ]);
  assert.match(result, /"'=SUM/);
  assert.match(result, /"' \+run/);
  assert.match(result, /"'@function/);
  assert.match(result, /ordinary ""quoted"" text/);
  assert.match(result, /two\nlines/);
});
test("migration CLI rejects false approval flags before opening a database", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const value of ["0", "false", "true", "yes", ""]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/migrate-department.mjs"],
      {
        cwd: process.cwd(),
        env: {
          DEPARTMENT_MIGRATION_APPROVED: value,
          DATABASE_URL: "postgresql://localhost:1/not-to-be-opened",
        },
        encoding: "utf8",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Set DEPARTMENT_MIGRATION_APPROVED=1 only after review/,
    );
    assert.equal(result.stderr.includes("ECONNREFUSED"), false);
  }
});
