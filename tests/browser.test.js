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
  let provider;
  try {
    const context = await browser.newContext();
    const errors = [];
    const coachRequests = [];
    let failNextGeneration = false;
    provider = mock.method(globalThis, "fetch", async (url) => {
      assert.ok(String(url).startsWith("https://api.openai.com/v1/"));
      if (String(url).endsWith("/moderations"))
        return Response.json({ results: [{ flagged: false }] });
      assert.ok(String(url).endsWith("/responses"));
      if (failNextGeneration) {
        failNextGeneration = false;
        return Response.json(
          { error: "Synthetic provider failure" },
          { status: 503 },
        );
      }
      return Response.json({
        output_text:
          "Your draft identifies shared responsibility and disagreement but leaves their relationship unexplained. Examine which decisions bring neighbors together and which priorities create tension. What evidence would help you decide whether a shared task strengthens relationships?",
      });
    });
    await context.route("https://synthetic.test/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.pathname.startsWith("/api/")) {
        if (url.pathname === "/api/department" && req.method() === "POST") {
          const body = req.postDataJSON();
          if (body.action === "student-coach") coachRequests.push(body);
        }
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
      .fill("  " + process.env.ENDEPTH_TEACHER_CODE + "  ");
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
    await page.getByLabel("Rubric focus", { exact: true }).selectOption("Analysis");
    await page.getByLabel("Goal", { exact: true }).fill(
      "Explain the relationship between shared responsibility and disagreement.",
    );
    await page.getByLabel("Exact passage from saved draft", { exact: true }).fill(
      "Exact passage from saved draft: The fictional garden gives neighbors a shared responsibility.",
    );
    await page.getByLabel("What I already tried", { exact: true }).fill(
      "I identified a shared task and competing priorities.",
    );
    await page.getByLabel("My focused question", { exact: true }).fill(
      "Which causal link needs more explanation?",
    );
    const coachResponse = () => page.waitForResponse((response) =>
      response.url().endsWith("/api/department") &&
      response.request().postDataJSON()?.action === "student-coach",
    );
    let result = coachResponse();
    await page.getByRole("button", { name: "Request live check", exact: true }).click();
    assert.equal((await result).status(), 400);
    await page.getByText("Select an exact passage from the saved draft.", {
      exact: true,
    }).waitFor();
    await page.getByRole("button", { name: "Request live check", exact: true }).waitFor();
    assert.equal(provider.mock.callCount(), 0);

    const savedPassage =
      "The fictional garden gives neighbors a shared responsibility, but it also exposes disagreement about priorities.";
    const draftEditor = page.getByLabel("Working / final draft", { exact: true });
    await draftEditor.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Control+Shift+End");
    await page.getByRole("button", { name: "Use selected passage", exact: true }).click();
    assert.equal(
      await page.getByLabel("Exact passage from saved draft", { exact: true }).inputValue(),
      savedPassage,
    );
    await page.getByLabel("My focused question", { exact: true }).fill("Which causal link needs evidence?");
    result = coachResponse();
    await page.getByRole("button", { name: "Request live check", exact: true }).click();
    assert.equal((await result).status(), 200);
    await page.getByText(/1\/4 used/).waitFor();
    assert.notEqual(coachRequests[1].requestId, coachRequests[0].requestId);
    assert.equal(coachRequests[1].passage, savedPassage);
    assert.equal(coachRequests[1].question, "Which causal link needs evidence?");

    failNextGeneration = true;
    await page.getByLabel("My focused question", { exact: true }).fill(
      "How could competing priorities limit the garden's effect?",
    );
    result = coachResponse();
    await page.getByRole("button", { name: "Request live check", exact: true }).click();
    assert.equal((await result).status(), 502);
    await page.getByRole("button", { name: "Retry the same live check", exact: true }).waitFor();
    await page.getByText(/1\/4 used/).waitFor();
    await page.getByLabel("My focused question", { exact: true }).fill(
      "An edited question must not replace an uncertain retry payload.",
    );
    result = coachResponse();
    await page.getByRole("button", { name: "Retry the same live check", exact: true }).click();
    assert.equal((await result).status(), 200);
    await page.getByText(/2\/4 used/).waitFor();
    assert.deepEqual(coachRequests[3], coachRequests[2]);
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
      2,
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
    await page.getByRole('button',{name:'Students / import / access links',exact:true}).click();
    await page.getByText(/fictional@example.invalid/).waitFor();
    await page
      .getByRole("button", { name: "EnDepth Teacher Desk", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: "Build assignments once. Share one student link.",
        exact: true,
      })
      .waitFor();
    const logoutResponse=page.waitForResponse(r=>r.url().endsWith('/api/staff-auth')&&r.request().postData()?.includes('logout'));
    await page
      .getByRole("button", { name: "Lock portal", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Approved staff sign-in", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "EnScribe Writing Studio", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "EnDepth Teacher Desk", exact: true })
        .count(),
      0,
    );
    assert.equal(
      await page
        .getByText("fictional@example.invalid", { exact: true })
        .count(),
      0,
    );
    assert.equal((await logoutResponse).status(),200);
    assert.equal((await sql`SELECT count(*)::int AS n FROM department_sessions`)[0].n,0);
    await page.reload();await page.getByRole('heading',{name:'Approved staff sign-in',exact:true}).waitFor();
    await page.getByLabel("Individual teacher or administrator code").fill(
      process.env.ENDEPTH_TEACHER_CODE,
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", {
      name: "Try EnScribe — fictional example", exact: true,
    }).click();
    const fictionalWorkspace = page.getByRole("link", {
      name: "Open fictional workspace", exact: true,
    });
    await fictionalWorkspace.waitFor();
    const fictionalUrl = new URL(await fictionalWorkspace.getAttribute("href"));
    assert.equal(fictionalUrl.origin, "https://synthetic.test");
    assert.equal(fictionalUrl.searchParams.get("tool"), "enscribe");
    assert.match(fictionalUrl.hash, /^#access=/);
    const opened = context.waitForEvent("page");
    await fictionalWorkspace.click();
    const examplePage = await opened;
    await examplePage.getByLabel("Working / final draft", { exact: true }).waitFor();
    assert.ok((await examplePage.getByLabel("Working / final draft", { exact: true }).inputValue()).length);
    await examplePage.close();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Individual teacher or administrator code").fill(
      process.env.ENDEPTH_ADMIN_CODE,
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const preservedTeacher = await sql`SELECT teacher_id,code_hash,active,activation_state,credential_version FROM endepth_teachers WHERE slug='morgan-towle'`;
    await page.getByRole("button", {
      name: "Add approved roster without changing existing accounts", exact: true,
    }).click();
    const activeTeacher = page.locator("article").filter({ hasText: "towlem@ensworth.com" });
    await activeTeacher.getByText("Replace active teacher code", { exact: true }).waitFor();
    assert.equal(await activeTeacher.getByRole("button", {
      name: "Replace existing code & revoke sessions", exact: true,
    }).isVisible(), false);
    const awaitingTeacher = page.locator("article").filter({ hasText: "marksd@ensworth.com" });
    await awaitingTeacher.getByRole("button", {
      name: "Activate & issue individual code", exact: true,
    }).click();
    await page.getByLabel("Private credential or link").waitFor();
    const teacherCode = await page.getByLabel("Private credential or link").inputValue();
    assert.match(teacherCode, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(await fictionalWorkspace.count(), 0);
    await awaitingTeacher.getByText("Replace active teacher code", { exact: true }).waitFor();
    assert.deepEqual(
      await sql`SELECT teacher_id,code_hash,active,activation_state,credential_version FROM endepth_teachers WHERE slug='morgan-towle'`,
      preservedTeacher,
    );
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByLabel("Individual teacher or administrator code").fill(
      process.env.ENDEPTH_TEACHER_CODE,
    );
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const oldAssignment = page.locator(".assignment-grid > section").filter({
      has: page.getByRole("heading", { name: "Synthetic browser assignment", exact: true }),
    });
    await oldAssignment.getByRole("button", {
      name: "Students / import / access links", exact: true,
    }).click();
    await page.getByText(/fictional@example.invalid/).waitFor();
    await sql`UPDATE department_sessions SET expires_at=NOW()-INTERVAL '1 minute' WHERE teacher_id=${preservedTeacher[0].teacher_id}`;
    await page.getByRole("button", { name: "EnDepth Teacher Desk", exact: true }).click();
    await page.getByRole("heading", { name: "Approved staff sign-in", exact: true }).waitFor();
    assert.equal(await page.getByText(/fictional@example.invalid/).count(), 0);
    assert.equal(await oldAssignment.count(), 0);
    await page.getByLabel("Email (optional for existing codes)").fill("marksd@ensworth.com");
    await page.getByLabel("Individual teacher or administrator code").fill(teacherCode);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.locator(".department-navigation strong").getByText("marksd@ensworth.com", { exact: true }).waitFor();
    assert.equal(await page.getByText(/fictional@example.invalid/).count(), 0);
    assert.equal(await oldAssignment.count(), 0);
    const secondTeacher = (await sql`SELECT teacher_id FROM endepth_teachers WHERE email='marksd@ensworth.com'`)[0];
    let depthResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/assignments") &&
      response.request().postDataJSON()?.action === "list",
    );
    await page.getByRole("button", { name: "EnDepth Teacher Desk", exact: true }).click();
    assert.equal((await (await depthResponse).json()).staff.teacherId, secondTeacher.teacher_id);
    await page.locator(".staff-portal-banner").getByText("marksd@ensworth.com", { exact: true }).waitFor();
    await page.getByRole("button", { name: "EnScribe Writing Studio", exact: true }).click();
    await page.getByRole("button", { name: "Create writing assignment", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Second teacher private assignment");
    await page.getByLabel("Course", { exact: true }).fill("Fictional seminar");
    await page.getByLabel("Section", { exact: true }).fill("Another section");
    await page.getByLabel("Assignment prompt", { exact: true }).fill("Analyze a fictional garden independently.");
    const writingResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/department") &&
      response.request().postDataJSON()?.action === "writing-save",
    );
    await page.getByRole("button", { name: "Save assignment", exact: true }).click();
    assert.equal((await (await writingResponse).json()).assignment.teacher_id, secondTeacher.teacher_id);
    await page.getByRole("heading", { name: "Second teacher private assignment", exact: true }).waitFor();
    assert.equal(await oldAssignment.count(), 0);
    assert.equal(await page.getByText(/fictional@example.invalid/).count(), 0);
    // Another tab can replace the shared cookie while this desk still has data.
    await page.evaluate(async (code) => {
      const response = await fetch("/api/staff-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", code }),
      });
      if (!response.ok) throw new Error("Synthetic identity switch failed");
    }, process.env.ENDEPTH_TEACHER_CODE);
    await page.getByRole("button", { name: "EnDepth Teacher Desk", exact: true }).click();
    await page.locator(".department-navigation strong").getByText("Morgan Towle", { exact: true }).waitFor();
    await page.locator(".staff-portal-banner").getByText("Morgan Towle", { exact: true }).waitFor();
    await page.getByRole("button", { name: "EnScribe Writing Studio", exact: true }).click();
    await oldAssignment.waitFor();
    assert.equal(await page.getByRole("heading", {
      name: "Second teacher private assignment", exact: true,
    }).count(), 0);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.goto("https://synthetic.test/");
    await page.getByRole("button", { name: "Teacher Portal", exact: true }).click();
    await page.getByLabel("Teacher or admin code").fill(teacherCode);
    await page.getByRole("button", { name: "Open Teacher Portal", exact: true }).click();
    await page.getByRole("heading", {
      name: "Build assignments once. Share one student link.", exact: true,
    }).waitFor();
    await page.locator(".staff-portal-banner").getByText("marksd@ensworth.com", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    provider?.mock.restore();
    await db.close();
  }
});
