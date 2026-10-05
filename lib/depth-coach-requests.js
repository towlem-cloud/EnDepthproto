import {
  database,
  digest,
  token,
  assert,
  rateLimit,
} from "./department-security.js";
export async function reserveDepth(request, assignmentId, key, body) {
  const sql = await database();
  await rateLimit(sql, "depth-coach:" + assignmentId + ":" + key, 30, 600);
  const requestId =
    body.requestId ||
    digest(
      JSON.stringify({
        initialResponse: body.initialResponse,
        selectedMove: body.selectedMove,
        evidence: body.evidence,
        significance: body.significance,
        messages: body.messages,
      }),
    );
  assert(
    typeof requestId === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(requestId),
    400,
    "A retry-safe coaching request ID is required. Refresh the page.",
  );
  const hash = digest(
    JSON.stringify({
      initialResponse: body.initialResponse,
      selectedMove: body.selectedMove,
      evidence: body.evidence,
      significance: body.significance,
      messages: body.messages,
    }),
  );
  const lease = token();
  const row = (
    await sql`SELECT * FROM department_depth_reserve(${assignmentId},${key},${requestId},${hash},${lease})`
  )[0];
  return { ...row, lease, requestId };
}
export async function finishDepth(
  assignmentId,
  key,
  reservation,
  reply = null,
) {
  const sql = await database();
  const rows =
    await sql`SELECT department_depth_finish(${assignmentId},${key},${reservation.requestId},${reservation.lease},${reply ? JSON.stringify(reply) : null}::jsonb) AS n`;
  return rows[0].n;
}
