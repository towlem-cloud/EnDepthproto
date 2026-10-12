-- Synthetic empty pilot schema for isolated PostgreSQL security tests.

CREATE TABLE endepth_teachers (
  teacher_id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
  code_salt TEXT NOT NULL, code_hash TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE endepth_assignments (
  assignment_id TEXT PRIMARY KEY, public_slug TEXT UNIQUE NOT NULL,
  teacher_id TEXT NOT NULL, teacher_name TEXT NOT NULL, course TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '', assignment_title TEXT NOT NULL,
  assignment_date TEXT NOT NULL DEFAULT '', central_question TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '', source_passage TEXT NOT NULL DEFAULT '',
  directions TEXT NOT NULL DEFAULT '', evidence_requirement TEXT NOT NULL DEFAULT '',
  coaching_focus TEXT NOT NULL DEFAULT 'Balanced preparation',
  max_coach_questions INTEGER NOT NULL DEFAULT 4,
  student_limit INTEGER NOT NULL DEFAULT 17, status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE endepth_submissions (
  submission_id TEXT PRIMARY KEY, assignment_key TEXT NOT NULL,
  teacher_name TEXT NOT NULL, course TEXT NOT NULL, assignment_title TEXT NOT NULL,
  assignment_date TEXT NOT NULL DEFAULT '', central_question TEXT NOT NULL,
  source_title TEXT NOT NULL DEFAULT '', student_first_name TEXT NOT NULL,
  student_last_name TEXT NOT NULL, initial_response TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '', significance TEXT NOT NULL DEFAULT '',
  claim TEXT NOT NULL DEFAULT '', complication TEXT NOT NULL DEFAULT '',
  open_question TEXT NOT NULL DEFAULT '', messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assignment_id TEXT, teacher_id TEXT, section TEXT NOT NULL DEFAULT '',
  student_email TEXT NOT NULL DEFAULT '', student_key TEXT
);
CREATE INDEX endepth_assignments_teacher_updated_idx
  ON endepth_assignments (teacher_id, updated_at DESC);
CREATE INDEX endepth_submissions_assignment_updated_idx
  ON endepth_submissions (assignment_id, updated_at DESC);
CREATE UNIQUE INDEX endepth_submissions_student_key_unique_idx
  ON endepth_submissions (student_key) WHERE student_key IS NOT NULL;
