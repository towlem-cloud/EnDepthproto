// Adds a stable retry ID to EnDepth calls. Identity is resolved server-side from the private code.
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
          const bytes = new TextEncoder().encode(JSON.stringify(body));
          const hashed = await window.crypto.subtle.digest('SHA-256', bytes);
          body.requestId = Array.from(new Uint8Array(hashed)).map(b=>b.toString(16).padStart(2,'0')).join('');
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
