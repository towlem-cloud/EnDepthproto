import React from "react";
import { Icon, Pill } from "../components/UI.jsx";

export default function Overview({
  onOpenSetup,
  onOpenStudent,
  onOpenTeacher,
}) {
  return (
    <main className="page overview-page">
      <section className="hero-panel">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-dot" />
            AI that protects student ownership
          </div>
          <h1>Think privately. Enter the circle ready.</h1>
          <p>
            EnDepth helps students arrive at Harkness with a provisional claim,
            a precise textual moment, a complication, and a question worth
            pursuing—without writing the interpretation for them.
          </p>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={onOpenSetup}>
              Configure a teacher assignment
              <Icon name="settings" />
            </button>
            <button className="secondary-button" type="button" onClick={onOpenStudent}>
              Open the student demo
              <Icon name="arrow" />
            </button>
          </div>
          <div className="hero-proof">
            <span><Icon name="shield" /> Teacher controls the task</span>
            <span><Icon name="message" /> One Socratic question at a time</span>
            <span><Icon name="eye" /> Student thinking stays visible</span>
          </div>
        </div>

        <div className="hero-demo" aria-label="Sample EnDepth exchange">
          <div className="demo-window-bar">
            <div>
              <span className="window-dot" />
              <span className="window-dot" />
              <span className="window-dot" />
            </div>
            <span>EnDepth coach</span>
          </div>
          <div className="demo-assignment-label">THE STUDENT'S STARTING IDEA</div>
          <blockquote>
            “Fluent language might be evidence of consciousness, but it cannot
            settle whether a machine actually experiences anything.”
          </blockquote>
          <div className="mini-message coach">
            <div className="mini-avatar">E</div>
            <p>
              What standard do you use for human consciousness that you could
              apply fairly to a machine?
            </p>
          </div>
          <div className="demo-output">
            <div>
              <small>Intellectual movement</small>
              <strong>Certainty → fair evidence under uncertainty</strong>
            </div>
            <span className="signal-dot" />
          </div>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading split-heading">
          <div>
            <div className="eyebrow">The student journey</div>
            <h2>From first thought to Harkness-ready</h2>
          </div>
          <p>
            The tool makes the process visible without turning thought into a
            points game.
          </p>
        </div>

        <div className="journey-grid">
          {[
            {
              number: "01",
              title: "The teacher authors the task",
              body: "The teacher selects the text, central question, evidence expectations, and coaching emphasis.",
              icon: "settings",
            },
            {
              number: "02",
              title: "The student begins alone",
              body: "The student writes before the coach appears, preserving the student's first interpretation.",
              icon: "book",
            },
            {
              number: "03",
              title: "The coach asks one question",
              body: "EnDepth diagnoses the next thinking move without providing a thesis, quotation, or answer.",
              icon: "message",
            },
            {
              number: "04",
              title: "The student prepares the card",
              body: "The final artifact holds a claim, evidence, complication, and open question for the circle.",
              icon: "check",
            },
          ].map((item) => (
            <article className="journey-card" key={item.number}>
              <div className="journey-card-top">
                <span>{item.number}</span>
                <div className="journey-icon"><Icon name={item.icon} /></div>
              </div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="overview-grid section-block">
        <article className="dark-card">
          <Pill tone="dark">Teacher-facing control</Pill>
          <h2>Change the task without changing the code.</h2>
          <p>
            Teacher Setup makes the class, teacher, source, Harkness question,
            evidence expectations, coach emphasis, and question limit editable
            inside the product.
          </p>
          <button className="primary-button dark-card-button" type="button" onClick={onOpenSetup}>
            Open Teacher Setup <Icon name="arrow" />
          </button>
        </article>

        <article className="guardrail-card">
          <div className="guardrail-icon"><Icon name="shield" size={24} /></div>
          <div>
            <div className="eyebrow">Built-in guardrails</div>
            <h2>The coach never becomes the author.</h2>
          </div>
          <ul className="check-list">
            <li><Icon name="check" /> No thesis, paragraph, or finished interpretation</li>
            <li><Icon name="check" /> No invented quotations or evidence</li>
            <li><Icon name="check" /> A teacher-selected limit of 4, 6, or 8 questions</li>
            <li><Icon name="check" /> Student language remains visible throughout</li>
          </ul>
          <button className="secondary-button" type="button" onClick={onOpenTeacher}>
            Preview teacher visibility <Icon name="eye" />
          </button>
        </article>
      </section>
    </main>
  );
}
