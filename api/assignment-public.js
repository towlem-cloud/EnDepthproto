import {
  databaseIsConfigured,
  getPublicAssignmentBySlug,
  json,
} from "./submissions-db.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") {
      return json({ error: "Use GET for this endpoint." }, 405);
    }
    if (!databaseIsConfigured()) {
      return json({ error: "The EnDepth pilot database is not connected." }, 503);
    }

    const url = new URL(request.url);
    const slug = url.searchParams.get("slug") || "";
    if (!slug) return json({ error: "The assignment link is incomplete." }, 400);

    try {
      const assignment = await getPublicAssignmentBySlug(slug);
      if (!assignment) {
        return json(
          { error: "This assignment is not open or could not be found." },
          404
        );
      }
      return json({ assignment });
    } catch (error) {
      console.error("EnDepth public assignment load failed", error);
      return json({ error: "The assignment could not be loaded." }, 500);
    }
  },
};
