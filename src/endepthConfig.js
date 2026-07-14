export const ASSIGNMENT_STORAGE_KEY = "endepth.assignment.v1";
const STORAGE_KEY = "endepth-student-prototype-v5";
export const PILOT_CODE_STORAGE_KEY = "endepth-pilot-access-code";

const DEFAULT_ASSIGNMENT = {
  teacherName: "Morgan Towle",
  course: "Minds, Machines, and Morality",
  title: "What Counts as Consciousness?",
  date: "Harkness preparation · Showcase demo",
  prompt:
    "What should count as consciousness, and what kind of evidence would persuade us that an artificial intelligence genuinely possesses it?",
  sourceTitle: "Turing, Searle, and the Problem of Machine Consciousness",
  passage:
    "A machine may produce language that appears thoughtful, responsive, and self-aware. But observable performance does not necessarily settle whether the machine understands, experiences, or merely processes symbols according to rules.",
  directions:
    "Develop a provisional answer to the central question. Identify one specific idea or distinction from the assigned material, explain why it matters, acknowledge a complication, and prepare one genuine question for the group.",
  evidenceRequirement:
    "Ground your thinking in the assigned passage or another specific course text.",
  coachingFocus: "Balanced preparation",
  maxCoachQuestions: 6,
};

export const SHOWCASE_ASSIGNMENT = { ...DEFAULT_ASSIGNMENT };

export const COACHING_FOCUS_OPTIONS = [
  "Balanced preparation",
  "Clarify the interpretation",
  "Strengthen textual evidence",
  "Complicate the interpretation",
  "Connect ideas and patterns",
  "Prepare an open discussion question",
];

export const MAX_COACH_QUESTION_OPTIONS = [4, 6, 8];

export function normalizeAssignment(value = {}) {
  const maxCoachQuestions = Number(value.maxCoachQuestions);
  return {
    ...DEFAULT_ASSIGNMENT,
    ...(value && typeof value === "object" ? value : {}),
    teacherName: String(value.teacherName ?? DEFAULT_ASSIGNMENT.teacherName).trim(),
    course: String(value.course ?? DEFAULT_ASSIGNMENT.course).trim(),
    title: String(value.title ?? DEFAULT_ASSIGNMENT.title).trim(),
    date: String(value.date ?? DEFAULT_ASSIGNMENT.date).trim(),
    prompt: String(value.prompt ?? DEFAULT_ASSIGNMENT.prompt).trim(),
    sourceTitle: String(value.sourceTitle ?? DEFAULT_ASSIGNMENT.sourceTitle).trim(),
    passage: String(value.passage ?? DEFAULT_ASSIGNMENT.passage).trim(),
    directions: String(value.directions ?? DEFAULT_ASSIGNMENT.directions).trim(),
    evidenceRequirement: String(
      value.evidenceRequirement ?? DEFAULT_ASSIGNMENT.evidenceRequirement
    ).trim(),
    coachingFocus: COACHING_FOCUS_OPTIONS.includes(value.coachingFocus)
      ? value.coachingFocus
      : DEFAULT_ASSIGNMENT.coachingFocus,
    maxCoachQuestions: MAX_COACH_QUESTION_OPTIONS.includes(maxCoachQuestions)
      ? maxCoachQuestions
      : DEFAULT_ASSIGNMENT.maxCoachQuestions,
  };
}

export function stableAssignmentKey(assignment) {
  const normalized = normalizeAssignment(assignment);
  return JSON.stringify({
    teacherName: normalized.teacherName,
    course: normalized.course,
    title: normalized.title,
    date: normalized.date,
    prompt: normalized.prompt,
    sourceTitle: normalized.sourceTitle,
    passage: normalized.passage,
    directions: normalized.directions,
    evidenceRequirement: normalized.evidenceRequirement,
    coachingFocus: normalized.coachingFocus,
    maxCoachQuestions: normalized.maxCoachQuestions,
  });
}

export function isShowcaseAssignment(assignment) {
  return stableAssignmentKey(assignment) === stableAssignmentKey(SHOWCASE_ASSIGNMENT);
}

export function loadAssignment() {
  if (typeof window === "undefined") return SHOWCASE_ASSIGNMENT;
  try {
    const saved = window.localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    return saved ? normalizeAssignment(JSON.parse(saved)) : SHOWCASE_ASSIGNMENT;
  } catch {
    return SHOWCASE_ASSIGNMENT;
  }
}

export function saveAssignmentToStorage(assignment) {
  const normalized = normalizeAssignment(assignment);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      ASSIGNMENT_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  }
  return normalized;
}

const SHOWCASE_STARTER_MESSAGES = [
  {
    id: 1,
    role: "coach",
    text: "You distinguish outward performance from inner experience. Which phrase in the passage makes that distinction hardest to ignore?",
    move: "Ground in the text",
  },
  {
    id: 2,
    role: "student",
    text: "The passage says language can appear thoughtful and self-aware, but observable performance does not settle whether the machine experiences anything.",
  },
  {
    id: 3,
    role: "coach",
    text: "If performance is not enough by itself, what additional evidence would persuade you that the AI has experience rather than only symbol-processing?",
    move: "Clarify the criterion",
  },
];

const SHOWCASE_STUDENT_STATE = {
  initialResponse:
    "At first, I want to say a machine is conscious if it can speak in a thoughtful and self-aware way. But the passage makes that answer feel too quick because language might only show performance. I think real consciousness would require some evidence that the machine has experiences, not just that it follows rules well.",
  coachUnlocked: true,
  messages: SHOWCASE_STARTER_MESSAGES,
  newMessage:
    "Maybe the strongest evidence would be consistent reports of experience that change when the system encounters new situations.",
  selectedMove: "clarify",
  evidence:
    "The passage says observable performance does not necessarily settle whether the machine understands, experiences, or merely processes symbols according to rules.",
  significance:
    "That distinction matters because it separates what an outside observer can see from what might be happening internally.",
  claim:
    "Consciousness should require evidence of experience, not only language that appears thoughtful or responsive.",
  complication:
    "Human consciousness is also inferred through behavior, so demanding more from AI may create an unfair double standard.",
  openQuestion:
    "What kind of evidence could show genuine experience without becoming just another performance test?",
  submitted: false,
};

function createCleanStudentState() {
  return {
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
}

export function initialStudentStateFor(assignment) {
  return isShowcaseAssignment(assignment)
    ? {
        ...SHOWCASE_STUDENT_STATE,
        messages: SHOWCASE_STARTER_MESSAGES.map((message) => ({ ...message })),
      }
    : createCleanStudentState();
}

export function studentStorageKey(assignment) {
  return `${STORAGE_KEY}:${stableAssignmentKey(assignment)}`;
}

export function loadStudentState(assignment) {
  const fallback = initialStudentStateFor(assignment);
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage.getItem(studentStorageKey(assignment));
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    return {
      ...fallback,
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages : fallback.messages,
    };
  } catch {
    return fallback;
  }
}

export const MOVE_OPTIONS = [
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

export const SHOWCASE_TEACHER_STUDENTS = [
  {
    id: 1,
    name: "Avery M.",
    status: "Submitted",
    stage: "Ready",
    grounding: "Grounded",
    complexity: "Visible",
    question: "Open",
    initial:
      "If an AI answers like a person, I am tempted to call it conscious, but that might only prove imitation.",
    revised:
      "Performance matters because it is the evidence we can observe, but the passage separates responsive language from inner experience. I would need evidence that the system can report stable experiences rather than only process symbols.",
    evidence:
      "The passage says observable performance does not settle whether the machine understands, experiences, or merely processes symbols.",
    complication:
      "Human consciousness is also inferred from behavior, so rejecting AI behavior too quickly may use a double standard.",
    openQuestion:
      "What evidence of experience could be more than another kind of performance?",
  },
  {
    id: 2,
    name: "Jordan R.",
    status: "In progress",
    stage: "Evidence needed",
    grounding: "Developing",
    complexity: "Visible",
    question: "Developing",
    initial: "I think understanding should count more than sounding thoughtful.",
    revised:
      "The difference between understanding and symbol processing seems central, but I still need a clearer test for how we would know the difference.",
    evidence:
      "The response refers to language that appears thoughtful and responsive but has not yet isolated the decisive phrase.",
    complication:
      "Maybe all we ever have for other minds is external evidence.",
    openQuestion: "Can external behavior ever prove internal experience?",
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
      "The passage makes me skeptical that fluent language is enough for consciousness.",
    revised:
      "Fluent language can be evidence, but it is not decisive. Consciousness may require a capacity for experience, and the hard part is designing evidence that is not merely another performance trick.",
    evidence:
      "The machine may produce language that appears self-aware while still possibly processing symbols according to rules.",
    complication:
      "A rule-based process might still produce awareness if the rules create the right kind of system.",
    openQuestion:
      "Is consciousness defined by how a system works inside or by what it can make visible to others?",
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
      "Maybe consciousness should mean having experiences, not just giving answers.",
    revised:
      "The passage pushes me to ask whether apparent self-awareness is enough or whether we need evidence that the machine has a point of view.",
    evidence:
      "Observable performance does not necessarily settle whether the machine understands or experiences.",
    complication:
      "We cannot directly inspect another person's experience either.",
    openQuestion:
      "How much uncertainty should we tolerate before granting moral status to AI?",
  },
];

export function wordCount(value) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function hasAny(text, terms) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function getSignal(label, state, note) {
  return { label, state, note };
}

export function buildSnapshot({
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
