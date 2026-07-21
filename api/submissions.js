import { ensureAtomicCapacityGuard } from "./capacity-guard.js";
import {
  cleanMessages,
  cleanString,
  databaseIsConfigured,
  isValidEmail,
  json,
  normalizeEmail,
  upsertSubmission,
} from "./submissions-db.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Use POST for this endpoint." }, 405);
    }
    if (!databaseIsConfigured()) {
      return json(
        { error: "The classroom submissions database has not been connected." },
        503
      );
    }

    const requiredCode = process.env.ENDEPTH_ACCESS_CODE;
    if (!requiredCode) {
      return json({ error: "The student pilot code has not been configured." }, 503);
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

    const assignmentId = cleanString(
      body?.assignmentId || body?.assignment?.assignmentId,
      100
    );
    const firstName = cleanString(body?.student?.firstName, 80);
    const lastName = cleanString(body?.student?.lastName, 80);
    const studentEmail = normalizeEmail(body?.student?.email);
    const work = body?.work || {};
    const initialResponse = cleanString(work.initialResponse, 8000);
    const evidence = cleanString(work.evidence, 6000);
    const significance = cleanString(work.significance, 6000);
    const claim = cleanString(work.claim, 6000);
    const complication = cleanString(work.complication, 6000);
    const openQuestion = cleanString(work.openQuestion, 3000);

    if (!assignmentId) {
      return json({ error: "The assignment link is missing its database ID." }, 400);
    }
    if (!firstName || !lastName) {
      return json({ error: "First and last name are required." }, 400);
    }
    if (!isValidEmail(studentEmail)) {
      return json({ error: "Enter a valid student email address." }, 400);
    }
    if (!initialResponse || !evidence || !claim || !complication || !openQuestion) {
      return json({ error: "Complete the preparation card before submitting." }, 400);
    }

    try {
      await ensureAtomicCapacityGuard();
      const row = await upsertSubmission({
        // The database chooses the existing ID for this assignment/email pair,
        // or generates a fresh one for a new/corrected email. We intentionally
        // do not reuse the browser's old submission ID across identities.
        assignmentId,
        firstName,
        lastName,
        studentEmail,
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
      const code = error instanceof Error ? error.message : "";
      if (code.includes("ASSIGNMENT_CAPACITY_REACHED")) {
        return json(
          { error: "This class section has reached its 17-student pilot limit." },
          409
        );
      }
      if (code.includes("ASSIGNMENT_NOT_OPEN")) {
        return json({ error: "This assignment is no longer open for submissions." }, 409);
      }
      console.error("EnDepth submission failed", error);
      return json(
        { error: "Your preparation could not be saved to the classroom database." },
        500
      );
    }
  },
};
