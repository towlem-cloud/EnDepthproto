import { randomBytes } from 'node:crypto';
import { getSql } from './db.js';
import { cleanString, normalizeEmail, isValidEmail, getAssignmentById } from './submissions-db.js';
import { token, digest, fail, rateLimit } from './security.js';
const id = prefix => prefix + '_' + randomBytes(16).toString('hex');
export async function assignmentFor(module, assignmentId) {
  if (module === 'endepth') {
    const a = await getAssignmentById(assignmentId);
    return a && {...a,assignment_id:a.assignmentId,teacher_id:a.teacherId};
  }
  if (module !== 'enscribe') fail(400,'Unknown module.');
  return (await getSql()`SELECT * FROM enscribe_assignments WHERE assignment_id=${assignmentId}`)[0];
}
export async function ownedAssignment(staff,module,assignmentId) {
  const a = await assignmentFor(module,assignmentId);
  if (!a || (staff.role !== 'admin' && a.teacher_id !== staff.teacherId)) fail(404,'Assignment not found.');
  return a;
}
export async function listWriting(staff) {
  return getSql()`SELECT * FROM enscribe_assignments WHERE (${staff.role === 'admin'} OR teacher_id=${staff.teacherId}) ORDER BY updated_at DESC`;
}
export async function saveWriting(staff,input,duplicate=false,sandbox=false) {
  const sql = getSql();
  let existing;
  if (input.assignment_id) existing = await ownedAssignment(staff,'enscribe',input.assignment_id);
  const owner = existing && !duplicate ? existing.teacher_id : staff.teacherId;
  const values = Object.fromEntries(['course','section','title','prompt','instructions','rubric','timing'].map(k=>[k,cleanString(input[k],k==='rubric'?12000:8000)]));
  for (const k of ['course','section','title','prompt']) if (!values[k]) fail(400,`${k} is required.`);
  const status = duplicate ? 'draft' : ['draft','open','closed'].includes(input.status) ? input.status : 'draft';
  const boundaries = ['Permissive','Moderate','Restrictive'].includes(input.boundaries) ? input.boundaries : 'Moderate';
  if (existing && !duplicate) return (await sql`UPDATE enscribe_assignments SET course=${values.course},section=${values.section},title=${values.title},prompt=${values.prompt},instructions=${values.instructions},rubric=${values.rubric},timing=${values.timing},status=${status},boundaries=${boundaries},updated_at=NOW() WHERE assignment_id=${existing.assignment_id} RETURNING *`)[0];
  return (await sql`INSERT INTO enscribe_assignments (assignment_id,public_slug,teacher_id,course,section,title,prompt,instructions,rubric,timing,status,boundaries,sandbox)
    VALUES (${id('writing')},${token()},${owner},${values.course},${values.section},${values.title},${values.prompt},${values.instructions},${values.rubric},${values.timing},${status},${boundaries},${sandbox}) RETURNING *`)[0];
}
export async function issueStudent(staff,body) {
  const sql = getSql();
  const a = await ownedAssignment(staff,body.module,body.assignmentId);
  await rateLimit('student-issue:' + staff.teacherId,100);
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) fail(400,'A valid student email is required.');
  const first = cleanString(body.firstName,80), last = cleanString(body.lastName,80);
  if (!first || !last) fail(400,'First and last name are required.');
  const value = token();
  // Atomic capacity and code rotation are handled by a DB function (assignment row lock).
  const [student] = await sql`SELECT * FROM department_issue_student(${body.module},${a.assignment_id},${email},${first},${last},${digest(value)},${id('student')},${cleanString(body.original,60000)})`;
  return {studentId:student.student_id,code:value};
}
export async function studentAccess(body) {
  const sql = getSql();
  const [student] = await sql`SELECT * FROM department_students WHERE token_hash=${digest(body.studentToken)} AND assignment_id=${cleanString(body.assignmentId,100)} AND module=${body.module}`;
  if (!student) fail(401,'Enter your private student code from your teacher. An email address does not grant access.');
  const assignment = await assignmentFor(student.module,student.assignment_id);
  if (!assignment) fail(404,'Assignment not found.');
  return {student,assignment};
}
export async function preserveOriginal(studentId,original) {
  const text = cleanString(original,60000);
  if (!text) fail(400,'Paste your independent original draft first.');
  const [draft] = await getSql()`INSERT INTO enscribe_drafts (student_id,original,working) VALUES (${studentId},${text},${text}) ON CONFLICT (student_id) DO NOTHING RETURNING *`;
  if (!draft) fail(409,'The original draft is already preserved and cannot be replaced.');
  return draft;
}
export async function readDraft(studentId) {
  const sql = getSql();
  const [draft] = await sql`SELECT * FROM enscribe_drafts WHERE student_id=${studentId}`;
  const history = await sql`SELECT request_id,reply,started_at FROM department_coach_requests WHERE student_id=${studentId} AND state='success' ORDER BY started_at`;
  return {draft:draft || null,history};
}
export async function saveDraft(student,assignment,body) {
  if (assignment.status !== 'open') fail(409,'This assignment is not open.');
  const sql = getSql();
  if (body.action==='original') return {draft:await preserveOriginal(student.student_id,body.original)};
  const working=cleanString(body.working,60000), explanation=cleanString(body.explanation,6000), reflection=cleanString(body.reflection,6000);
  if (!working) fail(400,'A working draft is required.');
  if (!explanation) fail(400,'Explain what changed or why you kept your draft.');
  if (body.action==='submit' && !reflection) fail(400,'Add your final reflection before submitting.');
  const submit=body.action==='submit';
  const entry=JSON.stringify([{writing:working,explanation,reflection,at:new Date().toISOString(),action:submit?'submit':'save'}]);
  const [draft] = await sql`UPDATE enscribe_drafts SET working=${working},reflection=${reflection},version=version+1,
    revisions=revisions || ${entry}::jsonb,status=${submit?'submitted':'draft'},submitted_at=CASE WHEN ${submit} THEN NOW() ELSE submitted_at END,updated_at=NOW()
    WHERE student_id=${student.student_id} AND version=${Number(body.version)} AND status='draft'
    AND EXISTS(SELECT 1 FROM enscribe_assignments WHERE assignment_id=${assignment.assignment_id} AND status='open') RETURNING *`;
  if (!draft) fail(409,'This draft changed in another tab or is submitted. Reload and compare your writing; ask your teacher to reopen submitted work.');
  return {draft,submitted:submit};
}
export async function review(staff,body) {
  const a = await ownedAssignment(staff,body.module,body.assignmentId);
  const sql = getSql();
  if (body.module==='enscribe') return sql`SELECT s.student_id,s.first_name,s.last_name,s.email,d.original,d.working,d.reflection,d.status,d.version,d.revisions,d.submitted_at,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('requestId',c.request_id,'reply',c.reply,'at',c.started_at) ORDER BY c.started_at),'[]'::jsonb) FROM department_coach_requests c WHERE c.student_id=s.student_id AND c.state='success') AS history
    FROM department_students s LEFT JOIN enscribe_drafts d USING(student_id) WHERE s.module='enscribe' AND s.assignment_id=${a.assignment_id} ORDER BY s.last_name`;
  return sql`SELECT student_id,first_name,last_name,email FROM department_students WHERE module='endepth' AND assignment_id=${a.assignment_id}`;
}
export async function reopen(staff,body) {
  await ownedAssignment(staff,'enscribe',body.assignmentId);
  const sql = getSql();
  const [row] = await sql`UPDATE enscribe_drafts d SET status='draft',version=version+1,updated_at=NOW(),
    revisions=revisions || jsonb_build_array(jsonb_build_object('action','teacher-reopen','at',NOW()))
    FROM department_students s WHERE d.student_id=s.student_id AND s.student_id=${body.studentId} AND s.assignment_id=${body.assignmentId} AND s.module='enscribe' RETURNING d.student_id`;
  if (!row) fail(404,'Student not found.');
  return {ok:true};
}
export function safeCsv(rows) {
  const cell=x=>'"'+String(x??'').replace(/^[\s]*[=+@\-\t\r]/,m=>"'"+m).replaceAll('"','""')+'"';
  return [['First name','Last name','Email','Original','Working','Status','Reflection'],...rows.map(r=>[r.first_name,r.last_name,r.email,r.original,r.working,r.status || 'Not started',r.reflection])].map(r=>r.map(cell).join(',')).join('\r\n');
}
