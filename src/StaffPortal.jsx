import React, { useEffect, useMemo, useState } from "react";
import { Icon, LogoMark, Pill } from "./endepthUI";
import {
  COACHING_FOCUS_OPTIONS,
  SHOWCASE_ASSIGNMENT,
  normalizeAssignment,
} from "./endepthConfig";

const STAFF_CODE_KEY = "endepth-staff-code-v1";

function blankAssignment(staff, teachers) {
  const teacherId = staff?.role === "teacher" ? staff.teacherId : teachers[0]?.teacherId || "";
  const teacherName = staff?.role === "teacher" ? staff.displayName : teachers[0]?.displayName || "";
  return normalizeAssignment({
    ...SHOWCASE_ASSIGNMENT,
    assignmentId: "",
    publicSlug: "",
    teacherId,
    teacherName,
    section: "",
    date: "Harkness preparation · Due next class",
    status: "draft",
    updatedAt: "",
  });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export default function StaffPortal() {
  const [code, setCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(STAFF_CODE_KEY) || "";
  });
  const [draftCode, setDraftCode] = useState(code);
  const [staff, setStaff] = useState(null);
  const [tab, setTab] = useState("assignments");
  const [assignments, setAssignments] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState("");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState(null);
  const [teacherDraft, setTeacherDraft] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function post(path, body, activeCode = code) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, code: activeCode }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const requestError = new Error(data.error || "The request could not be completed.");
      requestError.status = response.status;
      throw requestError;
    }
    return data;
  }

  async function authenticate(nextCode = draftCode) {
    const cleanCode = String(nextCode || "").trim();
    if (!cleanCode) {
      setError("Enter your teacher or admin code.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await post("/api/staff-auth", { code: cleanCode }, cleanCode);
      window.sessionStorage.setItem(STAFF_CODE_KEY, cleanCode);
      setCode(cleanCode);
      setDraftCode(cleanCode);
      setStaff(data.staff);
      setTab("assignments");
      await loadPortalData(cleanCode, data.staff);
    } catch (authError) {
      window.sessionStorage.removeItem(STAFF_CODE_KEY);
      setCode("");
      setStaff(null);
      setError(authError.message || "That code was not accepted.");
    } finally {
      setLoading(false);
    }
  }

  async function loadPortalData(activeCode = code, activeStaff = staff) {
    const assignmentData = await post(
      "/api/assignments",
      { action: "list" },
      activeCode
    );
    setAssignments(assignmentData.assignments || []);
    setSelectedAssignmentId((current) =>
      (assignmentData.assignments || []).some((item) => item.assignmentId === current)
        ? current
        : assignmentData.assignments?.[0]?.assignmentId || ""
    );

    if (activeStaff?.role === "admin") {
      const teacherData = await post("/api/teachers", { action: "list" }, activeCode);
      setTeachers(teacherData.teachers || []);
    } else if (activeStaff) {
      setTeachers([
        {
          teacherId: activeStaff.teacherId,
          displayName: activeStaff.displayName,
          email: activeStaff.email,
          slug: activeStaff.slug,
          active: true,
        },
      ]);
    }
  }

  async function loadSubmissions(assignmentId = selectedAssignmentId) {
    setLoading(true);
    setError("");
    try {
      const data = await post("/api/submissions-list", {
        assignmentId,
        limit: 500,
      });
      setSubmissions(data.submissions || []);
      setSelectedSubmissionId((current) =>
        (data.submissions || []).some((item) => item.submissionId === current)
          ? current
          : data.submissions?.[0]?.submissionId || ""
      );
      setNotice("Student records refreshed.");
    } catch (loadError) {
      if (loadError.status === 401) lockPortal();
      setError(loadError.message || "Student records could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (code && !staff) authenticate(code);
    // Restore one authenticated browser session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAssignment =
    assignments.find((item) => item.assignmentId === selectedAssignmentId) || null;
  const filteredSubmissions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return submissions;
    return submissions.filter((item) =>
      [
        item.studentFirstName,
        item.studentLastName,
        item.studentEmail,
        item.assignmentTitle,
        item.course,
        item.section,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [submissions, search]);
  const selectedSubmission =
    filteredSubmissions.find((item) => item.submissionId === selectedSubmissionId) ||
    filteredSubmissions[0] ||
    null;

  function lockPortal() {
    window.sessionStorage.removeItem(STAFF_CODE_KEY);
    setCode("");
    setDraftCode("");
    setStaff(null);
    setAssignments([]);
    setTeachers([]);
    setSubmissions([]);
    setAssignmentDraft(null);
    setTeacherDraft(null);
    setError("");
    setNotice("");
  }

  function startAssignment(existing = null) {
    setAssignmentDraft(
      existing ? normalizeAssignment(existing) : blankAssignment(staff, teachers)
    );
    setNotice("");
    setError("");
    setTab("editor");
  }

  async function saveAssignment() {
    setLoading(true);
    setError("");
    try {
      const data = await post("/api/assignments", {
        action: "save",
        assignment: assignmentDraft,
      });
      setAssignmentDraft(normalizeAssignment(data.assignment));
      await loadPortalData(code, staff);
      setSelectedAssignmentId(data.assignment.assignmentId);
      setNotice(
        data.assignment.status === "open"
          ? "Assignment saved and student link is open."
          : "Assignment saved. Change its status to Open before posting the student link."
      );
    } catch (saveError) {
      if (saveError.status === 401) lockPortal();
      setError(saveError.message || "The assignment could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  async function saveTeacher() {
    setLoading(true);
    setError("");
    try {
      await post("/api/teachers", { action: "save", teacher: teacherDraft });
      const teacherData = await post("/api/teachers", { action: "list" });
      setTeachers(teacherData.teachers || []);
      setTeacherDraft(null);
      setNotice("Teacher account saved. New codes take effect immediately.");
    } catch (saveError) {
      setError(saveError.message || "The teacher account could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  function studentUrl(assignment) {
    if (!assignment?.publicSlug) return "";
    return `${window.location.origin}/?assignment=${encodeURIComponent(
      assignment.publicSlug
    )}`;
  }

  async function copyLink(assignment) {
    const url = studentUrl(assignment);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Student link copied. Post this exact link in Tigernet.");
    } catch {
      window.prompt("Copy this student link:", url);
    }
  }

  function exportCsv() {
    const rows = [
      [
        "First name",
        "Last name",
        "Student email",
        "Course",
        "Section",
        "Assignment",
        "Submitted",
        "Initial response",
        "Claim",
        "Evidence",
        "Significance",
        "Complication",
        "Open question",
      ],
      ...filteredSubmissions.map((item) => [
        item.studentFirstName,
        item.studentLastName,
        item.studentEmail,
        item.course,
        item.section,
        item.assignmentTitle,
        item.updatedAt,
        item.initialResponse,
        item.claim,
        item.evidence,
        item.significance,
        item.complication,
        item.openQuestion,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `endepth-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!staff) {
    return (
      <main className="page staff-login-page">
        <section className="content-card staff-login-card">
          <div className="staff-lock-mark"><LogoMark /></div>
          <div>
            <Pill tone="orange">Two-teacher pilot</Pill>
            <h1>Open the EnDepth Teacher Portal.</h1>
            <p>
              Morgan, Teacher 2, and the pilot administrator each use a different
              private code. Teacher records are separated on the server.
            </p>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              authenticate();
            }}
          >
            <label htmlFor="staff-code">Teacher or admin code</label>
            <input
              id="staff-code"
              type="password"
              value={draftCode}
              onChange={(event) => setDraftCode(event.target.value)}
              autoComplete="current-password"
            />
            <button className="primary-button" type="submit" disabled={loading}>
              {loading ? "Opening…" : "Open Teacher Portal"}
              {!loading ? <Icon name="arrow" /> : null}
            </button>
          </form>
          {error ? <div className="inline-notice">{error}</div> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="page staff-portal-page">
      <section className="teacher-banner staff-portal-banner">
        <div>
          <div className="banner-meta">
            <Pill tone={staff.role === "admin" ? "dark" : "orange"}>
              {staff.role === "admin" ? "Pilot administrator" : "Teacher portal"}
            </Pill>
            <span>{staff.displayName}</span>
          </div>
          <h1>Build assignments once. Share one student link.</h1>
          <p>
            Assignment changes, teacher codes, student links, and records now live
            in the database—routine pilot updates no longer require a code change or
            Vercel redeployment.
          </p>
        </div>
        <div className="staff-banner-actions">
          <button className="secondary-button" type="button" onClick={() => loadPortalData()} disabled={loading}>
            Refresh portal <Icon name="rotate" />
          </button>
          <button className="text-button" type="button" onClick={lockPortal}>Lock portal</button>
        </div>
      </section>

      <nav className="staff-tabs" aria-label="Teacher portal sections">
        <button className={tab === "assignments" || tab === "editor" ? "active" : ""} onClick={() => setTab("assignments")}>
          Assignments
        </button>
        <button
          className={tab === "submissions" ? "active" : ""}
          onClick={() => {
            setTab("submissions");
            loadSubmissions(selectedAssignmentId);
          }}
        >
          Student records
        </button>
        {staff.role === "admin" ? (
          <button className={tab === "teachers" ? "active" : ""} onClick={() => setTab("teachers")}>
            Teacher accounts
          </button>
        ) : null}
      </nav>

      {notice ? <div className="inline-notice success-notice portal-notice">{notice}</div> : null}
      {error ? <div className="inline-notice portal-notice">{error}</div> : null}

      {tab === "assignments" ? (
        <section className="portal-section">
          <div className="portal-section-heading">
            <div>
              <div className="card-kicker">Database-backed assignments</div>
              <h2>{staff.role === "admin" ? "All pilot assignments" : "Your pilot assignments"}</h2>
            </div>
            <button className="primary-button" type="button" onClick={() => startAssignment()}>
              Create assignment <Icon name="arrow" />
            </button>
          </div>
          <div className="assignment-portal-grid">
            {assignments.length === 0 ? (
              <article className="content-card portal-empty-card">
                <Icon name="book" size={28} />
                <h3>No assignments yet</h3>
                <p>Create the first assignment, open it, and copy its student link.</p>
              </article>
            ) : null}
            {assignments.map((assignment) => (
              <article className="content-card portal-assignment-card" key={assignment.assignmentId}>
                <div className="portal-card-top">
                  <Pill tone={assignment.status === "open" ? "green" : assignment.status === "closed" ? "neutral" : "orange"}>
                    {assignment.status}
                  </Pill>
                  <span>{assignment.submissionCount} / {assignment.studentLimit} submitted</span>
                </div>
                <h3>{assignment.title}</h3>
                <p>{assignment.course} · {assignment.section}</p>
                {staff.role === "admin" ? <small>{assignment.teacherName}</small> : null}
                <div className="portal-card-actions">
                  <button className="secondary-button compact" type="button" onClick={() => startAssignment(assignment)}>Edit</button>
                  <button className="secondary-button compact" type="button" onClick={() => copyLink(assignment)} disabled={assignment.status !== "open"}>Copy student link</button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setSelectedAssignmentId(assignment.assignmentId);
                      setTab("submissions");
                      loadSubmissions(assignment.assignmentId);
                    }}
                  >
                    View records
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tab === "editor" && assignmentDraft ? (
        <section className="portal-section">
          <div className="portal-section-heading">
            <div>
              <div className="card-kicker">Assignment editor</div>
              <h2>{assignmentDraft.assignmentId ? "Update assignment" : "Create assignment"}</h2>
            </div>
            <button className="text-button" type="button" onClick={() => setTab("assignments")}>Back to assignments</button>
          </div>
          <div className="content-card portal-editor-card">
            <div className="pilot-limits-row">
              <Pill tone="orange">4 live coach questions</Pill>
              <Pill tone="neutral">17-student section limit</Pill>
              <span>Fixed for the first two-teacher pilot.</span>
            </div>
            <div className="portal-form-grid">
              {staff.role === "admin" ? (
                <label>
                  <span>Assigned teacher</span>
                  <select
                    value={assignmentDraft.teacherId}
                    onChange={(event) => {
                      const teacher = teachers.find((item) => item.teacherId === event.target.value);
                      setAssignmentDraft((current) => ({
                        ...current,
                        teacherId: event.target.value,
                        teacherName: teacher?.displayName || current.teacherName,
                      }));
                    }}
                  >
                    <option value="">Choose teacher</option>
                    {teachers.filter((teacher) => teacher.active).map((teacher) => (
                      <option key={teacher.teacherId} value={teacher.teacherId}>{teacher.displayName}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label><span>Course</span><input value={assignmentDraft.course} onChange={(event) => setAssignmentDraft((current) => ({ ...current, course: event.target.value }))} /></label>
              <label><span>Section or period</span><input value={assignmentDraft.section} onChange={(event) => setAssignmentDraft((current) => ({ ...current, section: event.target.value }))} placeholder="Period 3" /></label>
              <label><span>Assignment title</span><input value={assignmentDraft.title} onChange={(event) => setAssignmentDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label><span>Timing label</span><input value={assignmentDraft.date} onChange={(event) => setAssignmentDraft((current) => ({ ...current, date: event.target.value }))} /></label>
              <label><span>Status</span><select value={assignmentDraft.status} onChange={(event) => setAssignmentDraft((current) => ({ ...current, status: event.target.value }))}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select></label>
              <label><span>Coaching focus</span><select value={assignmentDraft.coachingFocus} onChange={(event) => setAssignmentDraft((current) => ({ ...current, coachingFocus: event.target.value }))}>{COACHING_FOCUS_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="full-span"><span>Central Harkness question</span><textarea rows={3} value={assignmentDraft.prompt} onChange={(event) => setAssignmentDraft((current) => ({ ...current, prompt: event.target.value }))} /></label>
              <label className="full-span"><span>Source title</span><input value={assignmentDraft.sourceTitle} onChange={(event) => setAssignmentDraft((current) => ({ ...current, sourceTitle: event.target.value }))} /></label>
              <label className="full-span"><span>Source passage or essential context</span><textarea rows={6} value={assignmentDraft.passage} onChange={(event) => setAssignmentDraft((current) => ({ ...current, passage: event.target.value }))} /></label>
              <label className="full-span"><span>Student directions</span><textarea rows={4} value={assignmentDraft.directions} onChange={(event) => setAssignmentDraft((current) => ({ ...current, directions: event.target.value }))} /></label>
              <label className="full-span"><span>Evidence requirement</span><textarea rows={3} value={assignmentDraft.evidenceRequirement} onChange={(event) => setAssignmentDraft((current) => ({ ...current, evidenceRequirement: event.target.value }))} /></label>
            </div>
            <div className="portal-editor-actions">
              <button className="primary-button" type="button" onClick={saveAssignment} disabled={loading}>{loading ? "Saving…" : "Save assignment"}<Icon name="save" /></button>
              {assignmentDraft.publicSlug ? (
                <>
                  <button className="secondary-button" type="button" onClick={() => copyLink(assignmentDraft)} disabled={assignmentDraft.status !== "open"}>Copy student link</button>
                  <button className="text-button" type="button" onClick={() => window.open(studentUrl(assignmentDraft), "_blank", "noopener,noreferrer")} disabled={assignmentDraft.status !== "open"}>Open student link</button>
                </>
              ) : null}
            </div>
            {assignmentDraft.publicSlug ? <div className="share-link-box"><span>Student link</span><code>{studentUrl(assignmentDraft)}</code></div> : null}
          </div>
        </section>
      ) : null}

      {tab === "submissions" ? (
        <section className="portal-section">
          <div className="portal-section-heading">
            <div>
              <div className="card-kicker">Live student records</div>
              <h2>{selectedAssignment?.title || "Student submissions"}</h2>
              <p>{selectedAssignment ? `${selectedAssignment.course} · ${selectedAssignment.section}` : "Choose an assignment."}</p>
            </div>
            <div className="portal-heading-actions">
              <select value={selectedAssignmentId} onChange={(event) => { setSelectedAssignmentId(event.target.value); loadSubmissions(event.target.value); }}>
                <option value="">All accessible assignments</option>
                {assignments.map((assignment) => <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.course} · {assignment.section} · {assignment.title}</option>)}
              </select>
              <button className="secondary-button" type="button" onClick={() => loadSubmissions()} disabled={loading}>Refresh</button>
              <button className="secondary-button" type="button" onClick={exportCsv} disabled={filteredSubmissions.length === 0}>Export CSV</button>
            </div>
          </div>
          <section className="metric-grid live-metric-grid">
            <article className="metric-card"><div className="metric-icon"><Icon name="users" /></div><div><strong>{submissions.length}</strong><span>Submitted records</span></div></article>
            <article className="metric-card"><div className="metric-icon"><Icon name="check" /></div><div><strong>{selectedAssignment ? `${submissions.length} / 17` : "—"}</strong><span>Section capacity</span></div></article>
            <article className="metric-card"><div className="metric-icon"><Icon name="book" /></div><div><strong>{new Set(submissions.map((item) => item.assignmentId)).size}</strong><span>Assignments represented</span></div></article>
          </section>
          <div className="content-card submissions-toolbar"><label className="submissions-search"><span>Search name, email, course, or section</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Student or assignment" /></label></div>
          <div className="live-submissions-grid">
            <article className="content-card live-roster-card">
              <div className="roster-table">
                <div className="roster-row roster-header"><span>Student</span><span>Email</span><span>Updated</span><span /></div>
                {filteredSubmissions.map((item) => (
                  <button className={`roster-row ${selectedSubmission?.submissionId === item.submissionId ? "selected" : ""}`} type="button" key={item.submissionId} onClick={() => setSelectedSubmissionId(item.submissionId)}>
                    <span className="student-cell"><span className="table-avatar">{item.studentFirstName.slice(0, 1)}</span><strong>{item.studentFirstName} {item.studentLastName}</strong></span>
                    <span className="stage-cell">{item.studentEmail}</span>
                    <span className="stage-cell">{formatDate(item.updatedAt)}</span>
                    <span className="row-arrow"><Icon name="chevron" size={16} /></span>
                  </button>
                ))}
                {filteredSubmissions.length === 0 ? <div className="portal-empty-list">No submissions match this view.</div> : null}
              </div>
            </article>
            <aside className="content-card live-submission-detail">
              {selectedSubmission ? (
                <>
                  <div className="student-detail-header"><div><div className="card-kicker">Selected student</div><h2>{selectedSubmission.studentFirstName} {selectedSubmission.studentLastName}</h2><p>{selectedSubmission.studentEmail}</p></div><Pill tone="green">Submitted</Pill></div>
                  <div className="movement-panel"><div className="movement-label">Intellectual movement</div><div className="movement-block initial"><span>Initial thinking</span><p>{selectedSubmission.initialResponse}</p></div><div className="movement-arrow"><Icon name="arrow" /></div><div className="movement-block revised"><span>Provisional claim</span><p>{selectedSubmission.claim}</p></div></div>
                  <div className="teacher-prep-card"><div><span>Evidence</span><p>{selectedSubmission.evidence}</p></div><div><span>Why it matters</span><p>{selectedSubmission.significance}</p></div><div><span>Complication</span><p>{selectedSubmission.complication}</p></div><div><span>Open question</span><p>{selectedSubmission.openQuestion}</p></div></div>
                  <details className="conversation-details"><summary>View EnDepth conversation ({selectedSubmission.messages.length} messages)</summary><div className="teacher-conversation">{selectedSubmission.messages.map((message, index) => <div className={`teacher-conversation-message ${message.role}`} key={`${message.role}-${index}`}><strong>{message.role === "coach" ? "EnDepth" : selectedSubmission.studentFirstName}</strong><p>{message.text}</p></div>)}</div></details>
                </>
              ) : <div className="empty-detail"><Icon name="message" size={30} /><h3>Select a student record</h3><p>Their preparation card and coaching process will appear here.</p></div>}
            </aside>
          </div>
        </section>
      ) : null}

      {tab === "teachers" && staff.role === "admin" ? (
        <section className="portal-section">
          <div className="portal-section-heading"><div><div className="card-kicker">Admin controls</div><h2>Teacher accounts and code rotation</h2></div><button className="primary-button" type="button" onClick={() => setTeacherDraft({ teacherId: "", displayName: "", email: "", slug: "", newCode: "", active: true })}>Add teacher</button></div>
          <div className="teacher-account-grid">
            <div className="content-card teacher-account-list">
              {teachers.map((teacher) => <button className="teacher-account-row" type="button" key={teacher.teacherId} onClick={() => setTeacherDraft({ ...teacher, newCode: "" })}><div><strong>{teacher.displayName}</strong><span>{teacher.email || "No email added"}</span></div><Pill tone={teacher.active ? "green" : "neutral"}>{teacher.active ? "Active" : "Inactive"}</Pill></button>)}
            </div>
            <div className="content-card teacher-account-editor">
              {teacherDraft ? (
                <>
                  <div className="card-kicker">{teacherDraft.teacherId ? "Edit teacher" : "New teacher"}</div><h3>{teacherDraft.displayName || "Teacher account"}</h3>
                  <label><span>Display name</span><input value={teacherDraft.displayName} onChange={(event) => setTeacherDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
                  <label><span>Teacher email</span><input type="email" value={teacherDraft.email} onChange={(event) => setTeacherDraft((current) => ({ ...current, email: event.target.value }))} /></label>
                  <label><span>Account slug</span><input value={teacherDraft.slug} onChange={(event) => setTeacherDraft((current) => ({ ...current, slug: event.target.value }))} /></label>
                  <label><span>{teacherDraft.teacherId ? "New code (leave blank to keep current)" : "Teacher code"}</span><input type="password" value={teacherDraft.newCode} onChange={(event) => setTeacherDraft((current) => ({ ...current, newCode: event.target.value }))} /></label>
                  <label className="account-active-toggle"><input type="checkbox" checked={teacherDraft.active !== false} onChange={(event) => setTeacherDraft((current) => ({ ...current, active: event.target.checked }))} /><span>Active teacher account</span></label>
                  <button className="primary-button" type="button" onClick={saveTeacher} disabled={loading}>Save teacher account</button>
                </>
              ) : <div className="empty-detail"><Icon name="users" size={30} /><h3>Select a teacher</h3><p>Rename Teacher 2, add their email, or rotate a teacher code without redeploying EnDepth.</p></div>}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
