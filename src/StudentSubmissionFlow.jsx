import React, { useEffect, useMemo, useState } from "react";
import StudentWorkspace from "./StudentWorkspace";
import { Icon, Pill } from "./endepthUI";
import {
  PILOT_CODE_STORAGE_KEY,
  stableAssignmentKey,
  studentStorageKey,
  wordCount,
} from "./endepthConfig";

const IDENTITY_STORAGE_KEY = "endepth-student-identity-v1";
const SUBMISSION_META_PREFIX = "endepth-submission-meta-v1";

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

export default function StudentSubmissionFlow({ resetToken, assignment }) {
  const assignmentSignature = stableAssignmentKey(assignment);
  const submissionMetaKey = useMemo(
    () => `${SUBMISSION_META_PREFIX}:${shortHash(assignmentSignature)}`,
    [assignmentSignature]
  );
  const savedIdentity = useMemo(() => {
    if (typeof window === "undefined") return { firstName: "", lastName: "" };
    try {
      const value = window.sessionStorage.getItem(IDENTITY_STORAGE_KEY);
      return value ? JSON.parse(value) : { firstName: "", lastName: "" };
    } catch {
      return { firstName: "", lastName: "" };
    }
  }, []);
  const [firstName, setFirstName] = useState(savedIdentity.firstName || "");
  const [lastName, setLastName] = useState(savedIdentity.lastName || "");
  const [submissionId, setSubmissionId] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const [submissionNotice, setSubmissionNotice] = useState("");

  useEffect(() => {
    const meta = loadJson(submissionMetaKey, {});
    setSubmissionId(meta.submissionId || "");
    setSubmittedAt(meta.submittedAt || "");
    setSubmissionError("");
    setSubmissionNotice("");
  }, [submissionMetaKey]);

  useEffect(() => {
    if (resetToken === 0) return;
    try {
      window.localStorage.removeItem(submissionMetaKey);
    } catch {
      // A reset still clears the visible status if browser storage is unavailable.
    }
    setSubmissionId("");
    setSubmittedAt("");
    setSubmissionError("");
    setSubmissionNotice("");
  }, [resetToken, submissionMetaKey]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(
        IDENTITY_STORAGE_KEY,
        JSON.stringify({ firstName, lastName })
      );
    } catch {
      // The name fields still work even when browser storage is unavailable.
    }
  }, [firstName, lastName]);

  function requestPilotCode() {
    const currentCode = window.sessionStorage.getItem(PILOT_CODE_STORAGE_KEY) || "";
    const entered = window.prompt(
      "Enter the EnDepth pilot access code before submitting to your teacher.",
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
    const cleanFirstName = firstName.trim();
    const cleanLastName = lastName.trim();
    setSubmissionError("");
    setSubmissionNotice("");

    if (!cleanFirstName || !cleanLastName) {
      setSubmissionError("Enter both your first and last name before submitting.");
      return;
    }

    const accessCode =
      window.sessionStorage.getItem(PILOT_CODE_STORAGE_KEY)?.trim() ||
      requestPilotCode();
    if (!accessCode) {
      setSubmissionError("The class pilot code is required to submit.");
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
          assignment,
          student: {
            firstName: cleanFirstName,
            lastName: cleanLastName,
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
  const initials = `${firstName.trim().slice(0, 1)}${lastName.trim().slice(0, 1)}`.toUpperCase() || "ST";

  return (
    <>
      <div className="page student-identity-page">
        <section className="content-card real-identity-card">
          <div className="real-identity-heading">
            <div className="real-identity-avatar">{initials}</div>
            <div>
              <div className="card-kicker">Student identity</div>
              <h2>{displayName || "Enter your name before you begin"}</h2>
              <p>
                Your name is attached to the record your teacher receives. It is
                not included in requests sent to the AI coach.
              </p>
            </div>
          </div>
          <div className="student-name-grid">
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
          </div>
        </section>
      </div>

      <StudentWorkspace resetToken={resetToken} assignment={assignment} />

      <div className="page real-submit-page">
        <section className="content-card real-submit-card">
          <div className="real-submit-copy">
            <div className="card-kicker">Real classroom submission</div>
            <h2>Send your preparation to {assignment.teacherName}</h2>
            <p>
              EnDepth will send your initial response, preparation card, evidence,
              and coaching conversation. Your teacher can review the visible
              movement in your thinking.
            </p>
            <div className="submission-privacy-note">
              <Icon name="shield" />
              <span>
                Your name is stored with the classroom submission but is never
                added to the OpenAI coaching request.
              </span>
            </div>
          </div>
          <div className="real-submit-actions">
            {submittedAt ? (
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
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Submitting…"
                : submissionId
                ? "Update submission"
                : "Submit preparation"}
              {!isSubmitting ? <Icon name="arrow" /> : null}
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
