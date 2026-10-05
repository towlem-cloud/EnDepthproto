import React,{useState} from 'react';
import {department} from './departmentApi';
export function SampleTools() {
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
  async function start(module) {
    setBusy(true);setNotice('');
    try { const d=await department({action:'sandbox',module});setResult(d);setNotice('Fictional example only. Four live checks total per module; reopening does not reset the limit.'); }
    catch(e){setNotice(e.message);} finally {setBusy(false);}
  }
  return <section className="department-card"><h2>Try both tools</h2><p>Use your own fictional sample assignment. Live checks process academic writing through the AI provider.</p><div className="department-actions"><button disabled={busy} onClick={()=>start('enscribe')}>Try EnScribe</button><button disabled={busy} onClick={()=>start('endepth')}>Try EnDepth</button></div>{notice && <p role="status">{notice}</p>}{result && <div><p>Private sample code: <code>{result.code}</code></p><a href={result.path} target="_blank" rel="noreferrer">Open fictional sample workspace ↗</a><p>For EnDepth, use fictional@example.invalid and the name Fictional Writer. Enter the private code above when asked.</p></div>}</section>;
}
export function StudentAccess({module,assignmentId,onChange}) {
  const [fields,setFields]=useState({firstName:'',lastName:'',email:'',original:''}),[notice,setNotice]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false);
  async function issue(e) {
    e.preventDefault();setBusy(true);setCode('');
    try{const d=await department({action:'issue-student',module,assignmentId,...fields});setCode(d.code);setNotice('Deliver this code privately with the assignment link. Issuing again rotates only this student’s code; it does not reset coaching usage.');onChange?.();}
    catch(e){setNotice(e.message);}finally{setBusy(false);}
  }
  return <form className="department-card" onSubmit={issue}><h3>Private student access</h3><p>Issue a separate code for each student. Existing emails are matched within this assignment.</p><div className="department-grid">{['firstName','lastName','email'].map(k=><label key={k}>{({firstName:'First name',lastName:'Last name',email:'Student email'})[k]}<input required type={k==='email'?'email':'text'} value={fields[k]} onChange={e=>setFields({...fields,[k]:e.target.value})}/></label>)}</div>{module==='enscribe'&&<label>Optional independent draft import (paste a teacher-exported Exam.net draft)<textarea value={fields.original} onChange={e=>setFields({...fields,original:e.target.value})}/><small>First import only. An existing original can never be replaced.</small></label>}<button disabled={busy}>Issue private student code</button>{notice&&<p role="status">{notice}</p>}{code&&<p className="private-code"><strong>Copy now:</strong> <code>{code}</code></p>}</form>;
}
export function AccountAdmin({teachers,refresh}) {
  const [notice,setNotice]=useState(''),[code,setCode]=useState(''),[busy,setBusy]=useState(false);
  async function act(action,teacher) {
    if(action==='issue' && teacher.active && !window.confirm('Rotate this account’s code and revoke its existing sessions?')) return;
    if(action==='disable'&&!window.confirm('Disable this account and revoke its sessions?')) return;
    let displayName=teacher.displayName;
    if(action==='save'){displayName=window.prompt('Verified display name',displayName);if(!displayName)return;}
    setBusy(true);setCode('');
    try {const d=await department({action,teacherId:teacher.teacherId,teacher:{...teacher,displayName}},'/api/teachers');setCode(d.code || '');setNotice(d.message || 'Account updated.');await refresh();}
    catch(e){setNotice(e.message);}finally{setBusy(false);}
  }
  return <section className="department-card"><h2>Department accounts</h2><p>One individual staff code works in both tools. No invitations are sent automatically.</p>{notice&&<p role="status">{notice}</p>}{code&&<p className="private-code">Copy and deliver privately: <code>{code}</code></p>}{teachers.map(t=><div className="account-line" key={t.teacherId}><div><strong>{t.displayName}</strong><p>{t.email || 'Existing administrator'} · {t.activationState} · {t.role}</p></div><div className="department-actions"><button disabled={busy} onClick={()=>act('issue',t)}>{t.active?'Rotate code':'Activate / issue code'}</button><button disabled={busy} onClick={()=>act('save',t)}>Edit name</button><button disabled={busy||!t.active} onClick={()=>act('disable',t)}>Disable</button></div></div>)}</section>;
}
