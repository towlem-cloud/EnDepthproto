import { ensurePilotSchema,json,saveAssignmentForStaff } from '../server/submissions-db.js';
import { checkOrigin,requireStaff,rateLimit,fail } from '../server/security.js';
import { listWriting,saveWriting,issueStudent,studentAccess,readDraft,saveDraft,review,reopen,safeCsv } from '../server/studio.js';
import { coach } from '../server/coaching.js';

async function sandbox(staff,module,sql) {
  if (!['enscribe','endepth'].includes(module)) fail(400,'Unknown module.');
  await rateLimit('sandbox:'+staff.teacherId,15,3600);
  let a;
  if(module==='enscribe') {
    [a]=await sql`SELECT * FROM enscribe_assignments WHERE teacher_id=${staff.teacherId} AND sandbox=TRUE ORDER BY created_at LIMIT 1`;
    if(!a) a=await saveWriting(staff,{course:'Fictional sample',section:'Teacher testing only',title:'Example: the empty bench',prompt:'Analyze how a detail creates tension.',instructions:'Use only this fictional sample. Do not enter student information.',rubric:'Teacher testing focus: explain how an observation supports an interpretation.',status:'open'},false,true);
  } else {
    [a]=await sql`SELECT * FROM endepth_assignments WHERE teacher_id=${staff.teacherId} AND sandbox=TRUE ORDER BY created_at LIMIT 1`;
    if(!a) {
      const created=await saveAssignmentForStaff(staff,{teacherId:staff.teacherId,course:'Fictional sample',section:'Teacher testing only',title:'Example: the empty bench',prompt:'How does the choice to wait create tension?',sourceTitle:'Fictional practice passage',passage:'Every evening Ari left the gate open. Tonight Ari closed it, then waited beside the empty bench.',directions:'Develop your own interpretation of this fictional passage.',status:'open'});
      [a]=await sql`UPDATE endepth_assignments SET sandbox=TRUE WHERE assignment_id=${created.assignmentId} RETURNING *`;
    }
  }
  // Reuse one bounded sandbox per staff member/module. Reopening it never resets coach quota.
  const issued=await issueStudent(staff,{module,assignmentId:a.assignment_id,email:'fictional@example.invalid',firstName:'Fictional',lastName:'Writer'});
  if(module==='enscribe') {
    const sample='The closed gate suggests a change in what Ari expects. Earlier the gate stayed open, but tonight Ari waits beside an empty bench. I think the contrast matters because the action and the waiting seem to pull in different directions.';
    await sql`INSERT INTO enscribe_drafts(student_id,original,working) VALUES(${issued.studentId},${sample},${sample}) ON CONFLICT(student_id) DO NOTHING`;
  }
  return {assignment:a,...issued,path:module==='enscribe'?`/?writing=${a.public_slug}`:`/?assignment=${a.public_slug}`,example:true};
}
export default {async fetch(request) {
  if(request.method!=='POST') return json({error:'Use POST.'},405);
  try {
    checkOrigin(request);
    const sql=await ensurePilotSchema(), body=await request.json();
    if(body.action==='public') {
      const [a]=await sql`SELECT assignment_id,course,section,title,prompt,instructions,rubric,timing,boundaries,status,sandbox FROM enscribe_assignments WHERE public_slug=${String(body.slug || '')} AND status='open'`;
      if(!a) fail(404,'This writing assignment is not open.');
      return json({assignment:a});
    }
    if(['student-read','original','save-draft','submit','coach'].includes(body.action)) {
      const {student,assignment}=await studentAccess(body);
      if(body.action==='coach') return json(await coach(student,assignment,body));
      if(body.module!=='enscribe') fail(400,'Use the EnDepth workspace.');
      if(body.action==='student-read') return json(await readDraft(student.student_id));
      return json(await saveDraft(student,assignment,body));
    }
    const staff=await requireStaff(request);
    if(body.action==='list') return json({assignments:await listWriting(staff)});
    if(body.action==='save-assignment' || body.action==='duplicate') return json({assignment:await saveWriting(staff,body.assignment || {},body.action==='duplicate')});
    if(body.action==='issue-student') return json(await issueStudent(staff,body));
    if(body.action==='review') return json({students:await review(staff,body)});
    if(body.action==='export') return json({csv:safeCsv(await review(staff,{...body,module:'enscribe'}))});
    if(body.action==='reopen') return json(await reopen(staff,body));
    if(body.action==='sandbox') return json(await sandbox(staff,body.module,sql));
    if(body.action==='sandbox-reset') {
      await rateLimit('sandbox-reset:'+staff.teacherId,5,3600);
      // Owner predicate deliberately applies to admins too: only THEIR test drafts.
      const changed=await sql`UPDATE enscribe_drafts d SET working=d.original,status='draft',version=d.version+1,updated_at=NOW(),
        revisions=revisions || jsonb_build_array(jsonb_build_object('action','sandbox-reset','at',NOW()))
        FROM department_students s,enscribe_assignments a WHERE d.student_id=s.student_id AND s.assignment_id=a.assignment_id AND a.sandbox=TRUE AND a.teacher_id=${staff.teacherId} AND a.assignment_id=${body.assignmentId} RETURNING d.student_id`;
      if(!changed.length) fail(404,'Your test assignment was not found.');
      return json({ok:true,message:'Example draft reset. Successful coaching checks are not reset.'});
    }
    fail(400,'Unsupported department action.');
  } catch(e) {
    const capacity=String(e.message).includes('ASSIGNMENT_CAPACITY_REACHED');
    if(String(e.message).includes('ORIGINAL_IMMUTABLE')) return json({error:'The original is already preserved. Leave the import field empty to rotate the student code.'},409);
    return json({error:e.status?e.message:capacity?'The assignment has reached its 17-student limit.':'The request could not be completed.'},e.status || (capacity?409:500));
  }
}};
