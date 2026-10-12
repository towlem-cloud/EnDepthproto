import React, { useEffect, useRef, useState } from "react";
import { post } from "./departmentApi.js";

export default function EndepthStudentGate({ assignment, children }) {
  const [student, setStudent] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const epochRef = useRef(0), busyRef = useRef(false);
  function clearPrivate(message = "") {
    epochRef.current += 1;
    setStudent(null); setCode(""); setError(message); setChecking(false);
    window.sessionStorage.removeItem("endepth-student-identity-v2");
    window.sessionStorage.removeItem("endepth-pilot-access-code");
  }
  useEffect(() => {
    let mounted = true;
    async function checkSession() {
      if (busyRef.current) return;
      const epoch = ++epochRef.current;
      setChecking(true);
      try {
        const data = await post("depth-student-session", { assignmentId: assignment.assignmentId });
        if (!data.student?.studentId) throw new Error("Student access was not confirmed.");
        if (mounted && epoch === epochRef.current) { setStudent(data.student); setError(""); }
      } catch (failure) {
        if (mounted && epoch === epochRef.current) clearPrivate(failure.status === 401 ? "" : failure.message);
      } finally { if (mounted && epoch === epochRef.current) setChecking(false); }
    }
    function invalidate() { if (mounted) clearPrivate("Your private student session expired or was revoked. Enter your current individual code."); }
    function onVisible() { if (!window.document.hidden) checkSession(); }
    checkSession();
    window.addEventListener("focus", checkSession);
    window.document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("depth-session-invalid", invalidate);
    return () => { mounted = false; window.removeEventListener("focus", checkSession); window.document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("depth-session-invalid", invalidate); };
  }, [assignment.assignmentId]);
  async function authenticate(event) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const epoch = ++epochRef.current;
    try {
      const data = await post("depth-student-login", { assignmentId: assignment.assignmentId, code: code.trim() });
      if (!data.student?.studentId) throw new Error("Student access was not confirmed.");
      if (epoch === epochRef.current) { setStudent(data.student); setCode(""); setChecking(false); }
    } catch (failure) { if (epoch === epochRef.current) setError(failure.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function signOut() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await post("depth-student-logout"); clearPrivate(); }
    catch (failure) { setError("Sign-out was not confirmed. " + failure.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  if (!student) return <main className="page"><section className="content-card department-student-access"><div className="card-kicker">Private student access</div><h1>Open your EnDepth preparation.</h1><p>Use the individual student code your teacher shared privately. Your email alone cannot open another student’s work.</p><form onSubmit={authenticate}><label><span>Individual student access code</span><input type="password" autoComplete="current-password" required value={code} onChange={(event) => setCode(event.target.value)} /></label><button type="submit" className="primary-button" disabled={checking || busy || !code.trim()}>{checking ? "Checking private session…" : busy ? "Verifying…" : "Open my workspace"}</button></form>{error ? <p className="inline-notice" role="alert">{error}</p> : null}<p>Live coaching sends your academic writing to the AI provider. Known identity fields are kept separate; writing itself may identify you.</p></section></main>;
  return <><div className="page"><button className="text-button" type="button" disabled={busy || checking} onClick={signOut}>Sign out of my student workspace</button>{error ? <p className="inline-notice" role="alert">{error}</p> : null}{checking ? <p role="status">Checking your private session…</p> : null}</div><div hidden={checking}>{React.cloneElement(children, { key: student.studentId, assignment: { ...assignment, _studentId: student.studentId }, authenticatedStudent: student })}</div></>;
}
