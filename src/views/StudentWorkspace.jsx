import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FieldHeader,
  Icon,
  LogoMark,
  Pill,
  ProgressSteps,
  SignalCard,
} from "../components/UI.jsx";
import { assignmentForCoach } from "../config/assignment.js";
import { createStudentStartingState } from "../data/demoData.js";
import { buildSnapshot, wordCount } from "../utils/thinking.js";

const PILOT_CODE_STORAGE_KEY = "endepth-pilot-access-code";

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

function studentStorageKey(assignment) {
  return `endepth.student.v6.${assignment.id}.${assignment.revision}`;
}

function loadStudentState(assignment) {
  const sample = createStudentStartingState(assignment);
  if (typeof window === "undefined") return sample;

  try {
    const saved = window.localStorage.getItem(studentStorageKey(assignment));
    if (!saved) return sample;
    const parsed = JSON.parse(saved);
    return {
      ...sample,
      ...parsed,
      messages: Array.isArray(parsed.messages)
        ? parsed.messages
        : sample.messages,
    };
  } catch {
    return sample;
  }
}

function coachTurnCount(messages) {
  return messages.filter(
    (message) =>
      message.role === "coach" && message.countsTowardLimit !== false
  ).length;
}

export default function StudentWorkspace({ assignment, resetToken }) {
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
  const [codeDraft, setCodeDraft] = useState("");
  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const chatEndRef = useRef(null);

  const maxCoachTurns = assignment.maxCoachTurns || 6;
  const coachTurns = useMemo(() => coachTurnCount(messages), [messages]);
  const sessionComplete = coachTurns >= maxCoachTurns;

  useEffect(() => {
    if (resetToken === 0) return;
    const fresh = createStudentStartingState(assignment);
    setInitialResponse(fresh.initialResponse);
    setCoachUnlocked(fresh.coachUnlocked);
    setMessages(fresh.messages);
    setNewMessage(fresh.newMessage);
    setSelectedMove(fresh.selectedMove);
    setEvidence(fresh.evidence);
    setSignificance(fresh.significance);
    setClaim(fresh.claim);
    setComplication(fresh.complication);
    setOpenQuestion(fresh.openQuestion);
    setSubmitted(false);
    setNotice("Sample workspace restored for this assignment.");
    setCoachError("");
    setIsCoachThinking(false);
    window.localStorage.removeItem(studentStorageKey(assignment));
  }, [resetToken, assignment]);

  useEffect(() => {
    setIsSaving(true);
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          studentStorageKey(assignment),
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
    assignment,
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
  ]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isCoachThinking]);

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
  }

  function savePilotCode() {
    const cleanCode = codeDraft.trim();
    if (!cleanCode) {
      setCoachError("Enter the pilot access code provided by your teacher.");
      return;
    }
    window.sessionStorage.setItem(PILOT_CODE_STORAGE_KEY, cleanCode);
    setPilotCode(cleanCode);
    setCodeDraft("");
    setShowCodeEntry(false);
    setCoachError("");
  }

  function clearPilotCode() {
    window.sessionStorage.removeItem(PILOT_CODE_STORAGE_KEY);
    setPilotCode("");
    setCodeDraft("");
    setShowCodeEntry(true);
  }

  async function sendMessage() {
    const text = newMessage.trim();
    if (!text || isCoachThinking) return;

    if (sessionComplete) {
      setCoachError(
        `You have used all ${maxCoachTurns} coach questions. Finish the Harkness Preparation Card with your own strongest thinking.`
      );
      document
        .getElementById("harkness-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const accessCode = pilotCode.trim();
    if (!accessCode) {
      setShowCodeEntry(true);
      setCoachError("Enter the pilot access code before sending your thinking.");
      return;
    }

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
          assignment: assignmentForCoach(assignment),
          initialResponse,
          selectedMove,
          evidence,
          significance,
          coachTurns,
          maxCoachTurns,
          messages: conversation.slice(-10).map(({ role, text: messageText }) => ({
            role,
            text: messageText,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 401) {
          clearPilotCode();
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
          countsTowardLimit: true,
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
    document
      .getElementById("harkness-card")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="page student-page">
      <section className="workspace-banner">
        <div>
          <div className="banner-meta">
            <Pill tone="orange">{assignment.courseName}</Pill>
            <span>{assignment.dueLabel}</span>
          </div>
          <h1>{assignment.assignmentTitle}</h1>
          <p className="workspace-teacher-line">Teacher: {assignment.teacherName}</p>
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
            <h2>Central question</h2>
            <p className="assignment-prompt">{assignment.centralQuestion}</p>
            {assignment.sourceTitle ? (
              <div className="assignment-source-title">{assignment.sourceTitle}</div>
            ) : null}
            <div className="passage-box">
              <span>Assigned text or moment</span>
              <p>“{assignment.sourcePassage}”</p>
            </div>
            {assignment.studentDirections ? (
              <div className="student-directions-box">
                <strong>Directions</strong>
                <p>{assignment.studentDirections}</p>
              </div>
            ) : null}
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
                htmlFor="initial-response"
                label="Initial response"
                helper="What do you notice, suspect, or find difficult to explain?"
                value={initialResponse}
                minimum={40}
              />
              <textarea
                id="initial-response"
                className="large-textarea"
                value={initialResponse}
                onChange={(event) => setInitialResponse(event.target.value)}
                rows={7}
              />
              <div className="field-footer">
                <span>
                  Your first version remains visible so you and your teacher can
                  see how the thinking changes.
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
                <div className="card-heading-row coach-heading-row">
                  <div>
                    <div className="card-kicker">One question at a time</div>
                    <h2>Use the Socratic coach</h2>
                  </div>
                  <div className="coach-header-controls">
                    <Pill tone={sessionComplete ? "neutral" : "orange"} icon={sessionComplete ? "check" : "message"}>
                      {sessionComplete
                        ? "Coaching complete"
                        : `${coachTurns} of ${maxCoachTurns} questions used`}
                    </Pill>
                    <Pill tone={pilotCode ? "green" : "orange"} icon={pilotCode ? "check" : undefined}>
                      {pilotCode ? "Live AI ready" : "Pilot code required"}
                    </Pill>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => (pilotCode ? clearPilotCode() : setShowCodeEntry((value) => !value))}
                    >
                      {pilotCode ? "Change code" : "Enter code"}
                    </button>
                  </div>
                </div>

                {showCodeEntry ? (
                  <div className="pilot-code-panel">
                    <div>
                      <strong>Enter the teacher-provided pilot code</strong>
                      <span>The code stays only in this browser session.</span>
                    </div>
                    <div className="pilot-code-controls">
                      <input
                        type="password"
                        value={codeDraft}
                        onChange={(event) => setCodeDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") savePilotCode();
                        }}
                        placeholder="Pilot code"
                        autoComplete="off"
                      />
                      <button className="primary-button compact" type="button" onClick={savePilotCode}>
                        Save code
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="coach-focus-note">
                  <Icon name="settings" />
                  <div>
                    <span>Teacher-selected focus</span>
                    <strong>{assignment.coachingFocus}</strong>
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
                        disabled={sessionComplete}
                      >
                        <span>{option.label}</span>
                        <small>{option.short}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="chat-window" aria-live="polite">
                  <div className="chat-date">Preparation conversation</div>
                  {messages.length === 0 ? (
                    <div className="chat-empty-state">
                      <div className="coach-avatar">E</div>
                      <div>
                        <strong>Your first idea belongs to you.</strong>
                        <p>Choose a thinking move, respond in your own words, and EnDepth will ask one focused question.</p>
                      </div>
                    </div>
                  ) : null}
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
                        <small>Choosing the next move</small>
                        <p>EnDepth is forming one useful Socratic question…</p>
                      </div>
                    </div>
                  ) : null}
                  <div ref={chatEndRef} />
                </div>

                {sessionComplete ? (
                  <div className="coach-complete-panel">
                    <Icon name="check" />
                    <div>
                      <strong>You have completed the coaching conversation.</strong>
                      <p>Use your strongest thinking—not the coach's words—to finish the Harkness Preparation Card.</p>
                    </div>
                    <button className="secondary-button" type="button" onClick={beginCardFromThinking}>
                      Finish the card <Icon name="arrow" />
                    </button>
                  </div>
                ) : (
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
                )}
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

              <div className="evidence-expectation">
                <Icon name="book" />
                <div>
                  <span>Teacher's evidence expectation</span>
                  <p>{assignment.evidenceRequirement}</p>
                </div>
              </div>

              <div className="field-stack">
                <div>
                  <FieldHeader
                    htmlFor="textual-evidence"
                    label="Exact textual moment"
                    helper="Paste a short quotation or describe the precise action, contrast, distinction, or pattern."
                    value={evidence}
                    minimum={8}
                  />
                  <textarea
                    id="textual-evidence"
                    value={evidence}
                    onChange={(event) => setEvidence(event.target.value)}
                    rows={4}
                  />
                </div>
                <div>
                  <FieldHeader
                    htmlFor="evidence-significance"
                    label="Why this detail matters"
                    helper="Explain what the moment adds to or complicates about your interpretation."
                    value={significance}
                    minimum={8}
                  />
                  <textarea
                    id="evidence-significance"
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
                  Copy my first thought into the claim <Icon name="chevron" size={16} />
                </button>
              </div>

              <div className="required-output-row">
                <span>Teacher-selected final requirements</span>
                <div>
                  {assignment.finalRequirements.map((requirement) => (
                    <Pill tone="neutral" icon="check" key={requirement}>{requirement}</Pill>
                  ))}
                </div>
              </div>

              <div className="prep-card">
                <div className="prep-card-header">
                  <div>
                    <span>Harkness Preparation Card</span>
                    <strong>{assignment.assignmentTitle}</strong>
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
                      placeholder="What precise idea or moment can you bring into the circle?"
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

          <section className="sidebar-card coach-budget-card">
            <div className="coach-budget-heading">
              <div>
                <span>Coach question budget</span>
                <strong>{coachTurns} of {maxCoachTurns} used</strong>
              </div>
              <Icon name="message" />
            </div>
            <div className="coach-budget-track">
              <span style={{ width: `${Math.min(100, (coachTurns / maxCoachTurns) * 100)}%` }} />
            </div>
            <p>
              The limit protects student ownership and moves the student toward a
              finished preparation card rather than an endless chatbot exchange.
            </p>
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
