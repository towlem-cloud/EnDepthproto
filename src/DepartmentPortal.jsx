import React, { useState, useEffect } from "react";
import StaffPortal from "./StaffPortal.jsx";
import { post, downloadRecords } from "./departmentApi.js";
const blank = {
  title: "",
  course: "",
  section: "",
  prompt: "",
  instructions: "",
  rubric: "",
  timing: "",
  boundaries: "moderate",
  status: "draft",
};
export default function DepartmentPortal() {
  const [staff, setStaff] = useState(null),
    [code, setCode] = useState(""),
    [email, setEmail] = useState(""),
    [module, setModule] = useState("desk");
  const [assignments, setAssignments] = useState([]),
    [draft, setDraft] = useState(null),
    [teachers, setTeachers] = useState([]),
    [students, setStudents] = useState([]),
    [selected, setSelected] = useState(null);
  const [invite, setInvite] = useState({
      firstName: "",
      lastName: "",
      email: "",
      original: "",
    }),
    [oneTime, setOneTime] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function clearStaff() {
    setStaff(null);
    setOneTime(null);
    setStudents([]);
    setAssignments([]);
    setTeachers([]);
    setDraft(null);
    setSelected(null);
    setModule("desk");
    setEmail("");
    setCode("");
    setInvite({ firstName: "", lastName: "", email: "", original: "" });
  }
  async function run(fn) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e.status === 401) clearStaff();
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh(s = staff) {
    setAssignments((await post("writing-list")).assignments);
    if (s?.role === "admin") setTeachers((await post("accounts")).teachers);
  }
  function sameStaff(nextStaff) {
    return staff?.role === nextStaff.role &&
      staff?.teacherId === nextStaff.teacherId;
  }
  async function adoptStaff(nextStaff) {
    if (sameStaff(nextStaff)) return;
    const currentModule = module;
    clearStaff();
    setStaff(nextStaff);
    setModule(currentModule);
    await refresh(nextStaff);
  }
  async function switchModule(nextModule) {
    await run(async () => {
      const d = await post("session", {}, "/api/staff-auth");
      await adoptStaff(d.staff);
      setModule(nextModule);
      setOneTime(null);
    });
  }
  useEffect(() => {
    run(async () => {
      const d = await post("session", {}, "/api/staff-auth");
      setStaff(d.staff);
      await refresh(d.staff);
    });
  }, []);
  async function signIn(e) {
    e.preventDefault();
    await run(async () => {
      const d = await post("login", { code, email }, "/api/staff-auth");
      setCode("");
      setStaff(d.staff);
      await refresh(d.staff);
    });
  }
  async function records(a) {
    setSelected(a);
    setStudents(
      (await post("writing-records", { assignmentId: a.id })).students,
    );
    setOneTime(null);
  }
  async function issueTeacherCode(teacherId) {
    const d = await post("rotate", { teacherId });
    setModule("desk");
    setOneTime({ kind: "credential", value: d.newCode });
    await refresh();
  }
  const field = (key, label, large = false) => (
    <label key={key}>
      {label}
      {large ? (
        <textarea
          aria-label={label}
          value={draft[key] || ""}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      ) : (
        <input
          value={draft[key] || ""}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
      )}
    </label>
  );
  return (
    <main className="department">
      <header className="department-masthead">
        <a href="/" className="department-brand" aria-label="EnDepth home">
          <span className="department-brand-mark">E</span>
          <span><strong>ENSWORTH</strong><small>ENGLISH DEPARTMENT</small></span>
        </a>
        <div className="department-product">
          En<span>Scribe</span><span className="department-product-divider" />EnDepth
        </div>
        <span className="department-access-label">Approved staff</span>
      </header>
      <div className="department-body">
      <div className="department-page-heading">
        <p className="department-eyebrow">English department</p>
        <h1>Department writing & discussion</h1>
        <p>Your thinking. Your writing.</p>
      </div>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {!staff ? (
        <form onSubmit={signIn}>
          <h2>Approved staff sign-in</h2>
          <label>
            Email (optional for existing codes)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Individual teacher or administrator code
            <input
              type="password"
              autoComplete="current-password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button disabled={busy}>Sign in</button>
          <p>
            Email alone does not grant access. Ask Morgan for your individual
            credential.
          </p>
        </form>
      ) : (
        <>
          <div className="toolbar department-navigation">
            <strong>{staff.displayName}</strong>
            <button
              aria-pressed={module === "desk"}
              disabled={busy}
              onClick={() => switchModule("desk")}
            >
              EnScribe Writing Studio
            </button>
            <button
              aria-pressed={module === "depth"}
              disabled={busy}
              onClick={() => switchModule("depth")}
            >
              EnDepth Teacher Desk
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post("logout", {}, "/api/staff-auth");
                  clearStaff();
                })
              }
            >
              Sign out
            </button>
          </div>
          {module === "depth" ? (
            <>
              <p>
                EnDepth assignments and records retain their existing student
                URLs.
              </p>
              <StaffPortal
                key={staff.role + ":" + (staff.teacherId || "admin")}
                onLock={clearStaff}
                onStaff={(nextStaff) => {
                  if (!sameStaff(nextStaff)) run(() => adoptStaff(nextStaff));
                }}
              />
            </>
          ) : (
            <>
              <h2>EnScribe Writing Studio</h2>
              <p>
                The writer does the thinking. All settings prohibit AI
                rewriting. Teacher rubrics remain teacher supplied.
              </p>
              <div className="toolbar">
                <button
                  disabled={busy}
                  onClick={() =>
                    setDraft({
                      ...blank,
                      teacher_id:
                        staff.teacherId ||
                        teachers.find((t) => t.active)?.teacher_id ||
                        "",
                    })
                  }
                >
                  Create writing assignment
                </button>
                <button
                  disabled={busy || !staff.teacherId}
                  onClick={() =>
                    run(async () => {
                      const d = await post("writing-test");
                      setOneTime({
                        kind: "fictional",
                        value: location.origin + d.studentPath,
                      });
                      await refresh();
                    })
                  }
                >
                  Try EnScribe — fictional example
                </button>
                <button
                  disabled={busy || !staff.teacherId}
                  onClick={() =>
                    run(async () => {
                      const d = await post("depth-test");
                      setOneTime({
                        kind: "fictional",
                        value: location.origin + d.studentPath,
                      });
                    })
                  }
                >
                  Try EnDepth — fictional example
                </button>
              </div>
              {oneTime && (
                <section className="notice">
                  <h3>
                    {oneTime.kind === "fictional"
                      ? "Your fictional example workspace"
                      : oneTime.kind === "credential"
                        ? "Individual staff code — shown once"
                        : "Private student access link — shown once"}
                  </h3>
                  <input
                    aria-label="Private credential or link"
                    readOnly
                    value={oneTime.value}
                  />
                  {oneTime.kind === "fictional" ? (
                    <>
                      <p>Open the example to try the student workflow. This workspace contains fictional material.</p>
                      <a href={oneTime.value} target="_blank" rel="noopener noreferrer">
                        Open fictional workspace
                      </a>
                    </>
                  ) : (
                    <p>
                      Copy and deliver privately to the intended recipient. No
                      invitation email was sent. Treat this as a password.
                    </p>
                  )}
                  <button onClick={() => setOneTime(null)}>Dismiss</button>
                </section>
              )}
              {draft && (
                <section>
                  <h3>{draft.id ? "Edit" : "Create"} assignment</h3>
                  {staff.role === "admin" && !draft.id && (
                    <label>
                      Teacher
                      <select
                        aria-label="Teacher"
                        value={draft.teacher_id}
                        onChange={(e) =>
                          setDraft({ ...draft, teacher_id: e.target.value })
                        }
                      >
                        {teachers
                          .filter((t) => t.active)
                          .map((t) => (
                            <option key={t.teacher_id} value={t.teacher_id}>
                              {t.display_name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <div className="form-grid">
                    {field("title", "Title")}
                    {field("course", "Course")}
                    {field("section", "Section")}
                    {field("timing", "Timing")}
                    {field("prompt", "Assignment prompt", true)}
                    {field("instructions", "Instructions", true)}
                    {field(
                      "rubric",
                      "Teacher-provided rubric (optional; no official rubric supplied)",
                      true,
                    )}
                    <label>
                      AI boundaries
                      <select
                        aria-label="AI boundaries"
                        value={draft.boundaries}
                        onChange={(e) =>
                          setDraft({ ...draft, boundaries: e.target.value })
                        }
                      >
                        <option value="permissive">
                          Permissive — no rewriting
                        </option>
                        <option value="moderate">
                          Moderate — no rewriting
                        </option>
                        <option value="restrictive">
                          Restrictive — coaching disabled
                        </option>
                      </select>
                    </label>
                    <label>
                      Status
                      <select
                        aria-label="Status"
                        value={draft.status}
                        onChange={(e) =>
                          setDraft({ ...draft, status: e.target.value })
                        }
                      >
                        <option>draft</option>
                        <option>open</option>
                        <option>closed</option>
                      </select>
                    </label>
                  </div>
                  <p>
                    Four successful coaching checks per student. Saving and
                    submitting are separate.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await post("writing-save", { assignment: draft });
                        setDraft(null);
                        await refresh();
                      })
                    }
                  >
                    Save assignment
                  </button>
                  <button onClick={() => setDraft(null)}>Cancel</button>
                </section>
              )}
              <div className="assignment-grid">
                {assignments.map((a) => (
                  <section key={a.id}>
                    <h3>{a.title}</h3>
                    <p>
                      {a.course} · {a.section} · {a.status}{" "}
                      {a.sandbox ? "— EXAMPLE TEST DATA" : ""}
                    </p>
                    <p>{a.boundaries} · Four successful checks</p>
                    <div className="toolbar">
                      <button onClick={() => setDraft(a)}>
                        Edit / open / close
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await post("writing-duplicate", {
                              assignmentId: a.id,
                            });
                            await refresh();
                          })
                        }
                      >
                        Duplicate
                      </button>
                      <button onClick={() => run(() => records(a))}>
                        Students / import / access links
                      </button>
                      {a.sandbox && a.teacher_id === staff.teacherId && (
                        <button
                          onClick={() =>
                            run(async () => {
                              await post("writing-reset", {
                                assignmentId: a.id,
                              });
                              setStudents([]);
                            })
                          }
                        >
                          Reset own test data
                        </button>
                      )}
                    </div>
                  </section>
                ))}
              </div>
              {selected && (
                <section>
                  <h3>{selected.title}: student records</h3>
                  {!selected.sandbox && (
                    <>
                      <h4>
                        Create private student access / import independent draft
                      </h4>
                      <p>
                        Paste original writing, including teacher-exported
                        Exam.net writing. This is manual import, not an
                        integration. A later import never replaces an existing
                        original.
                      </p>
                      <div className="form-grid">
                        {["firstName", "lastName", "email"].map((k) => (
                          <label key={k}>
                            {k}
                            <input
                              value={invite[k]}
                              onChange={(e) =>
                                setInvite({ ...invite, [k]: e.target.value })
                              }
                            />
                          </label>
                        ))}
                        <label>
                          Independent original (optional)
                          <textarea
                            aria-label="Independent original (optional)"
                            value={invite.original}
                            onChange={(e) =>
                              setInvite({ ...invite, original: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const d = await post("writing-invite", {
                              assignmentId: selected.id,
                              student: invite,
                            });
                            setInvite({
                              firstName: "",
                              lastName: "",
                              email: "",
                              original: "",
                            });
                            await records(selected);
                            setOneTime({ kind: "access", value: location.origin + d.studentPath });
                          })
                        }
                      >
                        Generate private student link
                      </button>
                    </>
                  )}
                  <button
                    disabled={!students.length}
                    onClick={() => downloadRecords(students)}
                  >
                    Export accessible records CSV
                  </button>
                  <button onClick={() => run(() => records(selected))}>
                    Refresh records
                  </button>
                  {students.map((s) => (
                    <article key={s.id}>
                      <h4>
                        {s.firstName} {s.lastName} —{" "}
                        {s.submittedAt
                          ? "Submitted " +
                            new Date(s.submittedAt).toLocaleString()
                          : "Not submitted"}
                      </h4>
                      <p>
                        {s.email} · {s.successfulChecks}/4 successful checks
                      </p>
                      <details>
                        <summary>
                          Original, current draft, revisions, reflection &
                          coaching
                        </summary>
                        <h5>Preserved original</h5>
                        <pre>
                          {s.original || "Awaiting independent original"}
                        </pre>
                        <h5>Working / final</h5>
                        <pre>{s.working}</pre>
                        <h5>Reflection</h5>
                        <pre>{s.reflection}</pre>
                        {s.revisions.map((r) => (
                          <div key={r.version}>
                            <h5>Revision {r.version}</h5>
                            <pre>{r.draft}</pre>
                            <p>{r.explanation}</p>
                          </div>
                        ))}
                        {s.checks.map((c) => (
                          <div key={c.request_id}>
                            <p>
                              {c.state} · {c.academic.focus}
                            </p>
                            <pre>{c.reply || "No successful feedback"}</pre>
                          </div>
                        ))}
                      </details>
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const d = await post("writing-link", {
                              assignmentId: selected.id,
                              studentId: s.id,
                            });
                            setOneTime({ kind: "access", value: location.origin + d.studentPath });
                          })
                        }
                      >
                        Replace private student link (revokes old link)
                      </button>
                      {s.inFlight > 0 && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(async () => {
                              await post("writing-cancel-stalled", {
                                assignmentId: selected.id,
                                studentId: s.id,
                              });
                              await records(selected);
                            })
                          }
                        >
                          Release stalled check older than five minutes
                        </button>
                      )}
                      {s.submittedAt && (
                        <button
                          onClick={() =>
                            run(async () => {
                              await post("writing-reopen", {
                                assignmentId: selected.id,
                                studentId: s.id,
                              });
                              await records(selected);
                            })
                          }
                        >
                          Reopen this student's draft
                        </button>
                      )}
                    </article>
                  ))}
                </section>
              )}
            </>
          )}
          {staff.role === "admin" && (
            <section>
              <h2>Approved teacher accounts</h2>
              <p>
                Add the approved roster, then activate accounts awaiting activation
                with individual random codes. Active accounts keep their current
                credentials unless you deliberately replace them. Share each new
                code privately; no email is sent.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post("onboard");
                    await refresh();
                  })
                }
              >
                Add approved roster without changing existing accounts
              </button>
              {teachers.map((t) => (
                <article key={t.teacher_id}>
                  <strong>{t.display_name}</strong>
                  <p>
                    {t.email} ·{" "}
                    {t.active
                      ? t.activation_state
                      : t.activation_state === "awaiting activation"
                        ? "awaiting activation"
                        : "disabled"}
                  </p>
                  <div className="toolbar">
                    {t.active ? (
                      <details>
                        <summary>Replace active teacher code</summary>
                        <p>The current code will stop working and this teacher's signed-in sessions will end.</p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            run(() => issueTeacherCode(t.teacher_id))
                          }
                        >
                          Replace existing code & revoke sessions
                        </button>
                      </details>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() =>
                          run(() => issueTeacherCode(t.teacher_id))
                        }
                      >
                        {t.activation_state === "awaiting activation"
                          ? "Activate & issue individual code"
                          : "Reactivate & issue new code"}
                      </button>
                    )}
                    <button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await post("disable", { teacherId: t.teacher_id });
                          await refresh();
                        })
                      }
                    >
                      Disable & revoke sessions
                    </button>
                    <label>
                      Verified display name
                      <input
                        defaultValue={t.display_name}
                        onBlur={(e) => {
                          if (e.target.value !== t.display_name)
                            run(async () => {
                              await post("rename", {
                                teacherId: t.teacher_id,
                                displayName: e.target.value,
                              });
                              await refresh();
                            });
                        }}
                      />
                    </label>
                  </div>
                </article>
              ))}
              <button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const d = await post("admin-rotate");
                    setModule("desk");
                    setOneTime({ kind: "credential", value: d.newCode });
                  })
                }
              >
                Rotate administrator code (sign-in required afterward)
              </button>
            </section>
          )}
        </>
      )}
      </div>
    </main>
  );
}
