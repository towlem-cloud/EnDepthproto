import React, { useEffect, useState } from "react";
import { Icon, Pill } from "./endepthUI";
import {
  COACHING_FOCUS_OPTIONS,
  MAX_COACH_QUESTION_OPTIONS,
  SHOWCASE_ASSIGNMENT,
  SHOWCASE_TEACHER_STUDENTS,
  isShowcaseAssignment,
  normalizeAssignment,
  saveAssignmentToStorage,
} from "./endepthConfig";

export function TeacherSetup({ assignment, onSave, onPreviewStudent }) {
  const [draft, setDraft] = useState(assignment);
  const [notice, setNotice] = useState("Loaded from this browser.");
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setDraft(assignment);
  }, [assignment]);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setNotice("");
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function validate(nextAssignment) {
    const required = {
      teacherName: "Teacher name is required.",
      course: "Course is required.",
      title: "Assignment title is required.",
      prompt: "Central question is required.",
      sourceTitle: "Source title is required.",
      passage: "Source passage is required.",
      directions: "Student directions are required.",
      evidenceRequirement: "Evidence expectations are required.",
      coachingFocus: "A coaching focus is required.",
    };
    const nextErrors = Object.fromEntries(
      Object.entries(required)
        .filter(([field]) => !String(nextAssignment[field] || "").trim())
        .map(([field, message]) => [field, message])
    );
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function saveCurrent({ preview = false } = {}) {
    const normalized = normalizeAssignment(draft);
    if (!validate(normalized)) {
      setNotice("Complete the required fields before saving or previewing.");
      return;
    }
    const saved = saveAssignmentToStorage(normalized);
    setDraft(saved);
    onSave(saved);
    setNotice("Assignment saved. Student View has been updated in this browser.");
    if (preview) onPreviewStudent();
  }

  function loadShowcase() {
    setDraft({ ...SHOWCASE_ASSIGNMENT });
    setErrors({});
    setNotice("Friday showcase loaded. Save or preview to apply it.");
  }

  function resetAssignment() {
    setDraft({ ...SHOWCASE_ASSIGNMENT });
    setErrors({});
    setNotice("Assignment reset to the showcase defaults. Save or preview to apply it.");
  }

  const fields = [
    ["teacherName", "Teacher name", "Who is leading this assignment?", "input"],
    ["course", "Course or class", "What class will students see?", "input"],
    ["title", "Assignment title", "Name the Harkness preparation task.", "input"],
    ["date", "Timing label", "For example: Due Friday or Preparation for tomorrow.", "input"],
    ["prompt", "Central Harkness question", "The intellectual problem students should prepare to discuss.", "textarea"],
    ["sourceTitle", "Source title", "The text or course material students should use.", "input"],
    ["passage", "Source passage", "Paste the assigned excerpt or essential context.", "textarea"],
    ["directions", "Student directions", "Explain the preparation process and final artifact.", "textarea"],
    ["evidenceRequirement", "Evidence requirement", "Define what counts as grounded evidence.", "textarea"],
  ];

  return (
    <main className="page teacher-setup-page">
      <section className="teacher-banner setup-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange">Teacher Setup</Pill>
            <span>Prototype configuration</span>
          </div>
          <h1>Define the intellectual task before students open the coach.</h1>
          <p>
            The teacher sets the question, source, expectations, and coaching
            boundaries. The AI asks questions but does not provide answers; the
            final interpretation remains the student's.
          </p>
        </div>
        <div className="setup-actions">
          <button className="primary-button" type="button" onClick={() => saveCurrent()}>
            Save assignment <Icon name="save" />
          </button>
          <button className="secondary-button" type="button" onClick={() => saveCurrent({ preview: true })}>
            Preview as student <Icon name="eye" />
          </button>
          <button className="secondary-button" type="button" onClick={loadShowcase}>
            Load Friday showcase <Icon name="spark" />
          </button>
          <button className="text-button" type="button" onClick={resetAssignment}>
            Reset assignment <Icon name="rotate" />
          </button>
        </div>
      </section>

      <section className="content-card setup-principles">
        <div><Icon name="book" /><span><strong>Teacher authorship</strong> You define the intellectual task.</span></div>
        <div><Icon name="message" /><span><strong>Socratic restraint</strong> The coach asks but does not answer.</span></div>
        <div><Icon name="eye" /><span><strong>Visible process</strong> The teacher can review how thinking changed.</span></div>
      </section>

      <section className="content-card setup-form-card">
        <div className="teacher-card-header">
          <div>
            <div className="card-kicker">Assignment configuration</div>
            <h2>Student-facing settings</h2>
          </div>
          <Pill tone="neutral">Saved only in this browser</Pill>
        </div>

        <div className="setup-grid">
          {fields.map(([field, label, helper, kind]) => (
            <div className={kind === "textarea" ? "setup-field full-span" : "setup-field"} key={field}>
              <label htmlFor={`setup-${field}`}>{label}</label>
              <small>{helper}</small>
              {kind === "textarea" ? (
                <textarea
                  id={`setup-${field}`}
                  rows={field === "passage" ? 6 : 3}
                  value={draft[field]}
                  onChange={(event) => updateField(field, event.target.value)}
                />
              ) : (
                <input
                  id={`setup-${field}`}
                  value={draft[field]}
                  onChange={(event) => updateField(field, event.target.value)}
                />
              )}
              {errors[field] ? <span className="field-error">{errors[field]}</span> : null}
            </div>
          ))}

          <div className="setup-field">
            <label htmlFor="setup-coachingFocus">Coaching focus</label>
            <small>Choose the coach's priority without changing its core guardrails.</small>
            <select
              id="setup-coachingFocus"
              value={draft.coachingFocus}
              onChange={(event) => updateField("coachingFocus", event.target.value)}
            >
              {COACHING_FOCUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>

          <div className="setup-field">
            <label htmlFor="setup-maxCoachQuestions">Maximum live coach questions</label>
            <small>Only successful AI questions count toward this limit.</small>
            <select
              id="setup-maxCoachQuestions"
              value={draft.maxCoachQuestions}
              onChange={(event) => updateField("maxCoachQuestions", Number(event.target.value))}
            >
              {MAX_COACH_QUESTION_OPTIONS.map((option) => (
                <option key={option} value={option}>{option} questions</option>
              ))}
            </select>
          </div>
        </div>

        {notice ? <div className="inline-notice setup-notice">{notice}</div> : null}
      </section>
    </main>
  );
}

function StatusBadge({ status }) {
  const slug = status.toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-badge status-${slug}`}>{status}</span>;
}

export function TeacherDashboard({ assignment, onEditAssignment }) {
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(1);
  const students = isShowcaseAssignment(assignment)
    ? SHOWCASE_TEACHER_STUDENTS
    : [];
  const selected = students.find((student) => student.id === selectedId);
  const visibleStudents = students.filter((student) =>
    filter === "All" ? true : student.status === filter
  );

  useEffect(() => {
    if (!visibleStudents.some((student) => student.id === selectedId)) {
      setSelectedId(visibleStudents[0]?.id ?? 1);
    }
  }, [filter, selectedId, visibleStudents]);

  return (
    <main className="page teacher-page">
      <section className="teacher-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange">Teacher dashboard</Pill>
            <span>Prototype class · {assignment.course}</span>
          </div>
          <h1>{assignment.title}</h1>
          <p>{assignment.date}</p>
        </div>
        <button className="primary-button" type="button" onClick={onEditAssignment}>
          Create new assignment <Icon name="arrow" />
        </button>
      </section>

      <section className="metric-grid">
        {[
          [String(students.length), "Students assigned", "users"],
          [String(students.filter((student) => student.status === "Submitted").length), "Submitted", "check"],
          [String(students.filter((student) => student.status === "In progress").length), "In progress", "clock"],
          [String(students.filter((student) => student.status === "Not started").length), "Not started", "book"],
        ].map(([value, label, icon]) => (
          <article className="metric-card" key={label}>
            <div className="metric-icon"><Icon name={icon} /></div>
            <div>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          </article>
        ))}
      </section>

      <section className="teacher-workspace-grid">
        <article className="content-card roster-card">
          <div className="teacher-card-header">
            <div>
              <div className="card-kicker">Class progress</div>
              <h2>Student preparation</h2>
            </div>
            <div className="filter-tabs">
              {["All", "Submitted", "In progress", "Not started"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={filter === item ? "active" : ""}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="roster-table" role="table" aria-label="Student preparation roster">
            <div className="roster-row roster-header" role="row">
              <span role="columnheader">Student</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Current need</span>
              <span role="columnheader" aria-label="Open student" />
            </div>
            {visibleStudents.length === 0 ? (
              <div className="empty-roster">
                <Icon name="users" />
                <strong>No class records in prototype mode</strong>
                <span>Use the Friday showcase preset to display fictional sample submissions.</span>
              </div>
            ) : null}
            {visibleStudents.map((student) => (
              <button
                type="button"
                className={`roster-row ${selectedId === student.id ? "selected" : ""}`}
                key={student.id}
                onClick={() => setSelectedId(student.id)}
                role="row"
              >
                <span className="student-cell" role="cell">
                  <span className="table-avatar">{student.name.slice(0, 1)}</span>
                  <strong>{student.name}</strong>
                </span>
                <span role="cell"><StatusBadge status={student.status} /></span>
                <span className="stage-cell" role="cell">{student.stage}</span>
                <span className="row-arrow" role="cell"><Icon name="chevron" size={16} /></span>
              </button>
            ))}
          </div>
        </article>

        <aside className="content-card student-detail-card">
          {selected ? (
            <>
              <div className="student-detail-header">
                <div>
                  <div className="card-kicker">Selected student</div>
                  <h2>{selected.name}</h2>
                </div>
                <StatusBadge status={selected.status} />
              </div>

              <div className="teacher-signal-row">
                <div><span>Grounding</span><strong>{selected.grounding}</strong></div>
                <div><span>Complexity</span><strong>{selected.complexity}</strong></div>
                <div><span>Inquiry</span><strong>{selected.question}</strong></div>
              </div>

              {selected.status === "Not started" ? (
                <div className="empty-detail">
                  <div className="empty-icon"><Icon name="clock" /></div>
                  <h3>No preparation yet</h3>
                  <p>This student has not opened the assignment.</p>
                </div>
              ) : (
                <>
                  <div className="movement-panel">
                    <div className="movement-label">Intellectual movement</div>
                    <div className="movement-block initial">
                      <span>Initial thinking</span>
                      <p>{selected.initial}</p>
                    </div>
                    <div className="movement-arrow"><Icon name="arrow" /></div>
                    <div className="movement-block revised">
                      <span>Current thinking</span>
                      <p>{selected.revised}</p>
                    </div>
                  </div>

                  <div className="teacher-prep-card">
                    <div>
                      <span>Textual evidence</span>
                      <p>{selected.evidence || "Not yet supplied."}</p>
                    </div>
                    <div>
                      <span>Complication</span>
                      <p>{selected.complication || "Not yet supplied."}</p>
                    </div>
                    <div>
                      <span>Open question</span>
                      <p>{selected.openQuestion || "Not yet supplied."}</p>
                    </div>
                  </div>
                </>
              )}

              <div className="detail-actions">
                <button className="secondary-button" type="button">View conversation</button>
                <button className="primary-button compact" type="button">Add teacher note</button>
              </div>
            </>
          ) : null}
        </aside>
      </section>

      <section className="teacher-bottom-grid">
        <article className="content-card assignment-settings-card">
          <div className="teacher-card-header">
            <div>
              <div className="card-kicker">Assignment design</div>
              <h2>What students are being asked to prepare</h2>
            </div>
            <button className="text-button" type="button" onClick={onEditAssignment}>Edit assignment <Icon name="chevron" size={16} /></button>
          </div>
          <div className="assignment-summary">
            <div>
              <span>Entry question</span>
              <p>{assignment.prompt}</p>
            </div>
            <div className="teacher-expectations">
              {[
                "A provisional interpretation",
                "A precise textual moment",
                "A genuine complication",
                "An open discussion question",
              ].map((item) => <span key={item}><Icon name="check" size={14} /> {item}</span>)}
            </div>
          </div>
        </article>

        <article className="content-card privacy-summary-card">
          <div className="guardrail-icon"><Icon name="shield" size={22} /></div>
          <div>
            <div className="card-kicker">Pilot guardrail</div>
            <h2>Process evidence, not automated grading</h2>
            <p>
              The dashboard highlights where thinking is visible. It does not rank
              students, assign a grade, or turn language patterns into a score.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}
