import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getSql } from './db.js';
const scrypt = promisify(scryptCallback);
export const ROSTER = ['marksd@ensworth.com','crumpk@ensworth.com','bradshawm@ensworth.com','brownk@ensworth.com','berrya@ensworth.com','kaminskim@ensworth.com','millerj@ensworth.com'];
export const digest = value => createHash('sha256').update(String(value || '')).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function equal(a,b) { return timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b))); }
export async function passwordHash(code, salt) {
  return 'scrypt:' + (await scrypt(code, salt, 64, { N: 16384, r: 8, p: 1 })).toString('hex');
}
export async function passwordMatches(code, row) {
  const candidate = row.code_hash.startsWith('scrypt:') ? await passwordHash(code, row.code_salt) : digest(`${row.code_salt}:${code}`);
  return equal(candidate, row.code_hash);
}
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function checkOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') fail(403, 'Use this application from its own website.');
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail(415, 'JSON required.');
}
export async function rateLimit(key, limit = 30, seconds = 900) {
  const sql = getSql();
  const bucket = Math.floor(Date.now() / (seconds * 1000));
  const rows = await sql`INSERT INTO department_rate_limits (key, bucket, count) VALUES (${digest(key)}, ${bucket}, 1)
    ON CONFLICT (key, bucket) DO UPDATE SET count = department_rate_limits.count + 1 RETURNING count`;
  if (rows[0].count > limit) fail(429, 'Too many attempts. Please try again later.');
}
export function cookieToken(request) {
  return (request.headers.get('cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('department_session='))?.slice(19) || '';
}
export const sessionCookie = value => `department_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${value ? 28800 : 0}`;
export async function createSession(staff) {
  const value = token();
  const sql = getSql();
  await sql`INSERT INTO department_sessions (token_hash, teacher_id, credential_hash, expires_at)
    SELECT ${digest(value)}, teacher_id, code_hash, NOW() + INTERVAL '8 hours' FROM endepth_teachers WHERE teacher_id = ${staff.teacherId} AND active = TRUE`;
  return value;
}
export async function sessionStaff(request) {
  const sql = getSql();
  const rows = await sql`SELECT t.teacher_id, t.slug, t.display_name, t.email, t.role FROM department_sessions s
    JOIN endepth_teachers t ON t.teacher_id = s.teacher_id
    WHERE s.token_hash = ${digest(cookieToken(request))} AND s.expires_at > NOW() AND t.active = TRUE AND s.credential_hash = t.code_hash`;
  const t = rows[0];
  return t ? { teacherId:t.teacher_id, slug:t.slug, displayName:t.display_name, email:t.email, role:t.role } : null;
}
export async function requireStaff(request) {
  checkOrigin(request);
  const staff = await sessionStaff(request);
  if (!staff) fail(401, 'Sign in with your individual staff code.');
  return staff;
}
