import { authenticateRequest } from "../lib/department-security.js";
import {
  databaseIsConfigured,
  json,
  listSubmissionsForStaff,
} from "../lib/endepth-db.js";
import { backfillLegacySubmissionOwnership } from "../lib/ownership-maintenance.js";

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

    try {
      const staff = await authenticateRequest(request);
      if (!staff) return json({ error: "The staff code was not accepted." }, 401);

      await backfillLegacySubmissionOwnership();
      const submissions = await listSubmissionsForStaff(
        staff,
        body.assignmentId,
        body.limit
      );
      return json({ submissions, staff });
    } catch (error) {
      if (error.status) return json({ error: error.message }, error.status);
      console.error("EnDepth submission list failed");
      return json({ error: "Student submissions could not be loaded." }, 500);
    }
  },
};
