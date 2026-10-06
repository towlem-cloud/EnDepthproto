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

CREATE OR REPLACE FUNCTION enscribe_save(p_id TEXT,p_token TEXT,p_version INTEGER,p_draft TEXT,p_explanation TEXT,p_reflection TEXT,p_submit BOOLEAN)
RETURNS SETOF enscribe_students LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; a enscribe_assignments;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id AND token_hash=p_token FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 IF a.status<>'open' THEN RAISE EXCEPTION 'ASSIGNMENT_CLOSED'; END IF;
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
DECLARE s enscribe_students; a enscribe_assignments; c enscribe_checks;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id AND token_hash=p_token FOR UPDATE;
 IF s.id IS NULL THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 SELECT * INTO a FROM enscribe_assignments WHERE id=s.assignment_id FOR SHARE;
 IF a.status<>'open' OR a.boundaries='restrictive' THEN RAISE EXCEPTION 'COACHING_DISABLED'; END IF;
 IF s.submitted_at IS NOT NULL OR s.original IS NULL THEN RAISE EXCEPTION 'DRAFT_NOT_ELIGIBLE'; END IF;
 SELECT * INTO c FROM enscribe_checks WHERE student_id=p_id AND request_id=p_request;
 IF c.request_id IS NOT NULL THEN
  IF c.request_hash<>p_hash THEN RAISE EXCEPTION 'REQUEST_CONFLICT'; END IF;
  IF c.state='complete' THEN RETURN QUERY SELECT 'cached'::text,c.reply; RETURN; END IF;
  IF c.state='pending' THEN RETURN QUERY SELECT 'pending'::text,NULL::text; RETURN; END IF;
 END IF;
 IF s.successful_checks>=4 THEN RETURN QUERY SELECT 'limit'::text,NULL::text; RETURN; END IF;
 IF s.in_flight>0 THEN RETURN QUERY SELECT 'pending'::text,NULL::text; RETURN; END IF;
 UPDATE enscribe_students SET in_flight=1 WHERE id=p_id;
 INSERT INTO enscribe_checks(student_id,request_id,state,request_hash,academic,lease)
 VALUES(p_id,p_request,'pending',p_hash,p_academic,p_lease)
 ON CONFLICT(student_id,request_id) DO UPDATE SET state='pending',lease=p_lease,created_at=NOW();
 RETURN QUERY SELECT 'reserved'::text,NULL::text;
END; $$;

CREATE OR REPLACE FUNCTION enscribe_finish(p_id TEXT,p_request TEXT,p_state TEXT,p_reply TEXT,p_lease TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE s enscribe_students; c enscribe_checks;
BEGIN
 SELECT * INTO s FROM enscribe_students WHERE id=p_id FOR UPDATE;
 SELECT * INTO c FROM enscribe_checks WHERE student_id=p_id AND request_id=p_request FOR UPDATE;
 IF c.state IS DISTINCT FROM 'pending' OR c.lease IS DISTINCT FROM p_lease THEN RETURN FALSE; END IF;
 UPDATE enscribe_checks SET state=p_state,reply=p_reply WHERE student_id=p_id AND request_id=p_request;
 UPDATE enscribe_students SET in_flight=0,successful_checks=successful_checks+CASE WHEN p_state='complete' THEN 1 ELSE 0 END WHERE id=p_id;
 RETURN TRUE;
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
