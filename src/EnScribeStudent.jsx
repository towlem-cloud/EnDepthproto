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
        <h1>EnScribe Writing Studio</h1>
        <p>Opening your private workspace…</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const s = data.student,
    a = data.assignment,
    locked = !!s.submittedAt;
  return (
    <main className="department">
      <header>
        <h1>EnScribe Writing Studio</h1>
        <p>The writer does the thinking. Your thinking. Your writing.</p>
        {a.sandbox && (
          <strong>
            EXAMPLE — fictional testing work, separate from student records
          </strong>
        )}
      </header>
      <section>
        <h2>{a.title}</h2>
        <p>
          {a.course} · {a.section} · {a.timing}
        </p>
        <pre>{a.prompt}</pre>
        <pre>{a.instructions}</pre>
        <details>
          <summary>Teacher-provided rubric</summary>
          <pre>
            {a.rubric ||
              "No rubric supplied. Focus categories are not an official school rubric."}
          </pre>
        </details>
        <p>
          {a.boundaries} boundaries · Four successful checks ·{" "}
          {s.successfulChecks}/4 used
        </p>
        <p>
          When you request a live check, academic writing is processed by the AI
          provider. Identity fields are kept out of the academic request;
          writing itself may contain identifying details. AI does not write or
          rewrite for you.
        </p>
      </section>
      {error && (
        <section role="alert">
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
      <section>
        <h2>Independent original</h2>
        {s.original ? (
          <details>
            <summary>View preserved original</summary>
            <pre>{s.original}</pre>
          </details>
        ) : (
          <p>
            Paste your independent draft below and save it before coaching. The
            first saved draft becomes the immutable original.
          </p>
        )}
        <label>
          Working / final draft
          <textarea
            aria-label="Working / final draft"
            className="writing-draft"
            value={draft}
            disabled={locked || busy}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
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
          Version {s.version}. Concurrent edits are rejected rather than
          overwritten.
        </p>
      </section>
      <section>
        <h2>Focused coaching check</h2>
        <label>
          Rubric focus
          <select
            aria-label="Rubric focus"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          >
            {foci.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        {[
          ["Goal", goal, setGoal],
          ["Exact passage from saved draft", passage, setPassage],
          ["What I already tried", tried, setTried],
          ["My focused question", question, setQuestion],
        ].map(([label, value, set]) => (
          <label key={label}>
            {label}
            <textarea
              aria-label={label}
              value={value}
              disabled={busy || locked}
              onChange={(e) => set(e.target.value)}
            />
          </label>
        ))}
        <button
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
        {data.checks?.map((c) => (
          <article key={c.request_id}>
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
      </section>
      <section>
        <h2>Revision history</h2>
        {data.revisions?.map((r) => (
          <details key={r.version}>
            <summary>
              Version {r.version} — {r.explanation || "Independent original"}
            </summary>
            <pre>{r.draft}</pre>
          </details>
        ))}
      </section>
      <section>
        <h2>Finish with reflection</h2>
        <label>
          What changed in your thinking and writing?
          <textarea
            aria-label="What changed in your thinking and writing?"
            value={reflection}
            disabled={locked || busy}
            onChange={(e) => setReflection(e.target.value)}
          />
        </label>
        <button disabled={locked || busy} onClick={() => save(true)}>
          Submit to teacher
        </button>
        <p role="status">
          {locked
            ? "Submitted " +
              new Date(s.submittedAt).toLocaleString() +
              " — teacher must reopen before further revision."
            : "Not submitted. Saving does not submit your work."}
        </p>
      </section>
    </main>
  );
}
