import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
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

export function normalizeEmail(value) {
  return cleanString(value, 254).toLowerCase();
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
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

function safeEqual(left, right) {
  const leftHash = createHash("sha256").update(String(left || "")).digest();
  const rightHash = createHash("sha256").update(String(right || "")).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function hashTeacherCode(code, salt) {
  return createHash("sha256")
    .update(`${salt}:${String(code || "")}`)
    .digest("hex");
}

function randomId(prefix) {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function randomPublicSlug() {
  return randomBytes(6).toString("hex");
}

function slugify(value) {
  const slug = cleanString(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || `teacher-${randomBytes(3).toString("hex")}`;
}

export function normalizeAssignment(assignment = {}) {
  return {
    assignmentId: cleanString(assignment.assignmentId, 100),
    publicSlug: cleanString(assignment.publicSlug, 100),
    teacherId: cleanString(assignment.teacherId, 100),
    teacherName: cleanString(assignment.teacherName, 160),
    course: cleanString(assignment.course, 240),
    section: cleanString(assignment.section, 160),
    title: cleanString(assignment.title, 300),
    date: cleanString(assignment.date, 200),
    prompt: cleanString(assignment.prompt, 3000),
    sourceTitle: cleanString(assignment.sourceTitle, 300),
    passage: cleanString(assignment.passage, 8000),
    directions: cleanString(assignment.directions, 3000),
    evidenceRequirement: cleanString(assignment.evidenceRequirement, 3000),
    coachingFocus: cleanString(assignment.coachingFocus, 300) || "Balanced preparation",
    maxCoachQuestions: 4,
    studentLimit: 17,
    status: ["draft", "open", "closed"].includes(assignment.status)
      ? assignment.status
      : "draft",
  };
}

export function stableAssignmentKey(assignment = {}) {
  const normalized = normalizeAssignment(assignment);
  return normalized.assignmentId || JSON.stringify(normalized);
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

function mapTeacher(row) {
  return {
    teacherId: row.teacher_id,
    slug: row.slug,
    displayName: row.display_name,
    email: row.email,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAssignment(row) {
  return {
    assignmentId: row.assignment_id,
    publicSlug: row.public_slug,
    teacherId: row.teacher_id,
    teacherName: row.teacher_display_name || row.teacher_name,
    course: row.course,
    section: row.section,
    title: row.assignment_title,
    date: row.assignment_date,
    prompt: row.central_question,
    sourceTitle: row.source_title,
    passage: row.source_passage,
    directions: row.directions,
    evidenceRequirement: row.evidence_requirement,
    coachingFocus: row.coaching_focus,
    maxCoachQuestions: Number(row.max_coach_questions) || 4,
    studentLimit: Number(row.student_limit) || 17,
    status: row.status,
    submissionCount: Number(row.submission_count) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubmission(row) {
  return {
    submissionId: row.submission_id,
    assignmentId: row.assignment_id,
    teacherId: row.teacher_id,
    assignmentKey: row.assignment_key,
    teacherName: row.teacher_name,
    course: row.course,
    section: row.section || "",
    assignmentTitle: row.assignment_title,
    assignmentDate: row.assignment_date,
    centralQuestion: row.central_question,
    sourceTitle: row.source_title,
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    studentEmail: row.student_email || "",
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

async function seedEnvironmentTeachers(sql) {
  const seeds = [
    {
      slug: "morgan-towle",
      displayName: "Morgan Towle",
      email: "towlem@ensworth.com",
      code: cleanString(process.env.ENDEPTH_TEACHER_CODE, 300),
    },
    {
      slug: "teacher-two",
      displayName:
        cleanString(process.env.ENDEPTH_SECOND_TEACHER_NAME, 160) || "Teacher 2",
      email: cleanString(process.env.ENDEPTH_SECOND_TEACHER_EMAIL, 254),
      code: cleanString(process.env.ENDEPTH_SECOND_TEACHER_CODE, 300),
    },
  ];

  for (const seed of seeds) {
    if (!seed.code) continue;
    const salt = randomBytes(16).toString("hex");
    const codeHash = hashTeacherCode(seed.code, salt);
    await sql`
      INSERT INTO endepth_teachers (
        teacher_id, slug, display_name, email, code_salt, code_hash, active,
        created_at, updated_at
      ) VALUES (
        ${randomId("teacher")}, ${seed.slug}, ${seed.displayName}, ${seed.email},
        ${salt}, ${codeHash}, TRUE, NOW(), NOW()
      )
      ON CONFLICT (slug) DO NOTHING
    `;
  }
}

export async function ensurePilotSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const sql = getSql();

      await sql`
        CREATE TABLE IF NOT EXISTS endepth_teachers (
          teacher_id TEXT PRIMARY KEY,
          slug TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          code_salt TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS endepth_assignments (
          assignment_id TEXT PRIMARY KEY,
          public_slug TEXT UNIQUE NOT NULL,
          teacher_id TEXT NOT NULL,
          teacher_name TEXT NOT NULL,
          course TEXT NOT NULL,
          section TEXT NOT NULL DEFAULT '',
          assignment_title TEXT NOT NULL,
          assignment_date TEXT NOT NULL DEFAULT '',
          central_question TEXT NOT NULL,
          source_title TEXT NOT NULL DEFAULT '',
          source_passage TEXT NOT NULL DEFAULT '',
          directions TEXT NOT NULL DEFAULT '',
          evidence_requirement TEXT NOT NULL DEFAULT '',
          coaching_focus TEXT NOT NULL DEFAULT 'Balanced preparation',
          max_coach_questions INTEGER NOT NULL DEFAULT 4,
          student_limit INTEGER NOT NULL DEFAULT 17,
          status TEXT NOT NULL DEFAULT 'draft',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `;

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

      await sql`ALTER TABLE endepth_submissions ADD COLUMN IF NOT EXISTS assignment_id TEXT`;
      await sql`ALTER TABLE endepth_submissions ADD COLUMN IF NOT EXISTS teacher_id TEXT`;
      await sql`ALTER TABLE endepth_submissions ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE endepth_submissions ADD COLUMN IF NOT EXISTS student_email TEXT NOT NULL DEFAULT ''`;
      await sql`ALTER TABLE endepth_submissions ADD COLUMN IF NOT EXISTS student_key TEXT`;

      await sql`
        CREATE INDEX IF NOT EXISTS endepth_assignments_teacher_updated_idx
        ON endepth_assignments (teacher_id, updated_at DESC)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS endepth_submissions_assignment_updated_idx
        ON endepth_submissions (assignment_id, updated_at DESC)
      `;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS endepth_submissions_student_key_unique_idx
        ON endepth_submissions (student_key)
        WHERE student_key IS NOT NULL
      `;

      await seedEnvironmentTeachers(sql);
      return sql;
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

export async function authenticateStaffCode(rawCode) {
  const code = cleanString(rawCode, 300);
  if (!code) return null;
  const sql = await ensurePilotSchema();

  const adminCode = cleanString(process.env.ENDEPTH_ADMIN_CODE, 300);
  if (adminCode && safeEqual(code, adminCode)) {
    return {
      role: "admin",
      teacherId: null,
      slug: "pilot-admin",
      displayName: "EnDepth Pilot Admin",
      email: "",
    };
  }

  const rows = await sql`
    SELECT teacher_id, slug, display_name, email, code_salt, code_hash, active
    FROM endepth_teachers
    WHERE active = TRUE
    ORDER BY created_at ASC
  `;

  for (const row of rows) {
    const candidate = hashTeacherCode(code, row.code_salt);
    if (safeEqual(candidate, row.code_hash)) {
      return {
        role: "teacher",
        teacherId: row.teacher_id,
        slug: row.slug,
        displayName: row.display_name,
        email: row.email,
      };
    }
  }

  return null;
}

export async function listTeachers() {
  const sql = await ensurePilotSchema();
  const rows = await sql`
    SELECT teacher_id, slug, display_name, email, active, created_at, updated_at
    FROM endepth_teachers
    ORDER BY display_name ASC
  `;
  return rows.map(mapTeacher);
}

export async function saveTeacherAccount(input = {}) {
  const sql = await ensurePilotSchema();
  const teacherId = cleanString(input.teacherId, 100);
  const displayName = cleanString(input.displayName, 160);
  const email = normalizeEmail(input.email);
  const slug = slugify(input.slug || displayName);
  const newCode = cleanString(input.newCode, 300);
  const active = input.active !== false;

  if (!displayName) throw new Error("TEACHER_NAME_REQUIRED");
  if (email && !isValidEmail(email)) throw new Error("TEACHER_EMAIL_INVALID");

  if (!teacherId) {
    if (newCode.length < 8) throw new Error("TEACHER_CODE_REQUIRED");
    const salt = randomBytes(16).toString("hex");
    const codeHash = hashTeacherCode(newCode, salt);
    const rows = await sql`
      INSERT INTO endepth_teachers (
        teacher_id, slug, display_name, email, code_salt, code_hash, active,
        created_at, updated_at
      ) VALUES (
        ${randomId("teacher")}, ${slug}, ${displayName}, ${email},
        ${salt}, ${codeHash}, ${active}, NOW(), NOW()
      )
      RETURNING teacher_id, slug, display_name, email, active, created_at, updated_at
    `;
    return mapTeacher(rows[0]);
  }

  if (newCode) {
    if (newCode.length < 8) throw new Error("TEACHER_CODE_TOO_SHORT");
    const salt = randomBytes(16).toString("hex");
    const codeHash = hashTeacherCode(newCode, salt);
    const rows = await sql`
      UPDATE endepth_teachers
      SET slug = ${slug}, display_name = ${displayName}, email = ${email},
          code_salt = ${salt}, code_hash = ${codeHash}, active = ${active},
          updated_at = NOW()
      WHERE teacher_id = ${teacherId}
      RETURNING teacher_id, slug, display_name, email, active, created_at, updated_at
    `;
    if (!rows[0]) throw new Error("TEACHER_NOT_FOUND");
    return mapTeacher(rows[0]);
  }

  const rows = await sql`
    UPDATE endepth_teachers
    SET slug = ${slug}, display_name = ${displayName}, email = ${email},
        active = ${active}, updated_at = NOW()
    WHERE teacher_id = ${teacherId}
    RETURNING teacher_id, slug, display_name, email, active, created_at, updated_at
  `;
  if (!rows[0]) throw new Error("TEACHER_NOT_FOUND");
  return mapTeacher(rows[0]);
}

export async function listAssignmentsForStaff(staff) {
  const sql = await ensurePilotSchema();
  const rows = staff.role === "admin"
    ? await sql`
        SELECT a.*, t.display_name AS teacher_display_name,
          (SELECT COUNT(*) FROM endepth_submissions s WHERE s.assignment_id = a.assignment_id) AS submission_count
        FROM endepth_assignments a
        JOIN endepth_teachers t ON t.teacher_id = a.teacher_id
        ORDER BY a.updated_at DESC
      `
    : await sql`
        SELECT a.*, t.display_name AS teacher_display_name,
          (SELECT COUNT(*) FROM endepth_submissions s WHERE s.assignment_id = a.assignment_id) AS submission_count
        FROM endepth_assignments a
        JOIN endepth_teachers t ON t.teacher_id = a.teacher_id
        WHERE a.teacher_id = ${staff.teacherId}
        ORDER BY a.updated_at DESC
      `;
  return rows.map(mapAssignment);
}

export async function saveAssignmentForStaff(staff, input = {}) {
  const sql = await ensurePilotSchema();
  const assignment = normalizeAssignment(input);
  const existingId = assignment.assignmentId;
  const teacherId = staff.role === "admin"
    ? cleanString(assignment.teacherId, 100)
    : staff.teacherId;

  if (!teacherId) throw new Error("TEACHER_REQUIRED");
  if (!assignment.course || !assignment.section || !assignment.title || !assignment.prompt) {
    throw new Error("ASSIGNMENT_REQUIRED_FIELDS");
  }
  if (!assignment.sourceTitle || !assignment.passage || !assignment.directions) {
    throw new Error("ASSIGNMENT_SOURCE_REQUIRED");
  }

  const teacherRows = await sql`
    SELECT teacher_id, display_name FROM endepth_teachers
    WHERE teacher_id = ${teacherId} AND active = TRUE
    LIMIT 1
  `;
  if (!teacherRows[0]) throw new Error("TEACHER_NOT_FOUND");
  const teacherName = teacherRows[0].display_name;

  if (existingId) {
    const ownershipRows = await sql`
      SELECT assignment_id, teacher_id, public_slug
      FROM endepth_assignments
      WHERE assignment_id = ${existingId}
      LIMIT 1
    `;
    const existing = ownershipRows[0];
    if (!existing) throw new Error("ASSIGNMENT_NOT_FOUND");
    if (staff.role !== "admin" && existing.teacher_id !== staff.teacherId) {
      throw new Error("FORBIDDEN");
    }

    const rows = await sql`
      UPDATE endepth_assignments
      SET teacher_id = ${teacherId}, teacher_name = ${teacherName},
          course = ${assignment.course}, section = ${assignment.section},
          assignment_title = ${assignment.title}, assignment_date = ${assignment.date},
          central_question = ${assignment.prompt}, source_title = ${assignment.sourceTitle},
          source_passage = ${assignment.passage}, directions = ${assignment.directions},
          evidence_requirement = ${assignment.evidenceRequirement},
          coaching_focus = ${assignment.coachingFocus},
          max_coach_questions = 4, student_limit = 17, status = ${assignment.status},
          updated_at = NOW()
      WHERE assignment_id = ${existingId}
      RETURNING *, ${teacherName}::text AS teacher_display_name
    `;
    return mapAssignment(rows[0]);
  }

  const assignmentId = randomId("assignment");
  const publicSlug = randomPublicSlug();
  const rows = await sql`
    INSERT INTO endepth_assignments (
      assignment_id, public_slug, teacher_id, teacher_name, course, section,
      assignment_title, assignment_date, central_question, source_title,
      source_passage, directions, evidence_requirement, coaching_focus,
      max_coach_questions, student_limit, status, created_at, updated_at
    ) VALUES (
      ${assignmentId}, ${publicSlug}, ${teacherId}, ${teacherName},
      ${assignment.course}, ${assignment.section}, ${assignment.title},
      ${assignment.date}, ${assignment.prompt}, ${assignment.sourceTitle},
      ${assignment.passage}, ${assignment.directions}, ${assignment.evidenceRequirement},
      ${assignment.coachingFocus}, 4, 17, ${assignment.status}, NOW(), NOW()
    )
    RETURNING *, ${teacherName}::text AS teacher_display_name
  `;
  return mapAssignment(rows[0]);
}

export async function getPublicAssignmentBySlug(slug) {
  const sql = await ensurePilotSchema();
  const rows = await sql`
    SELECT a.*, t.display_name AS teacher_display_name,
      (SELECT COUNT(*) FROM endepth_submissions s WHERE s.assignment_id = a.assignment_id) AS submission_count
    FROM endepth_assignments a
    JOIN endepth_teachers t ON t.teacher_id = a.teacher_id
    WHERE a.public_slug = ${cleanString(slug, 100)} AND a.status = 'open'
    LIMIT 1
  `;
  return rows[0] ? mapAssignment(rows[0]) : null;
}

export async function getAssignmentById(assignmentId) {
  const sql = await ensurePilotSchema();
  const rows = await sql`
    SELECT a.*, t.display_name AS teacher_display_name,
      (SELECT COUNT(*) FROM endepth_submissions s WHERE s.assignment_id = a.assignment_id) AS submission_count
    FROM endepth_assignments a
    JOIN endepth_teachers t ON t.teacher_id = a.teacher_id
    WHERE a.assignment_id = ${cleanString(assignmentId, 100)}
    LIMIT 1
  `;
  return rows[0] ? mapAssignment(rows[0]) : null;
}

export async function upsertSubmission(record) {
  const sql = await ensurePilotSchema();
  const assignment = await getAssignmentById(record.assignmentId);
  if (!assignment || assignment.status !== "open") throw new Error("ASSIGNMENT_NOT_OPEN");

  const studentEmail = normalizeEmail(record.studentEmail);
  const studentKey = `${assignment.assignmentId}:${studentEmail}`;
  const existingRows = await sql`
    SELECT submission_id FROM endepth_submissions
    WHERE student_key = ${studentKey}
    LIMIT 1
  `;

  if (!existingRows[0]) {
    const countRows = await sql`
      SELECT COUNT(*)::int AS count
      FROM endepth_submissions
      WHERE assignment_id = ${assignment.assignmentId}
    `;
    if (Number(countRows[0]?.count || 0) >= assignment.studentLimit) {
      throw new Error("ASSIGNMENT_CAPACITY_REACHED");
    }
  }

  const submissionId = existingRows[0]?.submission_id || record.submissionId || randomId("submission");
  const rows = await sql`
    INSERT INTO endepth_submissions (
      submission_id, student_key, assignment_id, assignment_key, teacher_id,
      teacher_name, course, section, assignment_title, assignment_date,
      central_question, source_title, student_first_name, student_last_name,
      student_email, initial_response, evidence, significance, claim,
      complication, open_question, messages, submitted_at, updated_at
    ) VALUES (
      ${submissionId}, ${studentKey}, ${assignment.assignmentId}, ${assignment.assignmentId},
      ${assignment.teacherId}, ${assignment.teacherName}, ${assignment.course},
      ${assignment.section}, ${assignment.title}, ${assignment.date},
      ${assignment.prompt}, ${assignment.sourceTitle}, ${record.firstName},
      ${record.lastName}, ${studentEmail}, ${record.initialResponse},
      ${record.evidence}, ${record.significance}, ${record.claim},
      ${record.complication}, ${record.openQuestion},
      ${JSON.stringify(record.messages)}::jsonb, NOW(), NOW()
    )
    ON CONFLICT (student_key) WHERE student_key IS NOT NULL DO UPDATE SET
      student_first_name = EXCLUDED.student_first_name,
      student_last_name = EXCLUDED.student_last_name,
      student_email = EXCLUDED.student_email,
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

export async function listSubmissionsForStaff(staff, assignmentId = "", limit = 250) {
  const sql = await ensurePilotSchema();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 250, 500));
  const cleanAssignmentId = cleanString(assignmentId, 100);
  let rows;

  if (staff.role === "admin" && cleanAssignmentId) {
    rows = await sql`
      SELECT * FROM endepth_submissions
      WHERE assignment_id = ${cleanAssignmentId}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  } else if (staff.role === "admin") {
    rows = await sql`
      SELECT * FROM endepth_submissions
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  } else if (cleanAssignmentId) {
    rows = await sql`
      SELECT * FROM endepth_submissions
      WHERE teacher_id = ${staff.teacherId} AND assignment_id = ${cleanAssignmentId}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  } else {
    rows = await sql`
      SELECT * FROM endepth_submissions
      WHERE teacher_id = ${staff.teacherId}
      ORDER BY updated_at DESC
      LIMIT ${safeLimit}
    `;
  }

  return rows.map(mapSubmission);
}
