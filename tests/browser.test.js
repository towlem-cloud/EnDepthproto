import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { chromium } from "playwright-core";
const db = new PGlite();
function sql(parts, ...values) {
  let text = parts[0];
  values.forEach((_, i) => (text += "$" + (i + 1) + parts[i + 1]));
  return db.query(text, values).then((r) => r.rows);
}
sql.query = (text, values) =>
  values ? db.query(text, values).then((r) => r.rows) : db.exec(text);
mock.module("@neondatabase/serverless", { exports: { neon: () => sql } });
process.env.DATABASE_URL = "postgres://isolated.browser/never-production";
process.env.ENDEPTH_TEACHER_CODE = "synthetic-browser-teacher-code";
process.env.ENDEPTH_ADMIN_CODE = "synthetic-browser-admin-code";
process.env.OPENAI_API_KEY = "synthetic-browser-ai-key";
process.env.ENDEPTH_ACCESS_CODE = "synthetic-browser-class-code";
const endpoint = (await import("../api/department.js")).default;
const auth = (await import("../api/staff-auth.js")).default;
const api = { department: endpoint, "staff-auth": auth };
for (const name of [
  "assignments",
  "teachers",
  "submissions-list",
  "assignment-public",
  "submissions",
  "coach",
])
  api[name] = (await import("../api/" + name + ".js")).default;
const { database } = await import("../lib/department-security.js");
let browser;
test("desktop/mobile: authenticated department and real student save/submit UI against isolated SQL", async () => {
  const { ensurePilotSchema } = await import("../lib/endepth-db.js");
  await ensurePilotSchema();
  const schema = (await import("../lib/department-schema.js")).default;
  const { statements } = await import("../lib/sql-statements.js");
  for (const statement of statements(schema)) await sql.query(statement);
  await database();
  browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      [
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
      ].find(existsSync),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext();
    const errors = [];
    await context.route("https://synthetic.test/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.pathname.startsWith("/api/")) {
        const handler = api[url.pathname.slice(5)];
        assert.ok(handler, url.pathname);
        const response = await handler.fetch(
          new Request(req.url(), {
            method: req.method(),
            headers: await req.allHeaders(),
            body: req.method() === "POST" ? req.postData() : undefined,
          }),
        );
        await route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: await response.text(),
        });
        return;
      }
      const path = resolve(
        "dist",
        url.pathname === "/" ? "index.html" : url.pathname.slice(1),
      );
      assert.ok(path.startsWith(resolve("dist")));
      const mime =
        {
          ".js": "application/javascript",
          ".css": "text/css",
          ".html": "text/html",
        }[extname(path)] || "application/octet-stream";
      await route.fulfill({
        status: 200,
        contentType: mime,
        body: await readFile(path),
      });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("https://synthetic.test/?tool=department");
    await page
      .getByLabel("Individual teacher or administrator code")
      .fill(process.env.ENDEPTH_TEACHER_CODE);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("heading", { name: "EnScribe Writing Studio", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Create writing assignment", exact: true })
      .click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Synthetic browser assignment");
    await page.getByLabel("Course", { exact: true }).fill("Fictional seminar");
    await page.getByLabel("Section", { exact: true }).fill("Test section");
    await page
      .getByLabel("Assignment prompt", { exact: true })
      .fill("Explore how a fictional garden changes a community.");
    await page.getByLabel("Status", { exact: true }).selectOption("open");
    await page
      .getByRole("button", { name: "Save assignment", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Synthetic browser assignment",
        exact: true,
      })
      .waitFor();
    await page
      .getByRole("button", {
        name: "Students / import / access links",
        exact: true,
      })
      .click();
    await page.getByLabel("firstName", { exact: true }).fill("Example");
    await page.getByLabel("lastName", { exact: true }).fill("Writer");
    await page
      .getByLabel("email", { exact: true })
      .fill("fictional@example.invalid");
    await page
      .getByRole("button", {
        name: "Generate private student link",
        exact: true,
      })
      .click();
    const link = await page
      .getByLabel("Private credential or link")
      .inputValue();
    assert.match(link, /#access=/);
    await page.screenshot({
      path: "/tmp/department-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/department-mobile.png",
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.goto(
      link.replace(/^https:\/\/synthetic.test/, "https://synthetic.test"),
    );
    await page
      .getByLabel("Working / final draft", { exact: true })
      .fill(
        "The fictional garden gives neighbors a shared responsibility, but it also exposes disagreement about priorities.",
      )
      .catch(async (e) => {
        await page.screenshot({
          path: "/tmp/student-startup-failure.png",
          fullPage: true,
        });
        throw e;
      });
    await page
      .getByRole("button", { name: "Save draft — not submit", exact: true })
      .click();
    await page
      .getByText("Draft saved. This is not a submission.", { exact: true })
      .waitFor();
    await page
      .getByLabel("Working / final draft", { exact: true })
      .fill(
        "The fictional garden gives neighbors a shared responsibility, while revealing disagreements about whose priorities matter.",
      );
    await page
      .getByLabel("Explain what changed or why you rejected a suggestion", {
        exact: true,
      })
      .fill("Clarified the source of disagreement.");
    await page
      .getByLabel("What changed in your thinking and writing?", { exact: true })
      .fill("I distinguished shared responsibility from agreement.");
    await page
      .getByRole("button", { name: "Submit to teacher", exact: true })
      .click();
    await page
      .getByText("Submission confirmed by the server.", { exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByText(/teacher must reopen before further revision/)
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Submit to teacher", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      (await sql`SELECT successful_checks FROM enscribe_students`)[0]
        .successful_checks,
      0,
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: "/tmp/enscribe-student-mobile.png",
      fullPage: true,
    });
    await page.goto("https://synthetic.test/");
    await page
      .getByRole("button", { name: "Open the student demo", exact: true })
      .click();
    await page
      .getByText("Harkness Preparation Card", { exact: true })
      .first()
      .waitFor();
    await page.goto("https://synthetic.test/?tool=department");
    await page
      .getByRole("button", { name: "EnDepth Teacher Desk", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Build assignments once. Share one student link.",
        exact: true,
      })
      .waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await db.close();
  }
});
