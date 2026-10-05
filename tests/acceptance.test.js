import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
process.env.NODE_ENV='test';
process.env.DATABASE_URL='test-only';
process.env.ENDEPTH_TEACHER_CODE='legacy-morgan-'+randomBytes(16).toString('hex');
process.env.ENDEPTH_SECOND_TEACHER_CODE='legacy-second-'+randomBytes(16).toString('hex');
process.env.ENDEPTH_SECOND_TEACHER_EMAIL='marksd@ensworth.com';
process.env.ENDEPTH_ADMIN_CODE='admin-'+randomBytes(16).toString('hex');
process.env.OPENAI_API_KEY='mock-only';
const {testDatabase,send}=await import('./helpers.js');
const {db,sql}=await testDatabase();
const {ensurePilotSchema,saveAssignmentForStaff,authenticateStaffCode}=await import('../server/submissions-db.js');
const {migrateDepartment}=await import('../server/department-schema.js');
const {migrateAtomic}=await import('../server/atomic-schema.js');
const {ROSTER,digest}=await import('../server/security.js');
const auth=(await import('../api/staff-auth.js')).default;
const teachers=(await import('../api/teachers.js')).default;
const department=(await import('../api/department.js')).default;
const assignments=(await import('../api/assignments.js')).default;
const submissions=(await import('../api/submissions.js')).default;
const list=(await import('../api/submissions-list.js')).default;
const coach=(await import('../api/coach.js')).default;
const publicAssignment=(await import('../api/assignment-public.js')).default;
let admin, teacherA, teacherB, aw, bw, ad, bd, studentA;
const mockPayloads=[];
let mockMode='success';
globalThis.fetch=async (url,options)=>{
  assert.ok(url.startsWith('https://api.openai.com/'));
  const body=JSON.parse(options.body);mockPayloads.push(body);
  if(mockMode==='failure') return Response.json({error:{message:'synthetic failure'}},{status:503});
  if(url.endsWith('/moderations')) return Response.json({results:[{categories:{'self-harm/intent':mockMode==='withhold'}}]});
  if(mockMode==='empty') return Response.json({output:[]});
  return Response.json({output_text:'Your explanation notices the contrast but has not yet connected that change to the waiting. Trace the relationship between your observation and your interpretation. What does your own selected detail establish?'});
};
const writing={course:'Synthetic course',section:'A',title:'Synthetic writing',prompt:'Analyze your observation.',status:'open',rubric:'Explain evidence.'};
const depth={course:'Synthetic course',section:'A',title:'Synthetic Harkness',prompt:'What does the contrast suggest?',sourceTitle:'Synthetic passage',passage:'Ari closed the gate and waited.',directions:'Prepare independently.',status:'open'};
async function issue(module,a,cookie,email='synthetic@example.invalid') {
  const r=await send(department,{action:'issue-student',module,assignmentId:a,email,firstName:'Synthetic',lastName:'Student'},cookie);
  assert.equal(r.status,200,JSON.stringify(r.data));return r.data;
}
const checkBody=(s,a,requestId)=>({action:'coach',module:'enscribe',assignmentId:a,studentToken:s.code,requestId,focus:'Analysis',goal:'Explain my reasoning.',passage:'The gate suggests a change.',tried:'I compared the two moments.',question:'Where is my explanation incomplete?'});

test('additive migration preserves legacy accounts, credentials, IDs, ownership and URLs',async()=>{
 await ensurePilotSchema();
 const m=await authenticateStaffCode(process.env.ENDEPTH_TEACHER_CODE);
 const second=await authenticateStaffCode(process.env.ENDEPTH_SECOND_TEACHER_CODE);
 assert.ok(m);assert.ok(second);
 const a=await saveAssignmentForStaff(m,depth);
 await sql`INSERT INTO endepth_submissions(submission_id,assignment_key,assignment_id,teacher_id,teacher_name,course,assignment_title,central_question,source_title,student_first_name,student_last_name,initial_response) VALUES('legacy-synthetic',${a.assignmentId},${a.assignmentId},${m.teacherId},'Synthetic teacher','Synthetic course','Synthetic title','Question','Source','Synthetic','Student','Preserve synthetic writing')`;
 const before=await sql`SELECT teacher_id,slug,code_salt,code_hash FROM endepth_teachers ORDER BY teacher_id`;
 await migrateDepartment(sql);await migrateAtomic(sql);
 assert.deepEqual(await sql`SELECT teacher_id,slug,code_salt,code_hash FROM endepth_teachers ORDER BY teacher_id`,before);
 assert.equal((await sql`SELECT count(*)::int AS n FROM endepth_teachers WHERE email='marksd@ensworth.com'`)[0].n,1);
 assert.equal((await sql`SELECT teacher_id,initial_response FROM endepth_submissions WHERE submission_id='legacy-synthetic'`)[0].teacher_id,m.teacherId);
 const response=await publicAssignment.fetch(new Request('https://example.test/api/assignment-public?slug='+a.publicSlug));assert.equal(response.status,200);
 assert.equal((await authenticateStaffCode(process.env.ENDEPTH_SECOND_TEACHER_CODE)).teacherId,second.teacherId);
 admin=await send(auth,{code:process.env.ENDEPTH_ADMIN_CODE});assert.equal(admin.status,200);assert.equal(admin.data.staff.role,'admin');assert.ok(admin.cookie);
});
test('all seven approved teachers activate and authenticate to BOTH modules; email is not authentication',async()=>{
 const roster=await send(teachers,{action:'list'},admin.cookie);assert.equal(roster.status,200);
 for(const email of ROSTER){
  const t=roster.data.teachers.find(t=>t.email===email);assert.ok(t);
  const activated=await send(teachers,{action:'issue',teacherId:t.teacherId},admin.cookie);assert.equal(activated.status,200);
  const login=await send(auth,{code:activated.data.code});assert.equal(login.status,200);
  assert.equal((await send(department,{action:'list'},login.cookie)).status,200);
  assert.equal((await send(assignments,{action:'list'},login.cookie)).status,200);
  if(email===ROSTER[0])teacherA={...login,code:activated.data.code};
  if(email===ROSTER[1])teacherB={...login,code:activated.data.code};
 }
 assert.equal((await send(auth,{code:ROSTER[0]})).status,401);
 assert.equal((await send(teachers,{action:'issue',teacherId:teacherA.data.staff.teacherId},teacherA.cookie)).status,403);
});
test('teacher ownership enforced for every assignment/review/export/student/reopen action',async()=>{
 aw=(await send(department,{action:'save-assignment',assignment:writing},teacherA.cookie)).data.assignment;
 bw=(await send(department,{action:'save-assignment',assignment:writing},teacherB.cookie)).data.assignment;
 ad=(await send(assignments,{action:'save',assignment:depth},teacherA.cookie)).data.assignment;
 bd=(await send(assignments,{action:'save',assignment:depth},teacherB.cookie)).data.assignment;
 assert.ok(aw&&bw&&ad&&bd);
 const own=(await send(department,{action:'list'},teacherA.cookie)).data.assignments;assert.deepEqual(own.map(a=>a.assignment_id),[aw.assignment_id]);
 const depthOwn=(await send(assignments,{action:'list'},teacherA.cookie)).data.assignments;assert.deepEqual(depthOwn.map(a=>a.assignmentId),[ad.assignmentId]);
 for(const action of ['review','export','reopen','issue-student'])assert.equal((await send(department,{action,module:'enscribe',assignmentId:bw.assignment_id,email:'x@example.invalid',firstName:'x',lastName:'y',studentId:'fake'},teacherA.cookie)).status,404,action);
 for(const action of ['save-assignment','duplicate'])assert.equal((await send(department,{action,assignment:{...bw,teacher_id:teacherA.data.staff.teacherId}},teacherA.cookie)).status,404);
 assert.equal((await send(department,{action:'delete',assignmentId:bw.assignment_id},teacherA.cookie)).status,400);
 assert.notEqual((await send(assignments,{action:'save',assignment:{...bd,teacherId:teacherA.data.staff.teacherId}},teacherA.cookie)).status,200);
 const sub=await issue('endepth',bd.assignmentId,teacherB.cookie);
 const response=await send(submissions,{assignmentId:bd.assignmentId,accessCode:sub.code,work:{initialResponse:'Original',evidence:'Evidence',significance:'Analysis',claim:'Claim',complication:'Complication',openQuestion:'Question?'}});assert.equal(response.status,200,JSON.stringify(response.data));
 assert.deepEqual((await send(list,{assignmentId:bd.assignmentId},teacherA.cookie)).data.submissions,[]);
 assert.equal((await send(list,{assignmentId:bd.assignmentId},admin.cookie)).data.submissions.length,1);
 assert.ok((await send(department,{action:'list'},admin.cookie)).data.assignments.length>=2);
 assert.equal((await send(department,{action:'review',module:'enscribe',assignmentId:bw.assignment_id},admin.cookie)).status,200);
 assert.equal((await send(department,{action:'list',code:teacherA.code})).status,401,'codes cannot bypass sessions');
 assert.equal((await send(department,{action:'list'},teacherA.cookie,'https://evil.example')).status,403);
});
test('student email cannot impersonate; original immutable; revisions, conflicts, submission and reopen persist',async()=>{
 studentA=await issue('enscribe',aw.assignment_id,teacherA.cookie);
 const base={module:'enscribe',assignmentId:aw.assignment_id,studentToken:studentA.code};
 assert.equal((await send(department,{action:'student-read',...base,studentToken:'',email:'synthetic@example.invalid'})).status,401);
 const original='\n  The gate suggests a change. Ari waits by an empty bench.  \n';
 let r=await send(department,{action:'original',...base,original});assert.equal(r.status,200,JSON.stringify(r.data));
 assert.equal((await send(department,{action:'original',...base,original:'Replacement'})).status,409);
 await assert.rejects(sql`UPDATE enscribe_drafts SET original='Overwrite' WHERE student_id=${studentA.studentId}`,/ORIGINAL_IMMUTABLE/);
 r=await send(department,{action:'save-draft',...base,version:1,working:original+' I will examine the contrast.',explanation:'I named the next reasoning step.'});assert.equal(r.status,200);
 assert.equal((await send(department,{action:'save-draft',...base,version:1,working:'Stale tab',explanation:'Overwrite'})).status,409);
 r=await send(department,{action:'submit',...base,version:2,working:original,explanation:'I chose to keep my original observation.',reflection:'I need to explain the contrast.'});assert.equal(r.status,200);assert.equal(r.data.draft.status,'submitted');assert.ok(r.data.draft.submitted_at);
 assert.equal((await send(department,{action:'save-draft',...base,version:3,working:original,explanation:'Not reopened.'})).status,409);
 assert.equal((await send(department,{action:'reopen',assignmentId:aw.assignment_id,studentId:studentA.studentId},teacherA.cookie)).status,200);
 r=await send(department,{action:'student-read',...base});assert.equal(r.data.draft.version,4);assert.equal(r.data.draft.revisions.length,3);assert.equal(r.data.draft.original,original);
});
test('coaching fifth success rejected, duplicate retries cached, concurrency bounded, provider receives no identity',async()=>{
 const first=checkBody(studentA,aw.assignment_id,'first-check-0000001');
 let r=await send(department,first);assert.equal(r.status,200,JSON.stringify(r.data));
 const calls=mockPayloads.length;
 assert.deepEqual((await send(department,first)).data,r.data);assert.equal(mockPayloads.length,calls);
 const results=await Promise.all(Array.from({length:8},(_,i)=>send(department,checkBody(studentA,aw.assignment_id,'parallel-check-000'+i))));
 assert.equal(results.filter(r=>r.status===200).length,3);
 assert.equal((await send(department,checkBody(studentA,aw.assignment_id,'fifth-check-0000001'))).status,409);
 assert.equal((await sql`SELECT count(*)::int AS n FROM department_coach_requests WHERE student_id=${studentA.studentId} AND state='success'`)[0].n,4);
 for(const p of mockPayloads){const s=JSON.stringify(p);for(const secret of [studentA.code,teacherA.code,'synthetic@example.invalid','Synthetic Student'])assert.ok(!s.includes(secret));if(p.instructions)assert.equal(p.store,false);}
});
test('withheld, failed and empty responses release reservations without simulated fallback',async()=>{
 const s=await issue('enscribe',aw.assignment_id,teacherA.cookie,'failures@example.invalid');
 await send(department,{action:'original',module:'enscribe',assignmentId:aw.assignment_id,studentToken:s.code,original:'The gate suggests a change.'});
 const body=checkBody(s,aw.assignment_id,'failure-retry-00001');
 for(const mode of ['failure','withhold','empty']){mockMode=mode;assert.notEqual((await send(department,body)).status,200);assert.equal((await sql`SELECT count(*)::int AS n FROM department_coach_requests WHERE student_id=${s.studentId} AND state='success'`)[0].n,0);}
 mockMode='success';assert.equal((await send(department,body)).status,200);
});
test('restrictive and closed writing assignments reject coaching and disallowed changes',async()=>{
 const s=await issue('enscribe',aw.assignment_id,teacherA.cookie,'restricted@example.invalid');
 await send(department,{action:'original',module:'enscribe',assignmentId:aw.assignment_id,studentToken:s.code,original:'The gate suggests a change.'});
 await send(department,{action:'save-assignment',assignment:{...aw,boundaries:'Restrictive'}},teacherA.cookie);
 assert.equal((await send(department,checkBody(s,aw.assignment_id,'restricted-check-01'))).status,409);
 await send(department,{action:'save-assignment',assignment:{...aw,status:'closed'}},teacherA.cookie);
 assert.equal((await send(department,{action:'save-draft',module:'enscribe',assignmentId:aw.assignment_id,studentToken:s.code,working:'Changed',explanation:'Explain',version:1})).status,409);
 await send(department,{action:'save-assignment',assignment:aw},teacherA.cookie);
});
test('EnDepth coaching uses authenticated student identity, preserves historic quota and blocks closed submissions',async()=>{
 const s=await issue('endepth',ad.assignmentId,teacherA.cookie);
 const body={assignmentId:ad.assignmentId,accessCode:s.code,requestId:'depth-check-000001',initialResponse:'The closed gate creates tension.',messages:[{role:'student',text:'What is missing in my explanation?'}]};
 await sql`INSERT INTO endepth_coach_usage(assignment_id,student_email,successful_count) VALUES(${ad.assignmentId},${digest(ad.assignmentId+':synthetic@example.invalid')},3)`;
 assert.equal((await send(coach,body)).status,200);
 assert.equal((await send(coach,body)).status,200,'cached retry');
 assert.equal((await send(coach,{...body,requestId:'depth-check-000002',studentCoachKey:'f'.repeat(64)})).status,409);
 assert.equal((await send(coach,{...body,accessCode:'synthetic@example.invalid'})).status,401);
 await send(assignments,{action:'save',assignment:{...ad,status:'closed'}},teacherA.cookie);
 assert.equal((await send(coach,body)).status,409);
 assert.equal((await send(submissions,{assignmentId:ad.assignmentId,accessCode:s.code,work:{initialResponse:'Original',evidence:'Evidence',claim:'Claim',complication:'Complication',openQuestion:'Question?'}})).status,409);
});
test('expired legacy in-flight reservations do not permanently consume coaching allowance',async()=>{
 const a=(await send(assignments,{action:'save',assignment:depth},teacherA.cookie)).data.assignment;
 const s=await issue('endepth',a.assignmentId,teacherA.cookie,'legacy-lease@example.invalid');
 await sql`INSERT INTO endepth_coach_usage(assignment_id,student_email,successful_count,in_flight_count,updated_at) VALUES(${a.assignmentId},${digest(a.assignmentId+':legacy-lease@example.invalid')},3,1,NOW()-INTERVAL '10 minutes')`;
 const body={assignmentId:a.assignmentId,accessCode:s.code,requestId:'expired-legacy-0001',messages:[{role:'student',text:'Where does my reasoning need attention?'}]};
 assert.equal((await send(coach,body)).status,200);
 assert.equal((await send(coach,{...body,requestId:'expired-legacy-0002'})).status,409);
});
test('17-student capacity survives concurrent issuance and student code rotation preserves quota',async()=>{
 const a=(await send(assignments,{action:'save',assignment:depth},teacherA.cookie)).data.assignment;
 const results=await Promise.all(Array.from({length:19},(_,i)=>send(department,{action:'issue-student',module:'endepth',assignmentId:a.assignmentId,email:`capacity${i}@example.invalid`,firstName:'Synthetic',lastName:'Student'},teacherA.cookie)));
 assert.equal(results.filter(r=>r.status===200).length,17);assert.equal(results.filter(r=>r.status===409).length,2);
 const rotated=await issue('enscribe',aw.assignment_id,teacherA.cookie);
 assert.equal(rotated.studentId,studentA.studentId);
 assert.equal((await send(department,{action:'student-read',module:'enscribe',assignmentId:aw.assignment_id,studentToken:studentA.code})).status,401);
 assert.equal((await send(department,checkBody(rotated,aw.assignment_id,'post-rotation-00001'))).status,409);
});
test('sandboxes belong to each teacher; reset cannot touch real work or others’ test work; CSV safe',async()=>{
 const sandboxA=await send(department,{action:'sandbox',module:'enscribe'},teacherA.cookie);assert.equal(sandboxA.status,200,JSON.stringify(sandboxA.data));
 const sandboxB=await send(department,{action:'sandbox',module:'enscribe'},teacherB.cookie);assert.equal(sandboxB.status,200);
 assert.notEqual(sandboxA.data.assignment.assignment_id,sandboxB.data.assignment.assignment_id);
 assert.equal((await send(department,{action:'sandbox-reset',assignmentId:sandboxB.data.assignment.assignment_id},teacherA.cookie)).status,404);
 assert.equal((await send(department,{action:'sandbox-reset',assignmentId:aw.assignment_id},teacherA.cookie)).status,404);
 assert.equal((await send(department,{action:'sandbox-reset',assignmentId:sandboxA.data.assignment.assignment_id},teacherA.cookie)).status,200);
 const {safeCsv}=await import('../server/studio.js');assert.match(safeCsv([{first_name:'=HYPERLINK("bad")'}]),/"'=HYPERLINK/);
});
test('rotation and disabling revoke sessions and all legacy environment fallback',async()=>{
 const old=teacherA.code, id=teacherA.data.staff.teacherId;
 let r=await send(teachers,{action:'issue',teacherId:id},admin.cookie);assert.equal(r.status,200);
 assert.equal((await send(auth,{code:old})).status,401);
 assert.equal((await send(auth,{code:process.env.ENDEPTH_SECOND_TEACHER_CODE})).status,401);
 assert.equal((await send(department,{action:'list'},teacherA.cookie)).status,401);
 const active=await send(auth,{code:r.data.code});assert.equal(active.status,200);
 await send(teachers,{action:'disable',teacherId:id},admin.cookie);
 assert.equal((await send(auth,{code:r.data.code})).status,401);
 assert.equal((await send(department,{action:'list'},active.cookie)).status,401);
 await migrateDepartment(sql);
 assert.equal((await sql`SELECT active FROM endepth_teachers WHERE teacher_id=${id}`)[0].active,false);
});
test('credential rotation during login cannot mint a session bound to the new credential',async()=>{
 const {createSession}=await import('../server/security.js');
 const verified=await authenticateStaffCode(teacherB.code);assert.ok(verified);
 await send(teachers,{action:'issue',teacherId:verified.teacherId},admin.cookie);
 await assert.rejects(createSession(verified),/credential changed/);
});
test('failed repeat import preserves original and does not revoke the current student code',async()=>{
 const a=(await send(department,{action:'save-assignment',assignment:writing},admin.cookie)).data.assignment;
 const body={action:'issue-student',module:'enscribe',assignmentId:a.assignment_id,email:'import@example.invalid',firstName:'Synthetic',lastName:'Import',original:'Independent original.'};
 const first=await send(department,body,admin.cookie);assert.equal(first.status,200);
 assert.equal((await send(department,{...body,original:'Replacement'},admin.cookie)).status,409);
 const read=await send(department,{action:'student-read',module:'enscribe',assignmentId:a.assignment_id,studentToken:first.data.code});
 assert.equal(read.status,200);assert.equal(read.data.draft.original,'Independent original.');
});
test('login rate limit rejects repeated guesses',async()=>{
 let last;
 for(let i=0;i<35;i++)last=await send(auth,{code:'invalid-guess'});
 assert.equal(last.status,429);
});
test.after(async()=>db.close());
