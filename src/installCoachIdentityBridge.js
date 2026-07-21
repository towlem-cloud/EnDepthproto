const IDENTITY_STORAGE_KEY = "endepth-student-identity-v2";

function currentStudentEmail() {
  try {
    const saved = window.sessionStorage.getItem(IDENTITY_STORAGE_KEY);
    const identity = saved ? JSON.parse(saved) : {};
    return String(identity.email || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

async function studentCoachKey(assignmentId) {
  const email = currentStudentEmail();
  if (!assignmentId || !email || !window.crypto?.subtle) return "";

  const source = new TextEncoder().encode(`${assignmentId}:${email}`);
  const digest = await window.crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * StudentWorkspace intentionally has no access to student identity. This narrow
 * fetch bridge creates an opaque one-way key in the browser and adds only that
 * key to our own /api/coach request. The student's raw name and email remain
 * outside both the coach endpoint and the OpenAI request.
 */
export function installCoachIdentityBridge() {
  if (typeof window === "undefined" || window.__endepthCoachIdentityBridge) return;
  window.__endepthCoachIdentityBridge = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(
      init?.method || (typeof input !== "string" ? input?.method : "GET")
    ).toUpperCase();

    if (method === "POST" && /(^|\/)api\/coach(?:\?|$)/.test(url)) {
      try {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        const assignmentId = body?.assignment?.assignmentId;
        if (body && assignmentId) {
          body.assignmentId = assignmentId;
          body.studentCoachKey = await studentCoachKey(assignmentId);
          return nativeFetch(input, {
            ...init,
            body: JSON.stringify(body),
          });
        }
      } catch {
        // The coach endpoint will return its normal invalid-request response.
      }
    }

    return nativeFetch(input, init);
  };
}
