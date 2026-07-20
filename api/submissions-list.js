import {
  cleanString,
  databaseIsConfigured,
  json,
  listSubmissions,
} from "./submissions-db.js";

function mapSubmission(row) {
  return {
    submissionId: row.submission_id,
    assignmentKey: row.assignment_key,
    teacherName: row.teacher_name,
    course: row.course,
    assignmentTitle: row.assignment_title,
    assignmentDate: row.assignment_date,
    centralQuestion: row.central_question,
    sourceTitle: row.source_title,
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    initialResponse: row.initial_response,
    evidence: row.evidence,
    significance: row.significance,
    claim: row.claim,
    complication: row.complication,
    openQuestion: row.open_question,
    messages: Array.isArray(row.messages) ? row.messages : [],
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
  };
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

    const requiredTeacherCode = process.env.ENDEPTH_TEACHER_CODE;
    if (!requiredTeacherCode) {
      return json(
        { error: "The private teacher dashboard code has not been configured yet." },
        503
      );
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const suppliedCode =
      cleanString(request.headers.get("x-endepth-teacher-code"), 200) ||
      cleanString(body.teacherCode, 200);
    if (suppliedCode !== requiredTeacherCode) {
      return json({ error: "The private teacher code was not accepted." }, 401);
    }

    try {
      const rows = await listSubmissions(body.limit);
      return json({ submissions: rows.map(mapSubmission) });
    } catch (error) {
      console.error("EnDepth submission list failed", error);
      return json(
        { error: "Student submissions could not be loaded from the database." },
        500
      );
    }
  },
};
