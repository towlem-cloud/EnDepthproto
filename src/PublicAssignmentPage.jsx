import React, { useEffect, useState } from "react";
import StudentSubmissionFlow from "./StudentSubmissionFlow";
import { LogoMark, Pill } from "./endepthUI";
import { normalizeAssignment } from "./endepthConfig";

export default function PublicAssignmentPage({ slug }) {
  const [assignment, setAssignment] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetToken, setResetToken] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/assignment-public?slug=${encodeURIComponent(slug)}`
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "The assignment could not be loaded.");
        if (active) setAssignment(normalizeAssignment(data.assignment));
      } catch (loadError) {
        if (active) setError(loadError.message || "The assignment could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [slug]);

  if (loading) {
    return (
      <main className="public-assignment-shell centered-state">
        <LogoMark />
        <Pill tone="orange">Loading EnDepth assignment</Pill>
        <h1>Preparing your private Harkness workspace…</h1>
      </main>
    );
  }

  if (error || !assignment) {
    return (
      <main className="public-assignment-shell centered-state">
        <LogoMark />
        <Pill tone="orange">Assignment unavailable</Pill>
        <h1>This EnDepth link is not currently open.</h1>
        <p>{error || "Ask your teacher for the current assignment link."}</p>
      </main>
    );
  }

  return (
    <div className="app public-student-app">
      <header className="public-student-header">
        <div className="public-brand">
          <LogoMark />
          <div>
            <strong>EnDepth</strong>
            <span>Private Harkness preparation</span>
          </div>
        </div>
        <div className="public-assignment-meta">
          <Pill tone="orange">{assignment.course}</Pill>
          <span>{assignment.section}</span>
          <button
            className="text-button"
            type="button"
            onClick={() => setResetToken((value) => value + 1)}
          >
            Reset my workspace
          </button>
        </div>
      </header>
      <StudentSubmissionFlow
        resetToken={resetToken}
        assignment={assignment}
        demoMode={false}
      />
      <footer className="site-footer public-footer">
        <div><LogoMark /><span>EnDepth classroom pilot</span></div>
        <p>
          Your name, student email, and submitted preparation are visible only to
          your assigned teacher and the pilot administrator. Your identity is not
          sent to the AI coach.
        </p>
      </footer>
    </div>
  );
}
