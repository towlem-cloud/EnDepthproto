export const CONSCIOUSNESS_STARTER_MESSAGES = [
  {
    id: 1,
    role: "coach",
    text: "You distinguish convincing performance from genuine experience. Which specific idea from Turing or Searle makes that distinction hardest to settle?",
    move: "Ground in the text",
    countsTowardLimit: false,
  },
  {
    id: 2,
    role: "student",
    text: "Searle's point matters because a system could produce the right symbols without understanding them, but Turing makes me question whether we can ever prove understanding in another mind.",
  },
  {
    id: 3,
    role: "coach",
    text: "What standard are you using for human consciousness that you could apply fairly to a machine without demanding access to an inner experience you cannot observe?",
    move: "Clarify the claim",
    countsTowardLimit: false,
  },
];

export const CONSCIOUSNESS_SAMPLE_STATE = {
  initialResponse:
    "At first, I want to say that consciousness requires genuine inner experience, not just convincing language. But that creates a problem: I cannot directly access another person's inner experience either. Turing makes behavior seem like the fairest evidence available, while Searle makes me worry that performance can imitate understanding without producing it.",
  coachUnlocked: true,
  messages: CONSCIOUSNESS_STARTER_MESSAGES,
  newMessage:
    "Maybe the real problem is not proving consciousness, but deciding what evidence is fair enough to count.",
  selectedMove: "clarify",
  evidence:
    "Searle's Chinese Room separates correct symbol manipulation from understanding, while Turing asks us to judge intelligence through observable conversation rather than inaccessible inner states.",
  significance:
    "Together, the two ideas expose a tension between the evidence we can observe and the experience we actually want to know exists.",
  claim:
    "We should not treat fluent language alone as proof of consciousness, but we may need to accept a pattern of behavior, self-report, adaptation, and vulnerability as the fairest evidence available.",
  complication:
    "That standard could still reward a perfect simulation, and demanding more from AI than from other humans may reveal an unfair double standard.",
  openQuestion:
    "What evidence would be strong enough to justify moral concern for an AI without pretending that certainty is possible?",
  submitted: false,
};

export const BLANK_STUDENT_STATE = {
  initialResponse: "",
  coachUnlocked: false,
  messages: [],
  newMessage: "",
  selectedMove: "clarify",
  evidence: "",
  significance: "",
  claim: "",
  complication: "",
  openQuestion: "",
  submitted: false,
};

export function createStudentStartingState(assignment) {
  const isHeatherDemo = assignment?.preset === "heather";

  const source = isHeatherDemo
    ? CONSCIOUSNESS_SAMPLE_STATE
    : BLANK_STUDENT_STATE;

  return {
    ...source,
    messages: source.messages.map((message) => ({ ...message })),
  };
}

export const TEACHER_STUDENTS = [
  {
    id: 1,
    name: "Avery M.",
    status: "Submitted",
    stage: "Ready",
    grounding: "Grounded",
    complexity: "Visible",
    question: "Open",
    initial:
      "A conscious AI would need to understand what it says instead of only producing the correct words.",
    revised:
      "Understanding may be impossible to observe directly, so consciousness should be judged through converging evidence: flexible behavior, self-report, memory, adaptation, and signs that experiences matter to the system.",
    evidence:
      "Searle separates symbol processing from understanding, while Turing argues that observable performance is the evidence available to an outside judge.",
    complication:
      "A sufficiently advanced simulation could satisfy every behavioral test without possessing experience.",
    openQuestion:
      "When does refusing to recognize machine consciousness become a moral risk rather than reasonable skepticism?",
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
      "I think consciousness is more than sounding human, but I do not know how we could prove the difference.",
    revised:
      "Language should count as evidence, but not decisive proof, because the same output could come from understanding or sophisticated pattern processing.",
    evidence:
      "The response refers to the Chinese Room but has not yet identified the specific distinction it is using.",
    complication:
      "We also judge other humans through behavior, so rejecting behavioral evidence entirely creates a double standard.",
    openQuestion:
      "How much uncertainty should we tolerate before giving an AI moral consideration?",
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
      "If an AI passes the Turing Test, we should probably call it conscious.",
    revised:
      "Passing the Turing Test would establish persuasive social intelligence, but not necessarily subjective experience; it should trigger further investigation rather than settle the question.",
    evidence:
      "Turing shifts attention to observable conversation, while Searle argues that successful symbol use can occur without semantic understanding.",
    complication:
      "No test gives us direct access to another being's experience, including another human's.",
    openQuestion:
      "Should consciousness be a scientific category, a moral category, or both?",
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
      "Consciousness might require the ability to care about what happens to you.",
    revised:
      "A system's apparent preferences become more meaningful evidence if they persist across contexts and shape choices even when no human is prompting the performance.",
    evidence:
      "The assigned passage separates responsive language from experience, which makes stable, consequential preferences more important than a single conversation.",
    complication: "",
    openQuestion:
      "Can vulnerability be evidence of consciousness, or can vulnerability also be programmed?",
  },
];
