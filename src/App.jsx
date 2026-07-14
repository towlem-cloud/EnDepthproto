import React, { useState } from "react";
import "./styles.css";
import "./upgrades.css";
import { Icon, LogoMark, Pill } from "./components/UI.jsx";
import {
  loadAssignment,
  saveAssignment as persistAssignment,
} from "./config/assignment.js";
import Overview from "./views/Overview.jsx";
import StudentWorkspace from "./views/StudentWorkspace.jsx";
import TeacherDashboard from "./views/TeacherDashboard.jsx";
import TeacherSetup from "./views/TeacherSetup.jsx";

function AppHeader({ view, setView, onReset }) {
  const navItems = [
    ["overview", "Overview"],
    ["setup", "Teacher Setup"],
    ["student", "Student View"],
    ["teacher", "Teacher Dashboard"],
  ];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <button className="brand" type="button" onClick={() => setView("overview")}>
          <LogoMark />
          <span>
            <strong>EnDepth</strong>
            <small>Private Harkness preparation</small>
          </span>
        </button>

        <nav className="view-switch" aria-label="Prototype views">
          {navItems.map(([id, label]) => (
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
          <Pill tone="orange">Friday showcase build</Pill>
          {view === "student" ? (
            <button className="icon-button" type="button" onClick={onReset}>
              <Icon name="rotate" />
              <span>Reset demo</span>
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [view, setView] = useState("overview");
  const [assignment, setAssignment] = useState(() => loadAssignment());
  const [resetToken, setResetToken] = useState(0);

  function saveAssignment(value) {
    const saved = persistAssignment(value);
    setAssignment(saved);
    return saved;
  }

  function previewAssignment(value) {
    setAssignment(value);
    setView("student");
  }

  return (
    <div className="app">
      <AppHeader
        view={view}
        setView={setView}
        onReset={() => setResetToken((value) => value + 1)}
      />

      {view === "overview" ? (
        <Overview
          onOpenSetup={() => setView("setup")}
          onOpenStudent={() => setView("student")}
          onOpenTeacher={() => setView("teacher")}
        />
      ) : null}

      {view === "setup" ? (
        <TeacherSetup
          assignment={assignment}
          onSave={saveAssignment}
          onPreview={previewAssignment}
        />
      ) : null}

      {view === "student" ? (
        <StudentWorkspace
          key={`${assignment.id}:${assignment.revision}`}
          assignment={assignment}
          resetToken={resetToken}
        />
      ) : null}

      {view === "teacher" ? (
        <TeacherDashboard
          assignment={assignment}
          onEdit={() => setView("setup")}
          onPreviewStudent={() => setView("student")}
        />
      ) : null}

      <footer className="site-footer">
        <div>
          <LogoMark />
          <span>EnDepth interactive prototype</span>
        </div>
        <p>
          Teacher assignments and student drafts remain in this browser. Live
          coach requests use OpenAI through a protected server route. Dashboard
          student records are fictional.
        </p>
      </footer>
    </div>
  );
}
