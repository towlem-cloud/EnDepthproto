import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

let sqlClient = null;

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

function legacyIdentity(assignmentKey) {
  const digest = createHash("sha256")
    .update(String(assignmentKey || "legacy-assignment"))
    .digest("hex");
  return {
    assignmentId: `legacy_${digest.slice(0, 24)}`,
    publicSlug: `legacy-${digest.slice(0, 12)}`,
  };
}

/**
 * Makes submissions created before the multi-teacher schema visible to Morgan.
 * The migration is deliberately idempotent and preserves the original submitted
 * work. Imported assignments remain closed and are labeled as legacy records.
 */
export async function backfillLegacySubmissionOwnership() {
  const sql = getSql();
  const morganRows = await sql`
    SELECT teacher_id, display_name
    FROM endepth_teachers
    WHERE slug = 'morgan-towle' AND active = TRUE
    LIMIT 1
  `;
  const morgan = morganRows[0];
  if (!morgan) return { assignments: 0, submissions: 0 };

  // First repair rows already attached to a database-backed assignment.
  const repairedRows = await sql`
    UPDATE endepth_submissions AS s
    SET teacher_id = a.teacher_id,
        teacher_name = a.teacher_name,
        section = CASE
          WHEN COALESCE(s.section, '') = '' THEN a.section
          ELSE s.section
        END
    FROM endepth_assignments AS a
    WHERE s.assignment_id = a.assignment_id
      AND (s.teacher_id IS NULL OR COALESCE(s.teacher_name, '') = '')
    RETURNING s.submission_id
  `;

  const groups = await sql`
    SELECT
      assignment_key,
      MAX(teacher_name) AS teacher_name,
      MAX(course) AS course,
      MAX(assignment_title) AS assignment_title,
      MAX(assignment_date) AS assignment_date,
      MAX(central_question) AS central_question,
      MAX(source_title) AS source_title,
      MAX(section) AS section
    FROM endepth_submissions
    WHERE assignment_id IS NULL OR teacher_id IS NULL
    GROUP BY assignment_key
  `;

  let importedAssignments = 0;
  let importedSubmissions = repairedRows.length;

  for (const group of groups) {
    const { assignmentId, publicSlug } = legacyIdentity(group.assignment_key);
    const course = group.course || "EnDepth Legacy Pilot";
    const section = group.section || "Legacy pilot";
    const title = group.assignment_title || "Imported EnDepth preparation";
    const centralQuestion = group.central_question || "Imported pilot assignment";
    const sourceTitle = group.source_title || "Earlier EnDepth pilot material";
    const assignmentDate = group.assignment_date || "Imported pilot record";

    const inserted = await sql`
      INSERT INTO endepth_assignments (
        assignment_id, public_slug, teacher_id, teacher_name, course, section,
        assignment_title, assignment_date, central_question, source_title,
        source_passage, directions, evidence_requirement, coaching_focus,
        max_coach_questions, student_limit, status, created_at, updated_at
      ) VALUES (
        ${assignmentId}, ${publicSlug}, ${morgan.teacher_id}, ${morgan.display_name},
        ${course}, ${section}, ${title}, ${assignmentDate}, ${centralQuestion},
        ${sourceTitle}, '', 'Imported from the earlier EnDepth classroom pilot.',
        '', 'Balanced preparation', 4, 17, 'closed', NOW(), NOW()
      )
      ON CONFLICT (assignment_id) DO NOTHING
      RETURNING assignment_id
    `;
    importedAssignments += inserted.length;

    const updated = await sql`
      UPDATE endepth_submissions
      SET assignment_id = ${assignmentId},
          teacher_id = ${morgan.teacher_id},
          teacher_name = ${morgan.display_name},
          section = CASE
            WHEN COALESCE(section, '') = '' THEN ${section}
            ELSE section
          END
      WHERE assignment_key = ${group.assignment_key}
        AND (assignment_id IS NULL OR teacher_id IS NULL)
      RETURNING submission_id
    `;
    importedSubmissions += updated.length;
  }

  return {
    assignments: importedAssignments,
    submissions: importedSubmissions,
  };
}

/**
 * Refreshes display metadata only for records whose verified owner already
 * matches the current assignment. Caller-supplied ownership is never authority.
 */
export async function syncAssignmentSubmissionOwnership(
  assignmentId,
  _teacherId,
  _teacherName
) {
  if (!assignmentId) return 0;
  const sql = getSql();
  const rows = await sql`
    WITH current_assignment AS (
      SELECT assignment_id, teacher_id, teacher_name
      FROM endepth_assignments
      WHERE assignment_id = ${assignmentId} AND status = 'open'
      FOR UPDATE
    )
    UPDATE endepth_submissions s
    SET teacher_name = a.teacher_name
    FROM current_assignment a
    WHERE s.assignment_id = a.assignment_id AND s.teacher_id = a.teacher_id
      AND s.teacher_name IS DISTINCT FROM a.teacher_name
    RETURNING s.submission_id
  `;
  return rows.length;
}
