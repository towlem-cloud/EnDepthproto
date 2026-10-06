import {
  assert, database, digest, HttpError, id, owned, passwordHash, passwordMatches,
  rateLimit, sameOrigin, token,
} from "./department-security.js";
import { cleanString, isValidEmail, normalizeEmail } from "./endepth-db.js";

export const DEPTH_STUDENT_COOKIE = "endepth_student_session";
const cookieValue = (request) => (request.headers.get("cookie") || "").split(";")
  .map((part) => part.trim()).find((part) => part.startsWith(DEPTH_STUDENT_COOKIE + "="))
  ?.slice(DEPTH_STUDENT_COOKIE.length + 1) || "";
const studentCookie = (raw, seconds = 43200) =>
  `${DEPTH_STUDENT_COOKIE}=${raw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
const studentIdentity = (student) => ({
  studentId: student.student_id, firstName: student.first_name,
  lastName: student.last_name, email: student.email,
});

/** Teachers issue private credentials; an email or shared class code grants no access. */
export async function staffDepthAccess(sql, staff, body) {
  assert(body.action === "depth-student-invite", 400, "Unsupported student access action.");
  const assignmentId = cleanString(body.assignmentId, 100);
  const assignment = (await sql`SELECT * FROM endepth_assignments WHERE assignment_id=${assignmentId}`)[0];
  assert(assignment, 404, "Assignment not found.");
  owned(staff, assignment.teacher_id);
  assert(!assignment.sandbox, 400, "Use the fictional test path for sandbox assignments.");
  const firstName = cleanString(body.firstName, 80), lastName = cleanString(body.lastName, 80);
  const email = normalizeEmail(body.email);
  assert(firstName && lastName && isValidEmail(email), 400, "First name, last name and student email are required.");
  await rateLimit(sql, "depth-student-invite:" + (staff.teacherId || "admin"), 100, 600);
  const secret = token(), salt = token(), codeHash = await passwordHash(secret, salt);
  let rows;
  try {
    rows = await sql`SELECT * FROM department_depth_invite(
      ${assignmentId},${staff.role},${staff.teacherId || ""},${id("depthstudent")},
      ${firstName},${lastName},${email},${salt},${codeHash}
    )`;
  } catch (error) {
    if (String(error.message).includes("ASSIGNMENT_CAPACITY_REACHED")) throw new HttpError(409, "This assignment has reached its 17-student limit.");
    if (String(error.message).includes("STUDENT_ACCESS_DENIED")) throw new HttpError(403, "Assignment ownership or teacher activation changed. Access was not issued.");
    throw error;
  }
  assert(rows[0], 403, "Assignment ownership or teacher activation changed. Access was not issued.");
  const canonical = rows[0];
  // Keep concurrent sessions minted using the new epoch; revoke only older credentials.
  await sql`DELETE FROM endepth_student_sessions WHERE student_id=${canonical.student_id}
    AND credential_version < ${canonical.credential_version}`;
  return {
    code: `${canonical.student_id}.${secret}`, studentId: canonical.student_id,
    studentPath: `/?assignment=${encodeURIComponent(assignment.public_slug)}`,
  };
}

export async function requireDepthStudent(request, assignmentId, sql = null) {
  sql ||= await database();
  const raw = cookieValue(request);
  assert(/^[a-zA-Z0-9_-]{43}$/.test(raw), 401, "Sign in with the individual student code your teacher issued.");
  const sessionHash = digest(raw);
  const rows = await sql`
    SELECT s.* FROM endepth_student_sessions x
    JOIN endepth_student_access s ON s.student_id=x.student_id
    JOIN endepth_assignments a ON a.assignment_id=s.assignment_id
    JOIN endepth_teachers t ON t.teacher_id=a.teacher_id
    WHERE x.token_hash=${sessionHash} AND x.expires_at>NOW()
      AND x.credential_version=s.credential_version AND s.active=TRUE
      AND s.assignment_id=${cleanString(assignmentId, 100)} AND a.sandbox=FALSE
      AND t.active=TRUE AND t.activation_state='active'
      AND x.teacher_id=t.teacher_id AND x.teacher_version=t.credential_version
    LIMIT 1
  `;
  assert(rows[0], 401, "Student access has expired or changed. Ask your teacher for your individual code.");
  const student = rows[0];
  return { ...studentIdentity(student), assignmentId: student.assignment_id,
    epoch: Number(student.credential_version), sessionHash,
    coachKey: digest(`${student.assignment_id}:${student.email}`) };
}

export async function studentDepthAccess(sql, request, body) {
  sameOrigin(request);
  if (body.action === "depth-student-logout") {
    await sql`DELETE FROM endepth_student_sessions WHERE token_hash=${digest(cookieValue(request))}`;
    return { ok: true, cookie: studentCookie("", 0) };
  }
  const assignmentId = cleanString(body.assignmentId, 100);
  assert(assignmentId, 400, "Use the assignment link supplied by your teacher.");
  if (body.action === "depth-student-session") {
    const student = await requireDepthStudent(request, assignmentId, sql);
    return { student: { studentId: student.studentId, firstName: student.firstName, lastName: student.lastName, email: student.email } };
  }
  assert(body.action === "depth-student-login", 400, "Unsupported student access action.");
  const ip = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "local";
  await rateLimit(sql, "depth-student-login:" + digest(ip), 60, 600);
  const raw = cleanString(body.code, 300);
  const matched = /^(depthstudent_[a-f0-9]{32})\.([a-zA-Z0-9_-]{43})$/.exec(raw);
  assert(matched, 401, "That individual student code was not accepted.");
  const [, studentId, secret] = matched;
  await rateLimit(sql, "depth-student-code:" + digest(studentId), 10, 600);
  const student = (await sql`
    SELECT s.*,t.credential_version AS owner_version FROM endepth_student_access s
    JOIN endepth_assignments a ON a.assignment_id=s.assignment_id
    JOIN endepth_teachers t ON t.teacher_id=a.teacher_id
    WHERE s.student_id=${studentId} AND s.assignment_id=${assignmentId} AND s.active=TRUE
      AND a.sandbox=FALSE AND t.active=TRUE AND t.activation_state='active'
  `)[0];
  assert(student && await passwordMatches(secret, { ...student, auth_scheme: "scrypt" }), 401, "That individual student code was not accepted.");
  const rawSession = token();
  const sessions = await sql`
    INSERT INTO endepth_student_sessions (token_hash,student_id,credential_version,teacher_id,teacher_version,expires_at)
    SELECT ${digest(rawSession)},s.student_id,s.credential_version,t.teacher_id,t.credential_version,NOW()+INTERVAL '12 hours'
    FROM endepth_student_access s
    JOIN endepth_assignments a ON a.assignment_id=s.assignment_id
    JOIN endepth_teachers t ON t.teacher_id=a.teacher_id
    WHERE s.student_id=${studentId} AND s.credential_version=${student.credential_version}
      AND s.active=TRUE AND a.sandbox=FALSE AND t.active=TRUE AND t.activation_state='active'
      AND t.credential_version=${student.owner_version}
    RETURNING token_hash
  `;
  assert(sessions.length, 401, "Student access changed. Sign in using your current individual code.");
  return { student: studentIdentity(student), cookie: studentCookie(rawSession) };
}

/** Identity comes from the server session. Epoch/session checks occur again under the write lock. */
export async function submitDepthStudent(sql, student, academic) {
  const rows = await sql`SELECT * FROM department_depth_submit(
    ${student.studentId},${student.epoch},${student.sessionHash},
    ${academic.initialResponse},${academic.evidence},${academic.significance},
    ${academic.claim},${academic.complication},${academic.openQuestion},${JSON.stringify(academic.messages)}::jsonb
  )`;
  if (!rows[0]) throw new HttpError(401, "Student access changed. Sign in again before submitting.");
  return rows[0];
}
