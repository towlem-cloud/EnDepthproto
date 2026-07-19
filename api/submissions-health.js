import {
  databaseIsConfigured,
  ensureSubmissionsTable,
  json,
} from "./submissions-db.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return json({ error: "Use GET for this endpoint." }, 405);
    }

    let databaseReachable = false;
    let databaseError = "";

    if (databaseIsConfigured()) {
      try {
        await ensureSubmissionsTable();
        databaseReachable = true;
      } catch (error) {
        databaseError = error instanceof Error ? error.message : "Unknown database error";
      }
    }

    return json({
      databaseConfigured: databaseIsConfigured(),
      databaseReachable,
      databaseError,
      teacherCodeConfigured: Boolean(process.env.ENDEPTH_TEACHER_CODE),
      studentCodeConfigured: Boolean(process.env.ENDEPTH_ACCESS_CODE),
    });
  },
};
