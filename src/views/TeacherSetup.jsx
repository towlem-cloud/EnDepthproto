import React, { useEffect, useMemo, useState } from "react";
import { Icon, Pill } from "../components/UI.jsx";
import {
  COACHING_FOCUS_OPTIONS,
  FINAL_REQUIREMENT_OPTIONS,
  HEATHER_DEMO_ASSIGNMENT,
  TURN_OPTIONS,
  normalizeAssignment,
} from "../config/assignment.js";

const REQUIRED_FIELDS = [
  ["teacherName", "Teacher name"],
  ["courseName", "Course or class"],
  ["assignmentTitle", "Assignment title"],
  ["centralQuestion", "Central Harkness question"],
];

function FieldLabel({ htmlFor, children, required = false, helper }) {
  return (
    <div className="setup-label-row">
      <label htmlFor={htmlFor}>
        {children}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

export default function TeacherSetup({ assignment, onSave, onPreview }) {
  const [draft, setDraft] = useState(() => normalizeAssignment(assignment));
  const [status, setStatus] = useState("");
  const [errors, setErrors] = useState({});

  useEffect(() => {
    setDraft(normalizeAssignment(assignment));
  }, [assignment]);

  const selectedFocus = useMemo(
    () =>
      COACHING_FOCUS_OPTIONS.find(
        (option) => option.value === draft.coachingFocus
      ),
    [draft.coachingFocus]
  );

  function updateField(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value,
      preset: "custom",
    }));
    setStatus("");
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function validate() {
    const nextErrors = {};
    for (const [field, label] of REQUIRED_FIELDS) {
      if (!String(draft[field] || "").trim()) {
        nextErrors[field] = `${label} is required.`;
      }
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function saveCurrent({ preview = false } = {}) {
    if (!validate()) {
      setStatus("Complete the required fields before saving.");
      return;
    }

    const saved = onSave({
      ...draft,
      preset: draft.preset === "heather" ? "heather" : "custom",
    });
    setDraft(saved);
    setStatus("Assignment saved in this browser.");

    if (preview) {
      onPreview(saved);
    }
  }

  function loadHeatherDemo() {
    setDraft(normalizeAssignment(HEATHER_DEMO_ASSIGNMENT));
    setErrors({});
    setStatus("Heather demo loaded. Save it or preview it as a student.");
  }

  function resetToSaved() {
    setDraft(normalizeAssignment(assignment));
    setErrors({});
    setStatus("Unsaved changes cleared.");
  }

  function toggleRequirement(requirement) {
    setDraft((current) => {
      const exists = current.finalRequirements.includes(requirement);
      const next = exists
        ? current.finalRequirements.filter((item) => item !== requirement)
        : [...current.finalRequirements, requirement];
      return {
        ...current,
        preset: "custom",
        finalRequirements: next.length ? next : [requirement],
      };
    });
    setStatus("");
  }

  return (
    <main className="page setup-page">
      <section className="setup-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange" icon="settings">Teacher Setup</Pill>
            <span>Prototype assignment builder</span>
          </div>
          <h1>Set the intellectual task. Keep the AI in its lane.</h1>
          <p>
            Change the teacher, class, text, question, evidence expectations,
            and coaching emphasis without editing a single line of code.
          </p>
        </div>
        <div className="setup-banner-actions">
          <button className="secondary-button" type="button" onClick={loadHeatherDemo}>
            Load Heather demo
          </button>
          <button className="primary-button" type="button" onClick={() => saveCurrent({ preview: true })}>
            Preview as student <Icon name="arrow" />
          </button>
        </div>
      </section>

      <div className="setup-layout">
        <div className="setup-form-column">
          <section className="content-card setup-card">
            <div className="setup-card-heading">
              <div className="setup-step">1</div>
              <div>
                <div className="card-kicker">Assignment identity</div>
                <h2>Who is teaching what?</h2>
              </div>
            </div>

            <div className="setup-two-column">
              <div className="setup-field">
                <FieldLabel htmlFor="teacher-name" required>Teacher name</FieldLabel>
                <input
                  id="teacher-name"
                  value={draft.teacherName}
                  onChange={(event) => updateField("teacherName", event.target.value)}
                  placeholder="Morgan Towle"
                  aria-invalid={Boolean(errors.teacherName)}
                />
                {errors.teacherName ? <span className="field-error">{errors.teacherName}</span> : null}
              </div>
              <div className="setup-field">
                <FieldLabel htmlFor="course-name" required>Course or class</FieldLabel>
                <input
                  id="course-name"
                  value={draft.courseName}
                  onChange={(event) => updateField("courseName", event.target.value)}
                  placeholder="Minds, Machines, and Morality"
                  aria-invalid={Boolean(errors.courseName)}
                />
                {errors.courseName ? <span className="field-error">{errors.courseName}</span> : null}
              </div>
            </div>

            <div className="setup-field">
              <FieldLabel htmlFor="assignment-title" required>Assignment title</FieldLabel>
              <input
                id="assignment-title"
                value={draft.assignmentTitle}
                onChange={(event) => updateField("assignmentTitle", event.target.value)}
                placeholder="What Counts as Consciousness?"
                aria-invalid={Boolean(errors.assignmentTitle)}
              />
              {errors.assignmentTitle ? <span className="field-error">{errors.assignmentTitle}</span> : null}
            </div>

            <div className="setup-field">
              <FieldLabel
                htmlFor="due-label"
                helper="Optional language students will see beneath the course name."
              >
                Timing or due label
              </FieldLabel>
              <input
                id="due-label"
                value={draft.dueLabel}
                onChange={(event) => updateField("dueLabel", event.target.value)}
                placeholder="Harkness preparation · Due tomorrow"
              />
            </div>
          </section>

          <section className="content-card setup-card">
            <div className="setup-card-heading">
              <div className="setup-step">2</div>
              <div>
                <div className="card-kicker">The intellectual task</div>
                <h2>What should students think about?</h2>
              </div>
            </div>

            <div className="setup-field">
              <FieldLabel
                htmlFor="central-question"
                required
                helper="Use a question that permits multiple defensible interpretations."
              >
                Central Harkness question
              </FieldLabel>
              <textarea
                id="central-question"
                rows={4}
                value={draft.centralQuestion}
                onChange={(event) => updateField("centralQuestion", event.target.value)}
                aria-invalid={Boolean(errors.centralQuestion)}
              />
              {errors.centralQuestion ? <span className="field-error">{errors.centralQuestion}</span> : null}
            </div>

            <div className="setup-field">
              <FieldLabel htmlFor="source-title">Text, source, or unit title</FieldLabel>
              <input
                id="source-title"
                value={draft.sourceTitle}
                onChange={(event) => updateField("sourceTitle", event.target.value)}
                placeholder="Turing, Searle, and the Problem of Machine Consciousness"
              />
            </div>

            <div className="setup-field">
              <FieldLabel
                htmlFor="source-passage"
                helper="Paste a short passage or summarize the exact textual moment students should use."
              >
                Assigned passage or textual moment
              </FieldLabel>
              <textarea
                id="source-passage"
                rows={6}
                value={draft.sourcePassage}
                onChange={(event) => updateField("sourcePassage", event.target.value)}
              />
            </div>

            <div className="setup-field">
              <FieldLabel htmlFor="student-directions">Directions students will see</FieldLabel>
              <textarea
                id="student-directions"
                rows={4}
                value={draft.studentDirections}
                onChange={(event) => updateField("studentDirections", event.target.value)}
              />
            </div>
          </section>

          <section className="content-card setup-card">
            <div className="setup-card-heading">
              <div className="setup-step">3</div>
              <div>
                <div className="card-kicker">Coach boundaries</div>
                <h2>How should EnDepth push the thinking?</h2>
              </div>
            </div>

            <div className="setup-two-column coaching-controls">
              <div className="setup-field">
                <FieldLabel htmlFor="coaching-focus">Primary coaching focus</FieldLabel>
                <select
                  id="coaching-focus"
                  value={draft.coachingFocus}
                  onChange={(event) => updateField("coachingFocus", event.target.value)}
                >
                  {COACHING_FOCUS_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.value}
                    </option>
                  ))}
                </select>
                <small className="field-help">{selectedFocus?.description}</small>
              </div>

              <div className="setup-field">
                <FieldLabel htmlFor="max-turns">Maximum coach questions</FieldLabel>
                <select
                  id="max-turns"
                  value={draft.maxCoachTurns}
                  onChange={(event) => updateField("maxCoachTurns", Number(event.target.value))}
                >
                  {TURN_OPTIONS.map((turns) => (
                    <option value={turns} key={turns}>{turns} questions</option>
                  ))}
                </select>
                <small className="field-help">
                  The student is redirected to the preparation card when the limit is reached.
                </small>
              </div>
            </div>

            <div className="setup-field">
              <FieldLabel htmlFor="evidence-requirement">Evidence expectation</FieldLabel>
              <textarea
                id="evidence-requirement"
                rows={3}
                value={draft.evidenceRequirement}
                onChange={(event) => updateField("evidenceRequirement", event.target.value)}
              />
            </div>

            <fieldset className="requirements-fieldset">
              <legend>Final preparation requirements</legend>
              <p>Select what students must bring into the Harkness circle.</p>
              <div className="requirement-grid">
                {FINAL_REQUIREMENT_OPTIONS.map((requirement) => {
                  const checked = draft.finalRequirements.includes(requirement);
                  return (
                    <label className={`requirement-option ${checked ? "selected" : ""}`} key={requirement}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRequirement(requirement)}
                      />
                      <span className="requirement-check">
                        {checked ? <Icon name="check" size={14} /> : null}
                      </span>
                      <span>{requirement}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </section>

          <section className="content-card setup-save-card">
            <div>
              <div className="card-kicker">Prototype mode</div>
              <h2>Save this assignment in the current browser</h2>
              <p>
                This Friday-ready version does not yet use teacher accounts or a
                shared database. The saved assignment will remain on this device
                and immediately update the Student View and Teacher Dashboard.
              </p>
              {status ? <div className="setup-status" aria-live="polite">{status}</div> : null}
            </div>
            <div className="setup-save-actions">
              <button className="text-button" type="button" onClick={resetToSaved}>
                Clear unsaved changes
              </button>
              <button className="secondary-button" type="button" onClick={() => saveCurrent()}>
                <Icon name="save" /> Save assignment
              </button>
              <button className="primary-button" type="button" onClick={() => saveCurrent({ preview: true })}>
                Save and preview <Icon name="arrow" />
              </button>
            </div>
          </section>
        </div>

        <aside className="setup-preview-column">
          <section className="setup-preview-card">
            <div className="setup-preview-top">
              <div>
                <span>STUDENT PREVIEW</span>
                <strong>{draft.courseName || "Course name"}</strong>
              </div>
              <Pill tone="orange">{draft.maxCoachTurns} coach questions</Pill>
            </div>
            <div className="setup-preview-body">
              <small>{draft.teacherName ? `Teacher: ${draft.teacherName}` : "Teacher name"}</small>
              <h2>{draft.assignmentTitle || "Assignment title"}</h2>
              <p className="setup-preview-question">
                {draft.centralQuestion || "Your central Harkness question will appear here."}
              </p>
              {draft.sourceTitle ? <strong className="preview-source-title">{draft.sourceTitle}</strong> : null}
              <blockquote>
                {draft.sourcePassage || "The assigned passage or textual moment will appear here."}
              </blockquote>
            </div>
            <div className="setup-preview-footer">
              <Icon name="shield" />
              <span>The AI will ask questions, not generate the student's answer.</span>
            </div>
          </section>

          <section className="setup-principles-card">
            <div className="eyebrow">What Heather will see</div>
            <h2>A teacher-directed AI workflow</h2>
            <div className="principle-list">
              <div>
                <span>1</span>
                <p><strong>The teacher sets the intellectual task.</strong> Text, question, evidence, and expectations remain teacher-authored.</p>
              </div>
              <div>
                <span>2</span>
                <p><strong>The AI asks, but does not answer.</strong> The live coach is constrained to one concise Socratic question.</p>
              </div>
              <div>
                <span>3</span>
                <p><strong>The final product belongs to the student.</strong> Initial and revised thinking remain visible.</p>
              </div>
              <div>
                <span>4</span>
                <p><strong>The teacher reviews process evidence.</strong> No leaderboard, synthetic depth score, or automated grade.</p>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
