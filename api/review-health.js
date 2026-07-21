import { ensureAtomicCapacityGuard } from "./capacity-guard.js";
import { reserveCoachTurn } from "./coach-usage.js";
import { backfillLegacySubmissionOwnership } from "./ownership-maintenance.js";
import { json } from "./submissions-db.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return json({ error: "Use GET for this endpoint." }, 405);
    }

    const result = {
      capacityGuard: false,
      coachUsageGuard: false,
      legacyBackfill: null,
    };

    try {
      await ensureAtomicCapacityGuard();
      result.capacityGuard = true;

      try {
        await reserveCoachTurn(
          "health-check-nonexistent-assignment",
          "health-check@example.com"
        );
      } catch (error) {
        result.coachUsageGuard = String(error?.message || error).includes(
          "ASSIGNMENT_NOT_OPEN"
        );
      }

      result.legacyBackfill = await backfillLegacySubmissionOwnership();
      return json(result);
    } catch (error) {
      return json(
        {
          ...result,
          error: error instanceof Error ? error.message : "Unknown health-check error",
        },
        500
      );
    }
  },
};
