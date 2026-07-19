import { neon } from "@neondatabase/serverless";

let sqlClient = null;
let schemaPromise = null;

export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function cleanString(value, maxLength = 4000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function databaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  );
}

export function databaseIsConfigured() {
  return Boolean(databaseUrl());
}

function getSql() {
  if (!sqlClient) {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
    sqlClient = neon(url);
  }
  return sqlClient;
}

export function normalizeAssignment(assignment = {}) {
  const maxCoachQuestions = [4, 6, 8].includes(
    Number(assignment.maxCoachQuestions)
  )
    ? Number(assignment.maxCoachQuestions)
    : 6;
  return {
    teacherName: cleanString(assignment.teacherName, 160),
    course: cleanString(assignment.course, 240),
    title: cleanString(assignment.title, 300),
    date: cleanString(assignment.date, 200),
    prompt: cleanString(assignment.prompt, 3000),
    sourceTitle: cleanString(assignment.sourceTitle, 300),
    passage: cleanString(assignment.passage, 6000),
    directions: cleanString(assignment.directions, 3000),
    evidenceRequirement: cleanString(assignment.evidenceRequirement, 3000),
    coachingFocus: cleanString(assignment.coachingFocus, 300),
    maxCoachQuestions,
  };
}

export function stableAssignmentKey(assignment = {}) {
  return JSON.stringify(normalizeAssignment(assignment));
}

export function cleanMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .slice(-30)
    .map((message) => ({
      role: message?.role === "coach" ? "coach" : "student",
      text: cleanString(message?.text, 2400),
      move: cleanString(message?.move, 120),
    }))
    .filter((message) => message.text);
}

export async function ensureSubmissionsTable() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS endepth_submissions (
          submission_id TEXT PRIMARY KEY,
          assignment_key TEXT NOT NULL,
          teacher_name TEXT NOT NULL,
          course TEXT NOT NULL,
          assignment_title TEXT NOT NULL,
          assignment_date TEXT NOT NULL DEFAULT '',
          central_question TEXT NOT NULL,
          source_title TEXT NOT NULL DEFAULT '',
          student_first_name TEXT NOT NULL,
          student_last_name TEXT NOT NULL,
          initial_response TEXT NOT NULL DEFAULT '',
          evidence TEXT NOT NULL DEFAULT '',
          significance TEXT NOT NULL DEFAULT '',
          claim TEXT NOT NULL DEFAULT '',
          complication TEXT NOT NULL DEFAULT '',
          open_question TEXT NOT NULL DEFAULT '',
          messages JSONB NOT NULL DEFAULT '[]'::jsonb,
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS endepth_submissions_assignment_updated_idx
        ON endepth_submissions (assignment_key, updated_at DESC)
      `;
      return sql;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function upsertSubmission(record) {
  const sql = await ensureSubmissionsTable();
  const rows = await sql`
    INSERT INTO endepth_submissions (
      submission_id,
      assignment_key,
      teacher_name,
      course,
      assignment_title,
      assignment_date,
      central_question,
      source_title,
      student_first_name,
      student_last_name,
      initial_response,
      evidence,
      significance,
      claim,
      complication,
      open_question,
      messages,
      submitted_at,
      updated_at
    ) VALUES (
      ${record.submissionId},
      ${record.assignmentKey},
      ${record.assignment.teacherName},
      ${record.assignment.course},
      ${record.assignment.title},
      ${record.assignment.date},
      ${record.assignment.prompt},
      ${record.assignment.sourceTitle},
      ${record.firstName},
      ${record.lastName},
      ${record.initialResponse},
      ${record.evidence},
      ${record.significance},
      ${record.claim},
      ${record.complication},
      ${record.openQuestion},
      ${JSON.stringify(record.messages)}::jsonb,
      NOW(),
      NOW()
    )
    ON CONFLICT (submission_id) DO UPDATE SET
      assignment_key = EXCLUDED.assignment_key,
      teacher_name = EXCLUDED.teacher_name,
      course = EXCLUDED.course,
      assignment_title = EXCLUDED.assignment_title,
      assignment_date = EXCLUDED.assignment_date,
      central_question = EXCLUDED.central_question,
      source_title = EXCLUDED.source_title,
      student_first_name = EXCLUDED.student_first_name,
      student_last_name = EXCLUDED.student_last_name,
      initial_response = EXCLUDED.initial_response,
      evidence = EXCLUDED.evidence,
      significance = EXCLUDED.significance,
      claim = EXCLUDED.claim,
      complication = EXCLUDED.complication,
      open_question = EXCLUDED.open_question,
      messages = EXCLUDED.messages,
      updated_at = NOW()
    RETURNING submission_id, submitted_at, updated_at
  `;
  return rows[0];
}

export async function listSubmissions(limit = 250) {
  const sql = await ensureSubmissionsTable();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 250, 500));
  return sql`
    SELECT
      submission_id,
      assignment_key,
      teacher_name,
      course,
      assignment_title,
      assignment_date,
      central_question,
      source_title,
      student_first_name,
      student_last_name,
      initial_response,
      evidence,
      significance,
      claim,
      complication,
      open_question,
      messages,
      submitted_at,
      updated_at
    FROM endepth_submissions
    ORDER BY updated_at DESC
    LIMIT ${safeLimit}
  `;
}
