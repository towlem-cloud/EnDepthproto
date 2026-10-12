import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

// The real queries execute against an isolated database containing only fictional records.
const db = new PGlite();
let afterOwnershipRead;
async function sql(strings, ...values) {
  const statement = strings.reduce((result, part, index) => result + part + (index < values.length ? `$${index + 1}` : ''), '');
  const rows = (await db.query(statement, values)).rows;
  if (afterOwnershipRead && /SELECT\s+assignment_id,\s*teacher_id,\s*public_slug/.test(statement)) {
    const callback = afterOwnershipRead;
    afterOwnershipRead = null;
    await callback();
  }
  return rows;
}
sql.query = async (statement, values = []) => (await db.query(statement, values)).rows;
mock.module('@neondatabase/serverless', { exports: { neon: () => sql } });

test('EnDepth ordinary edits and delayed metadata sync cannot change ownership or disclose stale-owner records', async t => {
  const keys = ['DATABASE_URL', 'ENDEPTH_TEACHER_CODE', 'ENDEPTH_SECOND_TEACHER_CODE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_URL = 'postgres://synthetic-ownership.test/never-production';
  process.env.ENDEPTH_TEACHER_CODE = '';
  process.env.ENDEPTH_SECOND_TEACHER_CODE = '';
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.close();
  });
  const { ensurePilotSchema, saveAssignmentForStaff, listSubmissionsForStaff, upsertSubmission } = await import('../lib/endepth-db.js');
  const { syncAssignmentSubmissionOwnership } = await import('../lib/ownership-maintenance.js');
  await ensurePilotSchema();
  for (const label of ['a', 'b']) {
    await sql`INSERT INTO endepth_teachers(teacher_id,slug,display_name,email,code_salt,code_hash)
      VALUES(${`synthetic-teacher-${label}`},${`synthetic-${label}`},${`Synthetic Teacher ${label.toUpperCase()}`},${`${label}@example.invalid`},'synthetic-salt','synthetic-unused-hash')`;
  }
  const teacherA = { role: 'teacher', teacherId: 'synthetic-teacher-a' };
  const teacherB = { role: 'teacher', teacherId: 'synthetic-teacher-b' };
  const admin = { role: 'admin' };
  const assignmentInput = title => ({
    title, course: 'Fictional Course', section: 'TEST ONLY', prompt: 'Explain a fictional choice.',
    sourceTitle: 'Fictional excerpt', passage: 'The fictional traveler chooses a path.',
    directions: 'Use your own reasoning.', status: 'open',
  });

  await t.test('neither teacher nor administrator can transfer an existing assignment through ordinary save', async () => {
    const assignment = await saveAssignmentForStaff(teacherA, assignmentInput('Synthetic immutable owner'));
    const saved = await saveAssignmentForStaff(admin, { ...assignment, title: 'Synthetic admin metadata edit' });
    assert.equal(saved.teacherId, teacherA.teacherId);
    assert.equal(saved.publicSlug, assignment.publicSlug);
    for (const actor of [teacherA, admin]) {
      await assert.rejects(saveAssignmentForStaff(actor, { ...saved, teacherId: teacherB.teacherId }), /FORBIDDEN/);
    }
    const [unchanged] = await sql`SELECT teacher_id,public_slug FROM endepth_assignments WHERE assignment_id=${assignment.assignmentId}`;
    assert.equal(unchanged.teacher_id, teacherA.teacherId);
    assert.equal(unchanged.public_slug, assignment.publicSlug);
  });

  await t.test('an ownership change after the authorization read prevents a delayed teacher or administrator edit', async () => {
    for (const actor of [teacherA, admin]) {
      const assignment = await saveAssignmentForStaff(teacherA, assignmentInput('Synthetic race assignment'));
      // A privileged database change represents an external administrative ownership operation.
      afterOwnershipRead = async () => {
        await sql`UPDATE endepth_assignments SET teacher_id=${teacherB.teacherId},teacher_name='Synthetic Teacher B'
          WHERE assignment_id=${assignment.assignmentId}`;
      };
      await assert.rejects(saveAssignmentForStaff(actor, { ...assignment, title: 'Stale edit must fail' }), /FORBIDDEN/);
      const [current] = await sql`SELECT teacher_id,assignment_title FROM endepth_assignments WHERE assignment_id=${assignment.assignmentId}`;
      assert.equal(current.teacher_id, teacherB.teacherId);
      assert.equal(current.assignment_title, assignment.title);
    }
  });

  await t.test('a delayed sync cannot reassign current records and stale denormalized owners cannot list writing', async () => {
    const assignment = await saveAssignmentForStaff(teacherA, assignmentInput('Synthetic sync race'));
    const work = email => ({
      assignmentId: assignment.assignmentId, firstName: 'Fictional', lastName: 'Learner', studentEmail: email,
      initialResponse: 'Private fictional thinking.', evidence: 'Fictional detail.', significance: '',
      claim: '', complication: '', openQuestion: '', messages: [],
    });
    await upsertSubmission(work('current-owner@example.invalid'));
    await upsertSubmission(work('stale-owner@example.invalid'));
    await sql`UPDATE endepth_assignments SET teacher_id=${teacherB.teacherId},teacher_name='Synthetic Teacher B'
      WHERE assignment_id=${assignment.assignmentId}`;
    await sql`UPDATE endepth_submissions SET teacher_id=${teacherB.teacherId},teacher_name='Historical B display label'
      WHERE assignment_id=${assignment.assignmentId} AND student_email='current-owner@example.invalid'`;
    const before = await sql`SELECT submission_id,teacher_id,initial_response,submitted_at FROM endepth_submissions
      WHERE assignment_id=${assignment.assignmentId} ORDER BY submission_id`;
    assert.equal(await syncAssignmentSubmissionOwnership(assignment.assignmentId, teacherA.teacherId, 'Stale caller display name'), 1);
    assert.deepEqual(await sql`SELECT submission_id,teacher_id,initial_response,submitted_at FROM endepth_submissions
      WHERE assignment_id=${assignment.assignmentId} ORDER BY submission_id`, before);
    const rows = await sql`SELECT student_email,teacher_name FROM endepth_submissions WHERE assignment_id=${assignment.assignmentId}`;
    assert.equal(rows.find(row => row.student_email === 'current-owner@example.invalid').teacher_name, 'Synthetic Teacher B');
    assert.equal(rows.find(row => row.student_email === 'stale-owner@example.invalid').teacher_name, 'Synthetic Teacher A');
    for (const filter of ['', assignment.assignmentId]) {
      assert.deepEqual(await listSubmissionsForStaff(teacherA, filter), []);
      const visibleB = await listSubmissionsForStaff(teacherB, filter);
      assert.equal(visibleB.length, 1);
      assert.equal(visibleB[0].studentEmail, 'current-owner@example.invalid');
    }
    assert.equal((await listSubmissionsForStaff(admin, assignment.assignmentId)).length, 2);
  });

  await t.test('metadata sync leaves unmatched, unowned and closed records intact', async () => {
    const assignment = await saveAssignmentForStaff(teacherB, assignmentInput('Synthetic preserved records'));
    for (const fixture of [
      { id: 'synthetic-unowned', assignment: assignment.assignmentId, teacher: null },
      { id: 'synthetic-unmatched', assignment: null, teacher: teacherA.teacherId },
    ]) {
      await sql`INSERT INTO endepth_submissions(submission_id,assignment_id,assignment_key,teacher_id,teacher_name,
        course,assignment_title,central_question,student_first_name,student_last_name,initial_response)
        VALUES(${fixture.id},${fixture.assignment},'synthetic-legacy-key',${fixture.teacher},'Preserved historical label',
          'Fictional Course','Fictional assignment','Fictional question','Fictional','Learner','Preserved fictional writing.')`;
    }
    const before = await sql`SELECT to_jsonb(s) AS record FROM endepth_submissions s
      WHERE submission_id IN ('synthetic-unowned','synthetic-unmatched') ORDER BY submission_id`;
    assert.equal(await syncAssignmentSubmissionOwnership(assignment.assignmentId, teacherA.teacherId, 'Untrusted caller name'), 0);
    await saveAssignmentForStaff(teacherB, { ...assignment, status: 'closed' });
    assert.equal(await syncAssignmentSubmissionOwnership(assignment.assignmentId, teacherB.teacherId, 'Untrusted caller name'), 0);
    assert.deepEqual(await sql`SELECT to_jsonb(s) AS record FROM endepth_submissions s
      WHERE submission_id IN ('synthetic-unowned','synthetic-unmatched') ORDER BY submission_id`, before);
    assert.deepEqual(await listSubmissionsForStaff(teacherB, assignment.assignmentId), []);
    const adminRecords = await listSubmissionsForStaff(admin);
    assert.ok(adminRecords.some(record => record.submissionId === 'synthetic-unowned'));
    assert.ok(adminRecords.some(record => record.submissionId === 'synthetic-unmatched'));
  });
});
