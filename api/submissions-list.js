import { requireStaff } from "../server/security.js";
import {
  ensurePilotSchema,
  cleanString,
  databaseIsConfigured,
  json,
  listSubmissionsForStaff,
} from "../server/submissions-db.js";
import { backfillLegacySubmissionOwnership } from "../server/ownership-maintenance.js";

export default {
  async fetch(request) {
    if (request.method !== "POST") {
      return json({ error: "Use POST for this endpoint." }, 405);
    }
    if (!databaseIsConfigured()) {
      return json({ error: "The classroom submissions database is not connected." }, 503);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const suppliedCode =
      cleanString(request.headers.get("x-endepth-staff-code"), 300) ||
      cleanString(body.code, 300);

    try {
      await ensurePilotSchema();
      const staff = await requireStaff(request);
      if (!staff) return json({ error: "The staff code was not accepted." }, 401);


      const submissions = await listSubmissionsForStaff(
        staff,
        body.assignmentId,
        body.limit
      );
      return json({ submissions, staff });
    } catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      return json({ error: "Student submissions could not be loaded." }, 500);
    }
  },
};
