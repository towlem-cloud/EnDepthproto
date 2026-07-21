import { neon } from "@neondatabase/serverless";

let sqlClient = null;
let guardPromise = null;

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

/**
 * Installs a database trigger that serializes new-email admission by locking the
 * assignment row. This prevents two simultaneous seventeenth/eighteenth
 * submissions from both passing a stale application-level count.
 */
export async function ensureAtomicCapacityGuard() {
  if (!guardPromise) {
    guardPromise = (async () => {
      const sql = getSql();
      await sql`
        CREATE OR REPLACE FUNCTION endepth_enforce_submission_capacity()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
          max_students INTEGER;
          current_students INTEGER;
        BEGIN
          IF NEW.assignment_id IS NULL OR NEW.student_key IS NULL THEN
            RETURN NEW;
          END IF;

          SELECT student_limit
          INTO max_students
          FROM endepth_assignments
          WHERE assignment_id = NEW.assignment_id
          FOR UPDATE;

          IF max_students IS NULL THEN
            RAISE EXCEPTION 'ASSIGNMENT_NOT_OPEN' USING ERRCODE = 'P0001';
          END IF;

          -- Re-submissions from an existing email do not consume another seat.
          IF EXISTS (
            SELECT 1
            FROM endepth_submissions
            WHERE student_key = NEW.student_key
          ) THEN
            RETURN NEW;
          END IF;

          SELECT COUNT(*)::INTEGER
          INTO current_students
          FROM endepth_submissions
          WHERE assignment_id = NEW.assignment_id
            AND student_key IS NOT NULL;

          IF current_students >= max_students THEN
            RAISE EXCEPTION 'ASSIGNMENT_CAPACITY_REACHED' USING ERRCODE = 'P0001';
          END IF;

          RETURN NEW;
        END;
        $$
      `;

      await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'endepth_submission_capacity_guard'
              AND NOT tgisinternal
          ) THEN
            CREATE TRIGGER endepth_submission_capacity_guard
            BEFORE INSERT ON endepth_submissions
            FOR EACH ROW
            EXECUTE FUNCTION endepth_enforce_submission_capacity();
          END IF;
        END
        $$
      `;
    })().catch((error) => {
      guardPromise = null;
      throw error;
    });
  }
  return guardPromise;
}
