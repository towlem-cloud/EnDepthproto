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
