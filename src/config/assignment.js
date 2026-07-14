export const ASSIGNMENT_STORAGE_KEY = "endepth.assignment.v1";

export const COACHING_FOCUS_OPTIONS = [
  {
    value: "Balanced preparation",
    description: "Let EnDepth diagnose the most useful next move.",
  },
  {
    value: "Clarify the interpretation",
    description: "Prioritize precision, definitions, and the student's actual claim.",
  },
  {
    value: "Strengthen textual evidence",
    description: "Prioritize exact textual moments and why they matter.",
  },
  {
    value: "Complicate the interpretation",
    description: "Prioritize tensions, exceptions, and competing readings.",
  },
  {
    value: "Connect ideas and patterns",
    description: "Prioritize relationships across moments, texts, and course ideas.",
  },
  {
    value: "Prepare an open discussion question",
    description: "Prioritize a question the Harkness group can genuinely pursue.",
  },
];

export const TURN_OPTIONS = [4, 6, 8];

export const FINAL_REQUIREMENT_OPTIONS = [
  "Provisional claim",
  "Specific textual evidence",
  "Complication or alternative reading",
  "Open discussion question",
];

export const HEATHER_DEMO_ASSIGNMENT = {
  id: "heather-consciousness-demo",
  preset: "heather",
  revision: 1,
  teacherName: "Morgan Towle",
  courseName: "Minds, Machines, and Morality",
  assignmentTitle: "What Counts as Consciousness?",
  dueLabel: "Harkness preparation · Friday showcase",
  centralQuestion:
    "What should count as consciousness, and what kind of evidence would persuade us that an artificial intelligence genuinely possesses it?",
  sourceTitle: "Turing, Searle, and the Problem of Machine Consciousness",
  sourcePassage:
    "A machine may produce language that appears thoughtful, responsive, and self-aware. But observable performance does not necessarily settle whether the machine understands, experiences, or merely processes symbols according to rules.",
  studentDirections:
    "Develop a provisional answer to the central question. Identify one specific idea or distinction from the assigned material, explain why it matters, acknowledge a complication, and prepare one question for the group.",
  coachingFocus: "Balanced preparation",
  maxCoachTurns: 6,
  evidenceRequirement:
    "Ground your thinking in the assigned passage or another specific course text. Name the exact idea, distinction, example, or textual moment you are using.",
  finalRequirements: [...FINAL_REQUIREMENT_OPTIONS],
};

function cleanText(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeRequirements(value) {
  if (!Array.isArray(value)) return [...FINAL_REQUIREMENT_OPTIONS];
  const valid = value
    .filter((item) => FINAL_REQUIREMENT_OPTIONS.includes(item))
    .filter((item, index, array) => array.indexOf(item) === index);
  return valid.length ? valid : [...FINAL_REQUIREMENT_OPTIONS];
}

export function normalizeAssignment(value, fallback = HEATHER_DEMO_ASSIGNMENT) {
  const source = value && typeof value === "object" ? value : {};
  const turns = Number(source.maxCoachTurns);

  return {
    id: cleanText(source.id, fallback.id),
    preset: cleanText(source.preset, fallback.preset),
    revision:
      Number.isFinite(Number(source.revision)) && Number(source.revision) > 0
        ? Number(source.revision)
        : fallback.revision,
    teacherName: cleanText(source.teacherName, fallback.teacherName),
    courseName: cleanText(source.courseName, fallback.courseName),
    assignmentTitle: cleanText(
      source.assignmentTitle,
      fallback.assignmentTitle
    ),
    dueLabel: cleanText(source.dueLabel, fallback.dueLabel),
    centralQuestion: cleanText(source.centralQuestion, fallback.centralQuestion),
    sourceTitle: cleanText(source.sourceTitle, fallback.sourceTitle),
    sourcePassage: cleanText(source.sourcePassage, fallback.sourcePassage),
    studentDirections: cleanText(
      source.studentDirections,
      fallback.studentDirections
    ),
    coachingFocus: COACHING_FOCUS_OPTIONS.some(
      (option) => option.value === source.coachingFocus
    )
      ? source.coachingFocus
      : fallback.coachingFocus,
    maxCoachTurns: TURN_OPTIONS.includes(turns) ? turns : fallback.maxCoachTurns,
    evidenceRequirement: cleanText(
      source.evidenceRequirement,
      fallback.evidenceRequirement
    ),
    finalRequirements: normalizeRequirements(source.finalRequirements),
  };
}

export function loadAssignment() {
  if (typeof window === "undefined") {
    return normalizeAssignment(HEATHER_DEMO_ASSIGNMENT);
  }

  try {
    const saved = window.localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    if (!saved) return normalizeAssignment(HEATHER_DEMO_ASSIGNMENT);
    return normalizeAssignment(JSON.parse(saved));
  } catch {
    return normalizeAssignment(HEATHER_DEMO_ASSIGNMENT);
  }
}

export function saveAssignment(value) {
  const normalized = normalizeAssignment({
    ...value,
    id: value?.id || `assignment-${Date.now()}`,
    preset: value?.preset || "custom",
    revision: Date.now(),
  });

  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      ASSIGNMENT_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  }

  return normalized;
}

export function assignmentForCoach(assignment) {
  return {
    courseName: assignment.courseName,
    assignmentTitle: assignment.assignmentTitle,
    centralQuestion: assignment.centralQuestion,
    sourceTitle: assignment.sourceTitle,
    sourcePassage: assignment.sourcePassage,
    studentDirections: assignment.studentDirections,
    coachingFocus: assignment.coachingFocus,
    evidenceRequirement: assignment.evidenceRequirement,
    maxCoachTurns: assignment.maxCoachTurns,
  };
}
