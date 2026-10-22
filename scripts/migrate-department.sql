-- Select the reviewed existing database branch and database in the SQL Editor.
-- Validate on an isolated branch first; database name alone cannot identify a branch.
-- Execute this complete file in one run. It requires the installed pilot schema,
-- applies the reviewed migration once, and commits only if every original row
-- and preexisting column remains unchanged. No account seeding, activation, or
-- credential rotation runs. Results contain counts/preservation booleans only.
-- Temporary snapshots disappear at commit/rollback. On error issue ROLLBACK.

BEGIN;

SET LOCAL lock_timeout = '5s';

SET LOCAL statement_timeout = '60s';

SET LOCAL TIME ZONE 'UTC';

SET LOCAL search_path = public;

CREATE TEMP TABLE department_migration_before (
  table_name TEXT NOT NULL,
  row_data JSONB NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE department_migration_tables (
  table_name TEXT PRIMARY KEY,
  original_columns TEXT[] NOT NULL,
  before_count BIGINT NOT NULL,
  after_count BIGINT,
  preserved BOOLEAN
) ON COMMIT DROP;

DO $department_migration_prepare$
DECLARE
  required RECORD;
  required_column TEXT;
  observed RECORD;
  original_columns TEXT[];
BEGIN
  -- Require the installed pilot schema; never prepare or seed pilot accounts.
  FOR required IN
    SELECT * FROM (VALUES
      ('endepth_teachers', ARRAY[
        'teacher_id','slug','display_name','email','code_salt','code_hash',
        'active','created_at','updated_at'
      ]::TEXT[]),
      ('endepth_assignments', ARRAY[
        'assignment_id','public_slug','teacher_id','teacher_name','course',
        'section','assignment_title','assignment_date','central_question',
        'source_title','source_passage','directions','evidence_requirement',
        'coaching_focus','max_coach_questions','student_limit','status',
        'created_at','updated_at'
      ]::TEXT[]),
      ('endepth_submissions', ARRAY[
        'submission_id','assignment_key','teacher_name','course',
        'assignment_title','assignment_date','central_question','source_title',
        'student_first_name','student_last_name','initial_response','evidence',
        'significance','claim','complication','open_question','messages',
        'submitted_at','updated_at','assignment_id','teacher_id','section',
        'student_email','student_key'
      ]::TEXT[])
    ) AS pilot(table_name, columns)
  LOOP
    IF to_regclass(format('public.%I', required.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required pilot table % is missing; migration not applied.',
        required.table_name;
    END IF;
    FOREACH required_column IN ARRAY required.columns LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = required.table_name
          AND c.column_name = required_column
      ) THEN
        RAISE EXCEPTION 'Required pilot column %.% is missing; migration not applied.',
          required.table_name, required_column;
      END IF;
    END LOOP;
  END LOOP;

  -- Capture every existing public application table, including future tables.
  -- Locks prevent concurrent record changes between capture and comparison.
  FOR observed IN
    SELECT c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',
      observed.table_name);
  END LOOP;

  -- CREATE TABLE IF NOT EXISTS cannot repair an older or malformed quota
  -- table. Preserve its existing counters and reject incompatible columns.
  IF to_regclass('public.endepth_coach_usage') IS NOT NULL THEN
    FOREACH required_column IN ARRAY ARRAY[
      'assignment_id','student_email','successful_count','in_flight_count','updated_at'
    ]::TEXT[] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'endepth_coach_usage'
          AND c.column_name = required_column
      ) THEN
        RAISE EXCEPTION 'Required existing quota column % is missing; migration not applied.',
          required_column;
      END IF;
    END LOOP;
  END IF;

  FOR observed IN
    SELECT c.relname AS table_name
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    SELECT array_agg(c.column_name::TEXT ORDER BY c.ordinal_position)
      INTO original_columns
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = observed.table_name;
    EXECUTE format(
      'INSERT INTO pg_temp.department_migration_before(table_name,row_data)
       SELECT $1,to_jsonb(t) FROM public.%I t', observed.table_name
    ) USING observed.table_name;
    INSERT INTO pg_temp.department_migration_tables(
      table_name, original_columns, before_count
    ) SELECT observed.table_name, original_columns, count(*)
      FROM pg_temp.department_migration_before b
      WHERE b.table_name = observed.table_name;
  END LOOP;
END;
$department_migration_prepare$;

CREATE TABLE IF NOT EXISTS endepth_coach_usage (
 assignment_id TEXT NOT NULL,student_email TEXT NOT NULL,successful_count INTEGER NOT NULL DEFAULT 0,
 in_flight_count INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(assignment_id,student_email)
);

-- Additive only. Run against an isolated database first, then the existing database.
ALTER TABLE endepth_teachers ADD COLUMN IF NOT EXISTS auth_scheme TEXT NOT NULL DEFAULT 'legacy-sha256';

ALTER TABLE endepth_teachers ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE endepth_teachers ADD COLUMN IF NOT EXISTS activation_state TEXT NOT NULL DEFAULT 'active';

UPDATE endepth_teachers SET activation_state='disabled' WHERE active=FALSE AND activation_state='active';

CREATE TABLE IF NOT EXISTS department_admin (
 id INTEGER PRIMARY KEY CHECK (id=1), code_hash TEXT NOT NULL, code_salt TEXT NOT NULL,
 auth_scheme TEXT NOT NULL DEFAULT 'scrypt', credential_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS department_sessions (
 token_hash TEXT PRIMARY KEY, teacher_id TEXT, role TEXT NOT NULL,
 credential_version INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS department_rate_limits (
 bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS enscribe_assignments (
 id TEXT PRIMARY KEY, public_slug TEXT UNIQUE NOT NULL, teacher_id TEXT NOT NULL REFERENCES endepth_teachers(teacher_id),
 title TEXT NOT NULL, course TEXT NOT NULL, section TEXT NOT NULL, prompt TEXT NOT NULL,
 instructions TEXT NOT NULL DEFAULT '', rubric TEXT NOT NULL DEFAULT '', timing TEXT NOT NULL DEFAULT '',
 boundaries TEXT NOT NULL DEFAULT 'moderate' CHECK(boundaries IN ('permissive','moderate','restrictive')),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')),
 sandbox BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enscribe_students (
 id TEXT PRIMARY KEY, assignment_id TEXT NOT NULL REFERENCES enscribe_assignments(id),
 token_hash TEXT UNIQUE NOT NULL, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
 original TEXT, working TEXT NOT NULL DEFAULT '', reflection TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 0, submitted_at TIMESTAMPTZ,
 successful_checks INTEGER NOT NULL DEFAULT 0 CHECK(successful_checks BETWEEN 0 AND 4),
 in_flight INTEGER NOT NULL DEFAULT 0 CHECK(in_flight BETWEEN 0 AND 1)
);

CREATE TABLE IF NOT EXISTS enscribe_sessions (
 token_hash TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES enscribe_students(id),
 credential_hash TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS enscribe_sessions_student ON enscribe_sessions(student_id);

ALTER TABLE enscribe_sessions ADD COLUMN IF NOT EXISTS teacher_version INTEGER;

CREATE TABLE IF NOT EXISTS enscribe_revisions (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES enscribe_students(id),
 version INTEGER NOT NULL, draft TEXT NOT NULL, explanation TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(student_id,version)
);

CREATE TABLE IF NOT EXISTS enscribe_checks (
 student_id TEXT NOT NULL REFERENCES enscribe_students(id), request_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','complete','failed','withheld')),
 request_hash TEXT NOT NULL, academic JSONB NOT NULL, reply TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(student_id,request_id)
);

CREATE OR REPLACE FUNCTION enscribe_protect_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.original IS NOT NULL AND NEW.original IS DISTINCT FROM OLD.original THEN
  RAISE EXCEPTION 'ORIGINAL_IMMUTABLE';
 END IF;
 RETURN NEW;
END; $$;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='enscribe_original_immutable' AND NOT tgisinternal) THEN
  CREATE TRIGGER enscribe_original_immutable BEFORE UPDATE ON enscribe_students
  FOR EACH ROW EXECUTE FUNCTION enscribe_protect_original();
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS enscribe_assignments_owner ON enscribe_assignments(teacher_id);

CREATE INDEX IF NOT EXISTS enscribe_students_assignment ON enscribe_students(assignment_id);

ALTER TABLE enscribe_checks ADD COLUMN IF NOT EXISTS lease TEXT NOT NULL DEFAULT '';

ALTER TABLE enscribe_checks ADD COLUMN IF NOT EXISTS credential_hash TEXT;

ALTER TABLE enscribe_checks ADD COLUMN IF NOT EXISTS teacher_version INTEGER;

ALTER TABLE enscribe_checks ADD COLUMN IF NOT EXISTS session_hash TEXT;

CREATE OR REPLACE FUNCTION enscribe_save(p_id TEXT,p_token TEXT,p_version INTEGER,p_draft TEXT,p_explanation TEXT,p_reflection TEXT,p_submit BOOLEAN)
RETURNS SETOF enscribe_students LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; a enscribe_assignments;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id AND token_hash=p_token FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 IF a.status<>'open' THEN RAISE EXCEPTION 'ASSIGNMENT_CLOSED'; END IF;
 PERFORM 1 FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF s.submitted_at IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;
 IF s.in_flight<>0 THEN RAISE EXCEPTION 'CHECK_IN_PROGRESS'; END IF;
 IF s.version<>p_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF s.original IS NOT NULL AND s.working<>p_draft AND length(trim(p_explanation))=0 THEN RAISE EXCEPTION 'EXPLANATION_REQUIRED'; END IF;
 IF p_submit AND length(trim(p_reflection))=0 THEN RAISE EXCEPTION 'REFLECTION_REQUIRED'; END IF;
 UPDATE enscribe_students SET original=COALESCE(original,p_draft),working=p_draft,reflection=p_reflection,
 version=version+1,submitted_at=CASE WHEN p_submit THEN NOW() ELSE NULL END WHERE id=p_id;
 INSERT INTO enscribe_revisions(id,student_id,version,draft,explanation)
 VALUES(p_id||':'||(s.version+1),p_id,s.version+1,p_draft,p_explanation);
 RETURN QUERY SELECT * FROM enscribe_students WHERE id=p_id;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_reserve(p_id TEXT,p_token TEXT,p_request TEXT,p_hash TEXT,p_academic JSONB,p_lease TEXT)
RETURNS TABLE(result TEXT,cached TEXT) LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; a enscribe_assignments; c enscribe_checks; owner_version INTEGER;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id AND token_hash=p_token FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 IF a.status<>'open' OR a.boundaries='restrictive' THEN RAISE EXCEPTION 'COACHING_DISABLED'; END IF;
 SELECT credential_version INTO owner_version FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 IF s.submitted_at IS NOT NULL OR s.original IS NULL THEN RAISE EXCEPTION 'DRAFT_NOT_ELIGIBLE'; END IF;
 SELECT * INTO c FROM enscribe_checks WHERE student_id=p_id AND request_id=p_request;
 IF c.request_id IS NOT NULL THEN
  IF c.request_hash<>p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF c.state='complete' THEN RETURN QUERY SELECT 'cached'::text,c.reply; RETURN; END IF;
  IF c.state='pending' THEN RETURN QUERY SELECT 'pending'::text,NULL::text; RETURN; END IF;
 END IF;
 IF p_academic ? 'draft' AND (p_academic->>'draft') IS DISTINCT FROM s.working THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 IF s.successful_checks>=4 THEN RETURN QUERY SELECT 'limit'::text,NULL::text; RETURN; END IF;
 IF s.in_flight>0 THEN RETURN QUERY SELECT 'pending'::text,NULL::text; RETURN; END IF;
 UPDATE enscribe_students SET in_flight=1 WHERE id=p_id;
 INSERT INTO enscribe_checks(student_id,request_id,state,request_hash,academic,lease,credential_hash,teacher_version,session_hash)
 VALUES(p_id,p_request,'pending',p_hash,p_academic,p_lease,p_token,owner_version,NULL)
 ON CONFLICT(student_id,request_id) DO UPDATE SET state='pending',lease=p_lease,credential_hash=p_token,teacher_version=owner_version,session_hash=NULL,created_at=NOW();
 RETURN QUERY SELECT 'reserved'::text,NULL::text;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_finish(p_id TEXT,p_request TEXT,p_state TEXT,p_reply TEXT,p_lease TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; c enscribe_checks; a enscribe_assignments; eligible BOOLEAN; owner_version INTEGER;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id FOR UPDATE;
 SELECT * INTO c FROM enscribe_checks WHERE student_id=p_id AND request_id=p_request FOR UPDATE;
 IF c.state IS DISTINCT FROM 'pending' OR c.lease IS DISTINCT FROM p_lease THEN RETURN FALSE; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 SELECT credential_version INTO owner_version FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE FOR SHARE;
 eligible := FOUND AND a.status='open' AND a.boundaries<>'restrictive' AND s.submitted_at IS NULL
   AND c.credential_hash IS NOT DISTINCT FROM s.token_hash AND c.teacher_version IS NOT DISTINCT FROM owner_version AND s.successful_checks<4;
 IF eligible AND c.session_hash IS NOT NULL THEN
  PERFORM 1 FROM enscribe_sessions WHERE token_hash=c.session_hash AND student_id=p_id
    AND credential_hash=s.token_hash AND teacher_version=owner_version AND expires_at>NOW() FOR SHARE;
  eligible := FOUND;
 END IF;
 IF p_state='complete' AND (NOT eligible OR p_reply IS NULL OR length(trim(p_reply))=0) THEN
  UPDATE enscribe_checks SET state='failed',reply=NULL WHERE student_id=p_id AND request_id=p_request;
  UPDATE enscribe_students SET in_flight=0 WHERE id=p_id;
  RETURN FALSE;
 END IF;
 UPDATE enscribe_checks SET state=p_state,reply=p_reply WHERE student_id=p_id AND request_id=p_request;
 UPDATE enscribe_students SET in_flight=0,successful_checks=successful_checks+CASE WHEN p_state='complete' THEN 1 ELSE 0 END WHERE id=p_id;
 RETURN TRUE;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_assert_session(p_id TEXT,p_token TEXT,p_session TEXT,p_teacher_version INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; a enscribe_assignments;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id AND token_hash=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 PERFORM 1 FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE AND credential_version=p_teacher_version FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM 1 FROM enscribe_sessions WHERE token_hash=p_session AND student_id=p_id AND credential_hash=p_token
   AND teacher_version=p_teacher_version AND expires_at>NOW() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_save_checked(p_id TEXT,p_token TEXT,p_version INTEGER,p_draft TEXT,p_explanation TEXT,p_reflection TEXT,p_submit BOOLEAN,p_session TEXT,p_teacher_version INTEGER)
RETURNS SETOF enscribe_students LANGUAGE plpgsql AS $$
BEGIN
 PERFORM enscribe_assert_session(p_id,p_token,p_session,p_teacher_version);
 RETURN QUERY SELECT * FROM enscribe_save(p_id,p_token,p_version,p_draft,p_explanation,p_reflection,p_submit);
END; $$;

CREATE OR REPLACE FUNCTION enscribe_reserve_checked(p_id TEXT,p_token TEXT,p_request TEXT,p_hash TEXT,p_academic JSONB,p_lease TEXT,p_session TEXT,p_teacher_version INTEGER)
RETURNS TABLE(result TEXT,cached TEXT) LANGUAGE plpgsql AS $$
DECLARE reserved RECORD;
BEGIN
 PERFORM enscribe_assert_session(p_id,p_token,p_session,p_teacher_version);
 SELECT * INTO reserved FROM enscribe_reserve(p_id,p_token,p_request,p_hash,p_academic,p_lease);
 IF reserved.result='reserved' THEN
  UPDATE enscribe_checks SET session_hash=p_session,teacher_version=p_teacher_version WHERE student_id=p_id AND request_id=p_request AND lease=p_lease;
 END IF;
 RETURN QUERY SELECT reserved.result,reserved.cached;
END; $$;

ALTER TABLE endepth_assignments ADD COLUMN IF NOT EXISTS sandbox BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS endepth_coach_requests (
 assignment_id TEXT NOT NULL, usage_key TEXT NOT NULL, request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL, lease TEXT NOT NULL, state TEXT NOT NULL,
 reply JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(assignment_id,usage_key,request_id)
);

CREATE OR REPLACE FUNCTION department_depth_reserve(p_assignment TEXT,p_key TEXT,p_request TEXT,p_hash TEXT,p_lease TEXT)
RETURNS TABLE(result TEXT,cached JSONB,successful INTEGER) LANGUAGE plpgsql AS $$
DECLARE a endepth_assignments; u endepth_coach_usage; c endepth_coach_requests;
BEGIN
 SELECT * INTO a FROM endepth_assignments WHERE assignment_id=p_assignment FOR UPDATE;
 IF a.assignment_id IS NULL OR a.status<>'open' THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_OPEN'; END IF;
 INSERT INTO endepth_coach_usage(assignment_id,student_email) VALUES(p_assignment,p_key) ON CONFLICT DO NOTHING;
 SELECT * INTO u FROM endepth_coach_usage WHERE assignment_id=p_assignment AND student_email=p_key FOR UPDATE;
 SELECT * INTO c FROM endepth_coach_requests WHERE assignment_id=p_assignment AND usage_key=p_key AND request_id=p_request;
 IF c.request_id IS NOT NULL THEN
  IF c.request_hash<>p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF c.state='complete' THEN RETURN QUERY SELECT 'cached'::TEXT,c.reply,u.successful_count; RETURN; END IF;
  IF c.state='pending' THEN RETURN QUERY SELECT 'pending'::TEXT,NULL::JSONB,u.successful_count; RETURN; END IF;
 END IF;
 IF u.successful_count+u.in_flight_count>=4 THEN RETURN QUERY SELECT 'limit'::TEXT,NULL::JSONB,u.successful_count; RETURN; END IF;
 UPDATE endepth_coach_usage SET in_flight_count=in_flight_count+1,updated_at=NOW() WHERE assignment_id=p_assignment AND student_email=p_key;
 INSERT INTO endepth_coach_requests(assignment_id,usage_key,request_id,request_hash,lease,state)
 VALUES(p_assignment,p_key,p_request,p_hash,p_lease,'pending')
 ON CONFLICT(assignment_id,usage_key,request_id) DO UPDATE SET lease=p_lease,state='pending',created_at=NOW();
 RETURN QUERY SELECT 'reserved'::TEXT,NULL::JSONB,u.successful_count;
END; $$;

CREATE OR REPLACE FUNCTION department_depth_finish(p_assignment TEXT,p_key TEXT,p_request TEXT,p_lease TEXT,p_reply JSONB)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE u endepth_coach_usage; c endepth_coach_requests; n INTEGER;
BEGIN
 SELECT * INTO u FROM endepth_coach_usage WHERE assignment_id=p_assignment AND student_email=p_key FOR UPDATE;
 SELECT * INTO c FROM endepth_coach_requests WHERE assignment_id=p_assignment AND usage_key=p_key AND request_id=p_request FOR UPDATE;
 IF c.state IS DISTINCT FROM 'pending' OR c.lease IS DISTINCT FROM p_lease THEN RETURN u.successful_count; END IF;
 n:=u.successful_count+CASE WHEN p_reply IS NULL THEN 0 ELSE 1 END;
 UPDATE endepth_coach_usage SET successful_count=n,in_flight_count=GREATEST(in_flight_count-1,0),updated_at=NOW() WHERE assignment_id=p_assignment AND student_email=p_key;
 UPDATE endepth_coach_requests SET state=CASE WHEN p_reply IS NULL THEN 'failed' ELSE 'complete' END,
 reply=CASE WHEN p_reply IS NULL THEN NULL ELSE p_reply||jsonb_build_object('usage',jsonb_build_object('successfulQuestions',n,'limit',4)) END
 WHERE assignment_id=p_assignment AND usage_key=p_key AND request_id=p_request;
 RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_cancel_stalled(p_student TEXT,p_assignment TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; n INTEGER;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_student AND assignment_id=p_assignment FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 UPDATE enscribe_checks SET state='failed' WHERE student_id=p_student AND state='pending' AND created_at<NOW()-INTERVAL '5 minutes';
 GET DIAGNOSTICS n = ROW_COUNT;
 IF n>0 THEN UPDATE enscribe_students SET in_flight=0 WHERE id=p_student; END IF;
 RETURN n>0;
END; $$;

CREATE TABLE IF NOT EXISTS department_schema_version(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);

INSERT INTO department_schema_version(id,version) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET version=1;

-- Additive individual EnDepth student access. Existing assignments, submissions and ownership remain intact.
CREATE TABLE IF NOT EXISTS endepth_student_access (
  student_id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES endepth_assignments(assignment_id),
  first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL,
  code_salt TEXT NOT NULL, code_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1, active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(assignment_id,email)
);

CREATE TABLE IF NOT EXISTS endepth_student_sessions (
  token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES endepth_student_access(student_id),
  credential_version INTEGER NOT NULL, teacher_id TEXT NOT NULL DEFAULT '',
  teacher_version INTEGER NOT NULL DEFAULT 1, expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE endepth_student_sessions ADD COLUMN IF NOT EXISTS teacher_id TEXT NOT NULL DEFAULT '';

ALTER TABLE endepth_student_sessions ADD COLUMN IF NOT EXISTS teacher_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS endepth_student_sessions_student ON endepth_student_sessions(student_id);

CREATE OR REPLACE FUNCTION department_depth_submit(
  p_student TEXT,p_epoch INTEGER,p_session TEXT,p_initial TEXT,p_evidence TEXT,p_significance TEXT,
  p_claim TEXT,p_complication TEXT,p_question TEXT,p_messages JSONB
) RETURNS TABLE(submission_id TEXT,submitted_at TIMESTAMPTZ,updated_at TIMESTAMPTZ)
LANGUAGE plpgsql AS $$
DECLARE s endepth_student_access; a endepth_assignments; teacher_active BOOLEAN; owner_version INTEGER;
BEGIN
  SELECT * INTO s FROM endepth_student_access WHERE student_id=p_student;
  IF s.student_id IS NULL THEN RAISE EXCEPTION 'STUDENT_ACCESS_CHANGED'; END IF;
  -- Match the invitation and quota lock order: assignment before student.
  SELECT * INTO a FROM endepth_assignments WHERE assignment_id=s.assignment_id FOR UPDATE;
  SELECT (t.active AND t.activation_state='active'),t.credential_version INTO teacher_active,owner_version
    FROM endepth_teachers t WHERE t.teacher_id=a.teacher_id FOR SHARE;
  SELECT * INTO s FROM endepth_student_access WHERE student_id=p_student FOR UPDATE;
  IF s.student_id IS NULL OR NOT s.active OR s.credential_version<>p_epoch OR NOT EXISTS (
    SELECT 1 FROM endepth_student_sessions x WHERE x.token_hash=p_session
      AND x.student_id=s.student_id AND x.credential_version=s.credential_version AND x.expires_at>NOW()
      AND x.teacher_id=a.teacher_id AND x.teacher_version=owner_version
  ) THEN RAISE EXCEPTION 'STUDENT_ACCESS_CHANGED'; END IF;
  IF a.assignment_id IS NULL OR a.status<>'open' OR a.sandbox THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_OPEN'; END IF;
  IF teacher_active IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'STUDENT_ACCESS_CHANGED'; END IF;
  -- Current canonical identity determines the key. Existing IDs and original submitted_at are preserved on an update.
  RETURN QUERY INSERT INTO endepth_submissions AS existing (
    submission_id,student_key,assignment_id,assignment_key,teacher_id,teacher_name,
    course,section,assignment_title,assignment_date,central_question,source_title,
    student_first_name,student_last_name,student_email,initial_response,evidence,
    significance,claim,complication,open_question,messages,submitted_at,updated_at
  ) VALUES (
    'submission_'||md5(s.student_id),a.assignment_id||':'||s.email,a.assignment_id,a.assignment_id,
    a.teacher_id,a.teacher_name,a.course,a.section,a.assignment_title,a.assignment_date,
    a.central_question,a.source_title,s.first_name,s.last_name,s.email,p_initial,p_evidence,
    p_significance,p_claim,p_complication,p_question,p_messages,NOW(),NOW()
  ) ON CONFLICT (student_key) WHERE student_key IS NOT NULL DO UPDATE SET
    student_first_name=EXCLUDED.student_first_name,student_last_name=EXCLUDED.student_last_name,
    student_email=EXCLUDED.student_email,initial_response=EXCLUDED.initial_response,evidence=EXCLUDED.evidence,
    significance=EXCLUDED.significance,claim=EXCLUDED.claim,complication=EXCLUDED.complication,
    open_question=EXCLUDED.open_question,messages=EXCLUDED.messages,updated_at=NOW()
  RETURNING existing.submission_id,existing.submitted_at,existing.updated_at;
END; $$;

CREATE OR REPLACE FUNCTION department_depth_invite(
  p_assignment TEXT,p_role TEXT,p_teacher TEXT,p_id TEXT,p_first TEXT,p_last TEXT,
  p_email TEXT,p_salt TEXT,p_hash TEXT
) RETURNS TABLE(student_id TEXT,credential_version INTEGER) LANGUAGE plpgsql AS $$
DECLARE a endepth_assignments; teacher_active BOOLEAN; owner_version INTEGER; admitted INTEGER;
BEGIN
  SELECT * INTO a FROM endepth_assignments WHERE assignment_id=p_assignment FOR UPDATE;
  IF a.assignment_id IS NULL OR a.sandbox OR (p_role<>'admin' AND a.teacher_id<>p_teacher)
    THEN RAISE EXCEPTION 'STUDENT_ACCESS_DENIED'; END IF;
  SELECT (t.active AND t.activation_state='active'),t.credential_version INTO teacher_active,owner_version
    FROM endepth_teachers t WHERE t.teacher_id=a.teacher_id FOR SHARE;
  IF teacher_active IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'STUDENT_ACCESS_DENIED'; END IF;
  -- Existing real submissions retain their slots and can receive credentials without being recreated.
  IF NOT EXISTS (SELECT 1 FROM endepth_student_access d WHERE d.assignment_id=p_assignment AND d.email=p_email)
    AND NOT EXISTS (SELECT 1 FROM endepth_submissions r WHERE r.assignment_id=p_assignment AND LOWER(TRIM(r.student_email))=p_email)
  THEN
    SELECT COUNT(*) INTO admitted FROM (
      SELECT d.email FROM endepth_student_access d WHERE d.assignment_id=p_assignment
      UNION SELECT LOWER(TRIM(r.student_email)) FROM endepth_submissions r
        WHERE r.assignment_id=p_assignment AND TRIM(r.student_email)<>''
    ) roster;
    IF admitted>=17 THEN RAISE EXCEPTION 'ASSIGNMENT_CAPACITY_REACHED'; END IF;
  END IF;
  RETURN QUERY INSERT INTO endepth_student_access AS existing (
    student_id,assignment_id,first_name,last_name,email,code_salt,code_hash
  ) VALUES (p_id,p_assignment,p_first,p_last,p_email,p_salt,p_hash)
  ON CONFLICT (assignment_id,email) DO UPDATE SET
    first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,code_salt=EXCLUDED.code_salt,
    code_hash=EXCLUDED.code_hash,credential_version=existing.credential_version+1,active=TRUE
  RETURNING existing.student_id,existing.credential_version;
END; $$;

CREATE OR REPLACE FUNCTION department_depth_finish_checked(
  p_assignment TEXT,p_key TEXT,p_request TEXT,p_lease TEXT,p_reply JSONB,
  p_student TEXT,p_epoch INTEGER,p_session TEXT
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE a endepth_assignments; s endepth_student_access; teacher_active BOOLEAN; owner_version INTEGER;
BEGIN
  SELECT * INTO a FROM endepth_assignments WHERE assignment_id=p_assignment FOR UPDATE;
  SELECT * INTO s FROM endepth_student_access WHERE student_id=p_student FOR SHARE;
  SELECT (t.active AND t.activation_state='active'),t.credential_version INTO teacher_active,owner_version
    FROM endepth_teachers t WHERE t.teacher_id=a.teacher_id FOR SHARE;
  IF a.assignment_id IS NULL OR a.status<>'open' OR a.sandbox
    OR teacher_active IS DISTINCT FROM TRUE OR s.student_id IS NULL
    OR NOT s.active OR s.assignment_id<>p_assignment OR s.credential_version<>p_epoch
    OR NOT EXISTS (SELECT 1 FROM endepth_student_sessions x WHERE x.token_hash=p_session
      AND x.student_id=s.student_id AND x.credential_version=s.credential_version AND x.expires_at>NOW()
      AND x.teacher_id=a.teacher_id AND x.teacher_version=owner_version)
  THEN
    -- A sentinel lets the failed lease release commit before the API rejects stale feedback.
    PERFORM department_depth_finish(p_assignment,p_key,p_request,p_lease,NULL);
    RETURN -1;
  END IF;
  RETURN department_depth_finish(p_assignment,p_key,p_request,p_lease,p_reply);
END; $$;

CREATE OR REPLACE FUNCTION department_depth_reserve_checked(
  p_assignment TEXT,p_key TEXT,p_request TEXT,p_hash TEXT,p_lease TEXT,
  p_student TEXT,p_epoch INTEGER,p_session TEXT
) RETURNS TABLE(result TEXT,cached JSONB,successful INTEGER) LANGUAGE plpgsql AS $$
DECLARE a endepth_assignments; s endepth_student_access; teacher_active BOOLEAN; owner_version INTEGER;
BEGIN
  SELECT * INTO a FROM endepth_assignments WHERE assignment_id=p_assignment FOR UPDATE;
  SELECT * INTO s FROM endepth_student_access WHERE student_id=p_student FOR SHARE;
  SELECT (t.active AND t.activation_state='active'),t.credential_version INTO teacher_active,owner_version
    FROM endepth_teachers t WHERE t.teacher_id=a.teacher_id FOR SHARE;
  IF a.assignment_id IS NULL OR a.status<>'open' OR a.sandbox
    OR teacher_active IS DISTINCT FROM TRUE OR s.student_id IS NULL
    OR NOT s.active OR s.assignment_id<>p_assignment OR s.credential_version<>p_epoch
    OR NOT EXISTS (SELECT 1 FROM endepth_student_sessions x WHERE x.token_hash=p_session
      AND x.student_id=s.student_id AND x.credential_version=s.credential_version AND x.expires_at>NOW()
      AND x.teacher_id=a.teacher_id AND x.teacher_version=owner_version)
    THEN RAISE EXCEPTION 'STUDENT_ACCESS_CHANGED'; END IF;
  RETURN QUERY SELECT * FROM department_depth_reserve(p_assignment,p_key,p_request,p_hash,p_lease);
END; $$;

CREATE OR REPLACE FUNCTION department_depth_sandbox_allowed(p_assignment TEXT,p_staff_session TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE a endepth_assignments; teacher_valid BOOLEAN;
BEGIN
  SELECT * INTO a FROM endepth_assignments WHERE assignment_id=p_assignment FOR UPDATE;
  IF a.assignment_id IS NULL OR NOT a.sandbox OR a.status<>'open' THEN RETURN FALSE; END IF;
  SELECT (t.active AND t.activation_state='active' AND t.credential_version=x.credential_version)
    INTO teacher_valid FROM department_sessions x JOIN endepth_teachers t ON t.teacher_id=x.teacher_id
    WHERE x.token_hash=p_staff_session AND x.expires_at>NOW() AND x.role='teacher'
      AND t.teacher_id=a.teacher_id FOR SHARE OF t;
  RETURN teacher_valid IS TRUE;
END; $$;

CREATE OR REPLACE FUNCTION department_depth_reserve_sandbox(
  p_assignment TEXT,p_key TEXT,p_request TEXT,p_hash TEXT,p_lease TEXT,p_staff_session TEXT
) RETURNS TABLE(result TEXT,cached JSONB,successful INTEGER) LANGUAGE plpgsql AS $$
BEGIN
  IF NOT department_depth_sandbox_allowed(p_assignment,p_staff_session) THEN RAISE EXCEPTION 'STUDENT_ACCESS_CHANGED'; END IF;
  RETURN QUERY SELECT * FROM department_depth_reserve(p_assignment,p_key,p_request,p_hash,p_lease);
END; $$;

CREATE OR REPLACE FUNCTION department_depth_finish_sandbox(
  p_assignment TEXT,p_key TEXT,p_request TEXT,p_lease TEXT,p_reply JSONB,p_staff_session TEXT
) RETURNS INTEGER LANGUAGE plpgsql AS $$
BEGIN
  IF NOT department_depth_sandbox_allowed(p_assignment,p_staff_session) THEN
    PERFORM department_depth_finish(p_assignment,p_key,p_request,p_lease,NULL);
    RETURN -1;
  END IF;
  RETURN department_depth_finish(p_assignment,p_key,p_request,p_lease,p_reply);
END; $$;

-- BEGIN OPTIONAL SCHOOL GOOGLE ACCESS
-- Optional school Google access is disabled until an administrator configures
-- exact school domains and a Google web client, and an owner enables a class.
ALTER TABLE enscribe_assignments ADD COLUMN IF NOT EXISTS school_google_access BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE enscribe_students ADD COLUMN IF NOT EXISTS google_subject TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS enscribe_students_google_subject
 ON enscribe_students(assignment_id,google_subject) WHERE google_subject IS NOT NULL;

ALTER TABLE enscribe_sessions ADD COLUMN IF NOT EXISTS google_config_version INTEGER;

CREATE TABLE IF NOT EXISTS department_school_google_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),enabled BOOLEAN NOT NULL DEFAULT FALSE,
 client_id TEXT NOT NULL DEFAULT '',allowed_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 config_version INTEGER NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO department_school_google_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS enscribe_school_google_nonces (
 nonce_hash TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,
 assignment_id TEXT NOT NULL REFERENCES enscribe_assignments(id),config_version INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS enscribe_school_google_nonce_expiry ON enscribe_school_google_nonces(expires_at);

CREATE OR REPLACE FUNCTION enscribe_school_google_start(p_nonce TEXT,p_binding TEXT,p_slug TEXT)
RETURNS TABLE(enabled BOOLEAN,client_id TEXT,allowed_domains TEXT[],config_version INTEGER,assignment_id TEXT)
LANGUAGE plpgsql AS $$
DECLARE cfg department_school_google_settings; a enscribe_assignments;
BEGIN
 SELECT * INTO cfg FROM department_school_google_settings WHERE id=1 FOR SHARE;
 IF NOT FOUND OR NOT cfg.enabled OR cfg.client_id='' OR cardinality(cfg.allowed_domains)=0 THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_DISABLED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE public_slug=p_slug FOR SHARE;
 IF NOT FOUND OR NOT a.school_google_access OR a.status<>'open' OR a.sandbox THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 PERFORM 1 FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE AND activation_state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 INSERT INTO enscribe_school_google_nonces(nonce_hash,binding_hash,assignment_id,config_version,expires_at)
 VALUES(p_nonce,p_binding,a.id,cfg.config_version,NOW()+INTERVAL '5 minutes');
 RETURN QUERY SELECT cfg.enabled,cfg.client_id,cfg.allowed_domains,cfg.config_version,a.id;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_school_google_admit(
 p_nonce TEXT,p_binding TEXT,p_slug TEXT,p_config INTEGER,p_subject TEXT,p_email TEXT,
 p_first TEXT,p_last TEXT,p_session TEXT,p_credential TEXT,p_student TEXT
) RETURNS TABLE(student_id TEXT) LANGUAGE plpgsql AS $$
DECLARE cfg department_school_google_settings; a enscribe_assignments; n enscribe_school_google_nonces;
 s enscribe_students; email_matches INTEGER; owner_version INTEGER; normalized_email TEXT;
BEGIN
 -- Serializes identity matching without excluding existing draft saves, which
 -- take a shared assignment lock after locking their own student row.
 PERFORM pg_advisory_xact_lock(hashtext('enscribe-school-google:'||p_slug));
 SELECT * INTO cfg FROM department_school_google_settings WHERE id=1 FOR SHARE;
 IF NOT FOUND OR NOT cfg.enabled OR cfg.config_version<>p_config THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_CONFIGURATION_CHANGED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE public_slug=p_slug FOR SHARE;
 IF NOT FOUND OR NOT a.school_google_access OR a.status<>'open' OR a.sandbox THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 SELECT credential_version INTO owner_version FROM endepth_teachers
  WHERE teacher_id=a.teacher_id AND active=TRUE AND activation_state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 SELECT * INTO n FROM enscribe_school_google_nonces WHERE nonce_hash=p_nonce FOR UPDATE;
 IF NOT FOUND OR n.binding_hash<>p_binding OR n.assignment_id<>a.id OR n.config_version<>cfg.config_version
   OR n.expires_at<=NOW() OR n.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_NONCE_REJECTED'; END IF;
 normalized_email:=lower(trim(p_email));
 IF normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   OR split_part(normalized_email,'@',2)<>ALL(cfg.allowed_domains) THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_DOMAIN_REJECTED'; END IF;
 IF length(p_subject)<1 OR length(p_subject)>255 OR length(p_first)>160 OR length(p_last)>160 THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_PROFILE_REQUIRED'; END IF;
 SELECT COUNT(*) INTO email_matches FROM enscribe_students WHERE assignment_id=a.id AND lower(trim(email))=normalized_email;
 IF email_matches>1 THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_IDENTITY_CONFLICT'; END IF;
 SELECT * INTO s FROM enscribe_students WHERE assignment_id=a.id AND google_subject=p_subject FOR UPDATE;
 IF FOUND THEN
  IF lower(trim(s.email))<>normalized_email OR email_matches<>1 THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_IDENTITY_CONFLICT'; END IF;
 ELSE
  SELECT * INTO s FROM enscribe_students WHERE assignment_id=a.id AND lower(trim(email))=normalized_email FOR UPDATE;
  IF FOUND THEN
   IF s.google_subject IS NOT NULL THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_IDENTITY_CONFLICT'; END IF;
   -- The owner's explicit assignment opt-in authorizes matching this verified
   -- email. No existing identity, original, working draft or credential changes.
   UPDATE enscribe_students SET google_subject=p_subject WHERE id=s.id;
  ELSE
   INSERT INTO enscribe_students(id,assignment_id,token_hash,first_name,last_name,email,google_subject)
   VALUES(p_student,a.id,p_credential,p_first,p_last,normalized_email,p_subject) RETURNING * INTO s;
  END IF;
 END IF;
 INSERT INTO enscribe_sessions(token_hash,student_id,credential_hash,teacher_version,google_config_version,expires_at)
 VALUES(p_session,s.id,s.token_hash,owner_version,cfg.config_version,NOW()+INTERVAL '8 hours');
 UPDATE enscribe_school_google_nonces SET consumed_at=NOW() WHERE nonce_hash=p_nonce;
 RETURN QUERY SELECT s.id;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_school_google_configure(p_role TEXT,p_enabled BOOLEAN,p_client TEXT,p_domains TEXT[])
RETURNS SETOF department_school_google_settings LANGUAGE plpgsql AS $$
BEGIN
 IF p_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ADMIN_REQUIRED'; END IF;
 PERFORM 1 FROM department_school_google_settings WHERE id=1 FOR UPDATE;
 UPDATE department_school_google_settings SET enabled=p_enabled,client_id=p_client,allowed_domains=p_domains,
  config_version=config_version+1,updated_at=NOW() WHERE id=1;
 -- Private invitation sessions have a NULL marker and retain their credentials.
 DELETE FROM enscribe_sessions WHERE google_config_version IS NOT NULL;
 RETURN QUERY SELECT * FROM department_school_google_settings WHERE id=1;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_school_google_assignment(p_role TEXT,p_teacher TEXT,p_assignment TEXT,p_enabled BOOLEAN)
RETURNS SETOF enscribe_assignments LANGUAGE plpgsql AS $$
DECLARE a enscribe_assignments;
BEGIN
 SELECT * INTO a FROM enscribe_assignments WHERE id=p_assignment FOR UPDATE;
 IF NOT FOUND OR (p_role IS DISTINCT FROM 'admin' AND (p_role IS DISTINCT FROM 'teacher' OR a.teacher_id IS DISTINCT FROM p_teacher)) THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ACCESS_DENIED'; END IF;
 IF a.sandbox THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 PERFORM 1 FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE AND activation_state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 UPDATE enscribe_assignments SET school_google_access=p_enabled,updated_at=NOW() WHERE id=a.id;
 IF NOT p_enabled THEN
  DELETE FROM enscribe_sessions x USING enscribe_students s WHERE x.student_id=s.id AND s.assignment_id=a.id AND x.google_config_version IS NOT NULL;
 END IF;
 RETURN QUERY SELECT * FROM enscribe_assignments WHERE id=a.id;
END; $$;

-- Re-check optional Google policy on reads and inside existing locked writes.
-- Legacy private sessions have a NULL marker and continue to work unchanged.
CREATE OR REPLACE FUNCTION enscribe_google_session_allowed(p_session TEXT,p_assignment TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE session_version INTEGER; cfg department_school_google_settings; a enscribe_assignments;
BEGIN
 SELECT google_config_version INTO session_version FROM enscribe_sessions WHERE token_hash=p_session;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF session_version IS NULL THEN RETURN TRUE; END IF;
 SELECT * INTO cfg FROM department_school_google_settings WHERE id=1 FOR SHARE;
 IF NOT FOUND OR NOT cfg.enabled OR cfg.config_version<>session_version THEN RETURN FALSE; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=p_assignment FOR SHARE;
 RETURN FOUND AND a.school_google_access AND a.status='open' AND NOT a.sandbox;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_assert_session(p_id TEXT,p_token TEXT,p_session TEXT,p_teacher_version INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; a enscribe_assignments;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id AND token_hash=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 PERFORM 1 FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE AND credential_version=p_teacher_version FOR SHARE;
 IF NOT FOUND OR NOT enscribe_google_session_allowed(p_session,a.id) THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 PERFORM 1 FROM enscribe_sessions WHERE token_hash=p_session AND student_id=p_id AND credential_hash=p_token
   AND teacher_version=p_teacher_version AND expires_at>NOW() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_finish(p_id TEXT,p_request TEXT,p_state TEXT,p_reply TEXT,p_lease TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; c enscribe_checks; a enscribe_assignments; eligible BOOLEAN; owner_version INTEGER;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id FOR UPDATE;
 SELECT * INTO c FROM enscribe_checks WHERE student_id=p_id AND request_id=p_request FOR UPDATE;
 IF c.state IS DISTINCT FROM 'pending' OR c.lease IS DISTINCT FROM p_lease THEN RETURN FALSE; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 SELECT credential_version INTO owner_version FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE FOR SHARE;
 eligible := FOUND AND a.status='open' AND a.boundaries<>'restrictive' AND s.submitted_at IS NULL
   AND c.credential_hash IS NOT DISTINCT FROM s.token_hash AND c.teacher_version IS NOT DISTINCT FROM owner_version AND s.successful_checks<4;
 IF eligible AND c.session_hash IS NOT NULL THEN
  eligible:=enscribe_google_session_allowed(c.session_hash,a.id);
  IF eligible THEN
   PERFORM 1 FROM enscribe_sessions WHERE token_hash=c.session_hash AND student_id=p_id
    AND credential_hash=s.token_hash AND teacher_version=owner_version AND expires_at>NOW() FOR SHARE;
   eligible:=FOUND;
  END IF;
 END IF;
 IF p_state='complete' AND (NOT eligible OR p_reply IS NULL OR length(trim(p_reply))=0) THEN
  UPDATE enscribe_checks SET state='failed',reply=NULL WHERE student_id=p_id AND request_id=p_request;
  UPDATE enscribe_students SET in_flight=0 WHERE id=p_id;
  RETURN FALSE;
 END IF;
 UPDATE enscribe_checks SET state=p_state,reply=p_reply WHERE student_id=p_id AND request_id=p_request;
 UPDATE enscribe_students SET in_flight=0,successful_checks=successful_checks+CASE WHEN p_state='complete' THEN 1 ELSE 0 END WHERE id=p_id;
 RETURN TRUE;
END; $$;

-- Imports and Google enrollment share a transaction-level assignment gate.
-- Each SELECT runs after acquiring it, so a waiting call sees the prior commit.
CREATE OR REPLACE FUNCTION enscribe_school_google_invite(
 p_role TEXT,p_teacher TEXT,p_assignment TEXT,p_student TEXT,p_credential TEXT,
 p_first TEXT,p_last TEXT,p_email TEXT,p_original TEXT,p_revision TEXT
) RETURNS TABLE(student_id TEXT) LANGUAGE plpgsql AS $$
DECLARE a enscribe_assignments;
BEGIN
 SELECT * INTO a FROM enscribe_assignments WHERE id=p_assignment;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ACCESS_DENIED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('enscribe-school-google:'||a.public_slug));
 SELECT * INTO a FROM enscribe_assignments WHERE id=p_assignment FOR SHARE;
 IF NOT FOUND OR (p_role IS DISTINCT FROM 'admin' AND (p_role IS DISTINCT FROM 'teacher' OR a.teacher_id IS DISTINCT FROM p_teacher))
 THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ACCESS_DENIED'; END IF;
 PERFORM 1 FROM endepth_teachers WHERE teacher_id=a.teacher_id AND active=TRUE AND activation_state='active' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE'; END IF;
 IF a.school_google_access AND EXISTS(SELECT 1 FROM enscribe_students WHERE assignment_id=a.id AND lower(trim(email))=lower(trim(p_email)))
 THEN RAISE EXCEPTION 'SCHOOL_GOOGLE_IDENTITY_CONFLICT'; END IF;
 INSERT INTO enscribe_students(id,assignment_id,token_hash,first_name,last_name,email,original,working)
 VALUES(p_student,a.id,p_credential,p_first,p_last,p_email,p_original,COALESCE(p_original,''));
 IF p_original IS NOT NULL THEN
  INSERT INTO enscribe_revisions(id,student_id,version,draft,explanation)
  VALUES(p_revision,p_student,0,p_original,'Independent original imported by teacher; not AI generated.');
 END IF;
 RETURN QUERY SELECT p_student;
END; $$;

-- END OPTIONAL SCHOOL GOOGLE ACCESS

DO $department_migration_verify$
DECLARE
  observed RECORD;
  current_count BIGINT;
  preserved BOOLEAN;
BEGIN
  FOR observed IN
    SELECT * FROM pg_temp.department_migration_tables ORDER BY table_name
  LOOP
    IF to_regclass(format('public.%I', observed.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Existing application table % was removed; transaction aborted.',
        observed.table_name;
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(observed.original_columns) AS original(column_name)
      WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = observed.table_name
          AND c.column_name = original.column_name
      )
    ) THEN
      RAISE EXCEPTION 'Existing application column in % was removed; transaction aborted.',
        observed.table_name;
    END IF;
    EXECUTE format($department_migration_comparison$
      WITH current_rows AS MATERIALIZED (
        SELECT (
          SELECT jsonb_object_agg(j.key,j.value)
          FROM jsonb_each(to_jsonb(t)) j
          WHERE j.key = ANY($1)
        ) AS row_data FROM public.%I t
      ), before_rows AS MATERIALIZED (
        SELECT row_data FROM pg_temp.department_migration_before
        WHERE table_name = $2
      ), differences AS (
        (SELECT row_data FROM current_rows
         EXCEPT ALL SELECT row_data FROM before_rows)
        UNION ALL
        (SELECT row_data FROM before_rows
         EXCEPT ALL SELECT row_data FROM current_rows)
      )
      SELECT (SELECT count(*) FROM current_rows),
             NOT EXISTS (SELECT 1 FROM differences)
    $department_migration_comparison$, observed.table_name)
      INTO current_count, preserved
      USING observed.original_columns, observed.table_name;
    IF NOT preserved OR current_count <> observed.before_count THEN
      RAISE EXCEPTION 'Migration did not preserve existing rows in %; transaction aborted.',
        observed.table_name;
    END IF;
    UPDATE pg_temp.department_migration_tables
    SET after_count = current_count, preserved = TRUE
    WHERE table_name = observed.table_name;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM public.department_schema_version WHERE id = 1 AND version = 1
  ) THEN
    RAISE EXCEPTION 'Department schema marker missing; transaction aborted.';
  END IF;
END;
$department_migration_verify$;

SELECT table_name, before_count, after_count, preserved,
       (SELECT version FROM public.department_schema_version WHERE id = 1)
         AS schema_version
FROM pg_temp.department_migration_tables
ORDER BY table_name;

COMMIT;
