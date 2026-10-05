import { ensurePilotSchema,json } from '../server/submissions-db.js';
import { checkOrigin } from '../server/security.js';
import { studentAccess } from '../server/studio.js';
import { coach } from '../server/coaching.js';
export default {async fetch(request) {
  if(request.method!=='POST') return json({error:'Use POST.'},405);
  try {
    checkOrigin(request); await ensurePilotSchema();
    const body=await request.json();
    body.module='endepth'; body.assignmentId ||= body.assignment?.assignmentId;
    body.studentToken ||= body.accessCode;
    const {student,assignment}=await studentAccess(body);
    return json(await coach(student,assignment,body));
  } catch(e) {return json({error:e.status ? e.message:'Coaching could not complete. No simulated response was substituted.'},e.status || 500);}
}};
