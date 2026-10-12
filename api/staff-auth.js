import {
  database,
  sameOrigin,
  session,
  login,
  logout,
  HttpError,
} from "../lib/department-security.js";
export default {
  async fetch(request) {
    try {
      if (request.method !== "POST") throw new HttpError(405, "Use POST.");
      sameOrigin(request);
      const sql = await database();
      const body = await request.json();
      if (body.action === "logout")
        return Response.json(
          { ok: true },
          {
            headers: {
              "Set-Cookie": await logout(request, sql),
              "Cache-Control": "no-store",
            },
          },
        );
      if (body.action === "session")
        return Response.json(
          { staff: await session(request, sql) },
          { headers: { "Cache-Control": "no-store" } },
        );
      const result = await login(request, body.code, body.email, sql);
      return Response.json(
        { staff: result.staff },
        {
          headers: { "Set-Cookie": result.cookie, "Cache-Control": "no-store" },
        },
      );
    } catch (error) {
      return Response.json(
        {
          error: error.status ? error.message : "Staff access is unavailable.",
        },
        {
          status: error.status || 503,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  },
};
