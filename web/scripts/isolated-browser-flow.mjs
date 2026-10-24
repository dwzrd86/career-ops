import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { build, createServer, preview } from "vite";
import JSZip from "jszip";
import { configuredSecurityPolicy } from "./security-policy.mjs";

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const viteConfig = resolve(scriptDirectory, "browser-flow.vite.config.mjs");

function failure(message) {
  throw new Error(`Isolated browser flow: ${message}`);
}

async function expectVisible(page, locator, label) {
  await locator.waitFor({ state: "visible", timeout: 10_000 }).catch(() => failure(`${label} was not visible`));
  assert.ok(await locator.isVisible(), `${label} was not visible`);
}

async function main() {
  const productionCsp = process.argv.includes("--production-csp");
  let outputDirectory;
  let server;
  if (productionCsp) {
    const policy = configuredSecurityPolicy();
    // Compile the existing mocked account fixture, without replacing release dist/.
    const localDirectory = resolve(scriptDirectory, "../../agent/.local");
    await mkdir(localDirectory, { recursive: true });
    outputDirectory = await mkdtemp(resolve(localDirectory, "csp-browser-"));
    try {
      await build({ configFile: viteConfig, build: { outDir: outputDirectory, emptyOutDir: true }, logLevel: "error" });
      server = await preview({ configFile: viteConfig, build: { outDir: outputDirectory },
        preview: { host: "127.0.0.1", port: 0, headers: { "Content-Security-Policy": policy } } });
    } catch (error) {
      await rm(outputDirectory, { recursive: true, force: true });
      throw error;
    }
  } else {
    server = await createServer({ configFile: viteConfig, server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
  }
  const baseUrl = server.resolvedUrls?.local.find((url) => url.startsWith("http://127.0.0.1"));
  if (!baseUrl) failure("local test server did not expose a loopback URL");
  let browser;
  let context;

  try {
    browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
    context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", event => {
        window.__cspViolations.push(`${event.effectiveDirective}: ${event.blockedURI}`);
      });
    });
    page.on("console", (message) => { if (message.type() === "error") console.error("Browser console:", message.text()); });
    page.setDefaultTimeout(5_000);
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile={render:(_element,options)=>{window.__betaTurnstileOptions=options;setTimeout(()=>options.callback("isolated-browser-token"),0);return "isolated-widget";},remove:()=>{},reset:()=>{}};`,
      });
    });

    let generationFailure = false;
    let generationHold;
    await page.route("**/__career_ops/resume", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { enabled: true, model: "zai-coding-plan/test-model" } });
      const data = route.request().postDataJSON();
      assert.equal(data.consent, true);
      assert.ok(data.brief.includes("Test Candidate: Built Python automation"));
      const evidence = JSON.parse(data.brief.split("\nEVIDENCE JSON\n")[1]);
      assert.deepEqual(Object.keys(evidence).sort(), ["jobDescription", "sourceResume", "targetRole"]);
      assert.deepEqual(evidence.targetRole, { company: "Example Company", title: "Security regression role" }, "generation must exclude pipeline IDs, notes, and metadata");
      assert.equal(route.request().headers()["x-career-ops-local"], "1");
      await generationHold;
      return route.fulfill(generationFailure ? { status: 502, json: { error: "Test GLM failure. Editor retained." } } :
        { json: { draft: "Test Candidate\nEXPERIENCE\nBuilt Python automation with SQL on AWS.\nSKILLS\nPython, SQL, AWS" } });
    });
    // Exercise hosted AccessScreen recovery using the existing isolated client.
    // The configured backend lifecycle is covered independently by hostedAuth.test.ts.
    let localOwnerRequests = 0;
    await page.route("**/__career_ops/local-owner", route => {
      localOwnerRequests++;
      return route.fulfill({ json: { enabled: productionCsp } });
    });
    await page.goto(`${baseUrl}?error=INVALID_TOKEN`, { waitUntil: "networkidle" });
    await expectVisible(page, page.getByText("That verification or reset link is invalid or expired. Request a new link below.", { exact: true }), "invalid callback recovery");
    await page.getByLabel("Email").fill("unverified@example.test");
    await page.getByLabel("Password", { exact: true }).fill("FictionalPassword123");
    await page.evaluate(() => { window.__authFailure = { method: "signIn", code: "EMAIL_NOT_VERIFIED" }; });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expectVisible(page, page.getByRole("heading", { name: "Verify your email." }), "unverified sign-in recovery");
    assert.equal(await page.locator("h1").filter({ hasText: "Pipeline" }).count(), 0);
    await page.evaluate(() => { window.__authFailure = { method: "sendVerificationEmail", code: "AUTH_SERVICE_UNAVAILABLE" }; });
    await page.getByRole("button", { name: "Resend verification link" }).last().click();
    await expectVisible(page, page.getByText("Verification email could not be requested. Contact your beta host or try again later.", { exact: true }), "resend failure recovery");
    await page.getByRole("button", { name: "Back to sign in" }).click();
    assert.equal(new URL(page.url()).search, "", "starting over clears invalid callback parameters");
    await page.getByRole("button", { name: "Forgot your password?", exact: true }).click();
    await page.getByLabel("Email").fill("unknown@example.test");
    await page.getByRole("button", { name: "Send reset link", exact: true }).click();
    const resetNotice = await page.getByRole("status").textContent();
    await page.evaluate(() => { window.__authFailure = { method: "requestPasswordReset", code: "AUTH_SERVICE_UNAVAILABLE" }; });
    await page.getByRole("button", { name: "Send reset link", exact: true }).click();
    await page.waitForFunction(text => document.querySelector('[role="status"]')?.textContent === text, resetNotice);
    assert.equal(await page.getByRole("status").textContent(), resetNotice, "reset service failure does not disclose account existence");
    await page.goto(`${baseUrl}?token=invalid-fixture-token`, { waitUntil: "networkidle" });
    await page.getByLabel("New password", { exact: true }).fill("ChangedPassword123");
    await page.getByLabel("Confirm password").fill("ChangedPassword123");
    await page.evaluate(() => { window.__authFailure = { method: "resetPassword", code: "INVALID_TOKEN" }; });
    await page.getByRole("button", { name: "Reset password", exact: true }).click();
    await expectVisible(page, page.getByText("We could not complete that request. Request a new link and try again.", { exact: true }), "invalid reset token recovery");
    await page.getByRole("button", { name: "Request another reset link", exact: true }).click();
    assert.equal(new URL(page.url()).search, "");
    assert.ok(!(await page.locator("body").textContent()).includes("Private provider diagnostic"));
    const entry = await page.goto(baseUrl, { waitUntil: "networkidle" });
    if (productionCsp) assert.ok(entry.headers()["content-security-policy"], "The browser must receive the enforced CSP");
    await page.getByRole("button", { name: "Create an account" }).click({ force: true });
    await page.getByLabel("Email").fill("security-flow@example.test");
    await page.getByLabel("Password", { exact: true }).fill("SecurityFlow123");
    await page.getByLabel("Confirm password").fill("SecurityFlow123");
    await page.getByLabel("Beta invite code").fill("isolated-invite");
    const createAccount = page.getByRole("button", { name: "Create account" });
    await createAccount.waitFor({ state: "visible" });
    await createAccount.waitFor({ state: "attached" });
    await page.waitForFunction((button) => !(button instanceof HTMLButtonElement) || !button.disabled, await createAccount.elementHandle());
    await page.evaluate(() => window.__betaTurnstileOptions["error-callback"]());
    assert.equal(await createAccount.isEnabled(), false, "failed bot checks disable signup explicitly");
    await expectVisible(page, page.getByText("The bot check could not load. Check your connection or browser blocker, then retry.", { exact: true }), "actionable bot check failure");
    await page.getByRole("button", { name: "Retry bot check", exact: true }).click();
    await page.waitForFunction(button => !button.disabled, await createAccount.elementHandle());
    assert.equal(await page.getByLabel("Email").inputValue(), "security-flow@example.test", "bot retry preserves form input");
    if (productionCsp) {
      assert.equal(localOwnerRequests, 0, "hosted builds never probe or post local-owner credentials even if the route advertises availability");
      assert.equal(await page.getByText(/Create your first local owner account/).count(), 0);
    }
    for (const [code, message] of [
      ["AUTH_CONFIGURATION_UNAVAILABLE", "Authentication is not configured for this workspace. Contact your beta host."],
      ["BOT_VERIFICATION_FAILED", "The bot check failed. Complete a fresh check and try again."],
    ]) {
      await page.evaluate(code => { window.__authFailure = { method: "signUp", code }; }, code);
      await createAccount.click();
      await expectVisible(page, page.getByText(message, { exact: true }), `signup ${code} guidance`);
      assert.equal(await createAccount.isEnabled(), false, "a consumed bot token cannot be reused");
      await page.evaluate(() => window.__betaTurnstileOptions.callback("fresh-fixture-token"));
    }
    await createAccount.click();

    await expectVisible(page, page.getByRole("heading", { name: "Verify your email." }), "verification screen");
    if (productionCsp) assert.equal(localOwnerRequests, 0, "hosted signup never submits credentials to the local-owner route");
    await page.getByRole("button", { name: "Resend verification link" }).first().click();
    await expectVisible(page, page.getByRole("heading", { name: "Review the beta privacy notice." }), "privacy acknowledgement");
    await page.getByRole("button", { name: /Privacy notice \(version/ }).click();
    const policy = page.getByRole("dialog", { name: "Privacy notice", exact: true });
    await expectVisible(page, policy, "bundled current privacy policy");
    assert.ok((await policy.textContent()).includes("2026-10-24-meritwake-beta"));
    assert.ok(!(await policy.textContent()).includes("hi@santifer.io"));
    await page.keyboard.press("Escape");
    assert.equal(await policy.count(), 0);
    await page.getByRole("button", { name: "Beta terms of use", exact: true }).click();
    const terms = page.getByRole("dialog", { name: "Beta terms of use", exact: true });
    await expectVisible(page, terms, "bundled beta terms");
    assert.ok((await terms.textContent()).includes("saved resume bundles"));
    await page.keyboard.press("Escape");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Acknowledge and continue" }).click();
    await expectVisible(page, page.locator("h1").filter({ hasText: "Pipeline" }), "pipeline dashboard");

    const guide = page.getByRole("region", { name: "A clear next move." });
    await expectVisible(page, guide, "first application guide");
    await guide.getByRole("button", { name: "Set my job targets" }).click();
    assert.equal(await page.getByRole("textbox", { name: "Target role", exact: true }).evaluate(el => document.activeElement === el), true);
    await page.getByRole("button", { name: "Beta guide & feedback" }).click();
    const betaHelp = page.getByRole("dialog", { name: "A quick guide to Meritwake" });
    await expectVisible(page, betaHelp, "beta help dialog");
    assert.ok((await betaHelp.getByLabel("Beta feedback template").inputValue()).includes("Please omit resumes"));
    await page.keyboard.press("Escape");
    assert.equal(await betaHelp.count(), 0);

    const settings = page.locator("#discovery-settings");
    await expectVisible(page, settings.getByRole("heading", { name: "Target Profile" }), "Target Profile editor");
    assert.equal(await settings.getByRole("combobox", { name: /Schedule/ }).inputValue(), "manual");
    assert.equal(await settings.getByLabel("Enable discovery").isChecked(), false);
    await settings.locator("summary").filter({ hasText: "Optional preferences and eligibility" }).click();
    await settings.locator('input[type="file"]').setInputFiles({ name: "target-profile.yml", mimeType: "text/yaml", buffer: Buffer.from("targetRoles:\n  - title: Security Architect\n    aliases: [Cloud Security Architect]\nlocation:\n  home: Nashville\n  allowedRegions: [United States]\ncompensation:\n  floor: 150000\nevidenceReferences:\n  - localPath: secret-resume.pdf\n") });
    await expectVisible(page, settings.getByText("Profile loaded. Review it, enable discovery if wanted, then save."), "profile import confirmation");
    assert.equal(await settings.getByRole("textbox", { name: "Target role", exact: true }).inputValue(), "Security Architect");
    assert.equal(await settings.getByLabel("Minimum annual salary").inputValue(), "150000");
    await settings.getByLabel("Home location").fill("Nashville");
    await settings.getByLabel("Enable discovery").check();
    await settings.getByRole("button", { name: "Save Target Profile" }).click();
    await expectVisible(page, settings.getByText("Target Profile v1 saved."), "saved Target Profile confirmation");
    await settings.getByRole("button", { name: "Run now" }).click();
    await expectVisible(page, settings.getByText("Scan queued. Results will appear in the review queue."), "scan confirmation");
    await expectVisible(page, settings.getByText("Recent scans"), "scan history");

    await expectVisible(page, page.getByRole("heading", { name: "Discovery review queue" }), "discovery review queue");
    await expectVisible(page, page.getByText("Review target role", { exact: true }), "projected discovery role");
    await expectVisible(page, page.getByText("Mock Board", { exact: true }), "projected source");
    await expectVisible(page, page.getByText("84", { exact: true }), "projected score");
    await expectVisible(page, page.getByText(/Fresh · checked/), "projected freshness");
    await expectVisible(page, page.getByText("Work Authorization Required", { exact: true }), "projected hard-filter reason");
    await expectVisible(page, page.getByText("Salary Unknown", { exact: true }), "projected unknown");
    await expectVisible(page, page.getByText("Draft Awaiting Review · report, PDF, checklist", { exact: true }), "read-only material status");
    await page.getByRole("button", { name: "Shortlist", exact: true }).click();
    await page.getByRole("button", { name: "Shortlisted", exact: true }).click();
    await expectVisible(page, page.getByText("Shortlisted for evaluation review", { exact: true }), "shortlisted next action");
    await page.getByRole("button", { name: "Override decision" }).click();
    await expectVisible(page, page.getByRole("heading", { name: "Override discovery decision" }), "decision override dialog");
    await page.getByLabel("New decision").selectOption("ranked");
    await page.getByLabel("Override reason").fill("Relevant portfolio evidence changes this assessment.");
    await page.getByRole("button", { name: "Save override" }).click();
    await expectVisible(page, page.getByText("Ranked", { exact: true }), "overridden decision");
    await page.getByRole("button", { name: "Approve for evaluation" }).click();
    await expectVisible(page, page.getByText("Ready for evaluation", { exact: true }), "evaluation approval");
    const discoveredTarget = page.locator("#resume-studio").getByLabel("Resume target role", { exact: true });
    await discoveredTarget.selectOption({ label: "Example Discovery Co. · Review target role" });
    assert.equal(await page.locator("#resume-studio").getByLabel("Source resume", { exact: true }).isEnabled(), true);
    assert.equal(await page.locator("#resume-studio").getByLabel("Job description", { exact: true }).inputValue(), "SQL and AWS required.\nBuild reliable reporting.", "discovery posting prefills a new bundle");
    await discoveredTarget.selectOption("");
    await page.getByRole("button", { name: "Approve for evaluation" }).click();
    assert.equal(await discoveredTarget.locator("option").filter({ hasText: "Example Discovery Co. · Review target role" }).count(), 1, "repeat approval does not duplicate target");
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await page.getByRole("button", { name: "Archived", exact: true }).click();
    await expectVisible(page, page.getByText("Archived — no further action", { exact: true }), "archived discovery role");

    await page.getByRole("button", { name: "Add role" }).click();
    await page.getByLabel("Company").fill("Example Company");
    await page.getByLabel("Role title").fill("Security regression role");
    await page.getByRole("textbox", { name: "Location", exact: true }).fill("Remote");
    await page.getByRole("textbox", { name: "Source", exact: true }).fill("Isolated browser test");
    await page.getByLabel("Application URL").fill("https://example.test/roles/security-regression");
    await page.getByRole("button", { name: "Save role" }).click();
    await expectVisible(page, page.getByText("Security regression role", { exact: true }), "created role");

    const studio = page.locator("#resume-studio");
    const prepareResume = page.getByRole("button", { name: "Prepare resume for Security regression role at Example Company", exact: true });
    const prepareDiscoveryResume = page.getByRole("button", { name: "Prepare resume for Review target role at Example Discovery Co.", exact: true });
    await prepareResume.click();
    const targetRole = studio.getByLabel("Resume target role", { exact: true });
    assert.equal(await targetRole.locator("option:checked").textContent(), "Example Company · Security regression role", "pipeline action selects its own role");
    assert.equal(await targetRole.evaluate(element => document.activeElement === element), true, "pipeline action moves keyboard focus into Resume Studio");
    const preparation = studio.getByRole("region", { name: "Prepare this application", exact: true });
    await expectVisible(page, preparation.getByText("Next: Add source resume.", { exact: true }), "first preparation step");
    await preparation.getByRole("button", { name: "Add source resume", exact: true }).click();
    assert.equal(await studio.getByLabel("Source resume", { exact: true }).evaluate(element => document.activeElement === element), true, "next step focuses source evidence");
    assert.equal(await preparation.getByRole("listitem").count(), 5);
    const sourceInput = studio.getByLabel("Import source resume", { exact: true });
    const sourceText = "Test Candidate: Built Python automation with SQL on AWS.";
    await page.waitForFunction(() => document.querySelector('[aria-label="Import source resume"]').disabled === false);
    await sourceInput.setInputFiles({ name: "resume.TXT", mimeType: "text/plain", buffer: Buffer.from(`\uFEFF${sourceText}\r\n`) });
    await expectVisible(page, studio.getByText(/Source resume imported locally\./), "source import confirmation");
    assert.equal(await studio.getByLabel("Source resume", { exact: true }).inputValue(), sourceText);
    await preparation.getByRole("button", { name: "Add job description", exact: true }).click();
    assert.equal(await studio.getByLabel("Job description", { exact: true }).evaluate(element => document.activeElement === element), true, "next step focuses the missing posting");
    for (const [name, contents, message] of [
      ["resume.pdf", "%PDF", "Choose a .txt or .md source resume saved as UTF-8 plain text."],
      ["resume.txt", "invalid\0binary", "Choose a UTF-8 plain text source resume, not a binary document."],
      ["resume.txt", "\uFFFD", "Save the source resume with UTF-8 encoding before importing."],
      ["resume.md", " ", "The source resume file is empty."],
      ["resume.txt", "x".repeat(40001), "Source resumes must contain at most 40,000 characters."],
      ["resume.txt", "x".repeat(160001), "Source resume files must be smaller than 160 KB."],
    ]) {
      await sourceInput.setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from(contents) });
      await expectVisible(page, studio.getByText(message, { exact: name !== "resume.pdf" }), "invalid source rejection");
      assert.equal(await studio.getByLabel("Source resume", { exact: true }).inputValue(), sourceText, "invalid source preserves evidence");
    }
    await studio.getByLabel("Job description", { exact: true }).fill("Python, SQL, AWS and leadership required. React experience preferred.");
    await preparation.getByRole("button", { name: "Prepare tailored draft", exact: true }).click();
    assert.equal(await studio.locator('[tabindex="-1"]').evaluate(element => document.activeElement === element), true, "draft navigation focuses the tailoring panel without invoking GLM");
    await studio.getByLabel("Resume text", { exact: true }).fill("Test Candidate\nEXPERIENCE\nBuilt Python automation with SQL on AWS.\nSKILLS\nPython, SQL, AWS");
    const reviewFacts = studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." });
    await reviewFacts.check();
    const rejectSource = new Promise(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
    await sourceInput.setInputFiles({ name: "resume.md", mimeType: "text/markdown", buffer: Buffer.from("Cancelled replacement") });
    await rejectSource;
    assert.equal(await reviewFacts.isChecked(), true, "cancelled source import preserves review");
    assert.equal(await studio.getByLabel("Source resume", { exact: true }).inputValue(), sourceText);
    const acceptSource = new Promise(resolve => page.once("dialog", async dialog => { await dialog.accept(); resolve(); }));
    await sourceInput.setInputFiles({ name: "resume.md", mimeType: "text/markdown", buffer: Buffer.from(sourceText + "\nSKILLS\nPython, SQL, AWS") });
    await acceptSource;
    await expectVisible(page, studio.getByText(/Source resume imported locally\./), "Markdown source imported");
    assert.equal(await reviewFacts.isChecked(), false, "source import resets factual review");
    assert.ok((await studio.getByLabel("Resume text", { exact: true }).inputValue()).includes("Built Python automation"), "source import preserves existing draft");
    assert.ok((await studio.getByLabel("Job description", { exact: true }).inputValue()).includes("leadership"), "source import preserves posting");
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = function () {
        if (this.name !== "delayed-source.txt") return original.call(this);
        return new Promise(resolve => { window.__releaseSourceRead = () => resolve("Stale imported evidence"); });
      };
    });
    await sourceInput.setInputFiles({ name: "delayed-source.txt", mimeType: "text/plain", buffer: Buffer.from("Stale imported evidence") });
    await studio.getByLabel("Source resume", { exact: true }).fill(sourceText);
    await page.evaluate(() => window.__releaseSourceRead());
    await page.waitForTimeout(50);
    assert.equal(await studio.getByLabel("Source resume", { exact: true }).inputValue(), sourceText, "late file read cannot overwrite newer edits");
    let switchPrompts = 0;
    const rejectSwitch = async dialog => { switchPrompts++; await dialog.dismiss(); };
    page.on("dialog", rejectSwitch);
    await prepareResume.click();
    assert.equal(switchPrompts, 0, "opening the current role retains edits without a discard prompt");
    await prepareDiscoveryResume.click();
    page.off("dialog", rejectSwitch);
    assert.equal(switchPrompts, 1, "switching roles requires confirmation for unsaved edits");
    assert.equal(await targetRole.locator("option:checked").textContent(), "Example Company · Security regression role");
    assert.ok((await studio.getByLabel("Resume text", { exact: true }).inputValue()).includes("Built Python automation"), "cancelled navigation preserves the draft");
    await expectVisible(page, studio.getByText("Review: React", { exact: true }), "missing keyword evidence");
    await studio.getByLabel("Role-specific terms", { exact: true }).fill("patient care\nRN");
    await expectVisible(page, studio.getByText("Review: patient care", { exact: true }), "profession-specific keyword evidence");
    await studio.getByLabel("Role-specific terms", { exact: true }).fill("x".repeat(81));
    await expectVisible(page, studio.getByText("Use up to 40 terms, with no more than 80 characters per line.", { exact: true }), "checklist limit");
    await studio.getByLabel("Role-specific terms", { exact: true }).fill("");
    assert.equal(await studio.getByRole("button", { name: "Download text" }).isEnabled(), false);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".resume-print pre").count(), 0, "browser Print cannot bypass factual review");
    assert.match(await page.locator(".resume-print").innerText(), /review its resume facts/);
    await page.emulateMedia({ media: "screen" });
    assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false);
    await preparation.getByRole("button", { name: "Review resume facts", exact: true }).click();
    assert.equal(await studio.getByLabel("Resume text", { exact: true }).evaluate(element => document.activeElement === element), true, "review navigation focuses the draft rather than approving facts");
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), false);
    const generate = studio.getByRole("button", { name: "Generate GLM draft", exact: true });
    const sharingConsent = studio.getByRole("checkbox", { name: "Send this source resume and posting to Z.AI through my local OpenCode Coding Plan agent." });
    if (productionCsp) {
      assert.equal(await generate.count(), 0, "The hosted bundle must not expose local generation");
      const hostedGenerate = studio.getByRole("button", { name: "Generate hosted GLM draft", exact: true });
      const hostedConsent = studio.getByRole("checkbox", { name: "Share this saved source resume and posting with Z.ai Standard API for this hosted draft." });
      await expectVisible(page, hostedGenerate, "hosted generator without local endpoint");
      assert.equal(await hostedGenerate.isEnabled(), false, "requires a saved revision and consent");
      await studio.getByRole("button", { name: "Save bundle", exact: true }).click();
      await hostedConsent.check();
      assert.equal(await hostedGenerate.isEnabled(), true);
      page.once("dialog", dialog => dialog.accept());
      await hostedGenerate.click();
      await expectVisible(page, studio.getByRole("button", { name: "Generating hosted draft…", exact: true }), "hosted pending state");
      assert.equal(await studio.getByLabel("Source resume", { exact: true }).isEnabled(), false);
      assert.equal(await targetRole.isEnabled(), false);
      await page.evaluate(() => window.__completeHosted());
      await expectVisible(page, studio.getByText("Hosted GLM draft saved. Review changed lines and facts before approving and exporting.", { exact: true }), "hosted saved draft arrival");
      assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false);
      assert.equal(await hostedConsent.isChecked(), false, "fresh consent required for regeneration");
      for (const [reason, text] of [["quota", "Monthly quota exhausted"], ["budget", "shared AI budget is exhausted"], ["unavailable", "Hosted generation is unavailable"]]) {
        await page.evaluate(reason => window.__hostedAvailability(reason), reason);
        await expectVisible(page, studio.getByText(text, { exact: false }), `${reason} availability`);
        assert.equal(await hostedGenerate.isEnabled(), false);
      }
      await page.evaluate(() => window.__hostedAvailability("ready"));
      await hostedConsent.check();
      page.once("dialog", dialog => dialog.accept());
      await hostedGenerate.click();
      await page.evaluate(() => window.__completeHosted("providerTimeout"));
      await expectVisible(page, studio.getByText(/Provider timed out/), "safe timeout recovery");
      await hostedConsent.check();
      page.once("dialog", dialog => dialog.accept());
      await hostedGenerate.click();
      const beforeConflict = await studio.getByLabel("Resume text", { exact: true }).inputValue();
      await page.evaluate(() => window.__completeHosted(undefined, true));
      await expectVisible(page, studio.getByText(/The saved bundle changed. Your editor was retained/), "conflicting save protection");
      assert.equal(await studio.getByLabel("Resume text", { exact: true }).inputValue(), beforeConflict);
      await studio.getByRole("button", { name: "Reload saved bundle", exact: true }).click();
      // Restore the original fictional draft for the shared export assertions.
      await studio.getByLabel("Resume text", { exact: true }).fill(beforeConflict);

    } else {
      await expectVisible(page, generate, "connected local GLM generator");
      assert.equal(await generate.isEnabled(), false, "provider consent required");
      await sharingConsent.check();
      const originalSource = await studio.getByLabel("Source resume", { exact: true }).inputValue();
      await studio.getByLabel("Source resume", { exact: true }).fill(originalSource + "\nAdditional evidence");
      assert.equal(await sharingConsent.isChecked(), false, "new source evidence requires new sharing consent");
      assert.equal(await generate.isEnabled(), false);
      await studio.getByLabel("Source resume", { exact: true }).fill(originalSource);
      assert.equal(await sharingConsent.isChecked(), false, "restoring earlier evidence must not restore old consent");
      await sharingConsent.check();
      const originalPosting = await studio.getByLabel("Job description", { exact: true }).inputValue();
      await studio.getByLabel("Job description", { exact: true }).fill(originalPosting + "\nUpdated requirements");
      assert.equal(await sharingConsent.isChecked(), false, "new posting evidence requires new sharing consent");
      assert.equal(await generate.isEnabled(), false);
      await studio.getByLabel("Job description", { exact: true }).fill(originalPosting);
      await sharingConsent.check();
      let releaseGeneration;
      generationHold = new Promise(resolve => { releaseGeneration = resolve; });
      const acceptedGeneration = new Promise(resolve => page.once("dialog", async dialog => { await dialog.accept(); resolve(); }));
      await generate.click();
      await acceptedGeneration;
      await expectVisible(page, studio.getByRole("button", { name: "Generating GLM draft…", exact: true }), "generation in progress");
      await prepareDiscoveryResume.click();
      assert.equal(await targetRole.locator("option:checked").textContent(), "Example Company · Security regression role", "pipeline navigation cannot switch roles during generation");
      releaseGeneration();
      generationHold = undefined;
      await expectVisible(page, studio.getByText("GLM draft ready. Review changed lines and facts, then save and export your resume.", { exact: true }), "generated draft arrival");
      assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false);
      generationFailure = true;
      const failedGeneration = new Promise(resolve => page.once("dialog", async dialog => { await dialog.accept(); resolve(); }));
      await generate.click();
      await failedGeneration;
      await expectVisible(page, studio.getByText("Test GLM failure. Editor retained.", { exact: true }), "generation failure recovery");
      assert.ok((await studio.getByLabel("Resume text", { exact: true }).inputValue()).includes("Built Python automation"));
    }
    const briefDownload = page.waitForEvent("download");
    await studio.getByRole("button", { name: "Download GLM brief" }).click();
    const brief = await briefDownload;
    assert.equal(brief.suggestedFilename(), "example-company-security-regression-role-glm-brief.txt");
    let briefText = "";
    for await (const chunk of await brief.createReadStream()) briefText += chunk.toString();
    assert.ok(briefText.includes("Never borrow qualifications from the job description"));
    assert.ok(briefText.includes("Test Candidate: Built Python automation"));
    const importInput = studio.getByLabel("Import tailored draft", { exact: true });
    await importInput.setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("invalid\0binary") });
    await expectVisible(page, studio.getByText("Choose a UTF-8 plain text draft, not a binary document.", { exact: true }), "binary draft rejection");
    assert.ok((await studio.getByLabel("Resume text", { exact: true }).inputValue()).includes("Built Python automation"));
    await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).check();
    const cancelledImport = new Promise(resolve => page.once("dialog", async dialog => { await dialog.dismiss(); resolve(); }));
    await importInput.setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("Cancelled replacement") });
    await cancelledImport;
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), true);
    const acceptedImport = new Promise(resolve => page.once("dialog", async dialog => { await dialog.accept(); resolve(); }));
    await importInput.setInputFiles({ name: "draft.txt", mimeType: "text/plain", buffer: Buffer.from("Test Candidate\nEXPERIENCE\nBuilt Python automation with SQL on AWS.\nSKILLS\nPython, SQL, AWS, React") });
    await acceptedImport;
    await expectVisible(page, studio.getByText("Draft imported. Review changed lines against your source resume before exporting.", { exact: true }), "imported draft confirmation");
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), false);
    assert.equal(await studio.getByRole("button", { name: "Download text" }).isEnabled(), false);
    await studio.locator("summary").filter({ hasText: /^Review \d+ changed or added lines/ }).click();
    await expectVisible(page, studio.getByText(/Skills in the draft absent from source wording: React/), "unsupported skill warning");
    await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).check();
    await preparation.getByRole("button", { name: "Save reviewed bundle", exact: true }).click();
    assert.equal(await studio.getByRole("button", { name: "Save bundle", exact: true }).evaluate(element => document.activeElement === element), true, "save navigation focuses the existing save control");
    await studio.getByRole("button", { name: "Save bundle", exact: true }).click();
    await expectVisible(page, studio.getByText(`Saved revision ${productionCsp ? 5 : 1}.`, { exact: true }), "saved bundle revision");
    await expectVisible(page, guide.getByText("4 of 4 steps complete", { exact: true }), "saved first application progress");
    if (process.env.CAREER_OPS_BETA_SCREENSHOT && !productionCsp) {
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: process.env.CAREER_OPS_BETA_SCREENSHOT });
    }
    const roleSearch = page.getByRole("textbox", { name: "Search roles", exact: true });
    await roleSearch.fill("no-matching-role-for-this-beta-test");
    await expectVisible(page, page.getByRole("heading", { name: "No roles match this search." }), "filtered empty pipeline");
    await page.getByRole("button", { name: "Clear search", exact: true }).click();
    assert.equal(await roleSearch.inputValue(), "");
    await expectVisible(page, preparation.getByText("Reviewed and saved. Your resume is ready to export.", { exact: true }), "preparation complete");
    await preparation.getByRole("button", { name: "Export reviewed resume", exact: true }).click();
    assert.equal(await studio.getByRole("button", { name: "Download Word", exact: true }).evaluate(element => document.activeElement === element), true, "export navigation focuses Word without downloading");
    await expectVisible(page, studio.getByRole("button", { name: "Ready to export (1)", exact: true }), "reviewed resume appears in queue");
    await prepareDiscoveryResume.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Source resume"]').disabled === false);
    if (!productionCsp) assert.equal(await sharingConsent.isChecked(), false, "another role cannot inherit sharing permission");
    assert.equal(await studio.getByLabel("Resume text", { exact: true }).inputValue(), "", "another role does not inherit the saved draft");
    await prepareResume.click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Resume text"]').value.includes("Built Python automation"));
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), true, "pipeline navigation restores saved review state");
    await studio.getByLabel("Resume target role", { exact: true }).selectOption("");
    await studio.getByRole("button", { name: "Open for export for Example Company · Security regression role", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="Resume text"]')?.value?.includes("Built Python automation"));
    assert.ok((await studio.getByLabel("Resume text", { exact: true }).inputValue()).includes("Built Python automation"));
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), true);
    const savedSource = await studio.getByLabel("Source resume", { exact: true }).inputValue();
    const originalTarget = await studio.getByLabel("Resume target role", { exact: true }).inputValue();
    await discoveredTarget.selectOption({ label: "Example Discovery Co. · Review target role" });
    await studio.getByLabel("Reuse saved source resume", { exact: true }).selectOption(originalTarget);
    assert.equal(await studio.getByLabel("Source resume", { exact: true }).inputValue(), savedSource);
    assert.equal(await studio.getByLabel("Resume text", { exact: true }).inputValue(), "");
    assert.equal(await studio.getByLabel("Job description", { exact: true }).inputValue(), "SQL and AWS required.\nBuild reliable reporting.");
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), false);
    assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false);
    page.once("dialog", dialog => dialog.accept());
    await discoveredTarget.selectOption(originalTarget);
    const downloadReady = page.waitForEvent("download");
    await studio.getByRole("button", { name: "Download text" }).click();
    const download = await downloadReady;
    assert.equal(download.suggestedFilename(), "example-company-security-regression-role.txt");
    const stream = await download.createReadStream();
    let downloaded = "";
    for await (const chunk of stream) downloaded += chunk.toString();
    assert.ok(downloaded.includes("Built Python automation with SQL on AWS."));
    const wordReady = page.waitForEvent("download");
    await studio.getByRole("button", { name: "Download Word" }).click();
    const word = await wordReady;
    assert.equal(word.suggestedFilename(), "example-company-security-regression-role.docx");
    const wordChunks = [];
    for await (const chunk of await word.createReadStream()) wordChunks.push(chunk);
    const wordZip = await JSZip.loadAsync(Buffer.concat(wordChunks));
    const wordXml = await wordZip.file("word/document.xml").async("string");
    assert.ok(wordXml.includes("Built Python automation with SQL on AWS."));
    assert.ok(!wordXml.includes("<w:tbl"));
    await expectVisible(page, studio.getByText("Word document downloaded. Use the file format requested by the employer.", { exact: true }), "Word export confirmation");
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".resume-print").isVisible(), true);
    assert.equal(await page.locator(".resume-print pre").innerText(), downloaded.trim(), "PDF wording matches the reviewed text export");
    assert.equal(await page.locator(".sidebar").isVisible(), false);
    assert.equal(await page.locator(".topbar").isVisible(), false);
    assert.equal(await studio.locator("fieldset").isVisible(), false, "PDF excludes source evidence, posting, controls, and queue");
    const pdf = await page.pdf({ preferCSSPageSize: true, displayHeaderFooter: false });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-", "Chromium renders a real PDF from the reviewed print layout");
    await page.emulateMedia({ media: "screen" });
    await studio.getByLabel("Resume text", { exact: true }).fill("Updated draft");
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), false);
    assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false);
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator(".resume-print pre").count(), 0, "editing invalidates browser Print as well as download buttons");
    assert.ok(!(await page.locator(".resume-print").innerText()).includes("Updated draft"));
    await page.emulateMedia({ media: "screen" });
    await expectVisible(page, preparation.getByText("Next: Review resume facts.", { exact: true }), "editing resets the preparation checklist");

    // Switching away from an unsaved edit must ask before losing it.
    page.once("dialog", dialog => dialog.dismiss());
    await studio.getByLabel("Resume target role", { exact: true }).selectOption("");
    assert.equal(await studio.getByLabel("Resume text", { exact: true }).inputValue(), "Updated draft");
    await studio.getByRole("button", { name: "Save bundle", exact: true }).click();
    await expectVisible(page, studio.getByText(`Saved revision ${productionCsp ? 6 : 2}.`, { exact: true }), "updated unreviewed bundle");

    await expectVisible(page, studio.getByRole("button", { name: "Ready to export (0)", exact: true }), "editing clears queue readiness after saving");
    await studio.getByRole("button", { name: "Needs review (1)", exact: true }).click();
    await expectVisible(page, studio.getByRole("button", { name: "Review draft for Example Company · Security regression role", exact: true }), "unreviewed draft in queue");

    const status = page.getByLabel("Update status for Security regression role");
    await status.selectOption("applied");
    await page.waitForFunction((select) => select instanceof HTMLSelectElement && select.value === "applied", await status.elementHandle());

    await expectVisible(page, studio.getByRole("button", { name: "Needs review (0)", exact: true }), "applied role leaves preparation queue");
    if (productionCsp) {
      await studio.getByRole("checkbox", { name: "Share this saved source resume and posting with Z.ai Standard API for this hosted draft." }).check();
      page.once("dialog", dialog => dialog.accept());
      await studio.getByRole("button", { name: "Generate hosted GLM draft", exact: true }).click();
    }
    await page.getByRole("button", { name: "Sign out" }).click();
    if (productionCsp) await page.evaluate(() => window.__completeHosted("providerTimeout"));
    await expectVisible(page, page.getByRole("heading", { name: "Welcome back." }), "signed-out screen");
    await page.getByLabel("Email").fill("security-flow@example.test");
    await page.getByLabel("Password", { exact: true }).fill("SecurityFlow123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expectVisible(page, page.locator("h1").filter({ hasText: "Pipeline" }), "signed-in dashboard");
    assert.equal(await page.locator("#resume-studio").getByLabel("Resume text", { exact: true }).inputValue(), "");
    await expectVisible(page, page.getByText("Security regression role", { exact: true }), "persisted role");
    await studio.getByLabel("Resume target role", { exact: true }).selectOption({ label: "Example Company · Security regression role" });
    assert.equal(await studio.getByLabel("Resume text", { exact: true }).inputValue(), "Updated draft");
    assert.equal(await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).isChecked(), false);
    assert.equal(await studio.getByRole("button", { name: "Download text" }).isEnabled(), false);
    page.once("dialog", dialog => dialog.accept());
    await studio.getByRole("button", { name: "Delete saved bundle" }).click();
    await expectVisible(page, studio.getByText("Saved bundle deleted. Editor text remains unsaved."), "deleted saved bundle");
    page.once("dialog", dialog => dialog.accept());
    await prepareDiscoveryResume.click();
    assert.equal(await targetRole.locator("option:checked").textContent(), "Example Discovery Co. · Review target role", "confirmed navigation switches roles");
    await studio.getByLabel("Source resume", { exact: true }).fill("Factual SQL source");
    await studio.getByLabel("Job description", { exact: true }).fill("My corrected posting requirements");
    await studio.getByLabel("Resume text", { exact: true }).fill("SQL experience");
    await studio.getByRole("button", { name: "Save bundle", exact: true }).click();
    await expectVisible(page, studio.getByText("Saved revision 1.", { exact: true }), "saved corrected discovery posting");
    await prepareResume.click();
    await prepareDiscoveryResume.click();
    // Selection clears the editor until the saved-bundle effect finishes.
    await page.waitForFunction(element => element instanceof HTMLTextAreaElement && !element.disabled,
      await studio.getByLabel("Job description", { exact: true }).elementHandle());
    assert.equal(await studio.getByLabel("Job description", { exact: true }).inputValue(), "My corrected posting requirements", "saved description takes priority over captured posting");
    await prepareResume.click();
    assert.equal(await studio.getByLabel("Resume text", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("Update status for Security regression role").inputValue(), "applied", "updated role status did not persist after sign-in");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Beta help", exact: true }).click();
    await expectVisible(page, page.getByRole("dialog", { name: "A quick guide to Meritwake" }), "mobile beta help");
    await page.keyboard.press("Escape");
    await expectVisible(page, page.locator("#discovery-settings"), "mobile Target Profile editor");
    const mobileWidth = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth, outside: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > innerWidth + 1 && !element.closest(".table-wrap")).slice(0, 20).map((element) => `${element.tagName}.${element.className} ${Math.round(element.getBoundingClientRect().right)}`) }));
    assert.equal(mobileWidth.page <= mobileWidth.viewport, true, `mobile dashboard has horizontal overflow: ${JSON.stringify(mobileWidth)}`);
    assert.deepEqual(pageErrors, [], "The workflow must have no browser runtime errors");
    if (productionCsp) {
      assert.deepEqual(await page.evaluate(() => window.__cspViolations), [], "The workflow must have no CSP violations");
      // Prove enforcement rather than merely checking the header is present.
      let offOriginRequests = 0;
      await page.route("https://csp-probe.invalid/**", route => { offOriginRequests++; return route.abort(); });
      assert.equal(await page.evaluate(async () => {
        try { await fetch("https://csp-probe.invalid/blocked"); return false; } catch { return true; }
      }), true, "Unapproved connections must be refused");
      await page.waitForFunction(() => window.__cspViolations.some(value => value.startsWith("connect-src:")));
      assert.equal(offOriginRequests, 0, "CSP must block an unapproved connection before it reaches the network");
    }
    console.log(`Isolated browser flow passed${productionCsp ? " with compiled assets and enforced production CSP" : ""}`);
  } finally {
    await context?.close();
    await browser?.close();
    if (productionCsp) {
      await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
    } else {
      await server.close();
    }
    if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
