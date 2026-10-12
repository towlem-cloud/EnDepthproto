import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// Execute the real handlers and SQL against an isolated PostgreSQL database.
// No production connection or real student record is used by this regression.
const db = new PGlite();
function sql(strings, ...values) {
  const query = strings.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
  return db.query(query, values).then(result => result.rows);
}
sql.query = async (query, values = []) => (await db.query(query, values)).rows;
mock.module('@neondatabase/serverless', { exports: { neon: () => sql } });

const origin = 'https://submission-preservation.test';
function request(path, body, cookie = '') {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json', cookie, 'x-vercel-forwarded-for': '203.0.113.45' },
    body: JSON.stringify(body),
  });
}

test('authenticated submission reads preserve legacy ownership, records, assignment IDs and URLs', async t => {
  const environment = {
    DATABASE_URL: 'postgres://isolated-preservation.test/never-production',
    ENDEPTH_TEACHER_CODE: 'synthetic-preservation-morgan-credential',
    ENDEPTH_SECOND_TEACHER_CODE: 'synthetic-preservation-second-credential',
    ENDEPTH_SECOND_TEACHER_EMAIL: 'synthetic-second@example.invalid',
    ENDEPTH_ADMIN_CODE: 'synthetic-preservation-admin-credential',
  };
  const beforeEnvironment = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(async () => {
    for (const [key, value] of Object.entries(beforeEnvironment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.close();
  });

  const { ensurePilotSchema, saveAssignmentForStaff } = await import('../lib/endepth-db.js');
  await ensurePilotSchema();
  const { default: schema } = await import('../lib/department-schema.js');
  await db.exec(schema);
  const security = await import('../lib/department-security.js');
  const endpoint = (await import('../api/submissions-list.js')).default;
  const morgan = await security.login(request('/api/staff-auth', {}), environment.ENDEPTH_TEACHER_CODE, '', sql);
  const second = await security.login(request('/api/staff-auth', {}), environment.ENDEPTH_SECOND_TEACHER_CODE, '', sql);
  const administrator = await security.login(request('/api/staff-auth', {}), environment.ENDEPTH_ADMIN_CODE, '', sql);
  const assignmentInput = title => ({
    title, course: 'Synthetic Course', section: 'Synthetic Section', prompt: 'Interpret a fictional choice.',
    sourceTitle: 'Fictional excerpt', passage: 'The fictional traveler chooses a path.',
    directions: 'Use your own reasoning.', status: 'open',
  });
  const morganAssignment = await saveAssignmentForStaff(morgan.staff, assignmentInput('Synthetic Morgan assignment'));
  const secondAssignment = await saveAssignmentForStaff(second.staff, assignmentInput('Synthetic second assignment'));

  for (const fixture of [
    { id: 'synthetic-owned-morgan', key: morganAssignment.assignmentId, assignment: morganAssignment.assignmentId, teacher: morgan.staff.teacherId, label: 'Synthetic Morgan owner' },
    { id: 'synthetic-owned-second', key: secondAssignment.assignmentId, assignment: secondAssignment.assignmentId, teacher: second.staff.teacherId, label: 'Synthetic second owner' },
    // Previously, listing submissions silently attached this row to Morgan's assignment.
    { id: 'synthetic-legacy-attached', key: morganAssignment.assignmentId, assignment: morganAssignment.assignmentId, teacher: null, label: 'Preserved original legacy label' },
    // Previously, a read created a new closed legacy assignment and assigned it to Morgan.
    { id: 'synthetic-legacy-unattached', key: 'synthetic-original-legacy-link', assignment: null, teacher: null, label: 'Untouched original legacy label' },
  ]) {
    await sql`INSERT INTO endepth_submissions (
      submission_id,assignment_key,assignment_id,teacher_id,teacher_name,course,assignment_title,central_question,
      student_first_name,student_last_name,student_email,section,initial_response,evidence,messages,submitted_at,updated_at
    ) VALUES (
      ${fixture.id},${fixture.key},${fixture.assignment},${fixture.teacher},${fixture.label},'Synthetic Course','Synthetic legacy preparation','Synthetic question?',
      'Synthetic','Learner',${`${fixture.id}@example.invalid`},'','Preserved independent synthetic thinking.','Preserved fictional detail.',
      '[{"role":"student","text":"Preserved synthetic academic conversation."}]'::jsonb,'2025-01-01Z','2025-01-02Z'
    )`;
  }

  const snapshot = async () => ({
    assignments: await sql`SELECT to_jsonb(a) AS row FROM endepth_assignments a ORDER BY assignment_id`,
    submissions: await sql`SELECT to_jsonb(s) AS row FROM endepth_submissions s ORDER BY submission_id`,
  });
  const preserved = await snapshot();

  for (const [name, actor, expected] of [
    ['Morgan', morgan, ['synthetic-owned-morgan']],
    ['second teacher', second, ['synthetic-owned-second']],
    ['administrator', administrator, ['synthetic-legacy-attached', 'synthetic-legacy-unattached', 'synthetic-owned-morgan', 'synthetic-owned-second']],
  ]) {
    await t.test(`${name} reads without inferring or changing legacy owners`, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await endpoint.fetch(request('/api/submissions-list', {}, actor.cookie.split(';')[0]));
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(payload.submissions.map(row => row.submissionId).sort(), expected);
        assert.deepEqual(await snapshot(), preserved, 'a staff list operation must not backfill, create assignments, or rewrite any existing field');
      }
    });
  }
});
