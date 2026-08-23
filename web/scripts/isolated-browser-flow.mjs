import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

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
  const server = await createServer({
    configFile: viteConfig,
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const baseUrl = server.resolvedUrls?.local.find((url) => url.startsWith("http://127.0.0.1"));
  if (!baseUrl) failure("local test server did not expose a loopback URL");
  let browser;
  let context;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", async (route) => {
      await route.fulfill({
        contentType: "application/javascript",
        body: `window.turnstile={render:(_element,options)=>{setTimeout(()=>options.callback("isolated-browser-token"),0);return "isolated-widget";},remove:()=>{},reset:()=>{}};`,
      });
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Create an account" }).click({ force: true });
    await page.getByLabel("Email").fill("security-flow@example.test");
    await page.getByLabel("Password", { exact: true }).fill("SecurityFlow123");
    await page.getByLabel("Confirm password").fill("SecurityFlow123");
    await page.getByLabel("Alpha invite code").fill("isolated-invite");
    const createAccount = page.getByRole("button", { name: "Create account" });
    await createAccount.waitFor({ state: "visible" });
    await createAccount.waitFor({ state: "attached" });
    await page.waitForFunction((button) => !(button instanceof HTMLButtonElement) || !button.disabled, await createAccount.elementHandle());
    await createAccount.click();

    await expectVisible(page, page.getByRole("heading", { name: "Verify your email." }), "verification screen");
    await page.getByRole("button", { name: "Resend verification link" }).first().click();
    await expectVisible(page, page.getByRole("heading", { name: "Review the alpha privacy notice." }), "privacy acknowledgement");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Acknowledge and continue" }).click();
    await expectVisible(page, page.locator("h1").filter({ hasText: "Pipeline" }), "pipeline dashboard");

    await expectVisible(page, page.getByRole("heading", { name: "Discovery review queue" }), "discovery review queue");
    await expectVisible(page, page.getByText("Review target role", { exact: true }), "projected discovery role");
    await expectVisible(page, page.getByText("Mock Board", { exact: true }), "projected source");
    await expectVisible(page, page.getByText("84", { exact: true }), "projected score");
    await expectVisible(page, page.getByText(/Fresh · checked/), "projected freshness");
    await expectVisible(page, page.getByText("Work Authorization Required", { exact: true }), "projected hard-filter reason");
    await expectVisible(page, page.getByText("Salary Unknown", { exact: true }), "projected unknown");
    await expectVisible(page, page.getByText("Draft Awaiting Review · report, PDF, checklist", { exact: true }), "read-only material status");
    await page.getByRole("button", { name: "Shortlist" }).click();
    await expectVisible(page, page.getByText("Shortlisted for evaluation review", { exact: true }), "shortlisted next action");
    await page.getByRole("button", { name: "Override decision" }).click();
    await expectVisible(page, page.getByRole("heading", { name: "Override discovery decision" }), "decision override dialog");
    await page.getByLabel("New decision").selectOption("ranked");
    await page.getByLabel("Override reason").fill("Relevant portfolio evidence changes this assessment.");
    await page.getByRole("button", { name: "Save override" }).click();
    await expectVisible(page, page.getByText("Ranked", { exact: true }), "overridden decision");
    await page.getByRole("button", { name: "Approve for evaluation" }).click();
    await expectVisible(page, page.getByText("Ready for evaluation", { exact: true }), "evaluation approval");
    await page.getByRole("button", { name: "Archive" }).click();
    await expectVisible(page, page.getByText("Archived — no further action", { exact: true }), "archived discovery role");

    await page.getByRole("button", { name: "Add role" }).click();
    await page.getByLabel("Company").fill("Example Company");
    await page.getByLabel("Role title").fill("Security regression role");
    await page.getByLabel("Location").fill("Remote");
    await page.getByLabel("Source").fill("Isolated browser test");
    await page.getByLabel("Application URL").fill("https://example.test/roles/security-regression");
    await page.getByRole("button", { name: "Save role" }).click();
    await expectVisible(page, page.getByText("Security regression role", { exact: true }), "created role");

    const status = page.getByLabel("Update status for Security regression role");
    await status.selectOption("applied");
    await page.waitForFunction((select) => select instanceof HTMLSelectElement && select.value === "applied", await status.elementHandle());

    await page.getByRole("button", { name: "Sign out" }).click();
    await expectVisible(page, page.getByRole("heading", { name: "Welcome back." }), "signed-out screen");
    await page.getByLabel("Email").fill("security-flow@example.test");
    await page.getByLabel("Password", { exact: true }).fill("SecurityFlow123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expectVisible(page, page.locator("h1").filter({ hasText: "Pipeline" }), "signed-in dashboard");
    await expectVisible(page, page.getByText("Security regression role", { exact: true }), "persisted role");
    assert.equal(await page.getByLabel("Update status for Security regression role").inputValue(), "applied", "updated role status did not persist after sign-in");
    console.log("Isolated browser flow passed");
  } finally {
    await context?.close();
    await browser?.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
