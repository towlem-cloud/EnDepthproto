import React, { useEffect, useMemo, useState } from "react";
import { Icon, Pill } from "./endepthUI";
import { stableAssignmentKey } from "./endepthConfig";

const TEACHER_CODE_STORAGE_KEY = "endepth-teacher-access-code";

function formatDate(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

export default function TeacherSubmissions({ assignment, onEditAssignment }) {
  const [teacherCode, setTeacherCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(TEACHER_CODE_STORAGE_KEY) || "";
  });
  const [draftCode, setDraftCode] = useState(teacherCode);
  const [submissions, setSubmissions] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentAssignmentOnly, setCurrentAssignmentOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState("");

  const currentAssignmentKey = useMemo(
    () => stableAssignmentKey(assignment),
    [assignment]
  );

  const visibleSubmissions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return submissions.filter((submission) => {
      if (
        currentAssignmentOnly &&
        submission.assignmentKey !== currentAssignmentKey
      ) {
        return false;
      }
      if (!normalizedSearch) return true;
      return [
        submission.studentFirstName,
        submission.studentLastName,
        submission.assignmentTitle,
        submission.course,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [submissions, currentAssignmentOnly, currentAssignmentKey, search]);

  const selected =
    visibleSubmissions.find((submission) => submission.submissionId === selectedId) ||
    visibleSubmissions[0] ||
    null;

  async function loadSubmissions(code = teacherCode) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
      setError("Enter the private teacher code to view student records.");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const response = await fetch("/api/submissions-list", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-endepth-teacher-code": cleanCode,
        },
        body: JSON.stringify({ limit: 250 }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          window.sessionStorage.removeItem(TEACHER_CODE_STORAGE_KEY);
          setTeacherCode("");
        }
        throw new Error(data.error || "Student submissions could not be loaded.");
      }

      window.sessionStorage.setItem(TEACHER_CODE_STORAGE_KEY, cleanCode);
      setTeacherCode(cleanCode);
      setDraftCode(cleanCode);
      setSubmissions(Array.isArray(data.submissions) ? data.submissions : []);
      setSelectedId((current) => {
        const records = Array.isArray(data.submissions) ? data.submissions : [];
        return records.some((record) => record.submissionId === current)
          ? current
          : records[0]?.submissionId || "";
      });
      setLastLoadedAt(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      );
    } catch (loadError) {
      setError(loadError.message || "Student submissions could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (teacherCode) loadSubmissions(teacherCode);
    // Load once from the teacher code stored for this browser session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      selectedId &&
      !visibleSubmissions.some((submission) => submission.submissionId === selectedId)
    ) {
      setSelectedId(visibleSubmissions[0]?.submissionId || "");
    }
  }, [visibleSubmissions, selectedId]);

  function lockDashboard() {
    window.sessionStorage.removeItem(TEACHER_CODE_STORAGE_KEY);
    setTeacherCode("");
    setDraftCode("");
    setSubmissions([]);
    setSelectedId("");
    setError("");
  }

  if (!teacherCode) {
    return (
      <main className="page live-submissions-page">
        <section className="teacher-banner submissions-banner">
          <div>
            <div className="banner-meta">
              <Pill tone="orange">Teacher records</Pill>
              <span>Protected classroom data</span>
            </div>
            <h1>Unlock live student submissions.</h1>
            <p>
              Student names and preparation records are hidden until the private
              teacher code is verified on the server.
            </p>
          </div>
        </section>

        <section className="content-card teacher-unlock-card">
          <div className="teacher-lock-icon"><Icon name="shield" size={28} /></div>
          <div>
            <div className="card-kicker">Teacher-only access</div>
            <h2>Enter your private teacher code</h2>
            <p>
              This is separate from the student pilot code. Do not share it with
              students.
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadSubmissions(draftCode);
            }}
          >
            <label htmlFor="teacher-code">Teacher code</label>
            <input
              id="teacher-code"
              type="password"
              autoComplete="current-password"
              value={draftCode}
              onChange={(event) => setDraftCode(event.target.value)}
            />
            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? "Unlocking…" : "Unlock submissions"}
              {!isLoading ? <Icon name="arrow" /> : null}
            </button>
          </form>
          {error ? <div className="inline-notice teacher-unlock-error">{error}</div> : null}
        </section>
      </main>
    );
  }

  const currentAssignmentCount = submissions.filter(
    (submission) => submission.assignmentKey === currentAssignmentKey
  ).length;
  const uniqueAssignments = new Set(
    submissions.map((submission) => submission.assignmentKey)
  ).size;

  return (
    <main className="page live-submissions-page">
      <section className="teacher-banner submissions-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="green" icon="check">Live submissions</Pill>
            <span>{assignment.course}</span>
          </div>
          <h1>{assignment.title}</h1>
          <p>
            Review student names, initial thinking, final preparation cards, and
            coach conversations. Names are stored in the classroom database, not
            sent to OpenAI.
          </p>
        </div>
        <div className="submissions-banner-actions">
          <button className="secondary-button" type="button" onClick={onEditAssignment}>
            Edit assignment
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => loadSubmissions()}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing…" : "Refresh records"}
            {!isLoading ? <Icon name="rotate" /> : null}
          </button>
          <button className="text-button" type="button" onClick={lockDashboard}>
            Lock dashboard
          </button>
        </div>
      </section>

      <section className="metric-grid live-metric-grid">
        {[
          [String(submissions.length), "Total submissions", "users"],
          [String(currentAssignmentCount), "Current assignment", "check"],
          [String(uniqueAssignments), "Assignments represented", "book"],
          [lastLoadedAt || "—", "Last refreshed", "clock"],
        ].map(([value, label, icon]) => (
          <article className="metric-card" key={label}>
            <div className="metric-icon"><Icon name={icon} /></div>
            <div><strong>{value}</strong><span>{label}</span></div>
          </article>
        ))}
      </section>

      <section className="content-card submissions-toolbar">
        <label className="submissions-search">
          <span>Search students or assignments</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, course, or assignment"
          />
        </label>
        <label className="current-assignment-toggle">
          <input
            type="checkbox"
            checked={currentAssignmentOnly}
            onChange={(event) => setCurrentAssignmentOnly(event.target.checked)}
          />
          <span>Show only the assignment currently loaded in Teacher Setup</span>
        </label>
      </section>

      {error ? <div className="inline-notice submissions-page-error">{error}</div> : null}

      <section className="live-submissions-grid">
        <article className="content-card live-roster-card">
          <div className="teacher-card-header">
            <div>
              <div className="card-kicker">Student records</div>
              <h2>{visibleSubmissions.length} visible submission{visibleSubmissions.length === 1 ? "" : "s"}</h2>
            </div>
          </div>

          <div className="live-roster-list">
            {visibleSubmissions.length === 0 ? (
              <div className="empty-roster live-empty-roster">
                <Icon name="users" />
                <strong>No matching submissions yet</strong>
                <span>
                  Students must enter their names and click Submit preparation in
                  Student View.
                </span>
              </div>
            ) : null}
            {visibleSubmissions.map((submission) => {
              const fullName = `${submission.studentFirstName} ${submission.studentLastName}`;
              return (
                <button
                  key={submission.submissionId}
                  type="button"
                  className={`live-roster-row ${selected?.submissionId === submission.submissionId ? "selected" : ""}`}
                  onClick={() => setSelectedId(submission.submissionId)}
                >
                  <span className="table-avatar">{submission.studentFirstName.slice(0, 1)}</span>
                  <span className="live-roster-name"><strong>{fullName}</strong><small>{submission.assignmentTitle}</small></span>
                  <span className="live-roster-time">{formatDate(submission.updatedAt)}</span>
                  <Icon name="chevron" size={16} />
                </button>
              );
            })}
          </div>
        </article>

        <aside className="content-card live-submission-detail">
          {selected ? (
            <>
              <div className="student-detail-header">
                <div>
                  <div className="card-kicker">Selected submission</div>
                  <h2>{selected.studentFirstName} {selected.studentLastName}</h2>
                  <p>{selected.course} · {selected.assignmentTitle}</p>
                </div>
                <Pill tone="green" icon="check">Submitted</Pill>
              </div>

              <div className="submission-timestamp">
                Last updated {formatDate(selected.updatedAt)}
              </div>

              <div className="movement-panel">
                <div className="movement-label">Intellectual movement</div>
                <div className="movement-block initial">
                  <span>Initial thinking</span>
                  <p>{selected.initialResponse || "Not supplied."}</p>
                </div>
                <div className="movement-arrow"><Icon name="arrow" /></div>
                <div className="movement-block revised">
                  <span>Provisional claim</span>
                  <p>{selected.claim || "Not supplied."}</p>
                </div>
              </div>

              <div className="teacher-prep-card live-prep-card">
                <div><span>Textual evidence</span><p>{selected.evidence || "Not supplied."}</p></div>
                <div><span>Why it matters</span><p>{selected.significance || "Not supplied."}</p></div>
                <div><span>Complication</span><p>{selected.complication || "Not supplied."}</p></div>
                <div><span>Open question</span><p>{selected.openQuestion || "Not supplied."}</p></div>
              </div>

              <details className="conversation-details">
                <summary>View coaching conversation</summary>
                <div className="teacher-conversation">
                  {(selected.messages || []).length === 0 ? (
                    <p>No coach conversation was included.</p>
                  ) : null}
                  {(selected.messages || []).map((message, index) => (
                    <div className={`teacher-conversation-message ${message.role}`} key={`${message.role}-${index}`}>
                      <strong>{message.role === "coach" ? "EnDepth" : "Student"}</strong>
                      <p>{message.text}</p>
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <div className="empty-detail">
              <div className="empty-icon"><Icon name="clock" /></div>
              <h3>Select a student</h3>
              <p>A submitted preparation record will appear here.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
