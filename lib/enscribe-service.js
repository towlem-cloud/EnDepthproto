import {
  assert,
  owned,
  id,
  token,
  digest,
  rateLimit,
  HttpError,
} from "./department-security.js";
import { academicInput, liveWritingCheck } from "./writing-coach.js";
const text = (v, max = 8000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const publicStudent = (s) => ({
  id: s.id,
  assignmentId: s.assignment_id,
  firstName: s.first_name,
  lastName: s.last_name,
  email: s.email,
  original: s.original,
  working: s.working,
  reflection: s.reflection,
  version: s.version,
  submittedAt: s.submitted_at,
  successfulChecks: s.successful_checks,
  inFlight: s.in_flight,
});
export async function getAssignment(sql, assignmentId, staff) {
  const a = (
    await sql`SELECT * FROM enscribe_assignments WHERE id=${text(assignmentId, 100)}`
  )[0];
  assert(a, 404, "Assignment not found.");
  if (staff) owned(staff, a.teacher_id);
  return a;
}
export async function staffWriting(sql, staff, body) {
  if (body.action === "writing-list") {
    return {
      assignments:
        staff.role === "admin"
          ? await sql`SELECT * FROM enscribe_assignments ORDER BY updated_at DESC`
          : await sql`SELECT * FROM enscribe_assignments WHERE teacher_id=${staff.teacherId} ORDER BY updated_at DESC`,
    };
  }
  if (body.action === "writing-save") {
    const draft = body.assignment || {};
    const existing = draft.id
      ? await getAssignment(sql, draft.id, staff)
      : null;
    const owner =
      existing?.teacher_id ||
      (staff.role === "admin" ? text(draft.teacher_id, 100) : staff.teacherId);
    assert(owner, 400, "Choose a teacher.");
    assert(
      (
        await sql`SELECT teacher_id FROM endepth_teachers WHERE teacher_id=${owner} AND active=TRUE`
      ).length,
      400,
      "Active teacher required.",
    );
    const values = {
      title: text(draft.title, 300),
      course: text(draft.course, 240),
      section: text(draft.section, 160),
      prompt: text(draft.prompt),
      instructions: text(draft.instructions),
      rubric: text(draft.rubric),
      timing: text(draft.timing, 300),
    };
    assert(
      values.title && values.course && values.section && values.prompt,
      400,
      "Title, course, section, and prompt are required.",
    );
    assert(
      ["draft", "open", "closed"].includes(draft.status) &&
        ["permissive", "moderate", "restrictive"].includes(draft.boundaries),
      400,
      "Choose valid status and boundaries.",
    );
    // Existing ownership and sandbox designation are immutable through ordinary save.
    const rows = existing
      ? await sql`UPDATE enscribe_assignments SET title=${values.title},course=${values.course},section=${values.section},prompt=${values.prompt},instructions=${values.instructions},rubric=${values.rubric},timing=${values.timing},status=${draft.status},boundaries=${draft.boundaries},updated_at=NOW() WHERE id=${existing.id} RETURNING *`
      : await sql`INSERT INTO enscribe_assignments(id,public_slug,teacher_id,title,course,section,prompt,instructions,rubric,timing,status,boundaries)
   VALUES(${id("writing")},${token()},${owner},${values.title},${values.course},${values.section},${values.prompt},${values.instructions},${values.rubric},${values.timing},${draft.status},${draft.boundaries}) RETURNING *`;
    return { assignment: rows[0] };
  }
  if (body.action === "writing-duplicate") {
    const a = await getAssignment(sql, body.assignmentId, staff);
    const copy = {
      ...a,
      id: undefined,
      status: "draft",
      title: a.title + " (copy)",
      teacher_id: staff.teacherId || a.teacher_id,
    };
    return staffWriting(sql, staff, {
      action: "writing-save",
      assignment: copy,
    });
  }
  if (body.action === "writing-test") {
    assert(staff.teacherId, 400, "Use your teacher account for testing.");
    await rateLimit(sql, "sandbox:" + staff.teacherId, 5, 3600);
    const a = (
      await sql`INSERT INTO enscribe_assignments(id,public_slug,teacher_id,title,course,section,prompt,instructions,rubric,timing,status,boundaries,sandbox)
   VALUES(${id("sandbox")},${token()},${staff.teacherId},'EXAMPLE: fictional writing test','EXAMPLE course','EXAMPLE section',
   'Explore how a fictional garden changes a community.','Use your own interpretation.','', 'Testing only','open','moderate',TRUE) RETURNING *`
    )[0];
    const result = await invite(sql, a, {
      firstName: "Example",
      lastName: "Writer",
      email: "fictional@example.invalid",
      original:
        "The fictional garden changes the neighborhood because it gives people a shared responsibility. Its effect depends on whether residents can decide together how to use the space.",
    });
    return { ...result, assignment: a };
  }
  const a = await getAssignment(sql, body.assignmentId, staff);
  if (body.action === "writing-records") {
    const rows =
      await sql`SELECT * FROM enscribe_students WHERE assignment_id=${a.id}`;
    return {
      students: await Promise.all(
        rows.map(async (s) => ({
          ...publicStudent(s),
          ...(await history(sql, s.id)),
        })),
      ),
    };
  }
  if (body.action === "writing-invite") {
    assert(!a.sandbox, 400, "Use the testing path for examples.");
    await rateLimit(sql, "invite:" + a.teacher_id, 60, 3600);
    return invite(sql, a, body.student || {});
  }
  if (body.action === "writing-link") {
    const raw = token();
    const changed =
      await sql`UPDATE enscribe_students SET token_hash=${digest(raw)} WHERE id=${text(body.studentId, 100)} AND assignment_id=${a.id} RETURNING id`;
    assert(changed.length, 404, "Student not found.");
    return {
      studentPath: `/?tool=enscribe&writer=${changed[0].id}#access=${raw}`,
    };
  }
  if (body.action === "writing-cancel-stalled") {
    const rows =
      await sql`SELECT enscribe_cancel_stalled(${text(body.studentId, 100)},${a.id}) AS cancelled`;
    return { cancelled: rows[0].cancelled };
  }
  if (body.action === "writing-reopen") {
    assert(
      a.status === "open",
      409,
      "Open the assignment before reopening a draft.",
    );
    const rows =
      await sql`UPDATE enscribe_students SET submitted_at=NULL,version=version+1 WHERE id=${text(body.studentId, 100)} AND assignment_id=${a.id} AND in_flight=0 RETURNING id`;
    assert(rows.length, 409, "Student not found or check in progress.");
    return { ok: true };
  }
  if (body.action === "writing-reset") {
    assert(
      a.sandbox && a.teacher_id === staff.teacherId,
      403,
      "Only your own testing data can be reset.",
    );
    await rateLimit(sql, "sandbox:" + staff.teacherId, 5, 3600);
    // Deletion predicates always include this owned sandbox assignment.
    await sql`DELETE FROM enscribe_checks WHERE student_id IN(SELECT id FROM enscribe_students WHERE assignment_id=${a.id})`;
    await sql`DELETE FROM enscribe_revisions WHERE student_id IN(SELECT id FROM enscribe_students WHERE assignment_id=${a.id})`;
    await sql`DELETE FROM enscribe_students WHERE assignment_id=${a.id}`;
    return { ok: true };
  }
  throw new HttpError(400, "Unsupported writing action.");
}
async function invite(sql, a, s) {
  const first = text(s.firstName, 80),
    last = text(s.lastName, 80),
    email = text(s.email, 254).toLowerCase();
  assert(
    first && last && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    400,
    "Student first name, last name, and email required.",
  );
  const raw = token(),
    studentId = id("writer"),
    original = text(s.original, 60000) || null;
  await sql`INSERT INTO enscribe_students(id,assignment_id,token_hash,first_name,last_name,email,original,working)
 VALUES(${studentId},${a.id},${digest(raw)},${first},${last},${email},${original},${original || ""})`;
  if (original)
    await sql`INSERT INTO enscribe_revisions(id,student_id,version,draft,explanation) VALUES(${id("revision")},${studentId},0,${original},'Independent original imported by teacher; not AI generated.')`;
  // Credentials are returned once to the authenticated owner, never listed later.
  return {
    studentPath: `/?tool=enscribe&writer=${studentId}#access=${raw}`,
    studentId,
  };
}
async function history(sql, studentId) {
  return {
    revisions:
      await sql`SELECT version,draft,explanation,created_at FROM enscribe_revisions WHERE student_id=${studentId} ORDER BY version`,
    checks:
      await sql`SELECT request_id,state,academic,reply,created_at FROM enscribe_checks WHERE student_id=${studentId} ORDER BY created_at`,
  };
}
export function studentCookie(raw, age = 28800) {
  return `enscribe_student=${raw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}
export function studentToken(request) {
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("enscribe_student="))
      ?.slice(17) || ""
  );
}
export async function studentWriting(
  sql,
  request,
  body,
  coach = liveWritingCheck,
) {
  const raw =
    body.action === "student-enter"
      ? text(body.token, 100)
      : studentToken(request);
  assert(raw, 401, "Use your private student link.");
  const s = (
    await sql`SELECT * FROM enscribe_students WHERE id=${text(body.studentId, 100)} AND token_hash=${digest(raw)}`
  )[0];
  assert(s, 401, "Use your private student link.");
  const a = await getAssignment(sql, s.assignment_id);
  // Closed assignments cannot be read through student routes either.
  assert(a.status === "open", 409, "This assignment is not open.");
  if (["student-enter", "student-read"].includes(body.action))
    return {
      student: publicStudent(s),
      assignment: a,
      ...(await history(sql, s.id)),
      ...(body.action === "student-enter"
        ? { cookie: studentCookie(raw) }
        : {}),
    };
  if (body.action === "student-save") {
    assert(Number.isInteger(body.version), 400, "Version required.");
    const draft = text(body.draft, 60000);
    assert(draft, 400, "A draft is required.");
    const rows =
      await sql`SELECT * FROM enscribe_save(${s.id},${digest(raw)},${body.version},${draft},${text(body.explanation, 6000)},${text(body.reflection, 6000)},${body.submit === true})`;
    return { student: publicStudent(rows[0]), ...(await history(sql, s.id)) };
  }
  if (body.action === "student-coach") {
    await rateLimit(sql, "coach:" + s.id, 20, 600);
    assert(
      typeof body.requestId === "string" &&
        /^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId),
      400,
      "Request ID required.",
    );
    const academic = academicInput(a, s, body);
    const lease = token();
    const reservation = (
      await sql`SELECT * FROM enscribe_reserve(${s.id},${digest(raw)},${body.requestId},${digest(JSON.stringify(academic))},${JSON.stringify(academic)}::jsonb,${lease})`
    )[0];
    if (reservation.result === "cached")
      return { reply: reservation.cached, cached: true };
    assert(
      reservation.result === "reserved",
      409,
      reservation.result === "limit"
        ? "Four successful checks completed."
        : "A check is already in progress. Retry the same request.",
    );
    let result;
    try {
      result = await coach(academic);
    } catch (error) {
      await sql`SELECT enscribe_finish(${s.id},${body.requestId},'failed',NULL,${lease})`;
      throw error;
    }
    if (result.withheld) {
      await sql`SELECT enscribe_finish(${s.id},${body.requestId},'withheld',NULL,${lease})`;
      return {
        withheld: true,
        message:
          "Feedback withheld by safety checks. No successful check was consumed.",
      };
    }
    const completed =
      await sql`SELECT enscribe_finish(${s.id},${body.requestId},'complete',${result.reply},${lease}) AS completed`;
    assert(
      completed[0].completed,
      409,
      "This check was cancelled; no successful check was recorded.",
    );
    return { reply: result.reply };
  }
  throw new HttpError(400, "Unsupported student action.");
}
