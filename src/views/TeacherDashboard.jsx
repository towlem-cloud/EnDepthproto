import React, { useEffect, useMemo, useState } from "react";
import { Icon, Pill, StatusBadge } from "../components/UI.jsx";
import { TEACHER_STUDENTS } from "../data/demoData.js";

export default function TeacherDashboard({ assignment, onEdit, onPreviewStudent }) {
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(1);

  const visibleStudents = useMemo(
    () =>
      TEACHER_STUDENTS.filter((student) =>
        filter === "All" ? true : student.status === filter
      ),
    [filter]
  );

  const selected = TEACHER_STUDENTS.find(
    (student) => student.id === selectedId
  );

  useEffect(() => {
    if (!visibleStudents.some((student) => student.id === selectedId)) {
      setSelectedId(visibleStudents[0]?.id ?? 1);
    }
  }, [selectedId, visibleStudents]);

  return (
    <main className="page teacher-page">
      <section className="teacher-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange">Teacher dashboard</Pill>
            <span>{assignment.courseName} · {assignment.teacherName}</span>
          </div>
          <h1>{assignment.assignmentTitle}</h1>
          <p>{assignment.dueLabel}</p>
        </div>
        <div className="teacher-banner-actions">
          <button className="secondary-button" type="button" onClick={onPreviewStudent}>
            Preview student view <Icon name="eye" />
          </button>
          <button className="primary-button" type="button" onClick={onEdit}>
            Edit assignment <Icon name="edit" />
          </button>
        </div>
      </section>

      <section className="metric-grid">
        {[
          ["16", "Students assigned", "users"],
          ["11", "Submitted", "check"],
          ["4", "In progress", "clock"],
          ["1", "Not started", "book"],
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
            <button className="text-button" type="button" onClick={onEdit}>
              Edit assignment <Icon name="chevron" size={16} />
            </button>
          </div>

          <div className="assignment-summary assignment-summary-expanded">
            <div>
              <span>Central question</span>
              <p>{assignment.centralQuestion}</p>
            </div>
            <div className="dashboard-design-grid">
              <div>
                <span>Coach focus</span>
                <strong>{assignment.coachingFocus}</strong>
              </div>
              <div>
                <span>Question limit</span>
                <strong>{assignment.maxCoachTurns} questions</strong>
              </div>
            </div>
            <div className="teacher-expectations">
              {assignment.finalRequirements.map((item) => (
                <span key={item}><Icon name="check" size={14} /> {item}</span>
              ))}
            </div>
          </div>
        </article>

        <article className="content-card privacy-summary-card">
          <div className="guardrail-icon"><Icon name="shield" size={22} /></div>
          <div>
            <div className="card-kicker">Pilot guardrail</div>
            <h2>Process evidence, not automated grading</h2>
            <p>
              The dashboard highlights where thinking is visible. It does not
              rank students, assign a grade, or turn language patterns into a score.
            </p>
            <small className="prototype-data-note">
              Dashboard students are fictional showcase records. A shared class
              database is the next implementation stage.
            </small>
          </div>
        </article>
      </section>
    </main>
  );
}
