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

/**
 * StudentWorkspace intentionally has no access to a student's identity. This
 * narrow fetch bridge adds the email only to our own /api/coach request so the
 * server can enforce four successful questions per assignment/student. The
 * coach prompt builder never includes this field in the OpenAI request.
 */
export function installCoachIdentityBridge() {
  if (typeof window === "undefined" || window.__endepthCoachIdentityBridge) return;
  window.__endepthCoachIdentityBridge = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init?.method || (typeof input !== "string" ? input?.method : "GET"))
      .toUpperCase();

    if (method === "POST" && /(^|\/)api\/coach(?:\?|$)/.test(url)) {
      try {
        const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
        if (body && body.assignment?.assignmentId) {
          body.assignmentId = body.assignment.assignmentId;
          body.studentEmail = currentStudentEmail();
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
