import {
  randomBytes,
  createHash,
  scrypt as rawScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getSql, hashTeacherCode } from "../lib/endepth-db.js";
const scrypt = promisify(rawScrypt);
export const APPROVED = [
  "marksd@ensworth.com",
  "crumpk@ensworth.com",
  "bradshawm@ensworth.com",
  "brownk@ensworth.com",
  "berrya@ensworth.com",
  "kaminskim@ensworth.com",
  "millerj@ensworth.com",
];
export const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export const id = (prefix) => `${prefix}_${randomBytes(16).toString("hex")}`;
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function assert(ok, status, message) {
  if (!ok) throw new HttpError(status, message);
}
export function owned(staff, owner) {
  assert(
    staff && (staff.role === "admin" || staff.teacherId === owner),
    403,
    "Access denied.",
  );
}
export async function passwordHash(code, salt) {
  return Buffer.from(
    await scrypt(code, salt, 64, { N: 16384, r: 8, p: 1 }),
  ).toString("hex");
}
export async function passwordMatches(code, row) {
  const candidate =
    row.auth_scheme === "scrypt"
      ? await passwordHash(code, row.code_salt)
      : hashTeacherCode(code, row.code_salt);
  const a = Buffer.from(candidate),
    b = Buffer.from(row.code_hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
let ready;
export async function database() {
  if (!ready)
    ready = (async () => {
      const sql = getSql();
      try {
        const installed =
          await sql`SELECT version FROM department_schema_version WHERE id=1`;
        assert(
          installed[0]?.version === 1,
          503,
          "Department migration must be applied before sign-in.",
        );
      } catch (error) {
        throw new HttpError(
          503,
          "Department migration must be applied before sign-in.",
        );
      }
      return sql;
    })().catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
export function sameOrigin(request) {
  const url = new URL(request.url),
    origin = request.headers.get("origin");
  assert(origin === url.origin, 403, "A same-origin request is required.");
  assert(
    request.headers.get("sec-fetch-site") !== "cross-site",
    403,
    "Cross-site request rejected.",
  );
  assert(
    (request.headers.get("content-type") || "").startsWith("application/json"),
    415,
    "Use application/json.",
  );
}
export async function rateLimit(sql, bucket, max = 20, seconds = 600) {
  const rows =
    await sql`INSERT INTO department_rate_limits(bucket,attempts,expires_at)
 VALUES(${bucket},1,NOW()+${seconds}*INTERVAL '1 second')
 ON CONFLICT(bucket) DO UPDATE SET
 attempts=CASE WHEN department_rate_limits.expires_at<NOW() THEN 1 ELSE department_rate_limits.attempts+1 END,
 expires_at=CASE WHEN department_rate_limits.expires_at<NOW() THEN NOW()+${seconds}*INTERVAL '1 second' ELSE department_rate_limits.expires_at END
 RETURNING attempts`;
  assert(
    rows[0].attempts <= max,
    429,
    "Too many attempts. Please wait before retrying.",
  );
}
export const staffCookie = (value, age = 28800) =>
  `department_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
function cookie(request, name) {
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export async function session(request, sql = null) {
  sql ||= await database();
  const hash = digest(cookie(request, "department_session"));
  const rows =
    await sql`SELECT s.*,t.slug,t.display_name,t.email,t.active,t.activation_state,t.credential_version AS teacher_version,
 a.credential_version AS admin_version
 FROM department_sessions s LEFT JOIN endepth_teachers t ON s.teacher_id=t.teacher_id
 LEFT JOIN department_admin a ON s.role='admin' AND a.id=1
 WHERE s.token_hash=${hash} AND s.expires_at>NOW()`;
  const row = rows[0];
  assert(
    row &&
      (row.role === "admin"
        ? row.credential_version === row.admin_version
        : row.active &&
          row.activation_state === "active" &&
          row.credential_version === row.teacher_version),
    401,
    "Sign in again.",
  );
  return {
    role: row.role,
    teacherId: row.teacher_id,
    slug: row.slug,
    displayName: row.display_name || "Department administrator",
    email: row.email || "",
  };
}
export async function authenticateRequest(request) {
  sameOrigin(request);
  return session(request);
}
export async function login(request, code, email = "", sql = null) {
  sql ||= await database();
  assert(
    typeof code === "string" && code.length >= 8 && code.length <= 300,
    401,
    "Credential not accepted.",
  );
  const ip =
    request.headers.get("x-vercel-forwarded-for") ||
    request.headers.get("x-forwarded-for") ||
    "local";
  await rateLimit(sql, "login:" + digest(ip), 15, 600);
  const admins = await sql`SELECT * FROM department_admin WHERE id=1`;
  // Seed the administrator once. A rotation makes the environment credential unusable.
  if (!admins.length && process.env.ENDEPTH_ADMIN_CODE) {
    const salt = token(),
      hash = await passwordHash(process.env.ENDEPTH_ADMIN_CODE, salt);
    await sql`INSERT INTO department_admin(id,code_hash,code_salt) VALUES(1,${hash},${salt}) ON CONFLICT(id) DO NOTHING`;
  }
  const admin = (await sql`SELECT * FROM department_admin WHERE id=1`)[0];
  let staff, version;
  if (admin && (await passwordMatches(code, admin))) {
    staff = {
      role: "admin",
      teacherId: null,
      displayName: "Department administrator",
      email: "",
    };
    version = admin.credential_version;
  } else {
    const rows = email
      ? await sql`SELECT * FROM endepth_teachers WHERE active=TRUE AND activation_state='active' AND lower(email)=${email.toLowerCase().trim()}`
      : await sql`SELECT * FROM endepth_teachers WHERE active=TRUE AND activation_state='active' ORDER BY created_at`;
    for (const row of rows) {
      if (await passwordMatches(code, row)) {
        if (row.auth_scheme !== "scrypt") {
          const salt = token(),
            hash = await passwordHash(code, salt);
          const upgraded =
            await sql`UPDATE endepth_teachers SET code_salt=${salt},code_hash=${hash},auth_scheme='scrypt'
     WHERE teacher_id=${row.teacher_id} AND credential_version=${row.credential_version} AND code_hash=${row.code_hash} AND active=TRUE RETURNING teacher_id`;
          assert(upgraded.length, 401, "Credential changed. Sign in again.");
        }
        staff = {
          role: "teacher",
          teacherId: row.teacher_id,
          slug: row.slug,
          displayName: row.display_name,
          email: row.email,
        };
        version = row.credential_version;
        break;
      }
    }
  }
  assert(staff, 401, "Credential not accepted.");
  const raw = token();
  await sql`INSERT INTO department_sessions(token_hash,teacher_id,role,credential_version,expires_at)
 VALUES(${digest(raw)},${staff.teacherId},${staff.role},${version},NOW()+INTERVAL '8 hours')`;
  // A concurrent disable/rotation must invalidate the newly minted session too.
  await session(
    new Request(request.url, {
      headers: { cookie: "department_session=" + raw },
    }),
    sql,
  );
  return { staff, cookie: staffCookie(raw) };
}
export async function logout(request, sql = null) {
  sql ||= await database();
  await sql`DELETE FROM department_sessions WHERE token_hash=${digest(cookie(request, "department_session"))}`;
  return staffCookie("", 0);
}
export async function onboard(sql) {
  for (const email of APPROVED) {
    const existing =
      await sql`SELECT teacher_id FROM endepth_teachers WHERE lower(email)=${email}`;
    assert(
      existing.length <= 1,
      409,
      "Duplicate existing teacher email requires administrator reconciliation.",
    );
    if (existing.length) continue;
    await sql`INSERT INTO endepth_teachers(teacher_id,slug,display_name,email,code_salt,code_hash,active,activation_state,auth_scheme)
   VALUES(${id("teacher")},${"approved-" + email.split("@")[0]},${email},${email},${token()},'',FALSE,'awaiting activation','scrypt')
   ON CONFLICT(slug) DO NOTHING`;
  }
}
export async function manageAccount(sql, staff, body) {
  assert(staff.role === "admin", 403, "Administrator required.");
  await rateLimit(sql, "manage:" + (staff.teacherId || "admin"), 30, 600);
  if (body.action === "onboard") {
    await onboard(sql);
    return { ok: true };
  }
  if (body.action === "admin-rotate") {
    const raw = token(),
      salt = token(),
      hash = await passwordHash(raw, salt);
    await sql`UPDATE department_admin SET code_hash=${hash},code_salt=${salt},credential_version=credential_version+1 WHERE id=1`;
    await sql`DELETE FROM department_sessions WHERE role='admin'`;
    return { newCode: raw };
  }
  const rows =
    await sql`SELECT * FROM endepth_teachers WHERE teacher_id=${body.teacherId || ""}`;
  const teacher = rows[0];
  assert(teacher, 404, "Account not found.");
  if (body.action === "rotate") {
    const raw = token(),
      salt = token(),
      hash = await passwordHash(raw, salt);
    await sql`UPDATE endepth_teachers SET code_hash=${hash},code_salt=${salt},auth_scheme='scrypt',
   credential_version=credential_version+1,active=TRUE,activation_state='active',updated_at=NOW() WHERE teacher_id=${teacher.teacher_id}`;
    await sql`DELETE FROM department_sessions WHERE teacher_id=${teacher.teacher_id}`;
    return { newCode: raw };
  }
  if (body.action === "disable") {
    await sql`UPDATE endepth_teachers SET active=FALSE,activation_state='disabled',credential_version=credential_version+1,updated_at=NOW() WHERE teacher_id=${teacher.teacher_id}`;
    await sql`DELETE FROM department_sessions WHERE teacher_id=${teacher.teacher_id}`;
    return { ok: true };
  }
  if (body.action === "rename") {
    assert(
      typeof body.displayName === "string" &&
        body.displayName.trim().length > 0 &&
        body.displayName.length <= 160,
      400,
      "Display name required.",
    );
    await sql`UPDATE endepth_teachers SET display_name=${body.displayName.trim()},updated_at=NOW() WHERE teacher_id=${teacher.teacher_id}`;
    return { ok: true };
  }
  throw new HttpError(400, "Unsupported account action.");
}
