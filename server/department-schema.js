import { randomBytes } from 'node:crypto';
import { ROSTER, passwordHash, token } from './security.js';

export async function migrateDepartment(sql) {
  await sql`ALTER TABLE endepth_teachers ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'teacher'`;
  await sql`ALTER TABLE endepth_teachers ADD COLUMN IF NOT EXISTS activation_state TEXT NOT NULL DEFAULT 'active'`;
  await sql`UPDATE endepth_teachers SET activation_state='disabled' WHERE active=FALSE AND activation_state='active'`;
  await sql`CREATE TABLE IF NOT EXISTS department_sessions (token_hash TEXT PRIMARY KEY, teacher_id TEXT NOT NULL REFERENCES endepth_teachers(teacher_id), credential_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS department_rate_limits (key TEXT NOT NULL, bucket BIGINT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key,bucket))`;
  // Existing admin environment credential is seeded once. Rotation never restores it.
  if (process.env.ENDEPTH_ADMIN_CODE) {
    const salt = randomBytes(16).toString('hex');
    const hash = await passwordHash(process.env.ENDEPTH_ADMIN_CODE, salt);
    await sql`INSERT INTO endepth_teachers (teacher_id,slug,display_name,email,code_salt,code_hash,active,role)
      VALUES ('department-admin','department-admin','Morgan — Administrator','',${salt},${hash},TRUE,'admin') ON CONFLICT (slug) DO NOTHING`;
  }
  for (const email of ROSTER) {
    // Match by email; no updates to existing IDs, hashes, names or ownership.
    await sql`INSERT INTO endepth_teachers (teacher_id,slug,display_name,email,code_salt,code_hash,active,activation_state)
      SELECT ${'teacher_' + token()}, ${'department-' + email.split('@')[0]}, ${email}, ${email}, '', '', FALSE, 'awaiting activation'
      WHERE NOT EXISTS (SELECT 1 FROM endepth_teachers WHERE lower(trim(email)) = ${email}) ON CONFLICT (slug) DO NOTHING`;
  }
  await sql`ALTER TABLE endepth_assignments ADD COLUMN IF NOT EXISTS sandbox BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`CREATE TABLE IF NOT EXISTS enscribe_assignments (
    assignment_id TEXT PRIMARY KEY, public_slug TEXT UNIQUE NOT NULL, teacher_id TEXT NOT NULL REFERENCES endepth_teachers(teacher_id),
    course TEXT NOT NULL, section TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, instructions TEXT NOT NULL DEFAULT '', rubric TEXT NOT NULL DEFAULT '', timing TEXT NOT NULL DEFAULT '',
    boundaries TEXT NOT NULL DEFAULT 'Moderate' CHECK(boundaries IN ('Permissive','Moderate','Restrictive')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')), sandbox BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS department_students (
    student_id TEXT PRIMARY KEY, module TEXT NOT NULL CHECK(module IN ('enscribe','endepth')), assignment_id TEXT NOT NULL,
    email TEXT NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(module,assignment_id,email))`;
  await sql`CREATE TABLE IF NOT EXISTS enscribe_drafts (
    student_id TEXT PRIMARY KEY REFERENCES department_students(student_id), original TEXT NOT NULL, working TEXT NOT NULL,
    reflection TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', version INTEGER NOT NULL DEFAULT 1,
    revisions JSONB NOT NULL DEFAULT '[]', submitted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS department_coach_requests (
    student_id TEXT NOT NULL REFERENCES department_students(student_id), request_id TEXT NOT NULL, input_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','success','failed')), reply JSONB, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(student_id,request_id))`;
  await sql`CREATE INDEX IF NOT EXISTS enscribe_owner_idx ON enscribe_assignments(teacher_id)`;
  await sql`CREATE OR REPLACE FUNCTION enscribe_preserve_original() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.original IS DISTINCT FROM OLD.original THEN RAISE EXCEPTION 'ORIGINAL_IMMUTABLE'; END IF; RETURN NEW; END; $$`;
  await sql`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='enscribe_original_guard' AND tgrelid='enscribe_drafts'::regclass) THEN
    CREATE TRIGGER enscribe_original_guard BEFORE UPDATE ON enscribe_drafts FOR EACH ROW EXECUTE FUNCTION enscribe_preserve_original(); END IF; END $$`;
}
