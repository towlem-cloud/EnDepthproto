import {
  database,
  sameOrigin,
  session,
  manageAccount,
  HttpError,
  assert,
} from "../lib/department-security.js";
import { createDepthTest } from "../lib/depth-sandbox.js";
import { staffWriting, studentWriting } from "../lib/enscribe-service.js";
export default {
  async fetch(request) {
    try {
      assert(request.method === "POST", 405, "Use POST.");
      sameOrigin(request);
      const body = await request.json();
      if (
        process.env.DEPARTMENT_WRITING_DISABLED === "1" &&
        /^(writing-|student-)/.test(String(body.action))
      )
        throw new HttpError(
          503,
          "EnScribe is temporarily unavailable. Saved writing is preserved.",
        );
      const sql = await database();
      let result;
      if (String(body.action).startsWith("student-"))
        result = await studentWriting(sql, request, body);
      else {
        const staff = await session(request, sql);
        if (body.action === "depth-test")
          result = await createDepthTest(sql, staff);
        else if (String(body.action).startsWith("writing-"))
          result = await staffWriting(sql, staff, body);
        else if (body.action === "accounts") {
          assert(staff.role === "admin", 403, "Administrator required.");
          result = {
            teachers:
              await sql`SELECT teacher_id,display_name,email,active,activation_state FROM endepth_teachers ORDER BY display_name`,
          };
        } else result = await manageAccount(sql, staff, body);
      }
      const headers = { "Cache-Control": "no-store" };
      if (result.cookie) {
        headers["Set-Cookie"] = result.cookie;
        delete result.cookie;
      }
      return Response.json(result, { headers });
    } catch (error) {
      const known = [
        "VERSION_CONFLICT",
        "ALREADY_SUBMITTED",
        "CHECK_IN_PROGRESS",
        "ASSIGNMENT_CLOSED",
        "COACHING_DISABLED",
        "DRAFT_NOT_ELIGIBLE",
        "REQUEST_CONFLICT",
        "EXPLANATION_REQUIRED",
        "REFLECTION_REQUIRED",
        "ORIGINAL_IMMUTABLE",
      ];
      const code = known.find((c) => String(error.message).includes(c));
      return Response.json(
        {
          error: error.status
            ? error.message
            : code || "The department service could not complete this request.",
        },
        {
          status: error.status || (code ? 409 : 503),
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  },
};
