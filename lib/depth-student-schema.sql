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
