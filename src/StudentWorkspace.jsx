import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FieldHeader,
  Icon,
  LogoMark,
  Pill,
  ProgressSteps,
  SignalCard,
} from "./endepthUI";
import {
  MOVE_OPTIONS,
  PILOT_CODE_STORAGE_KEY,
  buildSnapshot,
  initialStudentStateFor,
  isShowcaseAssignment,
  loadStudentState,
  stableAssignmentKey,
  studentStorageKey,
  wordCount,
} from "./endepthConfig";

export default function StudentWorkspace({ resetToken, assignment }) {
  const assignmentSignature = stableAssignmentKey(assignment);
  const initialState = useRef(loadStudentState(assignment)).current;

  const [initialResponse, setInitialResponse] = useState(initialState.initialResponse);
  const [coachUnlocked, setCoachUnlocked] = useState(initialState.coachUnlocked);
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
  const [hydratedSignature, setHydratedSignature] = useState(assignmentSignature);
  const [pilotCode, setPilotCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem(PILOT_CODE_STORAGE_KEY) || "";
  });
  const chatEndRef = useRef(null);

  function applyStudentState(nextState, nextNotice = "") {
    setInitialResponse(nextState.initialResponse);
    setCoachUnlocked(nextState.coachUnlocked);
    setMessages(nextState.messages.map((message) => ({ ...message })));
    setNewMessage(nextState.newMessage);
    setSelectedMove(nextState.selectedMove);
    setEvidence(nextState.evidence);
    setSignificance(nextState.significance);
    setClaim(nextState.claim);
    setComplication(nextState.complication);
    setOpenQuestion(nextState.openQuestion);
    setSubmitted(Boolean(nextState.submitted));
    setNotice(nextNotice);
    setCoachError("");
    setIsCoachThinking(false);
  }

  useEffect(() => {
    applyStudentState(
      loadStudentState(assignment),
      "Workspace loaded for this assignment."
    );
    setHydratedSignature(assignmentSignature);
  }, [assignmentSignature]);

  useEffect(() => {
    if (resetToken === 0) return;
    window.localStorage.removeItem(studentStorageKey(assignment));
    applyStudentState(
      initialStudentStateFor(assignment),
      isShowcaseAssignment(assignment)
        ? "Showcase workspace restored."
        : "Workspace cleared for this assignment."
    );
    setHydratedSignature(assignmentSignature);
  }, [resetToken, assignmentSignature]);

  useEffect(() => {
    if (hydratedSignature !== assignmentSignature) return undefined;
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
    hydratedSignature,
  ]);

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
  const successfulCoachQuestions = messages.filter(
    (message) => message.role === "coach" && message.countsTowardLimit
  ).length;
  const coachLimitReached =
    successfulCoachQuestions >= assignment.maxCoachQuestions;

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
          text: "Which part of your interpretation feels least settled, and what exact detail is creating that uncertainty?",
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
    if (!text || isCoachThinking || coachLimitReached) return;

    const accessCode = pilotCode.trim() || requestPilotCode();
    if (!accessCode) return;

    const studentMessage = { id: Date.now(), role: "student", text };
    const conversation = [...messages, studentMessage];
    setMessages(conversation);
    setNewMessage("");
    setCoachError("");
    setIsCoachThinking(true);

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
          countsTowardLimit: !data.safetyFlag,
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
      setOpenQuestion("What remains genuinely unresolved about this question?");
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
            <div className="assignment-meta-grid">
              <div><span>Teacher</span><strong>{assignment.teacherName}</strong></div>
              <div><span>Course</span><strong>{assignment.course}</strong></div>
            </div>
            <div className="passage-box">
              <span>{assignment.sourceTitle}</span>
              <p>“{assignment.passage}”</p>
            </div>
            <dl className="student-instructions">
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
                <div className="card-heading-row">
                  <div>
                    <div className="card-kicker">One question at a time</div>
                    <h2>Use the Socratic coach</h2>
                  </div>
                  <div className="coach-status-row">
                    <Pill tone="orange">
                      {coachLimitReached
                        ? `${assignment.maxCoachQuestions} of ${assignment.maxCoachQuestions} complete`
                        : `Question ${successfulCoachQuestions + 1} of ${assignment.maxCoachQuestions}`}
                    </Pill>
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
                    <div className={`chat-row ${message.role}`} key={message.id}>
                      {message.role === "coach" ? <div className="coach-avatar">E</div> : null}
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
                    placeholder={
                      coachLimitReached
                        ? "The coaching conversation is complete. Finish your preparation card."
                        : "Respond with your own thinking…"
                    }
                    disabled={isCoachThinking || coachLimitReached}
                  />
                  <div className="composer-footer">
                    <span>⌘/Ctrl + Enter to send</span>
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={sendMessage}
                      disabled={!newMessage.trim() || isCoachThinking || coachLimitReached}
                    >
                      {isCoachThinking ? "Thinking…" : "Send thinking"}
                      {!isCoachThinking ? <Icon name="arrow" /> : null}
                    </button>
                  </div>
                </div>
                {coachLimitReached ? (
                  <div className="inline-notice success-notice">
                    The coaching conversation is complete. Finish your Harkness
                    Preparation Card and preserve the question you most want the
                    group to pursue.
                  </div>
                ) : null}
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
                  <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={4} />
                </div>
                <div>
                  <FieldHeader
                    label="Why this detail matters"
                    helper="Explain what the moment adds to or complicates about your interpretation."
                    value={significance}
                    minimum={8}
                  />
                  <textarea value={significance} onChange={(event) => setSignificance(event.target.value)} rows={4} />
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
                  <textarea value={claim} onChange={(event) => setClaim(event.target.value)} rows={3} />
                </div>
                <div className="prep-grid">
                  <div className="prep-field">
                    <span>My textual evidence</span>
                    <textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} rows={5} />
                  </div>
                  <div className="prep-field">
                    <span>The complication</span>
                    <textarea value={complication} onChange={(event) => setComplication(event.target.value)} rows={5} />
                  </div>
                </div>
                <div className="prep-field question-field">
                  <span>My open question</span>
                  <textarea value={openQuestion} onChange={(event) => setOpenQuestion(event.target.value)} rows={3} />
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
              <div className="snapshot-ring"><span>{readyCount}</span><small>/ 4 moves</small></div>
            </div>
            <p className="sidebar-intro">
              This is not a grade. It shows what your preparation currently makes
              visible and what to work on next.
            </p>
            <div className="signal-list">
              {snapshot.map((signal) => <SignalCard signal={signal} key={signal.label} />)}
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
              <div><div className="card-kicker">Before you submit</div><h2>Readiness check</h2></div>
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
