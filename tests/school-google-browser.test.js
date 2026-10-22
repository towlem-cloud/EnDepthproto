import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

// This checks the UI contract with mocked GIS and API responses. It does not
// verify a real Google account, JWT signature, deployment, or school setup.
test("mocked Google browser: disabled entry, fresh nonce retry, cookie workspace and logout privacy on desktop/mobile", { timeout: 45000 }, async () => {
  const origin = "https://synthetic.test";
  const classSlug = "fictional-google-class";
  const studentId = "fictional-google-writer";
  const googleProof = "synthetic-not-a-real-google-jwt." + randomUUID();
  const privateProof = "synthetic-private-link." + randomUUID();
  const sessionValue = randomUUID();
  const draftText = "SYNTHETIC-GOOGLE-DRAFT: The fictional garden reveals disagreement about shared responsibility.";
  const classPath = "/?tool=enscribe&assignment=" + classSlug;
  const writerPath = "/?tool=enscribe&writer=" + studentId + "&assignment=" + classSlug;
  const dist = fileURLToPath(new URL("../dist/", import.meta.url));
  const workspace = {
    student: {
      id: studentId, working: draftText, original: draftText, reflection: "",
      version: 1, successfulChecks: 0, submittedAt: null,
    },
    assignment: {
      title: "Fictional Google browser assignment", course: "Synthetic seminar",
      section: "Test only", timing: "", prompt: "Examine a fictional garden.",
      instructions: "Keep the writing your own.", rubric: "", boundaries: "moderate",
      status: "open", sandbox: false,
    },
    revisions: [], checks: [],
  };
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || [
      "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    ].find(existsSync),
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const requests = [], urls = [], messages = [], errors = [], proofTransports = [];
    let enabled = false, starts = 0, scriptLoads = 0, currentNonce = "";
    let rejectNextProof = true, signedIn = false;
    await context.route("https://accounts.google.com/gsi/client", async (route) => {
      scriptLoads += 1;
      await route.fulfill({ contentType: "application/javascript", body: `
        (() => {
          const proof = ${JSON.stringify(googleProof)};
          let config;
          window.google = { accounts: { id: {
            initialize(next) {
              config = next;
              window.syntheticGoogleConfiguration = {
                clientId: next.client_id, nonce: next.nonce,
                autoSelect: next.auto_select, hostedDomain: next.hd
              };
            },
            renderButton(element) {
              const button = document.createElement("button");
              button.textContent = "Mock school Google sign-in";
              button.onclick = () => config.callback({ credential: proof });
              element.appendChild(button);
            }
          } } };
        })();
      ` });
    });
    await context.route(origin + "/**", async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) {
        assert.equal(url.pathname, "/api/department");
        assert.equal(request.method(), "POST");
        const headers = await request.allHeaders();
        assert.equal(headers.origin, origin);
        const body = request.postDataJSON();
        requests.push({ url: request.url(), body, cookie: headers.cookie || "" });
        const reply = (data, status = 200, cookie) => route.fulfill({
          status, contentType: "application/json",
          headers: cookie ? { "Set-Cookie": cookie } : {},
          body: JSON.stringify(data),
        });
        if (body.action === "student-google-start") {
          starts += 1;
          assert.equal(body.assignmentSlug, classSlug);
          if (!enabled) return reply({ error: "School Google access has not been enabled for this assignment." }, 403);
          currentNonce = "synthetic-nonce-" + starts;
          return reply({ clientId: "synthetic.apps.googleusercontent.com", nonce: currentNonce, domains: ["students.example.invalid"] }, 200,
            "synthetic_google_binding=" + currentNonce + "; Path=/; HttpOnly; Secure; SameSite=Strict");
        }
        if (body.action === "student-google-login") {
          assert.equal(body.assignmentSlug, classSlug);
          assert.equal(body.credential, googleProof);
          assert.match(headers.cookie || "", new RegExp("synthetic_google_binding=" + currentNonce));
          if (rejectNextProof) {
            rejectNextProof = false;
            return reply({ error: "Synthetic Google proof was not admitted. Try sign-in again." }, 403);
          }
          signedIn = true;
          return reply({ studentId, writerPath }, 200,
            "enscribe_student=" + sessionValue + "; Path=/; HttpOnly; Secure; SameSite=Strict");
        }
        if (body.action === "student-enter") {
          assert.equal(body.studentId, studentId);
          assert.equal(body.token, privateProof);
          assert.equal(signedIn, true);
          return reply(workspace);
        }
        if (body.action === "student-read") {
          assert.equal(body.studentId, studentId);
          assert.equal("credential" in body, false);
          assert.equal("token" in body, false);
          if (!signedIn) return reply({ error: "Your private session expired." }, 401);
          assert.match(headers.cookie || "", new RegExp("enscribe_student=" + sessionValue));
          return reply(workspace);
        }
        if (body.action === "student-logout") {
          assert.equal(body.studentId, studentId);
          signedIn = false;
          return reply({ ok: true }, 200, "enscribe_student=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
        }
        assert.fail("Unexpected mocked API action: " + body.action);
      }
      const path = resolve(dist, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
      assert.ok(path.startsWith(dist));
      await route.fulfill({
        contentType: { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" }[extname(path)] || "application/octet-stream",
        body: await readFile(path),
      });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => messages.push(message.text()));
    page.on("request", (request) => {
      urls.push(request.url());
      if (request.postData()?.includes(googleProof)) proofTransports.push({ url: request.url(), method: request.method() });
    });
    await page.goto(origin + classPath);
    await page.getByRole("alert").getByText("School Google access has not been enabled for this assignment.", { exact: true }).waitFor();
    assert.equal(starts, 1);
    assert.equal(scriptLoads, 0);
    assert.equal(await page.getByRole("button", { name: "Mock school Google sign-in", exact: true }).count(), 0);

    enabled = true;
    await page.getByRole("button", { name: "Try Google sign-in again", exact: true }).click();
    await page.getByRole("button", { name: "Mock school Google sign-in", exact: true }).waitFor();
    assert.equal(starts, 2);
    assert.equal(scriptLoads, 1);
    const firstSetup = await page.evaluate(() => window.syntheticGoogleConfiguration);
    assert.deepEqual(firstSetup, {
      clientId: "synthetic.apps.googleusercontent.com", nonce: currentNonce,
      autoSelect: false, hostedDomain: "students.example.invalid",
    });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Mock school Google sign-in", exact: true }).click();
    await page.getByRole("alert").getByText("Synthetic Google proof was not admitted. Try sign-in again.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Working / final draft", { exact: true }).count(), 0);
    await page.getByRole("button", { name: "Try Google sign-in again", exact: true }).click();
    await page.getByRole("button", { name: "Mock school Google sign-in", exact: true }).waitFor();
    const secondSetup = await page.evaluate(() => window.syntheticGoogleConfiguration);
    assert.notEqual(secondSetup.nonce, firstSetup.nonce);
    assert.equal(starts, 3);
    assert.equal(scriptLoads, 1);
    await page.setViewportSize({ width: 1365, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Mock school Google sign-in", exact: true }).click();
    await page.waitForURL(origin + writerPath);
    const editor = page.getByLabel("Working / final draft", { exact: true });
    await editor.waitFor();
    assert.equal(await editor.inputValue(), draftText);
    assert.ok(requests.some(({ body }) => body.action === "student-read"));
    assert.equal(new URL(page.url()).searchParams.get("assignment"), classSlug);
    assert.equal(new URL(page.url()).hash, "");
    await page.reload();
    await editor.waitFor();
    assert.equal(await editor.inputValue(), draftText);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // Existing private-link fragment cleanup must retain the public class return
    // path too. This separate synthetic capability is not a Google credential.
    await page.goto(origin + writerPath + "#access=" + encodeURIComponent(privateProof));
    // Opening a private link loads a document; a hash-only change on the already
    // open writer is a same-document navigation and does not remount React.
    await page.reload();
    await editor.waitFor();
    assert.equal(new URL(page.url()).hash, "");
    assert.equal(new URL(page.url()).searchParams.get("assignment"), classSlug);
    assert.equal(await editor.inputValue(), draftText);
    await page.getByRole("button", { name: "Sign out of my writing workspace", exact: true }).click();
    const returnLink = page.getByRole("link", { name: "Sign in with school Google again", exact: true });
    await returnLink.waitFor();
    assert.equal(await returnLink.getAttribute("href"), classPath);
    assert.equal(await editor.count(), 0);
    assert.equal(await page.getByText(/SYNTHETIC-GOOGLE-DRAFT/).count(), 0);
    assert.equal((await context.cookies()).filter((cookie) => cookie.name === "enscribe_student").length, 0);
    await page.reload();
    await returnLink.waitFor();
    assert.equal(await editor.count(), 0);
    assert.equal(await page.getByText(/SYNTHETIC-GOOGLE-DRAFT/).count(), 0);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).length + Object.keys(sessionStorage).length), 0);
    const proofRequests = requests.filter(({ body }) => body.credential === googleProof);
    assert.equal(proofRequests.length, 2);
    assert.ok(proofRequests.every(({ url, body }) => url === origin + "/api/department" && body.action === "student-google-login"));
    assert.deepEqual(proofTransports, Array.from({ length: 2 }, () => ({ url: origin + "/api/department", method: "POST" })));
    assert.ok(urls.every((url) => !url.includes(googleProof) && !url.includes(sessionValue)));
    assert.ok(messages.every((message) => !message.includes(googleProof) && !message.includes(privateProof) && !message.includes(sessionValue)));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
