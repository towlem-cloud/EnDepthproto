import {
  authenticateStaffCode,
  databaseIsConfigured,
  json,
  listTeachers,
  saveTeacherAccount,
} from "./submissions-db.js";

function errorMessage(error) {
  const code = error instanceof Error ? error.message : "";
  const messages = {
    TEACHER_NAME_REQUIRED: "A teacher name is required.",
    TEACHER_EMAIL_INVALID: "Enter a valid teacher email address.",
    TEACHER_CODE_REQUIRED: "A new teacher code must be at least eight characters.",
    TEACHER_CODE_TOO_SHORT: "The new teacher code must be at least eight characters.",
    TEACHER_NOT_FOUND: "That teacher account could not be found.",
  };
  return messages[code] || "The teacher account could not be saved.";
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
      return json({ error: "The teacher request was invalid." }, 400);
    }

    try {
      const staff = await authenticateStaffCode(body.code);
      if (!staff) return json({ error: "The staff code was not accepted." }, 401);
      if (staff.role !== "admin") {
        return json({ error: "Admin access is required to manage teachers." }, 403);
      }

      if (body.action === "list") {
        return json({ teachers: await listTeachers() });
      }
      if (body.action === "save") {
        const teacher = await saveTeacherAccount(body.teacher || {});
        return json({ teacher });
      }
      return json({ error: "Choose a supported teacher action." }, 400);
    } catch (error) {
      console.error("EnDepth teacher management failed", error);
      return json({ error: errorMessage(error) }, 400);
    }
  },
};
