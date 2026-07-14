import React, { useState } from "react";
import "./styles.css";
import "./showcase.css";
import StudentWorkspace from "./StudentWorkspace";
import { TeacherDashboard, TeacherSetup } from "./TeacherViews";
import { AppHeader, LogoMark, Overview } from "./endepthUI";
import { loadAssignment } from "./endepthConfig";

export default function App() {
  const [view, setView] = useState("overview");
  const [resetToken, setResetToken] = useState(0);
  const [assignment, setAssignment] = useState(loadAssignment);

  return (
    <div className="app">
      <AppHeader
        view={view}
        setView={setView}
        onReset={() => setResetToken((value) => value + 1)}
      />

      {view === "overview" ? (
        <Overview
          onOpenStudent={() => setView("student")}
          onOpenTeacher={() => setView("teacher")}
          onOpenSetup={() => setView("teacherSetup")}
        />
      ) : null}
      {view === "teacherSetup" ? (
        <TeacherSetup
          assignment={assignment}
          onSave={setAssignment}
          onPreviewStudent={() => setView("student")}
        />
      ) : null}
      {view === "student" ? (
        <StudentWorkspace resetToken={resetToken} assignment={assignment} />
      ) : null}
      {view === "teacher" ? (
        <TeacherDashboard
          assignment={assignment}
          onEditAssignment={() => setView("teacherSetup")}
        />
      ) : null}

      <footer className="site-footer">
        <div>
          <LogoMark />
          <span>EnDepth interactive prototype</span>
        </div>
        <p>
          Live-coach prototype. Student drafts and teacher-created assignments
          remain in this browser; coach requests use OpenAI through a protected
          server route. Dashboard records are fictional showcase data.
        </p>
      </footer>
    </div>
  );
}
