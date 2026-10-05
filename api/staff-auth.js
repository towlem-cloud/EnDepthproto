import { authenticateStaffCode, ensurePilotSchema, json } from '../server/submissions-db.js';
import { checkOrigin, rateLimit, createSession, sessionStaff, sessionCookie, cookieToken, digest } from '../server/security.js';

export default { async fetch(request) {
  if (request.method !== 'POST') return json({error:'Use POST.'},405);
  try {
    checkOrigin(request);
    const sql = await ensurePilotSchema();
    const body = await request.json();
    if (body.action === 'logout') {
      await sql`DELETE FROM department_sessions WHERE token_hash = ${digest(cookieToken(request))}`;
      return Response.json({ok:true},{headers:{'Set-Cookie':sessionCookie(''),'Cache-Control':'no-store'}});
    }
    if (body.action === 'session') return json({staff:await sessionStaff(request)});
    await rateLimit('login:' + (request.headers.get('x-vercel-forwarded-for') || 'local'),30);
    const staff = await authenticateStaffCode(body.code);
    if (!staff) return json({error:'That staff code was not accepted.'},401);
    const value = await createSession(staff);
    return Response.json({staff},{headers:{'Set-Cookie':sessionCookie(value),'Cache-Control':'no-store'}});
  } catch (error) { return json({error:error.status ? error.message : 'Staff sign-in could not be completed.'},error.status || 500); }
}};
