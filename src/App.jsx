import React, { useMemo, useState } from "react";
import "./styles.css";
import "./showcase.css";
import "./submissions.css";
import "./multiTeacher.css";
import PublicAssignmentPage from "./PublicAssignmentPage";
import StaffPortal from "./StaffPortal";
import StudentSubmissionFlow from "./StudentSubmissionFlow";
import { Icon, LogoMark, Overview, Pill } from "./endepthUI";
import { loadAssignment } from "./endepthConfig";

function PilotHeader({ view, setView, onReset }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" type="button" onClick={() => setView("overview")}>
          <LogoMark />
          <span><strong>EnDepth</strong><small>Private Harkness preparation</small></span>
        </button>
        <nav className="view-switch" aria-label="EnDepth views">
          {[
            ["overview", "Overview"],
            ["staff", "Teacher Portal"],
            ["student", "Student Preview"],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <Pill tone="orange">Two-teacher pilot</Pill>
          {view === "student" ? (
            <button className="icon-button" type="button" onClick={onReset}>
              <Icon name="rotate" /><span>Reset preview</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const assignmentSlug = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("assignment") || "";
  }, []);
  const [view, setView] = useState("overview");
  const [resetToken, setResetToken] = useState(0);
  const [assignment] = useState(loadAssignment);

  if (assignmentSlug) {
    return <PublicAssignmentPage slug={assignmentSlug} />;
  }

  return (
    <div className="app">
      <PilotHeader
        view={view}
        setView={setView}
        onReset={() => setResetToken((value) => value + 1)}
      />

      {view === "overview" ? (
        <Overview
          onOpenStudent={() => setView("student")}
          onOpenTeacher={() => setView("staff")}
          onOpenSetup={() => setView("staff")}
        />
      ) : null}
      {view === "staff" ? <StaffPortal /> : null}
      {view === "student" ? (
        <StudentSubmissionFlow
          resetToken={resetToken}
          assignment={assignment}
          demoMode
        />
      ) : null}

      <footer className="site-footer">
        <div><LogoMark /><span>EnDepth multi-teacher pilot</span></div>
        <p>
          Teachers create database-backed assignments and post unique student
          links. Student identity stays out of OpenAI requests, and teacher access
          is separated on the server.
        </p>
      </footer>
    </div>
  );
}
