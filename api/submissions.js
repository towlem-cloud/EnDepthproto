import {
  cleanMessages,
  cleanString,
  databaseIsConfigured,
  json,
  normalizeAssignment,
  stableAssignmentKey,
  upsertSubmission,
} from "./submissions-db.js";

function submissionIdFrom(body) {
  const supplied = cleanString(body?.submissionId, 160);
  if (supplied && /^[a-zA-Z0-9._:-]+$/.test(supplied)) return supplied;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Use POST for this endpoint." }, 405);
    }

    if (!databaseIsConfigured()) {
      return json(
        {
          error:
            "The classroom submissions database has not been connected in Vercel yet.",
        },
        503
      );
    }

    const requiredCode = process.env.ENDEPTH_ACCESS_CODE;
    if (!requiredCode) {
      return json({ error: "The student pilot code has not been configured yet." }, 503);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "The submission request was invalid." }, 400);
    }

    if (cleanString(body?.accessCode, 200) !== requiredCode) {
      return json({ error: "The class pilot code was not accepted." }, 401);
    }

    const assignment = normalizeAssignment(body?.assignment);
    const firstName = cleanString(body?.student?.firstName, 80);
    const lastName = cleanString(body?.student?.lastName, 80);
    const work = body?.work || {};
    const initialResponse = cleanString(work.initialResponse, 8000);
    const evidence = cleanString(work.evidence, 6000);
    const significance = cleanString(work.significance, 6000);
    const claim = cleanString(work.claim, 6000);
    const complication = cleanString(work.complication, 6000);
    const openQuestion = cleanString(work.openQuestion, 3000);

    if (!firstName || !lastName) {
      return json({ error: "Both first and last name are required." }, 400);
    }
    if (!assignment.course || !assignment.title || !assignment.prompt) {
      return json({ error: "The assignment information is incomplete." }, 400);
    }
    if (!initialResponse || !evidence || !claim || !complication || !openQuestion) {
      return json({ error: "Complete the preparation card before submitting." }, 400);
    }

    try {
      const row = await upsertSubmission({
        submissionId: submissionIdFrom(body),
        assignmentKey: stableAssignmentKey(assignment),
        assignment,
        firstName,
        lastName,
        initialResponse,
        evidence,
        significance,
        claim,
        complication,
        openQuestion,
        messages: cleanMessages(body?.messages),
      });
      return json({
        ok: true,
        submissionId: row.submission_id,
        submittedAt: row.updated_at,
      });
    } catch (error) {
      console.error("EnDepth submission failed", error);
      return json(
        { error: "Your preparation could not be saved to the classroom database." },
        500
      );
    }
  },
};
