import React, { useEffect, useState } from "react";
import { post } from "./departmentApi.js";
const foci = [
  "Thesis/inquiry",
  "Structure",
  "Evidence",
  "Analysis",
  "Grammar/usage/mechanics",
];
export default function EnScribeStudent({ studentId }) {
  const [data, setData] = useState(null),
    [draft, setDraft] = useState(""),
    [reflection, setReflection] = useState(""),
    [explanation, setExplanation] = useState("");
  const [focus, setFocus] = useState(foci[0]),
    [goal, setGoal] = useState(""),
    [passage, setPassage] = useState(""),
    [tried, setTried] = useState(""),
    [question, setQuestion] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null);
  const [draftView, setDraftView] = useState("working"),
    [selectedPassage, setSelectedPassage] = useState("");
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function load(d) {
    setData(d);
    setDraft(d.student.working);
    setReflection(d.student.reflection || "");
    setSelectedPassage("");
  }
  async function refresh() {
    load(await post("student-read", { studentId }));
  }
  useEffect(() => {
    const raw = new URLSearchParams(location.hash.slice(1)).get("access");
    // Private capability is never kept in browser storage or query URLs.
    if (raw)
      history.replaceState(null, "", location.pathname + location.search);
    run(async () =>
      load(
        await post(raw ? "student-enter" : "student-read", {
          studentId,
          ...(raw ? { token: raw } : {}),
        }),
      ),
    );
  }, [studentId]);
  async function save(submit = false) {
    await run(async () => {
      const d = await post("student-save", {
        studentId,
        version: data.student.version,
        draft,
        explanation,
        reflection,
        submit,
      });
      load({ ...data, ...d });
      setExplanation("");
      setNotice(
        submit
          ? "Submission confirmed by the server."
          : "Draft saved. This is not a submission.",
      );
      setPending(null);
    });
  }
  async function coach() {
    await run(async () => {
      if (draft !== data.student.working)
        throw new Error("Save your revision before requesting a check.");
      // Keep the exact request on retry; changing the prompt requires a fresh request.
      const req = pending || {
        studentId,
        requestId: crypto.randomUUID(),
        focus,
        goal,
        passage,
        tried,
        question,
      };
      setPending(req);
      let result;
      try {
        result = await post("student-coach", req);
      } catch (error) {
        // Input validation rejected this attempt before reservation. Let corrected fields create
        // a new request; uncertain failures retain the exact retry payload.
        if (error.status === 400) setPending(null);
        throw error;
      }
      setNotice(
        result.withheld
          ? result.message
          : "Live diagnostic feedback received. Make your own revision; explain your decision.",
      );
      setPending(null);
      await refresh();
    });
  }
  if (!data)
    return (
      <main className="department">
        <StudioHeader />
        <div className="department-body">
          <h1>EnScribe Writing Studio</h1>
          <p>Opening your private workspace…</p>
          {error && <p role="alert">{error}</p>}
        </div>
      </main>
    );
  const s = data.student,
    a = data.assignment,
    locked = !!s.submittedAt;
  const unsaved = draft !== s.working;
  const canUseSelection =
    selectedPassage.trim() && !unsaved && !busy && !locked && !pending;
  return (
    <main className="department">
      <StudioHeader />
      <div className="department-body">
        <div className="department-page-heading">
          <div>
            <p className="department-eyebrow">The writer does the thinking</p>
            <h1>EnScribe Writing Studio</h1>
            <p>Choose a focus. Ask with purpose. Keep the words your own.</p>
          </div>
          <span className="department-tag">
            {locked ? "Submitted" : "Private workspace"}
          </span>
        </div>
        {a.sandbox ? (
          <p className="department-example-strip">
            <strong>
              EXAMPLE — fictional testing work, separate from student records
            </strong>
          </p>
        ) : (
          <p className="department-example-strip">
            Your original, saved revisions, coaching and reflection are visible
            to your assigned teacher.
          </p>
        )}
        <section className="department-assignment-strip">
          <div>
            <p className="department-eyebrow">
              {[a.course, a.section, a.timing].filter(Boolean).join(" · ")}
            </p>
            <h2>{a.title}</h2>
            <details>
              <summary>Assignment & revision boundaries</summary>
              <pre>{a.prompt}</pre>
              <pre>{a.instructions}</pre>
            </details>
            <details>
              <summary>Teacher-provided rubric</summary>
              <pre>
                {a.rubric ||
                  "No rubric supplied. Focus categories are not an official school rubric."}
              </pre>
            </details>
          </div>
          <div className="department-assignment-status">
            <span className="department-tag">{a.boundaries} boundaries</span>
            <p>Four successful checks · {s.successfulChecks}/4 used</p>
          </div>
        </section>
        <ol className="department-steps" aria-label="Writing process">
          <li className={s.original ? "done" : "current"}>
            <span>1</span> Preserve draft
          </li>
          <li
            className={
              s.original && !locked && !data.checks?.length ? "current" : ""
            }
          >
            <span>2</span> Set a goal & ask
          </li>
          <li className={data.checks?.length && !locked ? "current" : ""}>
            <span>3</span> Revise & explain
          </li>
          <li className={locked ? "done" : ""}>
            <span>4</span> Reflect
          </li>
        </ol>
        {error && (
          <section role="alert" className="department-error">
            <p>{error}</p>
            {/VERSION_CONFLICT/.test(error) && (
              <>
                <p>
                  Your unsaved text remains below. Copy it before loading the
                  server version, then reconcile your changes.
                </p>
                <button onClick={() => run(refresh)}>
                  Load current server version
                </button>
              </>
            )}
          </section>
        )}
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <div className="department-workspace-grid">
          <section className="department-paper-panel">
            <div className="department-panel-heading">
              <div>
                <p className="department-eyebrow">Your writing</p>
                <h2>Your current draft</h2>
              </div>
              <span className="department-muted">
                {draft.trim() ? draft.trim().split(/\s+/).length : 0} words
              </span>
            </div>
            <div className="department-panel-body">
              <div
                className="toolbar department-draft-tabs"
                aria-label="Draft views"
              >
                <button
                  className="department-secondary"
                  aria-pressed={draftView === "working"}
                  onClick={() => setDraftView("working")}
                >
                  Working draft
                </button>
                <button
                  className="department-secondary"
                  aria-pressed={draftView === "original"}
                  onClick={() => setDraftView("original")}
                >
                  Original
                </button>
              </div>
              <div hidden={draftView !== "original"}>
                <h3>Independent original</h3>
                {s.original ? (
                  <>
                    <p className="department-original-note">
                      Original preserved · read only
                    </p>
                    <pre className="department-original-copy">{s.original}</pre>
                  </>
                ) : (
                  <p>
                    Save your independent draft first. The original is preserved
                    with your first save.
                  </p>
                )}
              </div>
              <div hidden={draftView !== "working"}>
                {!s.original && (
                  <p className="department-original-note">
                    Paste your independent draft below and save it before
                    coaching. The first saved draft becomes the immutable
                    original.
                  </p>
                )}
                <label>
                  Working / final draft
                  <textarea
                    aria-label="Working / final draft"
                    className="writing-draft"
                    value={draft}
                    disabled={locked || busy}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      setSelectedPassage("");
                    }}
                    onSelect={(e) => {
                      const field = e.currentTarget;
                      setSelectedPassage(
                        field.value.slice(
                          field.selectionStart,
                          field.selectionEnd,
                        ),
                      );
                    }}
                  />
                </label>
                <div className="department-passage-selection">
                  <p className="department-help">
                    {unsaved
                      ? "Save your revision before selecting a passage for coaching."
                      : "Highlight a passage in your draft, then use it in your coaching check."}
                  </p>
                  <button
                    className="department-secondary"
                    disabled={!canUseSelection}
                    onClick={() => {
                      setPassage(selectedPassage);
                      setNotice(
                        "Selected passage added to your coaching check.",
                      );
                    }}
                  >
                    Use selected passage
                  </button>
                </div>
                <label>
                  Explain what changed or why you rejected a suggestion
                  <textarea
                    aria-label="Explain what changed or why you rejected a suggestion"
                    value={explanation}
                    disabled={locked || busy}
                    onChange={(e) => setExplanation(e.target.value)}
                  />
                </label>
                <button disabled={locked || busy} onClick={() => save(false)}>
                  Save draft — not submit
                </button>
                <p>
                  Version {s.version} ·{" "}
                  {unsaved ? "Unsaved changes" : "Saved draft"}. Concurrent
                  edits are rejected rather than overwritten.
                </p>
              </div>
            </div>
          </section>
          <section className="department-coaching-panel">
            <div className="department-panel-heading">
              <div>
                <p className="department-eyebrow">Purposeful coaching</p>
                <h2>Focused coaching check</h2>
              </div>
              <span className="department-tag">{s.successfulChecks}/4</span>
            </div>
            <div className="department-panel-body">
              <p className="department-help">
                Name one goal and a passage to examine. You supply the reasoning
                and wording.
              </p>
              <label>
                Rubric focus
                <select
                  aria-label="Rubric focus"
                  value={focus}
                  disabled={busy || locked}
                  onChange={(e) => setFocus(e.target.value)}
                >
                  {foci.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              {[
                [
                  "Goal",
                  goal,
                  setGoal,
                  "What specifically do you want to strengthen?",
                ],
                [
                  "Exact passage from saved draft",
                  passage,
                  setPassage,
                  "Copy only the passage, without the field label, or use your highlighted text.",
                ],
                [
                  "What I already tried",
                  tried,
                  setTried,
                  "What have you checked or attempted yourself?",
                ],
                [
                  "My focused question",
                  question,
                  setQuestion,
                  "Ask about a reasoning or writing choice.",
                ],
              ].map(([label, value, set, hint]) => (
                <label key={label}>
                  {label}
                  <span className="department-help">{hint}</span>
                  <textarea
                    aria-label={label}
                    value={value}
                    rows={2}
                    disabled={busy || locked}
                    onChange={(e) => set(e.target.value)}
                  />
                </label>
              ))}
              <p className="department-help">
                When you request a live check, academic writing is processed by
                the AI provider. Identity fields are kept out of the academic
                request; writing itself may contain identifying details. AI does
                not write or rewrite for you.
              </p>
              <button
                className="department-primary-action"
                disabled={
                  busy ||
                  locked ||
                  a.boundaries === "restrictive" ||
                  s.successfulChecks >= 4 ||
                  !s.original
                }
                onClick={coach}
              >
                {pending ? "Retry the same live check" : "Request live check"}
              </button>
              {a.boundaries === "restrictive" && (
                <p>AI coaching is disabled by your teacher.</p>
              )}
              {pending && (
                <p className="department-help">
                  Retrying sends the same saved request. Edited fields will be
                  used after this attempt is resolved.
                </p>
              )}
            </div>
          </section>
        </div>
        <section className="department-feedback-panel">
          <div className="department-panel-heading">
            <div>
              <p className="department-eyebrow">Notice. Test. Decide.</p>
              <h2>Coaching history</h2>
            </div>
          </div>
          <div className="department-panel-body">
            {!data.checks?.length && (
              <p>
                Your saved coaching checks will appear here. Make every revision
                in your own words.
              </p>
            )}
            {data.checks?.map((c) => (
              <article key={c.request_id} className="department-coach-note">
                <h3>
                  {c.academic.focus} — {c.state}
                </h3>
                <p>Goal: {c.academic.goal}</p>
                <pre>
                  {c.reply ||
                    "No successful feedback returned; no successful check consumed."}
                </pre>
              </article>
            ))}
          </div>
        </section>
        <section className="department-journey-panel">
          <div className="department-panel-heading">
            <div>
              <p className="department-eyebrow">Visible thinking</p>
              <h2>Revision history</h2>
            </div>
          </div>
          <div className="department-panel-body department-journey">
            {!data.revisions?.length && (
              <p>Your original and saved revisions will appear here.</p>
            )}
            {data.revisions?.map((r) => (
              <details key={r.version} className="department-journey-event">
                <summary>
                  Version {r.version} —{" "}
                  {r.explanation || "Independent original"}
                </summary>
                <pre>{r.draft}</pre>
              </details>
            ))}
          </div>
        </section>
        <section className="department-reflection-panel">
          <div>
            <p className="department-eyebrow">Self-monitor & transfer</p>
            <h2>Finish with reflection</h2>
            <p>
              Explain one meaningful change, how it supports your goal, and what
              you will try independently next time.
            </p>
          </div>
          <div>
            <label>
              What changed in your thinking and writing?
              <textarea
                aria-label="What changed in your thinking and writing?"
                value={reflection}
                disabled={locked || busy}
                onChange={(e) => setReflection(e.target.value)}
              />
            </label>
            <button
              className="department-primary-action"
              disabled={locked || busy}
              onClick={() => save(true)}
            >
              Submit to teacher
            </button>
            <p role="status">
              {locked
                ? "Submitted " +
                  new Date(s.submittedAt).toLocaleString() +
                  " — teacher must reopen before further revision."
                : "Not submitted. Saving does not submit your work."}
            </p>
          </div>
        </section>
      </div>
      <footer className="department-footer">
        <span>ENSWORTH / EnScribe Writing Studio</span>
        <span>Your thinking. Your writing.</span>
      </footer>
    </main>
  );
}

function StudioHeader() {
  return (
    <header className="department-masthead">
      <a href="/" className="department-brand" aria-label="EnDepth home">
        <span className="department-brand-mark">E</span>
        <span>
          <strong>ENSWORTH</strong>
          <small>ENGLISH DEPARTMENT</small>
        </span>
      </a>
      <div className="department-product">
        En<span>Scribe</span>
        <span className="department-product-divider" />
        Writing Studio
      </div>
      <span className="department-access-label">Private workspace</span>
    </header>
  );
}
