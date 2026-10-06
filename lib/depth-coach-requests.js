import { database, digest, token, assert, rateLimit, HttpError } from "./department-security.js";
import { requireDepthStudent } from "./depth-student-access.js";

export async function reserveDepth(request, assignmentId, key, body, studentAccess = null) {
  const sql = await database();
  studentAccess ||= await requireDepthStudent(request, assignmentId, sql);
  await rateLimit(sql, "depth-coach:" + assignmentId + ":" + key, 30, 600);
  const requestId = body.requestId || digest(JSON.stringify({
    initialResponse: body.initialResponse, selectedMove: body.selectedMove,
    evidence: body.evidence, significance: body.significance, messages: body.messages,
  }));
  assert(typeof requestId === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(requestId),
    400, "A retry-safe coaching request ID is required. Refresh the page.");
  const hash = digest(JSON.stringify({ initialResponse: body.initialResponse,
    selectedMove: body.selectedMove, evidence: body.evidence,
    significance: body.significance, messages: body.messages }));
  const lease = token();
  const rawStaffSession = (request.headers.get("cookie") || "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith("department_session="))
    ?.slice("department_session=".length) || "";
  const staffSessionHash = digest(rawStaffSession);
  let rows;
  try {
    rows = studentAccess.sandbox
      ? await sql`SELECT * FROM department_depth_reserve_sandbox(${assignmentId},${key},${requestId},${hash},${lease},${staffSessionHash})`
      : await sql`SELECT * FROM department_depth_reserve_checked(${assignmentId},${key},${requestId},${hash},${lease},
        ${studentAccess.studentId},${studentAccess.epoch},${studentAccess.sessionHash})`;
  } catch (error) {
    if (String(error.message).includes("STUDENT_ACCESS_CHANGED")) throw new HttpError(401, "Access changed. Sign in again before requesting coaching.");
    throw error;
  }
  return { ...rows[0], lease, requestId, studentAccess, staffSessionHash };
}

export async function finishDepth(assignmentId, key, reservation, reply = null) {
  const sql = await database();
  let rows;
  if (!reply) {
    rows = await sql`SELECT department_depth_finish(${assignmentId},${key},${reservation.requestId},${reservation.lease},NULL) AS n`;
  } else if (reservation.studentAccess.sandbox) {
    rows = await sql`SELECT department_depth_finish_sandbox(${assignmentId},${key},${reservation.requestId},${reservation.lease},
      ${JSON.stringify(reply)}::jsonb,${reservation.staffSessionHash}) AS n`;
  } else {
    const student = reservation.studentAccess;
    rows = await sql`SELECT department_depth_finish_checked(${assignmentId},${key},${reservation.requestId},${reservation.lease},
      ${JSON.stringify(reply)}::jsonb,${student.studentId},${student.epoch},${student.sessionHash}) AS n`;
  }
  const successful = Number(rows[0]?.n);
  if (successful < 0) throw new HttpError(401, "Access changed while coaching was running. No successful check was charged.");
  return successful;
}
