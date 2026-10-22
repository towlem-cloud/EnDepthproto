import { createPublicKey, verify as verifySignature, timingSafeEqual } from "node:crypto";
import { assert, digest, HttpError, rateLimit, sameOrigin, token } from "./department-security.js";
import { studentCookie } from "./enscribe-service.js";
import { getSchoolGoogleSettings, startSchoolGoogle, admitSchoolGoogle } from "./school-google-service.js";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const BINDING_COOKIE = "__Host-enscribe_google_binding";
const RANDOM_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const MAX_JWKS_BYTES = 64 * 1024;
const REJECTED = "School Google sign-in was not accepted. Use your approved school account and try again.";
const UNAVAILABLE = "Google sign-in verification is temporarily unavailable. Please try again.";
let keyCache = null, keyRequest = null, lastRefresh = 0;

function reject() { throw new HttpError(401, REJECTED); }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function parsePart(value, maxBytes) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) reject();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length > maxBytes || bytes.toString("base64url") !== value) reject();
  try {
    const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(result)) reject();
    return result;
  } catch { reject(); }
}
function checkedSettings(clientId, domains) {
  assert(typeof clientId === "string" && /^[A-Za-z0-9_-]{5,240}\.apps\.googleusercontent\.com$/.test(clientId),
    503, "School Google sign-in is not configured.");
  assert(Array.isArray(domains) && domains.length > 0 && domains.length <= 20,
    503, "School Google sign-in is not configured.");
  const normalized = domains.map((value) => typeof value === "string" ? value.toLowerCase() : "");
  assert(normalized.every((value) => value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)),
    503, "School Google sign-in is not configured.");
  // A personal Google mail account never proves membership in a school Workspace.
  assert(!normalized.some((domain) => domain === "gmail.com" || domain === "googlemail.com"),
    503, "School Google sign-in is not configured.");
  return { clientId, domains: new Set(normalized) };
}
async function boundedJwks(response) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_JWKS_BYTES)) throw new Error("JWKS_SIZE");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("JWKS_BODY");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JWKS_BYTES) throw new Error("JWKS_SIZE");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (!isRecord(result) || !Array.isArray(result.keys) || result.keys.length < 1 || result.keys.length > 20) throw new Error("JWKS_KEYS");
  return result.keys;
}
async function refreshKeys() {
  if (!keyRequest) {
    lastRefresh = Date.now();
    keyRequest = (async () => {
      try {
        const response = await fetch(GOOGLE_JWKS_URL, {
          method: "GET", redirect: "error", headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("JWKS_RESPONSE");
        const keys = await boundedJwks(response);
        const parsed = new Map();
        for (const jwk of keys) {
          if (!isRecord(jwk) || jwk.kty !== "RSA" || jwk.use !== "sig" || (jwk.alg && jwk.alg !== "RS256")
            || typeof jwk.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(jwk.kid)
            || typeof jwk.n !== "string" || !/^[A-Za-z0-9_-]{256,1400}$/.test(jwk.n)
            || typeof jwk.e !== "string" || !/^[A-Za-z0-9_-]{1,12}$/.test(jwk.e)
            || (jwk.key_ops && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes("verify")))
            || parsed.has(jwk.kid)) throw new Error("JWKS_KEY");
          const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
          if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails?.modulusLength < 2048) throw new Error("JWKS_KEY");
          parsed.set(jwk.kid, key);
        }
        const cacheHeader = response.headers.get("cache-control") || "";
        const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(cacheHeader);
        const age = Number(response.headers.get("age") || 0);
        const ttl = /(?:^|,)\s*(?:no-store|no-cache)(?:\s|,|$)/i.test(cacheHeader) ? 0 :
          Math.max(0, Math.min(3600, maxAge ? Number(maxAge[1]) : 300) - (Number.isFinite(age) ? Math.max(age, 0) : 0));
        keyCache = { keys: parsed, expires: Date.now() + ttl * 1000 };
      } catch {
        // Provider diagnostics and credentials never enter application logs/errors.
        throw new HttpError(503, UNAVAILABLE);
      }
    })().finally(() => { keyRequest = null; });
  }
  await keyRequest;
}
async function googleKey(kid) {
  const now = Date.now();
  if (!keyCache || keyCache.expires <= now) await refreshKeys();
  let found = keyCache.keys.get(kid);
  // Refresh for rotation, bounded globally to prevent arbitrary-kid fetch amplification.
  if (!found && now - lastRefresh >= 60000) { await refreshKeys(); found = keyCache.keys.get(kid); }
  if (!found) reject();
  return found;
}

/** Verify only Google's published signing keys; token-supplied keys/URLs are never consulted. */
export async function verifySchoolGoogleCredential(credential, { clientId, domains, nonce } = {}) {
  const settings = checkedSettings(clientId, domains);
  if (typeof credential !== "string" || credential.length > 16384) reject();
  const parts = credential.split(".");
  if (parts.length !== 3) reject();
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parsePart(encodedHeader, 2048), claims = parsePart(encodedPayload, 8192);
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)
    || Object.hasOwn(header, "jwk") || Object.hasOwn(header, "jku") || Object.hasOwn(header, "x5u")
    || Object.hasOwn(header, "crit") || Object.hasOwn(header, "b64")) reject();
  if (!encodedSignature || !/^[A-Za-z0-9_-]{1,1400}$/.test(encodedSignature)) reject();
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.toString("base64url") !== encodedSignature) reject();
  const key = await googleKey(header.kid);
  let verified = false;
  try { verified = verifySignature("RSA-SHA256", Buffer.from(`${encodedHeader}.${encodedPayload}`), key, signature); } catch { reject(); }
  if (!verified) reject();
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.has(claims.iss)
    || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
    || claims.exp <= now || claims.iat > now + 60 || claims.iat < 0
    || claims.exp <= claims.iat || claims.exp - claims.iat > 7200
    || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 60))
    || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)
    || typeof claims.nonce !== "string" || !RANDOM_TOKEN.test(claims.nonce)) reject();
  const audience = claims.aud;
  if (typeof audience === "string") { if (audience !== settings.clientId) reject(); }
  else if (!Array.isArray(audience) || audience.length < 1 || audience.length > 8
    || !audience.every((value) => typeof value === "string" && value.length <= 300)
    || !audience.includes(settings.clientId) || (audience.length > 1 && claims.azp !== settings.clientId)) reject();
  if (claims.azp !== undefined && claims.azp !== settings.clientId) reject();
  if (nonce !== undefined && (typeof nonce !== "string" || !RANDOM_TOKEN.test(nonce)
    || !timingSafeEqual(Buffer.from(claims.nonce), Buffer.from(nonce)))) reject();
  if (claims.email_verified !== true || typeof claims.email !== "string" || claims.email.length > 254
    || claims.email !== claims.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)
    || typeof claims.hd !== "string") reject();
  const email = claims.email.toLowerCase(), domain = claims.hd.toLowerCase();
  if (!settings.domains.has(domain) || email.slice(email.lastIndexOf("@") + 1) !== domain) reject();
  return {
    subject: claims.sub, email, nonce: claims.nonce,
    firstName: typeof claims.given_name === "string" ? claims.given_name.trim().slice(0, 160) : "",
    lastName: typeof claims.family_name === "string" ? claims.family_name.trim().slice(0, 160) : "",
  };
}

function browserBinding(request) {
  const matches = (request.headers.get("cookie") || "").split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(BINDING_COOKIE + "="));
  const raw = matches.length === 1 ? matches[0].slice(BINDING_COOKIE.length + 1) : "";
  return RANDOM_TOKEN.test(raw) ? raw : "";
}
const bindingCookie = (raw) => `${BINDING_COOKIE}=${raw}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`;
function assignmentSlug(body) {
  assert(typeof body.assignmentSlug === "string" && /^[A-Za-z0-9_-]{16,120}$/.test(body.assignmentSlug),
    400, "Use the shared writing assignment link from your teacher.");
  return body.assignmentSlug;
}
export async function studentGoogleAccess(sql, request, body) {
  sameOrigin(request);
  assert(body && ["student-google-start", "student-google-login"].includes(body.action), 400, "Unsupported school sign-in action.");
  const slug = assignmentSlug(body);
  const ip = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") || "local";
  await rateLimit(sql, "google:" + body.action + ":" + digest(ip + ":" + slug), 120, 600);
  if (body.action === "student-google-start") {
    const previous = browserBinding(request), binding = previous || token(), nonce = token();
    await rateLimit(sql, "google-start-binding:" + digest(binding), 30, 600);
    const settings = await startSchoolGoogle(sql, { nonceHash: digest(nonce), bindingHash: digest(binding), assignmentSlug: slug });
    assert(settings.enabled === true, 403, "School Google sign-in is not enabled.");
    checkedSettings(settings.client_id, settings.allowed_domains);
    return { clientId: settings.client_id, nonce, domains: settings.allowed_domains,
      ...(!previous ? { cookie: bindingCookie(binding) } : {}) };
  }
  const binding = browserBinding(request);
  assert(binding, 401, "Begin school Google sign-in again in this browser.");
  await rateLimit(sql, "google-login-binding:" + digest(binding), 30, 600);
  const settings = await getSchoolGoogleSettings(sql);
  assert(settings.enabled === true, 403, "School Google sign-in is not enabled.");
  const identity = await verifySchoolGoogleCredential(body.credential, { clientId: settings.client_id, domains: settings.allowed_domains });
  const rawSession = token();
  const result = await admitSchoolGoogle(sql, {
    nonceHash: digest(identity.nonce), bindingHash: digest(binding), assignmentSlug: slug,
    configVersion: settings.config_version, subject: identity.subject, email: identity.email,
    firstName: identity.firstName, lastName: identity.lastName,
    sessionHash: digest(rawSession), credentialHash: digest(token()),
  });
  assert(result && typeof result.student_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(result.student_id), 503, "The writing workspace could not be opened.");
  return { studentId: result.student_id, writerPath: `/?tool=enscribe&writer=${encodeURIComponent(result.student_id)}&assignment=${encodeURIComponent(slug)}`, cookie: studentCookie(rawSession) };
}
