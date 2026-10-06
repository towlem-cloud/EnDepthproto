import { depthTestIdentity } from "../lib/depth-sandbox.js";
import { requireDepthStudent, submitDepthStudent } from "../lib/depth-student-access.js";
import { database, sameOrigin } from "../lib/department-security.js";
import { ensureAtomicCapacityGuard } from "../lib/capacity-guard.js";
import { cleanMessages, cleanString, databaseIsConfigured, json, upsertSubmission } from "../lib/endepth-db.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") return json({ error: "Use POST for this endpoint." }, 405);
    if (!databaseIsConfigured()) return json({ error: "The classroom submissions database is not connected." }, 503);
    try {
      sameOrigin(request);
      let body;
      try { body = await request.json(); } catch { return json({ error: "The submission request was invalid." }, 400); }
      const assignmentId = cleanString(body?.assignmentId || body?.assignment?.assignmentId, 100);
      if (!assignmentId) return json({ error: "The assignment link is missing its database ID." }, 400);
      const sandbox = await depthTestIdentity(request, assignmentId);
      const sql = await database();
      const student = sandbox ? null : await requireDepthStudent(request, assignmentId, sql);
      const work = body?.work || {};
      const academic = {
        initialResponse: cleanString(work.initialResponse, 8000), evidence: cleanString(work.evidence, 6000),
        significance: cleanString(work.significance, 6000), claim: cleanString(work.claim, 6000),
        complication: cleanString(work.complication, 6000), openQuestion: cleanString(work.openQuestion, 3000),
        messages: cleanMessages(body?.messages),
      };
      if (!academic.initialResponse || !academic.evidence || !academic.claim || !academic.complication || !academic.openQuestion)
        return json({ error: "Complete the preparation card before submitting." }, 400);
      await ensureAtomicCapacityGuard();
      const row = sandbox ? await upsertSubmission({
        assignmentId, firstName: "Fictional", lastName: "Writer", studentEmail: "fictional-writer@example.invalid", ...academic,
      }) : await submitDepthStudent(sql, student, academic);
      return json({ ok: true, submissionId: row.submission_id, submittedAt: row.updated_at });
    } catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      const code = String(error.message || "");
      if (code.includes("ASSIGNMENT_CAPACITY_REACHED")) return json({ error: "This class section has reached its 17-student limit." }, 409);
      if (code.includes("ASSIGNMENT_NOT_OPEN")) return json({ error: "This assignment is no longer open for submissions." }, 409);
      if (code.includes("STUDENT_ACCESS_CHANGED")) return json({ error: "Student access changed. Sign in again before submitting." }, 401);
      console.error("EnDepth submission failed");
      return json({ error: "Your preparation could not be saved to the classroom database." }, 500);
    }
  },
};
