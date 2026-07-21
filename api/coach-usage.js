import { neon } from "@neondatabase/serverless";

let sqlClient = null;
let schemaPromise = null;

function databaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    ""
  );
}

function getSql() {
  if (!sqlClient) {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
    sqlClient = neon(url);
  }
  return sqlClient;
}

async function ensureCoachUsageSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS endepth_coach_usage (
          assignment_id TEXT NOT NULL,
          student_email TEXT NOT NULL,
          successful_count INTEGER NOT NULL DEFAULT 0,
          in_flight_count INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (assignment_id, student_email)
        )
      `;

      await sql`
        CREATE OR REPLACE FUNCTION endepth_reserve_coach_turn(
          p_assignment_id TEXT,
          p_student_email TEXT
        )
        RETURNS TABLE(reserved BOOLEAN, successful_count INTEGER, limit_count INTEGER)
        LANGUAGE plpgsql
        AS $$
        DECLARE
          max_questions INTEGER;
          current_successful INTEGER;
          current_in_flight INTEGER;
          last_updated TIMESTAMPTZ;
        BEGIN
          SELECT max_coach_questions
          INTO max_questions
          FROM endepth_assignments
          WHERE assignment_id = p_assignment_id AND status = 'open'
          FOR UPDATE;

          IF max_questions IS NULL THEN
            RAISE EXCEPTION 'ASSIGNMENT_NOT_OPEN' USING ERRCODE = 'P0001';
          END IF;

          -- The first pilot is fixed at four even if an older row contains more.
          max_questions := LEAST(max_questions, 4);

          INSERT INTO endepth_coach_usage (
            assignment_id, student_email, successful_count, in_flight_count, updated_at
          ) VALUES (
            p_assignment_id, p_student_email, 0, 0, NOW()
          )
          ON CONFLICT (assignment_id, student_email) DO NOTHING;

          SELECT u.successful_count, u.in_flight_count, u.updated_at
          INTO current_successful, current_in_flight, last_updated
          FROM endepth_coach_usage AS u
          WHERE u.assignment_id = p_assignment_id
            AND u.student_email = p_student_email
          FOR UPDATE;

          -- A crashed request should not permanently consume an in-flight slot.
          IF last_updated < NOW() - INTERVAL '5 minutes' THEN
            current_in_flight := 0;
            UPDATE endepth_coach_usage
            SET in_flight_count = 0, updated_at = NOW()
            WHERE assignment_id = p_assignment_id
              AND student_email = p_student_email;
          END IF;

          IF current_successful + current_in_flight >= max_questions THEN
            RETURN QUERY SELECT FALSE, current_successful, max_questions;
            RETURN;
          END IF;

          UPDATE endepth_coach_usage
          SET in_flight_count = in_flight_count + 1,
              updated_at = NOW()
          WHERE assignment_id = p_assignment_id
            AND student_email = p_student_email;

          RETURN QUERY SELECT TRUE, current_successful, max_questions;
        END;
        $$
      `;
      return sql;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function reserveCoachTurn(assignmentId, studentEmail) {
  const sql = await ensureCoachUsageSchema();
  const rows = await sql`
    SELECT *
    FROM endepth_reserve_coach_turn(${assignmentId}, ${studentEmail})
  `;
  const row = rows[0] || {};
  return {
    reserved: Boolean(row.reserved),
    successfulCount: Number(row.successful_count) || 0,
    limit: Math.min(Number(row.limit_count) || 4, 4),
  };
}

export async function finalizeCoachTurn(assignmentId, studentEmail) {
  const sql = await ensureCoachUsageSchema();
  const rows = await sql`
    UPDATE endepth_coach_usage
    SET in_flight_count = GREATEST(in_flight_count - 1, 0),
        successful_count = LEAST(successful_count + 1, 4),
        updated_at = NOW()
    WHERE assignment_id = ${assignmentId}
      AND student_email = ${studentEmail}
    RETURNING successful_count
  `;
  return Number(rows[0]?.successful_count) || 0;
}

export async function releaseCoachTurn(assignmentId, studentEmail) {
  const sql = await ensureCoachUsageSchema();
  await sql`
    UPDATE endepth_coach_usage
    SET in_flight_count = GREATEST(in_flight_count - 1, 0),
        updated_at = NOW()
    WHERE assignment_id = ${assignmentId}
      AND student_email = ${studentEmail}
  `;
}
