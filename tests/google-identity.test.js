import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

const clientId = "1234567890-synthetic-school.apps.googleusercontent.com";
const domains = ["school.example"];
const nonce = randomBytes(32).toString("base64url");
const jwksUrl = "https://www.googleapis.com/oauth2/v3/certs";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "synthetic-google-key", alg: "RS256", use: "sig" };
const otherJwk = { ...otherPair.publicKey.export({ format: "jwk" }), kid: "synthetic-google-rotation", alg: "RS256", use: "sig" };
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: "https://accounts.google.com", aud: clientId, sub: "synthetic-school-subject", iat: now - 2, exp: now + 3598,
    email: "student@school.example", email_verified: true, hd: "school.example", nonce,
    given_name: "Synthetic", family_name: "Student", ...overrides };
}
function credential(payload = claims(), header = {}, key = pair.privateKey) {
  const body = `${encode({ alg: "RS256", kid: jwk.kid, typ: "JWT", ...header })}.${encode(payload)}`;
  return `${body}.${sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")}`;
}
async function verifier() {
  return (await import(`../lib/google-school-access.js?test=${randomBytes(8).toString("hex")}`)).verifySchoolGoogleCredential;
}
function mockKeys(t, options = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    assert.equal(url, jwksUrl);
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "GET");
    assert.ok(init.signal instanceof AbortSignal);
    if (options.throwError) throw new Error(options.throwError);
    return options.response ? options.response() : Response.json({ keys: options.keys || [jwk] }, {
      headers: { "Cache-Control": options.cacheControl || "public, max-age=3600", ...(options.headers || {}) },
    });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}
const options = { clientId, domains, nonce };
const unauthorized = (error) => error.status === 401 && !error.message.includes("eyJ");

test("valid signed Workspace identity uses exact issuer/audience/domain and returns only verified identity fields", async (t) => {
  const calls = mockKeys(t);
  const verify = await verifier();
  assert.deepEqual(await verify(credential(), options), {
    subject: "synthetic-school-subject", email: "student@school.example", nonce,
    firstName: "Synthetic", lastName: "Student",
  });
  const alternateIssuer = await verify(credential(claims({ iss: "accounts.google.com", email: "Student@SCHOOL.EXAMPLE", hd: "SCHOOL.EXAMPLE" })), options);
  assert.equal(alternateIssuer.email, "student@school.example");
  assert.equal(calls.length, 1);
  assert.equal((await verify(credential(claims({ given_name: undefined, family_name: undefined })), options)).firstName, "");
});

test("Google signature, issuer, audience/authorized party, timestamps, nonce and stable subject are mandatory", async (t) => {
  mockKeys(t);
  const verify = await verifier(), now = Math.floor(Date.now() / 1000);
  const cases = [
    { iss: "https://accounts.google.com.attacker.invalid" }, { iss: "https://login.microsoftonline.com" },
    { aud: "another.apps.googleusercontent.com" }, { aud: [] }, { aud: [clientId, "other-client"] },
    { aud: [clientId, "other-client"], azp: "other-client" }, { azp: "other-client" },
    { exp: now - 1 }, { exp: String(now + 3600) }, { iat: now + 90 }, { iat: "yesterday" },
    { exp: now - 1, iat: now - 2 }, { exp: now + 10000 }, { nbf: now + 1000 },
    { nonce: undefined }, { nonce: "client-supplied-nonce" }, { nonce: randomBytes(32).toString("base64url") },
    { sub: "" }, { sub: "   " }, { sub: 123 }, { sub: "x".repeat(256) },
  ];
  for (const invalid of cases) await assert.rejects(verify(credential(claims(invalid)), options), unauthorized);
  await assert.rejects(verify(credential(claims(), {}, otherPair.privateKey), options), unauthorized);
  assert.equal((await verify(credential(claims({ aud: [clientId, "other-client"], azp: clientId })), options)).subject, "synthetic-school-subject");
});

test("email identifiers or browser domain hints never replace verified Google Workspace claims", async (t) => {
  mockKeys(t); const verify = await verifier();
  const invalid = [
    { email_verified: false }, { email_verified: "true" }, { email_verified: undefined },
    { hd: undefined }, { hd: "elsewhere.example" }, { hd: "sub.school.example" },
    { hd: "gmail.com", email: "student@gmail.com" }, { email: "student@gmail.com" },
    { email: "student@elsewhere.example" }, { email: "student@sub.school.example" },
    { email: "student@school.example.attacker.invalid" }, { email: "student@school.example " },
    { email: "student@@school.example" }, { email: undefined },
  ];
  for (const candidate of invalid) await assert.rejects(verify(credential(claims(candidate)), options), unauthorized);
  for (const badDomains of [["*.school.example"], ["https://school.example"], ["gmail.com"], []]) {
    await assert.rejects(verify(credential(), { clientId, domains: badDomains, nonce }), (error) => error.status === 503);
  }
});

test("token-supplied algorithms, embedded keys and URLs cannot change Google's fixed trust source", async (t) => {
  const calls = mockKeys(t); const verify = await verifier();
  const headers = [
    { alg: "none" }, { alg: "HS256" }, { alg: "RS512" }, { kid: undefined }, { kid: "../../../untrusted" },
    { jku: "https://attacker.invalid/jwks" }, { x5u: "http://127.0.0.1/internal" },
    { jwk: otherJwk }, { crit: ["untrusted"] }, { b64: false },
  ];
  for (const header of headers) await assert.rejects(verify(credential(claims(), header), options), unauthorized);
  assert.equal(calls.length, 0);
  await assert.rejects(verify(credential(claims(), { kid: "unknown-google-key" }), options), unauthorized);
  assert.equal(calls.length, 1);
  await assert.rejects(verify(credential(claims(), { kid: "different-unknown-key" }), options), unauthorized);
  assert.equal(calls.length, 1); // Unknown key IDs cannot amplify provider requests.
});

test("malformed and oversized JWTs fail safely without fetching keys or retaining credentials", async (t) => {
  const calls = mockKeys(t); const verify = await verifier();
  const malformed = [undefined, null, 42, "", "not-a-token", "a.b.c.d", "e30.e30.", "***.***.***", "x".repeat(16385),
    `${encode([])}.${encode(claims())}.AA`, `${encode({ alg: "RS256", kid: jwk.kid })}.${encode("not-an-object")}.AA`,
    `${encode({ alg: "RS256", kid: jwk.kid })}.eyJub25jZSI6.eA`,
  ];
  for (const value of malformed) await assert.rejects(verify(value, options), unauthorized);
  assert.equal(calls.length, 0);
});

test("trusted key retrieval is bounded, fail-closed and sanitizes upstream failures without logging credentials", async (t) => {
  const originalError = console.error, logs = [];
  console.error = (...args) => logs.push(args);
  t.after(() => { console.error = originalError; });
  const marker = "synthetic-private-provider-diagnostic";
  mockKeys(t, { throwError: marker }); const verify = await verifier();
  await assert.rejects(verify(credential(), options), (error) => error.status === 503 && !error.message.includes(marker));
  assert.equal(logs.length, 0);
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      () => Response.json({ keys: [jwk] }, { status: 503 }),
      () => new Response("<html>not keys</html>", { headers: { "Content-Type": "text/html" } }),
      () => Response.json({ keys: [jwk] }, { headers: { "Content-Length": "65537" } }),
      () => Response.json({ keys: [jwk], padding: "x".repeat(65536) }),
      () => Response.json({ keys: [] }),
      () => Response.json({ keys: [jwk, jwk] }),
      () => Response.json({ keys: [{ ...jwk, kty: "EC" }] }),
      () => Response.json({ keys: [{ ...jwk, use: "enc" }] }),
    ]) {
      globalThis.fetch = async () => response();
      const isolated = await verifier();
      await assert.rejects(isolated(credential(), options), (error) => error.status === 503);
    }
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(logs.length, 0);
});

test("Google key rotation refreshes only the fixed JWKS endpoint and honors bounded cache lifetime", async (t) => {
  const actualNow = Date.now, started = actualNow(); let offset = 0, calls = 0;
  const originalFetch = globalThis.fetch;
  Date.now = () => started + offset;
  globalThis.fetch = async (url) => {
    assert.equal(url, jwksUrl); calls++;
    return Response.json({ keys: calls === 1 ? [jwk] : [jwk, otherJwk] }, { headers: { "Cache-Control": "public,max-age=86400" } });
  };
  t.after(() => { Date.now = actualNow; globalThis.fetch = originalFetch; });
  const verify = await verifier();
  await verify(credential(), options); assert.equal(calls, 1);
  offset = 61000;
  await verify(credential(claims(), { kid: otherJwk.kid }, otherPair.privateKey), options);
  assert.equal(calls, 2);
  offset += 3601000; // Clamp provider cache duration to one hour.
  await verify(credential(), options); assert.equal(calls, 3);
});
