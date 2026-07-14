import React, { useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";

const ASSIGNMENT_STORAGE_KEY = "endepth.assignment.v1";

const DEFAULT_ASSIGNMENT = {
  teacherName: "Morgan Towle",
  course: "Minds, Machines, and Morality",
  title: "What Counts as Consciousness?",
  date: "Harkness preparation · Due Friday",
  prompt:
    "What should count as consciousness, and what kind of evidence would persuade us that an artificial intelligence genuinely possesses it?",
  sourceTitle: "Turing, Searle, and the Problem of Machine Consciousness",
  passage:
    "A machine may produce language that appears thoughtful, responsive, and self-aware. But observable performance does not necessarily settle whether the machine understands, experiences, or merely processes symbols according to rules.",
  directions:
    "Begin with your own criteria for consciousness, then test those criteria against the Turing-style performance evidence and Searle-style symbol-processing objection.",
  evidenceRequirement:
    "Use at least one exact idea from the passage and explain why it would or would not count as evidence of genuine experience.",
  coachingFocus:
    "Define consciousness, distinguish performance from experience, and name what evidence would change your mind.",
  maxCoachQuestions: 6,
};

const SHOWCASE_ASSIGNMENT = { ...DEFAULT_ASSIGNMENT };

function normalizeAssignment(value = {}) {
  return {
    ...DEFAULT_ASSIGNMENT,
    ...value,
    teacherName: String(value.teacherName ?? DEFAULT_ASSIGNMENT.teacherName).trim(),
    course: String(value.course ?? DEFAULT_ASSIGNMENT.course).trim(),
    title: String(value.title ?? DEFAULT_ASSIGNMENT.title).trim(),
    date: String(value.date ?? DEFAULT_ASSIGNMENT.date).trim(),
    prompt: String(value.prompt ?? DEFAULT_ASSIGNMENT.prompt).trim(),
    sourceTitle: String(value.sourceTitle ?? DEFAULT_ASSIGNMENT.sourceTitle).trim(),
    passage: String(value.passage ?? DEFAULT_ASSIGNMENT.passage).trim(),
    directions: String(value.directions ?? DEFAULT_ASSIGNMENT.directions).trim(),
    evidenceRequirement: String(value.evidenceRequirement ?? DEFAULT_ASSIGNMENT.evidenceRequirement).trim(),
    coachingFocus: String(value.coachingFocus ?? DEFAULT_ASSIGNMENT.coachingFocus).trim(),
    maxCoachQuestions: [4, 6, 8].includes(Number(value.maxCoachQuestions))
      ? Number(value.maxCoachQuestions)
      : DEFAULT_ASSIGNMENT.maxCoachQuestions,
  };
}

function stableAssignmentKey(assignment) {
  const normalized = normalizeAssignment(assignment);
  return JSON.stringify({
    teacherName: normalized.teacherName,
    course: normalized.course,
    title: normalized.title,
    prompt: normalized.prompt,
    sourceTitle: normalized.sourceTitle,
    passage: normalized.passage,
    directions: normalized.directions,
    evidenceRequirement: normalized.evidenceRequirement,
    coachingFocus: normalized.coachingFocus,
    maxCoachQuestions: normalized.maxCoachQuestions,
  });
}

function loadAssignment() {
  if (typeof window === "undefined") return DEFAULT_ASSIGNMENT;
  try {
    const saved = window.localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    return saved ? normalizeAssignment(JSON.parse(saved)) : DEFAULT_ASSIGNMENT;
  } catch {
    return DEFAULT_ASSIGNMENT;
  }
}

function saveAssignmentToStorage(assignment) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(ASSIGNMENT_STORAGE_KEY, JSON.stringify(assignment));
  }
}

const ASSIGNMENT = DEFAULT_ASSIGNMENT;

const STARTER_MESSAGES = [
  {
    id: 1,
    role: "coach",
    text: "You argue that fear matters, but that it does not fully explain the choice. Which exact detail makes fear feel insufficient?",
    move: "Ground in the text",
  },
  {
    id: 2,
    role: "student",
    text: "The public and private actions do not match. If safety were the only goal, destroying the letter makes no sense.",
  },
  {
    id: 3,
    role: "coach",
    text: "What might the character be protecting instead of physical safety? Name the possibility, then test it against the scene.",
    move: "Clarify the claim",
  },
];

const STORAGE_KEY = "endepth-student-prototype-v4";
const PILOT_CODE_STORAGE_KEY = "endepth-pilot-access-code";

const SAMPLE_STUDENT_STATE = {
  initialResponse:
    "At first, the character seems to destroy the letter because they are afraid of being exposed. But that explanation feels incomplete: the letter could have protected them. The contradiction between what they say publicly and what they do privately makes me think they may care more about controlling their identity than staying safe.",
  coachUnlocked: true,
  messages: STARTER_MESSAGES,
  newMessage:
    "Maybe the character is protecting the version of themself that other people believe.",
  selectedMove: "clarify",
  evidence:
    "The character insists in public that nothing has changed, then privately destroys the one letter that could verify what really happened.",
  significance:
    "The contrast suggests that controlling the story matters more than using the letter for safety.",
  claim:
    "The character destroys the letter not simply out of fear, but to control which version of their identity can survive.",
  complication:
    "The act may also be a form of self-punishment, so control and guilt could be operating at the same time.",
  openQuestion:
    "Is the character preserving an identity, or trying to erase the person they used to be?",
  submitted: false,
};

function loadStudentState(assignment = DEFAULT_ASSIGNMENT) {
  if (typeof window === "undefined") return SAMPLE_STUDENT_STATE;

  try {
    const saved = window.localStorage.getItem(`${STORAGE_KEY}:${stableAssignmentKey(assignment)}`);
    if (!saved) return SAMPLE_STUDENT_STATE;
    const parsed = JSON.parse(saved);
    return {
      ...SAMPLE_STUDENT_STATE,
      ...parsed,
      messages: Array.isArray(parsed.messages)
        ? parsed.messages
        : STARTER_MESSAGES,
    };
  } catch {
    return SAMPLE_STUDENT_STATE;
  }
}

const MOVE_OPTIONS = [
  {
    id: "clarify",
    label: "Clarify my idea",
    short: "Make the claim more exact",
  },
  {
    id: "evidence",
    label: "Find what I need to prove",
    short: "Locate the textual hinge",
  },
  {
    id: "complicate",
    label: "Complicate my interpretation",
    short: "Test a competing reading",
  },
  {
    id: "connect",
    label: "Connect two ideas",
    short: "Build a larger pattern",
  },
];

const TEACHER_STUDENTS = [
  {
    id: 1,
    name: "Avery M.",
    status: "Submitted",
    stage: "Ready",
    grounding: "Grounded",
    complexity: "Visible",
    question: "Open",
    initial:
      "The character destroys the letter because they are afraid of being caught.",
    revised:
      "Fear explains the urgency, but destroying the letter also lets the character control which version of the past can survive. The choice protects an identity more than a body.",
    evidence:
      "The character says publicly that nothing has changed, then privately destroys the only document that could confirm the truth.",
    complication:
      "The letter could also represent guilt, so the act may be both self-protection and self-punishment.",
    openQuestion:
      "Is the character preserving an identity, or trying to erase the person they used to be?",
  },
  {
    id: 2,
    name: "Jordan R.",
    status: "In progress",
    stage: "Evidence needed",
    grounding: "Developing",
    complexity: "Visible",
    question: "Developing",
    initial:
      "I think pride matters more than fear, but I am not sure what proves that yet.",
    revised:
      "The character may choose pride over safety because being seen as weak would destroy the identity they have built.",
    evidence:
      "The response refers to the public scene but has not yet identified a precise word or action.",
    complication:
      "The character also seems panicked, so pride and fear may be feeding each other.",
    openQuestion: "Why is public humiliation more threatening than danger?",
  },
  {
    id: 3,
    name: "Mina K.",
    status: "Submitted",
    stage: "Ready",
    grounding: "Grounded",
    complexity: "Visible",
    question: "Open",
    initial:
      "The choice looks irrational because the character throws away protection.",
    revised:
      "The choice is irrational only if survival is the character's highest value. The scene suggests that controlling the story others believe has become more important than staying safe.",
    evidence:
      "The character destroys the letter immediately after insisting that the public version of events is true.",
    complication:
      "The destruction may create the very suspicion the character is trying to avoid.",
    openQuestion:
      "Can a choice be self-destructive and still feel like control to the person making it?",
  },
  {
    id: 4,
    name: "Theo S.",
    status: "Not started",
    stage: "Not started",
    grounding: "Beginning",
    complexity: "Beginning",
    question: "Beginning",
    initial: "",
    revised: "",
    evidence: "",
    complication: "",
    openQuestion: "",
  },
  {
    id: 5,
    name: "Cam L.",
    status: "In progress",
    stage: "Claim forming",
    grounding: "Grounded",
    complexity: "Developing",
    question: "Open",
    initial:
      "Maybe the character is not afraid of consequences but of losing control.",
    revised:
      "The letter gives someone else control over the story, so destroying it may be an attempt to take that control back.",
    evidence:
      "The private destruction directly contradicts the public insistence that the past is settled.",
    complication: "",
    openQuestion:
      "What does the scene suggest about the difference between truth and control?",
  },
];

function wordCount(value) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function hasAny(text, terms) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function getSignal(label, state, note) {
  return { label, state, note };
}

function buildSnapshot({
  initialResponse,
  evidence,
  significance,
  claim,
  complication,
  openQuestion,
  messages,
}) {
  const studentMessages = messages
    .filter((message) => message.role === "student")
    .map((message) => message.text)
    .join(" ");
  const allStudentThinking = `${initialResponse} ${studentMessages} ${claim}`;

  const grounding =
    wordCount(evidence) >= 10 && wordCount(significance) >= 8
      ? getSignal(
          "Textual grounding",
          "Grounded",
          "A specific moment is connected to an interpretive idea."
        )
      : wordCount(evidence) >= 5
      ? getSignal(
          "Textual grounding",
          "Developing",
          "A moment is present; its significance still needs sharpening."
        )
      : getSignal(
          "Textual grounding",
          "Beginning",
          "Identify the exact word, action, contrast, or pattern carrying the idea."
        );

  const complexityVisible =
    wordCount(complication) >= 10 ||
    hasAny(allStudentThinking, [
      "but",
      "however",
      "although",
      "yet",
      "tension",
      "contradiction",
      "instead",
    ]);
  const complexity = complexityVisible
    ? getSignal(
        "Complexity",
        "Visible",
        "The interpretation recognizes tension or a competing possibility."
      )
    : wordCount(initialResponse) >= 40
    ? getSignal(
        "Complexity",
        "Developing",
        "The idea has substance; now test what makes it less simple."
      )
    : getSignal(
        "Complexity",
        "Beginning",
        "Move beyond the first explanation by naming what resists it."
      );

  const inquiry = openQuestion.trim().endsWith("?")
    ? getSignal(
        "Inquiry",
        "Open",
        "The preparation ends with a question the group can genuinely explore."
      )
    : studentMessages.includes("?")
    ? getSignal(
        "Inquiry",
        "Developing",
        "A question is emerging; preserve the strongest one for discussion."
      )
    : getSignal(
        "Inquiry",
        "Beginning",
        "Form an interpretive question that cannot be answered with a fact."
      );

  const hasMovement =
    messages.filter((message) => message.role === "student").length >= 2 ||
    (wordCount(claim) >= 10 && claim.trim() !== initialResponse.trim());
  const movement = hasMovement
    ? getSignal(
        "Intellectual movement",
        "Revising",
        "The later thinking changes, narrows, or complicates the starting idea."
      )
    : getSignal(
        "Intellectual movement",
        "Beginning",
        "Use the coach to revise the idea rather than simply add more words."
      );

  return [grounding, complexity, inquiry, movement];
}

function LogoMark() {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="46" height="46" rx="15" fill="currentColor" />
      <path
        d="M13 14.5h21M13 24h15M13 33.5h21"
        fill="none"
        stroke="white"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="34" cy="24" r="4" fill="#ffedd5" />
    </svg>
  );
}

function Icon({ name, size = 18 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  const paths = {
    arrow: (
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    spark: (
      <>
        <path d="m12 3-1.6 4.1L6 9l4.4 1.9L12 15l1.6-4.1L18 9l-4.4-1.9L12 3Z" />
        <path d="m5 16-.8 2L2 19l2.2 1 .8 2 .8-2L8 19l-2.2-1L5 16Z" />
        <path d="m19 14-1 2.5-2.5 1 2.5 1 1 2.5 1-2.5 2.5-1-2.5-1L19 14Z" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </>
    ),
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    shield: (
      <>
        <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    save: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </>
    ),
    message: (
      <>
        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
        <path d="M8 9h8" />
        <path d="M8 13h5" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    rotate: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function Pill({ children, tone = "neutral", icon }) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

function AppHeader({ view, setView, onReset }) {
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
          <button
            type="button"
            className={view === "overview" ? "active" : ""}
            onClick={() => setView("overview")}
          >
            Overview
          </button>
          <button
            type="button"
            className={view === "student" ? "active" : ""}
            onClick={() => setView("student")}
          >
            Student view
          </button>
          <button type="button" className={view === "teacherSetup" ? "active" : ""} onClick={() => setView("teacherSetup")}>Teacher Setup</button>
          <button
            type="button"
            className={view === "teacher" ? "active" : ""}
            onClick={() => setView("teacher")}
          >
            Teacher view
          </button>
        </nav>

        <div className="topbar-actions">
          <Pill tone="orange">Live coach prototype</Pill>
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

function Overview({ onOpenStudent, onOpenTeacher }) {
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
            <button className="primary-button" type="button" onClick={onOpenStudent}>
              Open the student demo
              <Icon name="arrow" />
            </button>
            <button className="secondary-button" type="button" onClick={onOpenTeacher}>
              Preview the teacher dashboard
            </button>
          </div>
          <div className="hero-proof">
            <span><Icon name="shield" /> No grades or leaderboard</span>
            <span><Icon name="message" /> One Socratic question at a time</span>
            <span><Icon name="eye" /> Clear teacher visibility</span>
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
            “The character destroys the letter because they are afraid, but that
            answer feels too simple.”
          </blockquote>
          <div className="mini-message coach">
            <div className="mini-avatar">E</div>
            <p>
              Which exact detail makes fear feel insufficient—and what might the
              character be protecting instead?
            </p>
          </div>
          <div className="demo-output">
            <div>
              <small>Intellectual movement</small>
              <strong>Fear → control over identity</strong>
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
              title: "Begin alone",
              body: "The student writes before the coach appears, preserving the student's first interpretation.",
              icon: "book",
            },
            {
              number: "02",
              title: "Receive one question",
              body: "The coach identifies the next thinking move and asks one concise, text-centered question.",
              icon: "message",
            },
            {
              number: "03",
              title: "Ground and complicate",
              body: "The student names evidence, explains its significance, and tests a competing possibility.",
              icon: "spark",
            },
            {
              number: "04",
              title: "Prepare the card",
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
          <Pill tone="dark">Student-facing feedback</Pill>
          <h2>No synthetic “depth score.”</h2>
          <p>
            Students see a qualitative Thinking Snapshot: what is already visible
            in their preparation and what intellectual move should come next.
          </p>
          <div className="snapshot-preview">
            <div>
              <span>Textual grounding</span>
              <strong>Grounded</strong>
            </div>
            <div>
              <span>Complexity</span>
              <strong>Visible</strong>
            </div>
            <div>
              <span>Inquiry</span>
              <strong>Open</strong>
            </div>
            <div>
              <span>Intellectual movement</span>
              <strong>Revising</strong>
            </div>
          </div>
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
            <li><Icon name="check" /> Student language remains visible throughout</li>
            <li><Icon name="check" /> Teacher sees the submitted preparation and process</li>
          </ul>
        </article>
      </section>
    </main>
  );
}

function ProgressSteps({ readiness }) {
  const steps = [
    { label: "Think", complete: readiness.initial },
    { label: "Ground", complete: readiness.evidence },
    { label: "Complicate", complete: readiness.complication },
    { label: "Prepare", complete: readiness.card },
  ];

  return (
    <div className="progress-steps" aria-label="Preparation progress">
      {steps.map((step, index) => (
        <React.Fragment key={step.label}>
          <div className={`progress-step ${step.complete ? "complete" : ""}`}>
            <span>{step.complete ? <Icon name="check" size={14} /> : index + 1}</span>
            <small>{step.label}</small>
          </div>
          {index < steps.length - 1 ? (
            <div className={`progress-line ${step.complete ? "complete" : ""}`} />
          ) : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function SignalCard({ signal }) {
  const slug = signal.state.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="signal-card">
      <div className="signal-card-heading">
        <span>{signal.label}</span>
        <strong className={`signal-state state-${slug}`}>{signal.state}</strong>
      </div>
      <p>{signal.note}</p>
    </div>
  );
}

function FieldHeader({ label, helper, value, minimum }) {
  const count = wordCount(value);
  return (
    <div className="field-header">
      <div>
        <label>{label}</label>
        {helper ? <small>{helper}</small> : null}
      </div>
      {typeof minimum === "number" ? (
        <span className={count >= minimum ? "count-ready" : ""}>
          {count} words{minimum ? ` · ${minimum} suggested` : ""}
        </span>
      ) : null}
    </div>
  );
}

function StudentWorkspace({ resetToken, assignment }) {
  const assignmentSignature = stableAssignmentKey(assignment);
  const initialStateRef = useRef(loadStudentState(assignment));
  const initialState = initialStateRef.current;

  const [initialResponse, setInitialResponse] = useState(
    initialState.initialResponse
  );
  const [coachUnlocked, setCoachUnlocked] = useState(
    initialState.coachUnlocked
  );
  const [messages, setMessages] = useState(initialState.messages);
  const [newMessage, setNewMessage] = useState(initialState.newMessage);
  const [selectedMove, setSelectedMove] = useState(initialState.selectedMove);
  const [evidence, setEvidence] = useState(initialState.evidence);
  const [significance, setSignificance] = useState(initialState.significance);
  const [claim, setClaim] = useState(initialState.claim);
  const [complication, setComplication] = useState(initialState.complication);
  const [openQuestion, setOpenQuestion] = useState(initialState.openQuestion);
  const [submitted, setSubmitted] = useState(Boolean(initialState.submitted));
  const [savedAt, setSavedAt] = useState("Saved in this browser");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [isCoachThinking, setIsCoachThinking] = useState(false);
  const [coachError, setCoachError] = useState("");
  const [pilotCode, setPilotCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(PILOT_CODE_STORAGE_KEY) || "";
  });
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (resetToken === 0) return;
    setInitialResponse(SAMPLE_STUDENT_STATE.initialResponse);
    setCoachUnlocked(SAMPLE_STUDENT_STATE.coachUnlocked);
    setMessages(STARTER_MESSAGES.map((message) => ({ ...message })));
    setNewMessage(SAMPLE_STUDENT_STATE.newMessage);
    setSelectedMove(SAMPLE_STUDENT_STATE.selectedMove);
    setEvidence(SAMPLE_STUDENT_STATE.evidence);
    setSignificance(SAMPLE_STUDENT_STATE.significance);
    setClaim(SAMPLE_STUDENT_STATE.claim);
    setComplication(SAMPLE_STUDENT_STATE.complication);
    setOpenQuestion(SAMPLE_STUDENT_STATE.openQuestion);
    setSubmitted(false);
    setNotice("Sample workspace restored.");
    setCoachError("");
    setIsCoachThinking(false);
    window.localStorage.removeItem(`${STORAGE_KEY}:${assignmentSignature}`);
  }, [resetToken, assignmentSignature]);

  useEffect(() => {
    setIsSaving(true);
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          `${STORAGE_KEY}:${assignmentSignature}`,
          JSON.stringify({
            initialResponse,
            coachUnlocked,
            messages,
            newMessage,
            selectedMove,
            evidence,
            significance,
            claim,
            complication,
            openQuestion,
            submitted,
          })
        );
        setSavedAt(
          `Saved in this browser at ${new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}`
        );
      } catch {
        setSavedAt("Preview changes could not be saved");
      } finally {
        setIsSaving(false);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    initialResponse,
    coachUnlocked,
    messages,
    newMessage,
    selectedMove,
    evidence,
    significance,
    claim,
    complication,
    openQuestion,
    submitted,
    assignmentSignature,
  ]);

  useEffect(() => {
    const nextState = loadStudentState(assignment);
    setInitialResponse(nextState.initialResponse);
    setCoachUnlocked(nextState.coachUnlocked);
    setMessages(nextState.messages);
    setNewMessage(nextState.newMessage);
    setSelectedMove(nextState.selectedMove);
    setEvidence(nextState.evidence);
    setSignificance(nextState.significance);
    setClaim(nextState.claim);
    setComplication(nextState.complication);
    setOpenQuestion(nextState.openQuestion);
    setSubmitted(Boolean(nextState.submitted));
    setNotice("Workspace loaded for this assignment.");
  }, [assignmentSignature, assignment]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const snapshot = useMemo(
    () =>
      buildSnapshot({
        initialResponse,
        evidence,
        significance,
        claim,
        complication,
        openQuestion,
        messages,
      }),
    [
      initialResponse,
      evidence,
      significance,
      claim,
      complication,
      openQuestion,
      messages,
    ]
  );

  const readiness = useMemo(
    () => ({
      initial: wordCount(initialResponse) >= 40,
      evidence: wordCount(evidence) >= 8 && wordCount(significance) >= 8,
      complication: wordCount(complication) >= 8,
      card:
        wordCount(claim) >= 10 &&
        wordCount(evidence) >= 8 &&
        wordCount(complication) >= 8 &&
        openQuestion.trim().endsWith("?"),
    }),
    [initialResponse, evidence, significance, complication, claim, openQuestion]
  );

  const readyCount = Object.values(readiness).filter(Boolean).length;

  function unlockCoach() {
    if (wordCount(initialResponse) < 40) {
      setNotice(
        "Write at least 40 words of your own thinking before opening the coach."
      );
      return;
    }
    setCoachUnlocked(true);
    setNotice("");
    if (messages.length === 0) {
      setMessages([
        {
          id: Date.now(),
          role: "coach",
          move: "Clarify the claim",
          text: "What part of your interpretation feels least settled—and which detail is creating that uncertainty?",
        },
      ]);
    }
  }

  function requestPilotCode() {
    const entered = window.prompt(
      "Enter the EnDepth pilot access code. Your teacher will provide it.",
      pilotCode
    );

    if (entered === null) return "";

    const cleanCode = entered.trim();
    if (!cleanCode) {
      setCoachError("A pilot access code is required to use the live coach.");
      return "";
    }

    window.sessionStorage.setItem(PILOT_CODE_STORAGE_KEY, cleanCode);
    setPilotCode(cleanCode);
    setCoachError("");
    return cleanCode;
  }

  async function sendMessage() {
    const text = newMessage.trim();
    if (!text || isCoachThinking) return;

    const accessCode = pilotCode.trim() || requestPilotCode();
    if (!accessCode) return;

    const studentMessage = {
      id: Date.now(),
      role: "student",
      text,
    };
    const conversation = [...messages, studentMessage];

    setMessages(conversation);
    setNewMessage("");
    setCoachError("");
    setIsCoachThinking(true);

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessCode,
          assignment,
          initialResponse,
          selectedMove,
          evidence,
          significance,
          messages: conversation.slice(-10).map(({ role, text: messageText }) => ({
            role,
            text: messageText,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          window.sessionStorage.removeItem(PILOT_CODE_STORAGE_KEY);
          setPilotCode("");
        }
        const error = new Error(
          data.error || "The coach could not respond. Please try again."
        );
        error.status = response.status;
        throw error;
      }

      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: "coach",
          text: data.reply,
          move: data.move || "Socratic question",
        },
      ]);
    } catch (error) {
      setMessages((current) =>
        current.filter((message) => message.id !== studentMessage.id)
      );
      setNewMessage(text);
      setCoachError(
        error.status === 401
          ? "That pilot code was not accepted. Enter the current code and try again."
          : error.message || "The coach could not respond. Please try again."
      );
    } finally {
      setIsCoachThinking(false);
    }
  }

  function beginCardFromThinking() {
    if (!claim.trim()) {
      setClaim(initialResponse.split(/[.!?]/)[0] || "");
    }
    if (!openQuestion.trim()) {
      setOpenQuestion("What remains unresolved about this choice?");
    }
    document
      .getElementById("harkness-card")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="page student-page">
      <section className="workspace-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange">{assignment.course}</Pill>
            <span>{assignment.date}</span>
          </div>
          <h1>{assignment.title}</h1>
        </div>
        <div className="student-identity">
          <div className="student-avatar">DS</div>
          <div>
            <strong>Demo Student</strong>
            <span>{isSaving ? "Saving…" : savedAt}</span>
          </div>
          <Icon name="save" />
        </div>
      </section>

      <ProgressSteps readiness={readiness} />

      <div className="student-layout">
        <div className="student-main-column">
          <section className="content-card assignment-card">
            <div className="card-kicker"><Icon name="book" /> Assignment</div>
            <h2>Entry question</h2>
            <p className="assignment-prompt">{assignment.prompt}</p>
            <div className="passage-box">
              <span>Assigned moment</span>
              <p>“{assignment.passage}”</p>
            </div>
            <dl className="student-instructions">
              <div><dt>Teacher</dt><dd>{assignment.teacherName}</dd></div>
              <div><dt>Course</dt><dd>{assignment.course}</dd></div>
              <div><dt>Source</dt><dd>{assignment.sourceTitle}</dd></div>
              <div><dt>Directions</dt><dd>{assignment.directions}</dd></div>
              <div><dt>Evidence requirement</dt><dd>{assignment.evidenceRequirement}</dd></div>
              <div><dt>Coaching focus</dt><dd>{assignment.coachingFocus}</dd></div>
            </dl>
            <div className="assignment-note">
              <Icon name="shield" />
              <span>
                Begin with your own interpretation. The coach will not supply a
                thesis, quotation, or paragraph.
              </span>
            </div>
          </section>

          <section className="content-card numbered-card">
            <div className="number-badge">1</div>
            <div className="numbered-card-content">
              <div className="card-heading-row">
                <div>
                  <div className="card-kicker">Before the coach appears</div>
                  <h2>Begin with your own thinking</h2>
                </div>
                {readiness.initial ? <Pill tone="green" icon="check">Complete</Pill> : null}
              </div>
              <FieldHeader
                label="Initial response"
                helper="What do you notice, suspect, or find difficult to explain?"
                value={initialResponse}
                minimum={40}
              />
              <textarea
                className="large-textarea"
                value={initialResponse}
                onChange={(event) => setInitialResponse(event.target.value)}
                rows={7}
              />
              <div className="field-footer">
                <span>
                  Your first version will remain visible so you and your teacher
                  can see how the thinking changes.
                </span>
                {!coachUnlocked ? (
                  <button className="primary-button compact" type="button" onClick={unlockCoach}>
                    Open the coach <Icon name="arrow" />
                  </button>
                ) : (
                  <span className="unlocked-label"><Icon name="check" /> Coach unlocked</span>
                )}
              </div>
              {notice ? <div className="inline-notice">{notice}</div> : null}
            </div>
          </section>

          {coachUnlocked ? (
            <section className="content-card numbered-card coach-section">
              <div className="number-badge">2</div>
              <div className="numbered-card-content">
                <div className="card-heading-row">
                  <div>
                    <div className="card-kicker">One question at a time</div>
                    <h2>Use the Socratic coach</h2>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <Pill tone={pilotCode ? "green" : "orange"} icon={pilotCode ? "check" : undefined}>
                      {pilotCode ? "Live AI ready" : "Pilot code required"}
                    </Pill>
                    <button className="text-button" type="button" onClick={requestPilotCode}>
                      {pilotCode ? "Change code" : "Enter code"}
                    </button>
                  </div>
                </div>

                <div className="move-picker">
                  <div className="move-picker-heading">
                    <span>I need help to…</span>
                    <small>Choose the kind of thinking move you need.</small>
                  </div>
                  <div className="move-grid">
                    {MOVE_OPTIONS.map((option) => (
                      <button
                        type="button"
                        key={option.id}
                        className={`move-button ${selectedMove === option.id ? "selected" : ""}`}
                        onClick={() => setSelectedMove(option.id)}
                      >
                        <span>{option.label}</span>
                        <small>{option.short}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="chat-window" aria-live="polite">
                  <div className="chat-date">Preparation conversation</div>
                  {messages.map((message) => (
                    <div
                      className={`chat-row ${message.role}`}
                      key={message.id}
                    >
                      {message.role === "coach" ? (
                        <div className="coach-avatar">E</div>
                      ) : null}
                      <div className={`message-bubble ${message.role}`}>
                        {message.move ? <small>{message.move}</small> : null}
                        <p>{message.text}</p>
                      </div>
                    </div>
                  ))}
                  {isCoachThinking ? (
                    <div className="chat-row coach">
                      <div className="coach-avatar">E</div>
                      <div className="message-bubble coach">
                        <small>Thinking with you</small>
                        <p>EnDepth is choosing the most useful next question…</p>
                      </div>
                    </div>
                  ) : null}
                  <div ref={chatEndRef} />
                </div>

                <div className="composer">
                  <textarea
                    value={newMessage}
                    onChange={(event) => setNewMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (
                        !isCoachThinking &&
                        (event.metaKey || event.ctrlKey) &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                        sendMessage();
                      }
                    }}
                    rows={3}
                    placeholder="Respond with your own thinking…"
                    disabled={isCoachThinking}
                  />
                  <div className="composer-footer">
                    <span>⌘/Ctrl + Enter to send</span>
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={sendMessage}
                      disabled={!newMessage.trim() || isCoachThinking}
                    >
                      {isCoachThinking ? "Thinking…" : "Send thinking"}
                      {!isCoachThinking ? <Icon name="arrow" /> : null}
                    </button>
                  </div>
                </div>
                {coachError ? <div className="inline-notice">{coachError}</div> : null}
              </div>
            </section>
          ) : null}

          <section className="content-card numbered-card">
            <div className="number-badge">3</div>
            <div className="numbered-card-content">
              <div className="card-heading-row">
                <div>
                  <div className="card-kicker">Make the interpretation accountable</div>
                  <h2>Ground the idea in the text</h2>
                </div>
                {readiness.evidence ? <Pill tone="green" icon="check">Grounded</Pill> : null}
              </div>

              <div className="field-stack">
                <div>
                  <FieldHeader
                    label="Exact textual moment"
                    helper="Paste a short quotation or describe the precise action, contrast, or pattern."
                    value={evidence}
                    minimum={8}
                  />
                  <textarea
                    value={evidence}
                    onChange={(event) => setEvidence(event.target.value)}
                    rows={4}
                  />
                </div>
                <div>
                  <FieldHeader
                    label="Why this detail matters"
                    helper="Explain what the moment adds to or complicates about your interpretation."
                    value={significance}
                    minimum={8}
                  />
                  <textarea
                    value={significance}
                    onChange={(event) => setSignificance(event.target.value)}
                    rows={4}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="content-card numbered-card" id="harkness-card">
            <div className="number-badge">4</div>
            <div className="numbered-card-content">
              <div className="card-heading-row">
                <div>
                  <div className="card-kicker">The classroom artifact</div>
                  <h2>Build your Harkness Preparation Card</h2>
                </div>
                <button className="text-button" type="button" onClick={beginCardFromThinking}>
                  Use my thinking to begin <Icon name="chevron" size={16} />
                </button>
              </div>

              <div className="prep-card">
                <div className="prep-card-header">
                  <div>
                    <span>Harkness Preparation Card</span>
                    <strong>{assignment.title}</strong>
                  </div>
                  <div className="mini-brand"><LogoMark /> EnDepth</div>
                </div>

                <div className="prep-field claim-field">
                  <span>My provisional claim</span>
                  <textarea
                    value={claim}
                    onChange={(event) => setClaim(event.target.value)}
                    rows={3}
                    placeholder="What do you currently think?"
                  />
                </div>

                <div className="prep-grid">
                  <div className="prep-field">
                    <span>My textual evidence</span>
                    <textarea
                      value={evidence}
                      onChange={(event) => setEvidence(event.target.value)}
                      rows={5}
                      placeholder="What precise moment can you bring into the circle?"
                    />
                  </div>
                  <div className="prep-field">
                    <span>The complication</span>
                    <textarea
                      value={complication}
                      onChange={(event) => setComplication(event.target.value)}
                      rows={5}
                      placeholder="What keeps the interpretation from being simple?"
                    />
                  </div>
                </div>

                <div className="prep-field question-field">
                  <span>My open question</span>
                  <textarea
                    value={openQuestion}
                    onChange={(event) => setOpenQuestion(event.target.value)}
                    rows={3}
                    placeholder="What do you genuinely want the group to explore?"
                  />
                </div>
              </div>

              <div className={`submission-row ${submitted ? "submitted" : ""}`}>
                <div>
                  <strong>
                    {submitted
                      ? "Marked submitted in this browser"
                      : readyCount === 4
                        ? "Ready for discussion"
                        : `${readyCount} of 4 preparation moves visible`}
                  </strong>
                  <span>
                    {submitted
                      ? "Submission is still simulated; a shared teacher database has not been connected yet."
                      : "Drafts stay in this browser. Coach context is sent securely only when you request a live question."}
                  </span>
                </div>
                <button
                  className={submitted ? "secondary-button" : "primary-button"}
                  type="button"
                  disabled={!submitted && readyCount < 4}
                  onClick={() => setSubmitted((current) => !current)}
                >
                  {submitted ? "Reopen preparation" : "Submit preparation"}
                  <Icon name={submitted ? "rotate" : "check"} />
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside className="student-sidebar">
          <section className="sidebar-card snapshot-card">
            <div className="sidebar-heading">
              <div>
                <div className="card-kicker">Live qualitative feedback</div>
                <h2>Thinking Snapshot</h2>
              </div>
              <div className="snapshot-ring">
                <span>{readyCount}</span>
                <small>/ 4 moves</small>
              </div>
            </div>
            <p className="sidebar-intro">
              This is not a grade. It shows what your preparation currently makes
              visible and what to work on next.
            </p>
            <div className="signal-list">
              {snapshot.map((signal) => (
                <SignalCard signal={signal} key={signal.label} />
              ))}
            </div>
          </section>

          <section className="sidebar-card next-move-card">
            <div className="next-move-icon"><Icon name="spark" /></div>
            <div>
              <span>Best next move</span>
              <strong>
                {snapshot.find((signal) => signal.state === "Beginning")?.note ||
                  snapshot.find((signal) => signal.state === "Developing")?.note ||
                  "Read your card aloud and decide which question you most want the circle to pursue."}
              </strong>
            </div>
          </section>

          <section className="sidebar-card checklist-card">
            <div className="sidebar-heading compact-heading">
              <div>
                <div className="card-kicker">Before you submit</div>
                <h2>Readiness check</h2>
              </div>
            </div>
            <div className="readiness-list">
              {[
                [readiness.initial, "I began with my own interpretation."],
                [readiness.evidence, "I named a precise textual moment and its significance."],
                [readiness.complication, "I identified what makes the idea less simple."],
                [readiness.card, "I have a claim, evidence, complication, and open question."],
              ].map(([complete, text]) => (
                <div className={complete ? "complete" : ""} key={text}>
                  <span>{complete ? <Icon name="check" size={14} /> : ""}</span>
                  <p>{text}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="sidebar-card transparency-card">
            <Icon name="eye" />
            <div>
              <strong>What “private” means here</strong>
              <p>
                Your classmates cannot see this workspace. In a real pilot, your
                teacher could review your submitted preparation and conversation
                history.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

function StatusBadge({ status }) {
  const slug = status.toLowerCase().replace(/\s+/g, "-");
  return <span className={`status-badge status-${slug}`}>{status}</span>;
}

function TeacherDashboard({ assignment, onEditAssignment }) {
  const [filter, setFilter] = useState("All");
  const [selectedId, setSelectedId] = useState(1);
  const selected = TEACHER_STUDENTS.find((student) => student.id === selectedId);
  const visibleStudents = TEACHER_STUDENTS.filter((student) =>
    filter === "All" ? true : student.status === filter
  );

  useEffect(() => {
    if (!visibleStudents.some((student) => student.id === selectedId)) {
      setSelectedId(visibleStudents[0]?.id ?? 1);
    }
  }, [filter, selectedId, visibleStudents]);

  return (
    <main className="page teacher-page">
      <section className="teacher-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange">Teacher dashboard</Pill>
            <span>Period 3 · Minds, Machines, and Morality</span>
          </div>
          <h1>{assignment.title}</h1>
          <p>{assignment.date}</p>
        </div>
        <button className="primary-button" type="button" onClick={onEditAssignment}>
          Create new assignment <Icon name="arrow" />
        </button>
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
            <button className="text-button" type="button" onClick={onEditAssignment}>Edit assignment <Icon name="chevron" size={16} /></button>
          </div>
          <div className="assignment-summary">
            <div>
              <span>Entry question</span>
              <p>{assignment.prompt}</p>
            </div>
            <div className="teacher-expectations">
              {[
                "A provisional interpretation",
                "A precise textual moment",
                "A genuine complication",
                "An open discussion question",
              ].map((item) => <span key={item}><Icon name="check" size={14} /> {item}</span>)}
            </div>
          </div>
        </article>

        <article className="content-card privacy-summary-card">
          <div className="guardrail-icon"><Icon name="shield" size={22} /></div>
          <div>
            <div className="card-kicker">Pilot guardrail</div>
            <h2>Process evidence, not automated grading</h2>
            <p>
              The dashboard highlights where thinking is visible. It does not rank
              students, assign a grade, or turn language patterns into a score.
            </p>
          </div>
        </article>
      </section>
    </main>
  );
}


function TeacherSetup({ assignment, onSave, onPreview }) {
  const [draft, setDraft] = useState(assignment);
  const [notice, setNotice] = useState("");

  useEffect(() => setDraft(assignment), [assignment]);

  function updateField(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function saveAndMaybePreview(shouldPreview = false) {
    const normalized = normalizeAssignment(draft);
    const requiredFields = ["teacherName", "course", "title", "prompt", "sourceTitle", "passage", "directions", "evidenceRequirement", "coachingFocus"];
    const missing = requiredFields.filter((field) => !normalized[field]);
    if (missing.length) {
      setNotice("Complete every assignment field before previewing as a student.");
      return;
    }
    saveAssignmentToStorage(normalized);
    onSave(normalized);
    setNotice("Assignment saved for this browser.");
    if (shouldPreview) onPreview();
  }

  const fields = [
    ["teacherName", "Teacher name"],
    ["course", "Course"],
    ["title", "Assignment title"],
    ["sourceTitle", "Source title"],
    ["prompt", "Entry question", 3],
    ["passage", "Passage", 4],
    ["directions", "Directions", 4],
    ["evidenceRequirement", "Evidence requirement", 3],
    ["coachingFocus", "Coaching focus", 3],
  ];

  return (
    <main className="page teacher-setup-page">
      <section className="setup-hero content-card">
        <div>
          <div className="card-kicker">Teacher setup</div>
          <h1>Create the Harkness preparation assignment</h1>
          <p>Save the exact teacher-facing instructions before opening the read-only student preview.</p>
        </div>
        <div className="setup-actions">
          <button className="secondary-button" type="button" onClick={() => setDraft(SHOWCASE_ASSIGNMENT)}>
            Load Friday showcase
          </button>
          <button className="secondary-button" type="button" onClick={() => saveAndMaybePreview(false)}>
            Save draft
          </button>
          <button className="primary-button" type="button" onClick={() => saveAndMaybePreview(true)}>
            Preview as student <Icon name="arrow" />
          </button>
        </div>
      </section>

      <section className="setup-grid content-card">
        {fields.map(([field, label, rows]) => (
          <label className={rows ? "setup-field setup-field-wide" : "setup-field"} key={field}>
            <span>{label}</span>
            {rows ? (
              <textarea rows={rows} value={draft[field]} onChange={(event) => updateField(field, event.target.value)} />
            ) : (
              <input value={draft[field]} onChange={(event) => updateField(field, event.target.value)} />
            )}
          </label>
        ))}
        <label className="setup-field">
          <span>Successful live-coach question limit</span>
          <select value={draft.maxCoachQuestions} onChange={(event) => updateField("maxCoachQuestions", Number(event.target.value))}>
            <option value={4}>4 questions</option>
            <option value={6}>6 questions</option>
            <option value={8}>8 questions</option>
          </select>
        </label>
      </section>
      {notice ? <div className="inline-notice setup-notice">{notice}</div> : null}
    </main>
  );
}

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
        />
      ) : null}
      {view === "student" ? <StudentWorkspace resetToken={resetToken} assignment={assignment} /> : null}
      {view === "teacherSetup" ? (
        <TeacherSetup assignment={assignment} onSave={setAssignment} onPreview={() => setView("student")} />
      ) : null}
      {view === "teacher" ? <TeacherDashboard assignment={assignment} onEditAssignment={() => setView("teacherSetup")} /> : null}

      <footer className="site-footer">
        <div>
          <LogoMark />
          <span>EnDepth interactive prototype</span>
        </div>
        <p>
          Live-coach prototype. Student drafts remain in this browser; coach
          requests use OpenAI through a protected server route. Teacher dashboard
          records are fictional.
        </p>
      </footer>
    </div>
  );
}
