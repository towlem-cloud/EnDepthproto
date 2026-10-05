import { randomBytes } from 'node:crypto';
import { ensurePilotSchema, listTeachers, json, cleanString } from '../server/submissions-db.js';
import { requireStaff, rateLimit, token, passwordHash, fail } from '../server/security.js';
export default { async fetch(request) {
  if (request.method !== 'POST') return json({error:'Use POST.'},405);
  try {
    const sql = await ensurePilotSchema();
    const staff = await requireStaff(request);
    if (staff.role !== 'admin') fail(403,'Administrator access required.');
    const body = await request.json();
    if (body.action === 'list') return json({teachers:await listTeachers()});
    const id = cleanString(body.teacherId || body.teacher?.teacherId,100);
    const [account] = await sql`SELECT * FROM endepth_teachers WHERE teacher_id=${id}`;
    if (!account) fail(404,'Account not found.');
    if (body.action === 'issue') {
      await rateLimit('issue:' + staff.teacherId,30);
      const code = token(), salt = randomBytes(16).toString('hex');
      const hash = await passwordHash(code,salt);
      await sql`UPDATE endepth_teachers SET code_hash=${hash},code_salt=${salt},active=TRUE,activation_state='active',updated_at=NOW() WHERE teacher_id=${id}`;
      return json({code, message:'Copy this code now and deliver it privately. It will not be shown again.'});
    }
    if (body.action === 'disable') {
      if (id === staff.teacherId) fail(400,'You cannot disable your own administrator account.');
      await sql`UPDATE endepth_teachers SET active=FALSE,activation_state='disabled',updated_at=NOW() WHERE teacher_id=${id}`;
      await sql`DELETE FROM department_sessions WHERE teacher_id=${id}`;
      return json({ok:true});
    }
    if (body.action === 'save') {
      const name = cleanString(body.teacher?.displayName,160);
      if (!name) fail(400,'A display name is required.');
      // IDs, email matching, role and credentials cannot be changed via a generic edit.
      await sql`UPDATE endepth_teachers SET display_name=${name},updated_at=NOW() WHERE teacher_id=${id}`;
      return json({ok:true});
    }
    fail(400,'Unsupported teacher action.');
  } catch (e) {return json({error:e.status ? e.message : 'Teacher request failed.'},e.status || 500);}
}};
