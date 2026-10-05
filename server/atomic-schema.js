export async function migrateAtomic(sql) {
  await sql`CREATE TABLE IF NOT EXISTS endepth_coach_usage (assignment_id TEXT NOT NULL,student_email TEXT NOT NULL,successful_count INTEGER NOT NULL DEFAULT 0,in_flight_count INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(assignment_id,student_email))`;
  await sql`ALTER TABLE department_coach_requests ADD COLUMN IF NOT EXISTS lease TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE OR REPLACE FUNCTION department_issue_student(m TEXT,a TEXT,e TEXT,f TEXT,l TEXT,h TEXT,new_id TEXT,p_original TEXT)
    RETURNS SETOF department_students LANGUAGE plpgsql AS $$
    DECLARE existing department_students; total INTEGER;
    BEGIN
      IF m='endepth' THEN
        PERFORM 1 FROM endepth_assignments WHERE assignment_id=a FOR UPDATE;
      ELSE PERFORM 1 FROM enscribe_assignments WHERE assignment_id=a FOR UPDATE; END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
      SELECT * INTO existing FROM department_students WHERE module=m AND assignment_id=a AND email=e;
      IF existing.student_id IS NULL AND m='endepth' THEN
        SELECT count(*) INTO total FROM (
          SELECT email FROM department_students WHERE module=m AND assignment_id=a
          UNION SELECT lower(trim(student_email)) FROM endepth_submissions WHERE assignment_id=a
        ) seats;
        IF total >= 17 AND NOT EXISTS(SELECT 1 FROM endepth_submissions WHERE assignment_id=a AND lower(trim(student_email))=e) THEN RAISE EXCEPTION 'ASSIGNMENT_CAPACITY_REACHED'; END IF;
      END IF;
      RETURN QUERY INSERT INTO department_students(student_id,module,assignment_id,email,first_name,last_name,token_hash)
      VALUES(new_id,m,a,e,f,l,h) ON CONFLICT(module,assignment_id,email) DO UPDATE SET token_hash=EXCLUDED.token_hash RETURNING *;
      IF m='enscribe' AND p_original<>'' THEN
        INSERT INTO enscribe_drafts(student_id,original,working)
          SELECT student_id,p_original,p_original FROM department_students WHERE module=m AND assignment_id=a AND email=e
          ON CONFLICT(student_id) DO NOTHING;
        IF NOT FOUND THEN RAISE EXCEPTION 'ORIGINAL_IMMUTABLE'; END IF;
      END IF;
    END; $$`;
  await sql`CREATE OR REPLACE FUNCTION department_reserve_coach(s TEXT,r TEXT,h TEXT,lease_id TEXT,legacy_key TEXT)
    RETURNS TEXT LANGUAGE plpgsql AS $$
    DECLARE actor department_students; old department_coach_requests; used INTEGER; prior INTEGER:=0; allowed BOOLEAN;
    BEGIN
      SELECT * INTO actor FROM department_students WHERE student_id=s FOR UPDATE;
      IF actor.student_id IS NULL THEN RETURN 'denied'; END IF;
      IF actor.module='enscribe' THEN
        SELECT status='open' AND boundaries<>'Restrictive' INTO allowed FROM enscribe_assignments WHERE assignment_id=actor.assignment_id;
        IF NOT EXISTS(SELECT 1 FROM enscribe_drafts WHERE student_id=s AND status='draft') THEN RETURN 'closed'; END IF;
      ELSE
        SELECT status='open' INTO allowed FROM endepth_assignments WHERE assignment_id=actor.assignment_id;
        SELECT COALESCE(successful_count,0)+COALESCE(in_flight_count,0) INTO prior FROM endepth_coach_usage WHERE assignment_id=actor.assignment_id AND student_email=legacy_key;
      END IF;
      IF allowed IS DISTINCT FROM TRUE THEN RETURN 'closed'; END IF;
      SELECT * INTO old FROM department_coach_requests WHERE student_id=s AND request_id=r;
      IF old.request_id IS NOT NULL AND old.input_hash<>h THEN RETURN 'conflict'; END IF;
      IF old.state='success' THEN RETURN 'cached'; END IF;
      IF old.state='pending' AND old.started_at>NOW()-INTERVAL '5 minutes' THEN RETURN 'pending'; END IF;
      UPDATE department_coach_requests SET state='failed' WHERE student_id=s AND state='pending' AND started_at<=NOW()-INTERVAL '5 minutes';
      SELECT count(*) INTO used FROM department_coach_requests WHERE student_id=s AND state IN ('success','pending');
      IF used+COALESCE(prior,0)>=4 THEN RETURN 'limit'; END IF;
      INSERT INTO department_coach_requests(student_id,request_id,input_hash,state,lease) VALUES(s,r,h,'pending',lease_id)
        ON CONFLICT(student_id,request_id) DO UPDATE SET state='pending',started_at=NOW(),lease=lease_id;
      RETURN 'reserved';
    END; $$`;
}
