import React, { useEffect, useMemo, useState } from "react";
import StudentWorkspace from "./StudentWorkspace";
import { Icon, Pill } from "./endepthUI";
import {
  PILOT_CODE_STORAGE_KEY,
  stableAssignmentKey,
  studentStorageKey,
  wordCount,
} from "./endepthConfig";

const IDENTITY_STORAGE_KEY = "endepth-student-identity-v2";
const SUBMISSION_META_PREFIX = "endepth-submission-meta-v2";

function loadJson(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createSubmissionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateWorkspace(workspace) {
  if (!workspace) {
    return "Your preparation has not finished saving in this browser yet. Try submitting again.";
  }
  if (wordCount(workspace.initialResponse || "") < 40) {
    return "Complete an initial response of at least 40 words before submitting.";
  }
  if (wordCount(workspace.evidence || "") < 8) {
    return "Add a specific textual or course-based piece of evidence before submitting.";
  }
  if (wordCount(workspace.significance || "") < 8) {
    return "Explain why your evidence matters before submitting.";
  }
  if (wordCount(workspace.claim || "") < 10) {
    return "Complete your provisional claim before submitting.";
  }
  if (wordCount(workspace.complication || "") < 8) {
    return "Add a meaningful complication or alternative reading before submitting.";
  }
  if (!String(workspace.openQuestion || "").trim().endsWith("?")) {
    return "Finish with a genuine open question that ends with a question mark.";
  }
  return "";
}

export default function StudentSubmissionFlow({
  resetToken,
  assignment,
  demoMode = false,
}) {
  const assignmentSignature = stableAssignmentKey(assignment);
  const submissionMetaKey = useMemo(
    () => `${SUBMISSION_META_PREFIX}:${shortHash(assignmentSignature)}`,
    [assignmentSignature]
  );
  const savedIdentity = useMemo(() => {
    if (demoMode || typeof window === "undefined") {
      return { firstName: "", lastName: "", email: "" };
    }
    try {
      const value = window.sessionStorage.getItem(IDENTITY_STORAGE_KEY);
      return value
        ? JSON.parse(value)
        : { firstName: "", lastName: "", email: "" };
    } catch {
      return { firstName: "", lastName: "", email: "" };
    }
  }, [demoMode]);

  const [firstName, setFirstName] = useState(savedIdentity.firstName || "");
  const [lastName, setLastName] = useState(savedIdentity.lastName || "");
  const [email, setEmail] = useState(savedIdentity.email || "");
  const [submissionId, setSubmissionId] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState("");

  useEffect(() => {
    if (demoMode) return;
    const meta = loadJson(submissionMetaKey, {});
    setSubmissionId(meta.submissionId || "");
    setSubmittedAt(meta.submittedAt || "");
    setSubmissionError("");
    setSubmissionNotice("");
  }, [submissionMetaKey, demoMode]);

  useEffect(() => {
    if (resetToken === 0 || demoMode) return;
    try {
      window.localStorage.removeItem(submissionMetaKey);
    } catch {
      // Visible status is still cleared below.
    }
    setSubmissionId("");
    setSubmittedAt("");
    setSubmissionError("");
    setSubmissionNotice("");
  }, [resetToken, submissionMetaKey, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    try {
      window.sessionStorage.setItem(
        IDENTITY_STORAGE_KEY,
        JSON.stringify({ firstName, lastName, email })
      );
    } catch {
      // Identity fields still work without browser storage.
    }
  }, [firstName, lastName, email, demoMode]);

  function requestPilotCode() {
    const currentCode = window.sessionStorage.getItem(PILOT_CODE_STORAGE_KEY) || "";
    const entered = window.prompt(
      "Enter the EnDepth student pilot code before submitting.",
      currentCode
    );
    if (entered === null) return "";
    const cleanCode = entered.trim();
    if (cleanCode) {
      window.sessionStorage.setItem(PILOT_CODE_STORAGE_KEY, cleanCode);
    }
    return cleanCode;
  }

  async function submitPreparation() {
    if (demoMode) return;
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    const cleanEmail = email.trim().toLowerCase();
    setSubmissionError("");
    setSubmissionNotice("");

    if (!cleanFirstName || !cleanLastName) {
      setSubmissionError("Enter both your first and last name before submitting.");
      return;
    }
    if (!validEmail(cleanEmail)) {
      setSubmissionError("Enter your complete student email address before submitting.");
      return;
    }
    if (!assignment.assignmentId) {
      setSubmissionError("Open the student link your teacher posted for this assignment.");
      return;
    }

    const accessCode =
      window.sessionStorage.getItem(PILOT_CODE_STORAGE_KEY)?.trim() ||
      requestPilotCode();
    if (!accessCode) {
      setSubmissionError("The student pilot code is required to submit.");
      return;
    }

    setIsSubmitting(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const workspace = loadJson(studentStorageKey(assignment), null);
      const validationError = validateWorkspace(workspace);
      if (validationError) throw new Error(validationError);

      const nextSubmissionId = submissionId || createSubmissionId();
      const response = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessCode,
          submissionId: nextSubmissionId,
          assignmentId: assignment.assignmentId,
          assignment,
          student: {
            firstName: cleanFirstName,
            lastName: cleanLastName,
            email: cleanEmail,
          },
          work: {
            initialResponse: workspace.initialResponse,
            evidence: workspace.evidence,
            significance: workspace.significance,
            claim: workspace.claim,
            complication: workspace.complication,
            openQuestion: workspace.openQuestion,
          },
          messages: Array.isArray(workspace.messages)
            ? workspace.messages.map(({ role, text, move }) => ({ role, text, move }))
            : [],
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          window.sessionStorage.removeItem(PILOT_CODE_STORAGE_KEY);
        }
        throw new Error(data.error || "Your preparation could not be submitted.");
      }

      const meta = {
        submissionId: data.submissionId,
        submittedAt: data.submittedAt,
      };
      window.localStorage.setItem(submissionMetaKey, JSON.stringify(meta));
      setSubmissionId(meta.submissionId);
      setSubmittedAt(meta.submittedAt);
      setSubmissionNotice(
        submissionId
          ? `Your updated preparation was sent to ${assignment.teacherName}.`
          : `Your preparation was sent to ${assignment.teacherName}.`
      );
    } catch (error) {
      setSubmissionError(error.message || "Your preparation could not be submitted.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const displayName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  const initials = `${firstName.trim().slice(0, 1)}${lastName
    .trim()
    .slice(0, 1)}`.toUpperCase() || "ST";

  return (
    <>
      <div className="page student-identity-page">
        <section className="content-card real-identity-card">
          <div className="real-identity-heading">
            <div className="real-identity-avatar">{initials}</div>
            <div>
              <div className="card-kicker">
                {demoMode ? "Student preview" : "Student identity"}
              </div>
              <h2>{displayName || "Enter your school information before you begin"}</h2>
              <p>
                Your name and student email are attached to the classroom record
                your teacher receives. Neither is included in requests sent to the
                AI coach.
              </p>
            </div>
          </div>
          <div className="student-name-grid student-identity-grid-three">
            <label>
              <span>First name</span>
              <input
                autoComplete="given-name"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                maxLength={80}
              />
            </label>
            <label>
              <span>Last name</span>
              <input
                autoComplete="family-name"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                maxLength={80}
              />
            </label>
            <label>
              <span>Student email</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                placeholder="student@school.org"
              />
            </label>
          </div>
        </section>
      </div>

      <StudentWorkspace resetToken={resetToken} assignment={assignment} />

      <div className="page real-submit-page">
        <section className="content-card real-submit-card">
          <div className="real-submit-copy">
            <div className="card-kicker">
              {demoMode ? "Preview mode" : "Classroom submission"}
            </div>
            <h2>
              {demoMode
                ? "The live student link submits here"
                : `Send your preparation to ${assignment.teacherName}`}
            </h2>
            <p>
              {demoMode
                ? "This homepage preview does not create a database record. Teachers generate a unique student link from the Teacher Portal."
                : "EnDepth sends your initial response, preparation card, evidence, and coaching conversation to your assigned teacher."}
            </p>
            <div className="submission-privacy-note">
              <Icon name="shield" />
              <span>
                The database record includes your name and student email. OpenAI
                receives only the academic thinking needed to ask the next question.
              </span>
            </div>
          </div>
          <div className="real-submit-actions">
            {demoMode ? (
              <Pill tone="neutral">No record created in preview</Pill>
            ) : submittedAt ? (
              <Pill tone="green" icon="check">
                Submitted {new Date(submittedAt).toLocaleString()}
              </Pill>
            ) : (
              <Pill tone="orange">Not yet submitted</Pill>
            )}
            <button
              className="primary-button"
              type="button"
              onClick={submitPreparation}
              disabled={isSubmitting || demoMode}
            >
              {demoMode
                ? "Use a teacher-created link"
                : isSubmitting
                ? "Submitting…"
                : submissionId
                ? "Update submission"
                : "Submit preparation"}
              {!isSubmitting && !demoMode ? <Icon name="arrow" /> : null}
            </button>
          </div>
          {submissionNotice ? (
            <div className="inline-notice success-notice real-submission-message">
              {submissionNotice}
            </div>
          ) : null}
          {submissionError ? (
            <div className="inline-notice real-submission-message">
              {submissionError}
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
