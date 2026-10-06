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
