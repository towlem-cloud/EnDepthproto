import React, { useEffect, useRef, useState } from "react";
import { post } from "./departmentApi.js";

let googleScript;
function loadGoogleSignIn() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (!googleScript) {
    googleScript = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => { script.remove(); reject(new Error("Google sign-in took too long to load. Check your connection and try again.")); }, 15000);
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => {
        window.clearTimeout(timer);
        if (window.google?.accounts?.id) resolve(window.google.accounts.id);
        else { script.remove(); reject(new Error("Google sign-in could not load.")); }
      };
      script.onerror = () => { window.clearTimeout(timer); script.remove(); reject(new Error("Google sign-in could not load. Check your connection and try again.")); };
      document.head.appendChild(script);
    }).catch((error) => { googleScript = null; throw error; });
  }
  return googleScript;
}

export default function SchoolGoogleStudent({ assignmentSlug }) {
  const [error, setError] = useState("");
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  const buttonRef = useRef(null), startRef = useRef(null), loginRef = useRef(false);
  useEffect(() => {
    let active = true;
    setError(""); setStatus("loading"); loginRef.current = false;
    // Share the initial request across StrictMode's effect replay: a second nonce
    // response must not replace the binding cookie used by the displayed button.
    if (!startRef.current || startRef.current.key !== assignmentSlug + ":" + attempt)
      startRef.current = { key: assignmentSlug + ":" + attempt, promise: post("student-google-start", { assignmentSlug }) };
    async function open() {
      try {
        const setup = await startRef.current.promise;
        if (!active) return;
        const google = await loadGoogleSignIn();
        if (!active || !buttonRef.current) return;
        google.initialize({
          client_id: setup.clientId,
          nonce: setup.nonce,
          auto_select: false,
          ...(setup.domains?.[0] ? { hd: setup.domains[0] } : {}),
          callback: async (response) => {
            if (!active || loginRef.current) return;
            if (!response?.credential) { setError("Google did not confirm your sign-in. Try again."); return; }
            loginRef.current = true; setStatus("verifying"); setError("");
            try {
              const result = await post("student-google-login", { assignmentSlug, credential: response.credential });
              if (!active) return;
              const destination = new URL(result.writerPath, window.location.origin);
              if (destination.origin !== window.location.origin || destination.searchParams.get("tool") !== "enscribe" || destination.searchParams.get("writer") !== result.studentId || destination.hash)
                throw new Error("Your private workspace could not be opened. Ask your teacher for help.");
              window.location.assign(destination.pathname + destination.search);
            } catch (failure) {
              if (active) { setError(failure.message); setStatus("error"); }
              loginRef.current = false;
            }
          },
        });
        buttonRef.current.replaceChildren();
        google.renderButton(buttonRef.current, {
          type: "standard", theme: "outline", size: "large", text: "signin_with",
          width: Math.min(340, Math.max(200, buttonRef.current.clientWidth)),
        });
        setStatus("ready");
      } catch (failure) {
        if (active) { setError(failure.message); setStatus("error"); }
      }
    }
    open();
    return () => { active = false; buttonRef.current?.replaceChildren(); };
  }, [assignmentSlug, attempt]);
  return (
    <main className="department department-school-signin">
      <header className="department-masthead">
        <a href="/" className="department-brand" aria-label="EnDepth home">
          <span className="department-brand-mark">E</span>
          <span><strong>EnScribe</strong><small>WRITING STUDIO</small></span>
        </a>
        <span className="department-access-label">Private student access</span>
      </header>
      <div className="department-body">
        <section className="department-school-card">
          <p className="department-eyebrow">The writer does the thinking</p>
          <h1>EnScribe Writing Studio</h1>
          <p>Your thinking. Your writing.</p>
          <h2>Sign in with your school Google account</h2>
          <p>Use the school-managed Google account approved for this class. Your verified sign-in opens your own private workspace; an email address alone does not grant access.</p>
          <p role="status" aria-live="polite">{status === "loading" ? "Preparing secure Google sign-in…" : status === "verifying" ? "Verifying your school account and opening your private workspace…" : ""}</p>
          <div className="department-google-button" ref={buttonRef} hidden={status !== "ready"} />
          {error && <p role="alert" className="notice">{error}</p>}
          {status === "error" && <button className="department-secondary" onClick={() => setAttempt((value) => value + 1)}>Try Google sign-in again</button>}
          <p>If Google access is unavailable, ask your teacher for your private student link.</p>
          <p className="department-school-privacy">Google verifies your account. Live coaching separately sends academic writing to the AI provider when you request a check. Known identity fields are excluded from those coaching requests; writing itself may identify you.</p>
        </section>
      </div>
    </main>
  );
}
