import { databaseIsConfigured, json } from "./submissions-db.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return json({ error: "Use GET for this endpoint." }, 405);
    }

    return json({
      databaseConfigured: databaseIsConfigured(),
      teacherCodeConfigured: Boolean(process.env.ENDEPTH_TEACHER_CODE),
      studentCodeConfigured: Boolean(process.env.ENDEPTH_ACCESS_CODE),
    });
  },
};
