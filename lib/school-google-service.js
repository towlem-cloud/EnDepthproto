import { assert, HttpError, id, rateLimit } from './department-security.js';

const SETUP_MESSAGE = 'School Google sign-in setup is not installed yet.';
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com',
  'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'mail.com',
  'gmx.com', 'gmx.net', 'yandex.com', 'yandex.ru', 'qq.com', '163.com',
  '126.com', 'hey.com', 'fastmail.com', 'zoho.com', 'tuta.com', 'tutanota.com',
]);
const SQL_ERRORS = {
  SCHOOL_GOOGLE_DISABLED: [403, 'School Google sign-in has not been enabled by the administrator.'],
  SCHOOL_GOOGLE_CONFIGURATION_CHANGED: [401, 'School sign-in settings changed. Start sign-in again.'],
  SCHOOL_GOOGLE_ASSIGNMENT_UNAVAILABLE: [403, 'School Google access is unavailable for this assignment.'],
  SCHOOL_GOOGLE_NONCE_REJECTED: [401, 'This sign-in attempt expired or was already used. Start sign-in again.'],
  SCHOOL_GOOGLE_DOMAIN_REJECTED: [403, 'Use a school Google account from an approved student domain.'],
  SCHOOL_GOOGLE_PROFILE_REQUIRED: [400, 'The Google account profile could not be used. Ask your teacher for help.'],
  SCHOOL_GOOGLE_IDENTITY_CONFLICT: [409, 'This assignment has conflicting student identity records. Ask your teacher to reconcile them.'],
  SCHOOL_GOOGLE_ADMIN_REQUIRED: [403, 'Administrator access is required.'],
  SCHOOL_GOOGLE_ACCESS_DENIED: [403, 'Access denied.'],
};
async function query(sql, statement, values = []) {
  try { return await sql.query(statement, values); }
  catch (error) {
    const match = Object.keys(SQL_ERRORS).find(code => String(error.message).includes(code));
    if (match) throw new HttpError(...SQL_ERRORS[match]);
    if (['42P01', '42703', '42883'].includes(error.code)) throw new HttpError(503, SETUP_MESSAGE);
    if (error.code === '23505') throw new HttpError(409, 'This sign-in attempt conflicts with an existing record. Start again or ask your teacher for help.');
    throw error;
  }
}
async function requireSchema(sql) {
  const rows = await query(sql, `SELECT to_regclass('public.department_school_google_settings') AS settings,
    to_regclass('public.enscribe_school_google_nonces') AS nonces`);
  assert(rows[0]?.settings && rows[0]?.nonces, 503, SETUP_MESSAGE);
}
function hash(value) { assert(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 400, 'Invalid sign-in attempt.'); return value; }
function slug(value) { assert(typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value), 400, 'Use the assignment link your teacher shared.'); return value; }
function publicSettings(row) { return { enabled: row.enabled, clientId: row.client_id, domains: row.allowed_domains }; }
export async function getSchoolGoogleSettings(sql) {
  await requireSchema(sql);
  const rows = await query(sql, 'SELECT enabled,client_id,allowed_domains,config_version FROM department_school_google_settings WHERE id=1');
  assert(rows[0], 503, SETUP_MESSAGE);
  return rows[0];
}
export async function startSchoolGoogle(sql, { nonceHash, bindingHash, assignmentSlug }) {
  await requireSchema(sql);
  const rows = await query(sql, 'SELECT * FROM enscribe_school_google_start($1,$2,$3)', [hash(nonceHash), hash(bindingHash), slug(assignmentSlug)]);
  assert(rows[0], 403, 'School Google access is unavailable for this assignment.');
  return rows[0];
}
export async function admitSchoolGoogle(sql, input) {
  await requireSchema(sql);
  assert(Number.isSafeInteger(input.configVersion) && input.configVersion > 0, 400, 'Invalid sign-in settings.');
  assert(typeof input.subject === 'string' && input.subject.trim() && input.subject.length <= 255, 400, 'Invalid Google account.');
  assert(typeof input.email === 'string' && input.email.length <= 254, 400, 'Invalid Google account email.');
  const firstName = input.firstName ?? '', lastName = input.lastName ?? '';
  assert(typeof firstName === 'string' && typeof lastName === 'string' && firstName.length <= 160 && lastName.length <= 160, 400, 'Invalid Google account profile.');
  const rows = await query(sql, 'SELECT * FROM enscribe_school_google_admit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
    hash(input.nonceHash), hash(input.bindingHash), slug(input.assignmentSlug), input.configVersion,
    input.subject, input.email, firstName, lastName, hash(input.sessionHash), hash(input.credentialHash), id('writer'),
  ]);
  assert(rows[0]?.student_id, 403, 'This Google account could not enter the assignment.');
  return rows[0];
}
function configuredDomains(value) {
  const domains = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,;]+/) : [];
  assert(domains.length <= 20, 400, 'Use at most 20 exact school domains.');
  const normalized = [...new Set(domains.map(domain => typeof domain === 'string' ? domain.trim().toLowerCase() : '').filter(Boolean))];
  for (const domain of normalized) {
    assert(domain.length <= 253 && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain), 400, 'Enter exact school domains without @, URLs, or wildcards.');
    assert(![...PUBLIC_EMAIL_DOMAINS].some(publicDomain => domain === publicDomain || domain.endsWith(`.${publicDomain}`)), 400, 'Public email provider domains cannot be used for school access.');
  }
  return normalized;
}
export async function staffGoogleAccess(sql, staff, body) {
  assert(staff && ['admin', 'teacher'].includes(staff.role), 401, 'Sign in to the staff portal.');
  await requireSchema(sql);
  if (body.action === 'google-school-settings') {
    assert(staff.role === 'admin', 403, 'Administrator access is required.');
    return { settings: publicSettings(await getSchoolGoogleSettings(sql)) };
  }
  if (body.action === 'google-school-configure') {
    assert(staff.role === 'admin', 403, 'Administrator access is required.');
    assert(typeof body.enabled === 'boolean', 400, 'Choose whether school Google access is enabled.');
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
    const domains = configuredDomains(body.domains);
    assert(!clientId || /^[A-Za-z0-9_-]{10,240}\.apps\.googleusercontent\.com$/.test(clientId), 400, 'Enter the Google web client ID.');
    assert(!body.enabled || clientId && domains.length, 400, 'Add a Google web client ID and exact school student domains before enabling access.');
    await rateLimit(sql, 'school-google-configure:admin', 20, 600);
    const rows = await query(sql, 'SELECT * FROM enscribe_school_google_configure($1,$2,$3,$4::text[])', [staff.role, body.enabled, clientId, domains]);
    return { settings: publicSettings(rows[0]) };
  }
  if (body.action === 'writing-google-access') {
    assert(typeof body.enabled === 'boolean', 400, 'Choose whether school sign-in is enabled for this assignment.');
    assert(typeof body.assignmentId === 'string' && body.assignmentId.length <= 100, 400, 'Choose an assignment.');
    await rateLimit(sql, `school-google-assignment:${staff.teacherId || 'admin'}`, 60, 600);
    const rows = await query(sql, 'SELECT * FROM enscribe_school_google_assignment($1,$2,$3,$4)', [staff.role, staff.teacherId || null, body.assignmentId, body.enabled]);
    assert(rows[0], 404, 'Assignment not found.');
    return { assignment: rows[0] };
  }
  throw new HttpError(400, 'Unsupported school Google access action.');
}

// Existing private invitations keep their pre-migration path. Once the optional
// feature is installed, all new invitations participate in the same atomic gate.
export async function inviteSchoolGoogleStudent(sql, staff, input) {
  const available = await query(sql, `SELECT to_regprocedure('enscribe_school_google_invite(text,text,text,text,text,text,text,text,text,text)') AS installed`);
  if (!available[0]?.installed) return false;
  const rows = await query(sql, 'SELECT * FROM enscribe_school_google_invite($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
    staff?.role || '', staff?.teacherId || null, input.assignmentId, input.studentId,
    input.credentialHash, input.firstName, input.lastName, input.email, input.original, input.revisionId,
  ]);
  assert(rows[0]?.student_id, 409, 'The student invitation could not be created.');
  return true;
}
