import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import JSZip from "jszip";
import { resumeMiddleware } from "./local-resume-bridge.mjs";

// Explicit opt-in: this check makes one real provider request with synthetic data.
// Account persistence is isolated; the component, HTTP bridge and runner are real.
let stage = "configuration (requires --send-to-glm and CAREER_OPS_GLM_MODEL)";
async function main() {
  const model = process.env.CAREER_OPS_GLM_MODEL;
  assert.ok(process.argv.includes("--send-to-glm"), "Add --send-to-glm to permit one synthetic provider request.");
  assert.match(model ?? "", /^zai-coding-plan\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/, "Set CAREER_OPS_GLM_MODEL to a Coding Plan model.");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = await createServer({
    configFile: fileURLToPath(new URL("./browser-flow.vite.config.mjs", import.meta.url)),
    plugins: [{ name: "synthetic-live-resume-bridge", configureServer(server) {
      server.middlewares.use(resumeMiddleware({ root, model }));
    } }],
    server: { host: "127.0.0.1", port: 0 },
  });
  let browser, context;
  try {
    stage = "local server and browser startup";
    await server.listen();
    const origin = server.resolvedUrls?.local.find(url => url.startsWith("http://127.0.0.1"));
    assert.ok(origin, "Expected a loopback server");
    browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
    context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", () => pageErrors.push("Browser runtime error"));
    // Keep this check independent of hosted accounts and third-party scripts.
    await page.route("**/*", route => new URL(route.request().url()).origin === new URL(origin).origin
      ? route.continue() : route.abort());
    await page.goto(new URL("live-resume.html", origin).href);
    stage = "Resume Studio setup and consent";
    const studio = page.locator("#resume-studio");
    await studio.getByLabel("Resume target role", { exact: true }).selectOption({ label: "Fictional Analytics · SQL Analyst" });
    await studio.getByLabel("Source resume", { exact: true }).fill("Test Candidate\nEXPERIENCE\nSQL Analyst, Fictional Data Co, 2022-2024\nBuilt SQL reports and Excel dashboards.\nSKILLS\nSQL, Excel");
    await studio.getByLabel("Job description", { exact: true }).fill("SQL Analyst at Fictional Analytics. Build SQL reports and Excel dashboards. Python preferred.");
    const generate = studio.getByRole("button", { name: "Generate GLM draft", exact: true });
    await generate.waitFor();
    assert.equal(await generate.isEnabled(), false, "Consent must gate generation");
    await studio.getByRole("checkbox", { name: "Send this source resume and posting to Z.AI through my local OpenCode Coding Plan agent." }).check();
    console.log("Starting one synthetic Resume Studio request through the real local bridge.");
    stage = "live GLM generation";
    const responseReady = page.waitForResponse(response => response.url().endsWith("/__career_ops/resume") && response.request().method() === "POST", { timeout: 200_000 });
    await generate.click();
    const response = await responseReady;
    const result = await response.json();
    if (!response.ok()) {
      const safeCodes = new Set(["authentication", "quota", "timeout", "incomplete", "unavailable", "failed"]);
      console.error(`Local bridge returned HTTP ${response.status()}, code ${safeCodes.has(result.code) ? result.code : "unknown"}.`);
    }
    assert.equal(response.status(), 200, `Live bridge failed (${result.code ?? "unknown"})`);
    stage = "generated draft checks";
    await studio.getByText("GLM draft ready. Review changed lines and facts, then save and export your resume.", { exact: true }).waitFor();
    const draft = await studio.getByLabel("Resume text", { exact: true }).inputValue();
    assert.equal(draft, result.draft.trim(), "The editor must contain the real bridge result");
    assert.match(draft, /Test Candidate/);
    assert.match(draft, /SQL/);
    assert.doesNotMatch(draft, /Python/i, "The unsupported preferred skill must not become a claim");
    assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false);
    stage = "review and exact text/Word exports";
    await studio.getByRole("checkbox", { name: "I reviewed the facts, contact details, and relevance for this role." }).check();
    const textReady = page.waitForEvent("download");
    await studio.getByRole("button", { name: "Download text", exact: true }).click();
    const text = await textReady;
    const chunks = [];
    for await (const chunk of await text.createReadStream()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString("utf8"), draft + "\n");
    const wordReady = page.waitForEvent("download");
    await studio.getByRole("button", { name: "Download Word", exact: true }).click();
    const word = await wordReady;
    const wordChunks = [];
    for await (const chunk of await word.createReadStream()) wordChunks.push(chunk);
    const zip = await JSZip.loadAsync(Buffer.concat(wordChunks));
    const xml = await zip.file("word/document.xml").async("string");
    const exported = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      return [...doc.getElementsByTagName("w:p")].map(p => [...p.getElementsByTagName("w:t")].map(t => t.textContent).join("")).join("\n");
    }, xml);
    assert.equal(exported, draft, "Word export must preserve the generated wording");
    assert.ok(!xml.includes("<w:tbl"), "Word export must use a single column");
    await studio.getByLabel("Resume text", { exact: true }).fill(draft + "\nEdited");
    assert.equal(await studio.getByRole("button", { name: "Download Word" }).isEnabled(), false, "Edits must reset review");
    assert.deepEqual(pageErrors, []);
    console.log(`Live Resume Studio flow passed: ${model}, ${draft.length} characters, exact text/Word exports and review gates verified. Account persistence was mocked.`);
  } finally {
    await context?.close();
    await browser?.close();
    await server.close();
  }
}

main().catch(() => {
  // Keep generated evidence and provider diagnostics out of terminal logs.
  console.error(`Live Resume Studio check failed during ${stage}. No draft content or provider diagnostics were logged.`);
  process.exitCode = 1;
});
