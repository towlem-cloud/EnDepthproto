import {
  authenticateStaffCode,
  databaseIsConfigured,
  json,
} from "./submissions-db.js";
import { backfillLegacySubmissionOwnership } from "./ownership-maintenance.js";

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
      body = {};
    }

    try {
      const staff = await authenticateStaffCode(body.code);
      if (!staff) {
        return json({ error: "That teacher or admin code was not accepted." }, 401);
      }
      await backfillLegacySubmissionOwnership();
      return json({ staff });
    } catch (error) {
      console.error("EnDepth staff authentication failed", error);
      return json({ error: "EnDepth could not verify staff access." }, 500);
    }
  },
};
