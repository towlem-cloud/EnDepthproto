import React, { useState } from "react";
import "./styles.css";
import "./showcase.css";
import "./submissions.css";
import StudentSubmissionFlow from "./StudentSubmissionFlow";
import TeacherSubmissions from "./TeacherSubmissions";
import { TeacherSetup } from "./TeacherViews";
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
        <StudentSubmissionFlow resetToken={resetToken} assignment={assignment} />
      ) : null}
      {view === "teacher" ? (
        <TeacherSubmissions
          assignment={assignment}
          onEditAssignment={() => setView("teacherSetup")}
        />
      ) : null}

      <footer className="site-footer">
        <div>
          <LogoMark />
          <span>EnDepth classroom pilot</span>
        </div>
        <p>
          Student names and submitted preparation are stored in the connected
          classroom database. Names are not included in OpenAI coach requests.
          Teacher records require a separate private access code.
        </p>
      </footer>
    </div>
  );
}
