import {
  authenticateStaffCode,
  databaseIsConfigured,
  json,
  listAssignmentsForStaff,
  saveAssignmentForStaff,
} from "./submissions-db.js";

function assignmentError(error) {
  const code = error instanceof Error ? error.message : "";
  const messages = {
    TEACHER_REQUIRED: "Choose a teacher for this assignment.",
    TEACHER_NOT_FOUND: "The selected teacher account could not be found.",
    ASSIGNMENT_REQUIRED_FIELDS:
      "Course, section, title, and central question are required.",
    ASSIGNMENT_SOURCE_REQUIRED:
      "Source title, passage or context, and student directions are required.",
    ASSIGNMENT_NOT_FOUND: "That assignment could not be found.",
    FORBIDDEN: "You do not have permission to edit that assignment.",
  };
  return messages[code] || "The assignment could not be saved.";
}

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Use POST for this endpoint." }, 405);
    }
    if (!databaseIsConfigured()) {
      return json({ error: "The EnDepth pilot database is not connected." }, 503);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: "The assignment request was invalid." }, 400);
    }

    try {
      const staff = await authenticateStaffCode(body.code);
      if (!staff) return json({ error: "The staff code was not accepted." }, 401);

      if (body.action === "list") {
        return json({ assignments: await listAssignmentsForStaff(staff), staff });
      }
      if (body.action === "save") {
        const assignment = await saveAssignmentForStaff(
          staff,
          body.assignment || {}
        );
        return json({
          assignment,
          studentPath: `/?assignment=${encodeURIComponent(assignment.publicSlug)}`,
        });
      }
      return json({ error: "Choose a supported assignment action." }, 400);
    } catch (error) {
      console.error("EnDepth assignment operation failed", error);
      return json({ error: assignmentError(error) }, 400);
    }
  },
};
