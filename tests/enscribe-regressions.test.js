import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import schema from '../lib/department-schema.js';
import { staffWriting, studentWriting } from '../lib/enscribe-service.js';
import { liveWritingCheck } from '../lib/writing-coach.js';
import { digest } from '../lib/department-security.js';

async function fixture() {
  const db = new PGlite(); await db.waitReady;
  await db.exec(await readFile(new URL('./fixtures/pilot-schema.sql',import.meta.url),'utf8'));
  await db.exec(schema);
  function sql(strings,...values) {
    let statement = strings[0]; values.forEach((_,index)=>{statement+=`$${index+1}${strings[index+1]}`;});
    return db.query(statement,values).then(result=>result.rows);
  }
  sql.query = async (statement,values=[]) => (await db.query(statement,values)).rows;
  await sql`INSERT INTO endepth_teachers(teacher_id,slug,display_name,email,code_salt,code_hash,active) VALUES('synthetic-teacher','synthetic-teacher','Synthetic teacher','teacher@example.invalid','synthetic-salt','synthetic-hash',TRUE)`;
  const staff={role:'teacher',teacherId:'synthetic-teacher'};
  const assignment=(await staffWriting(sql,staff,{action:'writing-save',assignment:{title:'Synthetic practice',course:'Fictional course',section:'Practice',prompt:'Explain the choices of a fictional character.',status:'open',boundaries:'moderate'}})).assignment;
  const invite=await staffWriting(sql,staff,{action:'writing-invite',assignmentId:assignment.id,student:{firstName:'Synthetic',lastName:'Writer',email:'synthetic@example.invalid',original:'The fictional character accepts responsibility after hesitating. The choice changes the consequences of the journey.'}});
  const token = new URLSearchParams(invite.studentPath.split('#')[1]).get('access');
  const entered=await studentWriting(sql,request(),{action:'student-enter',studentId:invite.studentId,token});
  const cookie=entered.cookie.split(';')[0];
  const body={action:'student-coach',studentId:invite.studentId,requestId:'synthetic-request-0001',focus:'Analysis',goal:'Explain the connection.',passage:'accepts responsibility',tried:'I reread the first two sentences.',question:'What connection needs more reasoning?'};
  return {db,sql,staff,assignment,invite,token,cookie,entered,body};
}
function request(cookie='') {return new Request('https://synthetic.test/api/department',{method:'POST',headers:{Origin:'https://synthetic.test','Content-Type':'application/json',Cookie:cookie},body:'{}'});}
const diagnostic='Your explanation identifies a change but leaves its connection to the consequences unstated. Test the relationship using the details you already selected. Which detail in your own draft best supports that connection?';

test('closing, restricting, rotating access or disabling the teacher during AI blocks finalization without quota charge',async(t)=>{
  for(const change of ['close','restrict','rotate','disable'])await t.test(change,async()=>{
    const f=await fixture();try{
      await assert.rejects(studentWriting(f.sql,request(f.cookie),f.body,async()=>{
        if(change==='close'||change==='restrict')await staffWriting(f.sql,f.staff,{action:'writing-save',assignment:{...f.assignment,...(change==='close'?{status:'closed'}:{boundaries:'restrictive'})}});
        if(change==='rotate')await staffWriting(f.sql,f.staff,{action:'writing-link',assignmentId:f.assignment.id,studentId:f.invite.studentId});
        if(change==='disable')await f.sql`UPDATE endepth_teachers SET active=FALSE WHERE teacher_id=${f.staff.teacherId}`;
        return {reply:diagnostic};
      }), /cancelled/);
      const rows=await f.sql`SELECT successful_checks,in_flight FROM enscribe_students WHERE id=${f.invite.studentId}`;
      assert.equal(rows[0].successful_checks,0);assert.equal(rows[0].in_flight,0);
      const checks=await f.sql`SELECT state,reply FROM enscribe_checks WHERE student_id=${f.invite.studentId}`;
      assert.equal(checks[0].state,'failed');assert.equal(checks[0].reply,null);
    }finally{await f.db.close();}
  });
});

test('server-issued student session expires, logs out and remains distinct from the reusable private link',async()=>{
  const f=await fixture();try{
    assert.notEqual(f.cookie.split('=')[1],f.token);assert.match(f.entered.cookie,/HttpOnly; Secure; SameSite=Strict/);
    const loggedOut=await studentWriting(f.sql,request(f.cookie),{action:'student-logout'});
    assert.equal(loggedOut.ok,true);assert.match(loggedOut.cookie,/Max-Age=0/);
    await assert.rejects(studentWriting(f.sql,request(f.cookie),{action:'student-read',studentId:f.invite.studentId}),/private student link/);
    // Logout can safely clear a stale cookie and does not rotate or invalidate the invitation.
    assert.equal((await studentWriting(f.sql,request(f.cookie),{action:'student-logout'})).ok,true);
    const again=await studentWriting(f.sql,request(),{action:'student-enter',studentId:f.invite.studentId,token:f.token});
    const session=again.cookie.split(';')[0];
    await f.sql`UPDATE enscribe_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=${digest(session.split('=')[1])}`;
    await assert.rejects(studentWriting(f.sql,request(session),{action:'student-read',studentId:f.invite.studentId}),/private student link/);
    // Knowing an email, invitation token as a cookie, or another ID is insufficient to read a session.
    await assert.rejects(studentWriting(f.sql,request('enscribe_student='+f.token),{action:'student-read',studentId:f.invite.studentId}),/private student link/);
  }finally{await f.db.close();}
});

test('student mutations bind the request credential and reject rotation after authentication but before SQL commit',async(t)=>{
  for(const action of ['student-save','student-coach'])await t.test(action,async()=>{
    const f=await fixture();try{
      let swapped=false;
      const intercepted=async(strings,...values)=>{
        const statement=strings.join(' ');
        if(!swapped&&statement.includes(action==='student-save'?'enscribe_save_checked(':'enscribe_reserve_checked(')){
          swapped=true;await f.sql`UPDATE enscribe_students SET token_hash=${digest('synthetic-rotated-token')} WHERE id=${f.invite.studentId}`;
        }
        return f.sql(strings,...values);
      };
      const body=action==='student-save'?{action,studentId:f.invite.studentId,version:0,draft:'A new independent draft.',explanation:'I explained the consequence.',reflection:''}:f.body;
      await assert.rejects(studentWriting(intercepted,request(f.cookie),body,async()=>({reply:diagnostic})),/ACCESS_DENIED/);
      assert.equal(swapped,true);
      const rows=await f.sql`SELECT working,successful_checks FROM enscribe_students WHERE id=${f.invite.studentId}`;
      assert.equal(rows[0].working,f.entered.student.working);assert.equal(rows[0].successful_checks,0);
    }finally{await f.db.close();}
  });
});

test('duplicating an example preserves sandbox designation and raw teacher input cannot set it',async()=>{
  const f=await fixture();try{
    const example=await staffWriting(f.sql,f.staff,{action:'writing-test'});
    const copy=await staffWriting(f.sql,f.staff,{action:'writing-duplicate',assignmentId:example.assignment.id});
    assert.equal(copy.assignment.sandbox,true);
    const ordinary=await staffWriting(f.sql,f.staff,{action:'writing-save',assignment:{...f.assignment,id:undefined,title:'Ordinary class',sandbox:true}});
    assert.equal(ordinary.assignment.sandbox,false);
  }finally{await f.db.close();}
});

test('incomplete and refused provider output cannot count as a successful live check',async()=>{
  const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='synthetic-key';
  try{
    for(const output of [{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:diagnostic},{status:'completed',incomplete_details:{reason:'max_output_tokens'},output_text:diagnostic},{status:'completed',output:[{content:[{type:'refusal',refusal:'Refused'},{type:'output_text',text:diagnostic}]}]}]){
      const fetcher=async(url)=>Response.json(String(url).endsWith('moderations')?{results:[{flagged:false}]}:output);
      await assert.rejects(liveWritingCheck({draft:'Synthetic academic writing.'},fetcher),/complete check/);
    }
    const success=await liveWritingCheck({draft:'Synthetic academic writing.'},async(url)=>Response.json(String(url).endsWith('moderations')?{results:[{flagged:false}]}:{status:'completed',output_text:diagnostic}));
    assert.equal(success.reply,diagnostic);
  }finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
});

test('owner disable and reactivation revoke old sessions permanently while private links permit fresh sign-in',async()=>{
  const f=await fixture();try{
    await f.sql`UPDATE endepth_teachers SET active=FALSE,credential_version=credential_version+1 WHERE teacher_id=${f.staff.teacherId}`;
    await assert.rejects(studentWriting(f.sql,request(f.cookie),{action:'student-read',studentId:f.invite.studentId}),/private student link/);
    await f.sql`UPDATE endepth_teachers SET active=TRUE,credential_version=credential_version+1 WHERE teacher_id=${f.staff.teacherId}`;
    await assert.rejects(studentWriting(f.sql,request(f.cookie),{action:'student-read',studentId:f.invite.studentId}),/private student link/);
    const fresh=await studentWriting(f.sql,request(),{action:'student-enter',studentId:f.invite.studentId,token:f.token});
    assert.equal((await studentWriting(f.sql,request(fresh.cookie.split(';')[0]),{action:'student-read',studentId:f.invite.studentId})).student.original,f.entered.student.original);
  }finally{await f.db.close();}
});

test('logout or owner epoch changes during AI revoke the originating request without charging a check',async(t)=>{
  for(const change of ['logout','disable-reactivate'])await t.test(change,async()=>{
    const f=await fixture();try{
      await assert.rejects(studentWriting(f.sql,request(f.cookie),f.body,async()=>{
        if(change==='logout')await studentWriting(f.sql,request(f.cookie),{action:'student-logout'});
        else {
          await f.sql`UPDATE endepth_teachers SET active=FALSE,credential_version=credential_version+1 WHERE teacher_id=${f.staff.teacherId}`;
          await f.sql`UPDATE endepth_teachers SET active=TRUE,credential_version=credential_version+1 WHERE teacher_id=${f.staff.teacherId}`;
        }
        return {reply:diagnostic};
      }),/cancelled/);
      const rows=await f.sql`SELECT successful_checks,in_flight FROM enscribe_students WHERE id=${f.invite.studentId}`;
      assert.equal(rows[0].successful_checks,0);assert.equal(rows[0].in_flight,0);
    }finally{await f.db.close();}
  });
});

test('queued save and coaching reservations reject a session logged out after authentication',async(t)=>{
  for(const action of ['student-save','student-coach'])await t.test(action,async()=>{
    const f=await fixture();try{
      let revoked=false;
      const intercepted=async(strings,...values)=>{
        if(!revoked&&strings.join(' ').includes(action==='student-save'?'enscribe_save_checked(':'enscribe_reserve_checked(')){
          revoked=true;await studentWriting(f.sql,request(f.cookie),{action:'student-logout'});
        }
        return f.sql(strings,...values);
      };
      const body=action==='student-save'?{action,studentId:f.invite.studentId,version:0,draft:'Own new revision.',explanation:'I clarified the consequence.'}:f.body;
      await assert.rejects(studentWriting(intercepted,request(f.cookie),body,async()=>({reply:diagnostic})),/ACCESS_DENIED/);
      assert.equal(revoked,true);
      const rows=await f.sql`SELECT working,successful_checks FROM enscribe_students WHERE id=${f.invite.studentId}`;
      assert.equal(rows[0].working,f.entered.student.working);assert.equal(rows[0].successful_checks,0);
    }finally{await f.db.close();}
  });
});

test('independent student originals and teacher imports preserve exact whitespace and reject oversized replacement input',async()=>{
  const f=await fixture();try{
    const original='\n  An independently written opening.\n\nA second paragraph.  \n';
    const imported=await staffWriting(f.sql,f.staff,{action:'writing-invite',assignmentId:f.assignment.id,student:{firstName:'Synthetic',lastName:'Imported',email:'imported@example.invalid',original}});
    const importedToken=new URLSearchParams(imported.studentPath.split('#')[1]).get('access');
    const importedRead=await studentWriting(f.sql,request(),{action:'student-enter',studentId:imported.studentId,token:importedToken});
    assert.equal(importedRead.student.original,original);assert.equal(importedRead.revisions[0].draft,original);
    const empty=await staffWriting(f.sql,f.staff,{action:'writing-invite',assignmentId:f.assignment.id,student:{firstName:'Synthetic',lastName:'Independent',email:'independent@example.invalid'}});
    const raw=new URLSearchParams(empty.studentPath.split('#')[1]).get('access');
    const entered=await studentWriting(f.sql,request(),{action:'student-enter',studentId:empty.studentId,token:raw});
    const cookie=entered.cookie.split(';')[0];
    const saved=await studentWriting(f.sql,request(cookie),{action:'student-save',studentId:empty.studentId,version:0,draft:original});
    assert.equal(saved.student.original,original);assert.equal(saved.student.working,original);assert.equal(saved.revisions[0].draft,original);
    await assert.rejects(studentWriting(f.sql,request(cookie),{action:'student-save',studentId:empty.studentId,version:1,draft:'x'.repeat(60001),explanation:'Synthetic oversized input.'}),/60,000/);
    assert.equal((await studentWriting(f.sql,request(cookie),{action:'student-read',studentId:empty.studentId})).student.original,original);
  }finally{await f.db.close();}
});
