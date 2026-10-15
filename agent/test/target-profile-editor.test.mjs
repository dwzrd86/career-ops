import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { emptyTargetProfile, loadTargetProfile, saveTargetProfile } from "../store/target-profile.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function startEditor(profilePath) {
  const child = spawn(process.execPath, ["agent/commands/profile.mjs", "edit"], {
    cwd: repositoryRoot,
    env: { ...process.env, CAREER_OPS_TARGET_PROFILE: profilePath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  return {
    child,
    async url() {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const match = output.match(/Target Profile editor: (http:\/\/127\.0\.0\.1:\d+\/#token=[^\s]+)/);
        if (match) return match[1];
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
      }
      throw new Error(`Target Profile editor did not start: ${output}`);
    },
  };
}

async function stopEditor(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGINT");
  await Promise.race([once(child, "exit"), new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))]);
}

function launchBrowser() {
  const bundled = chromium.executablePath();
  return chromium.launch({ headless: true, executablePath: existsSync(bundled) ? bundled : "/usr/bin/google-chrome" });
}

test("loopback Target Profile editor saves a validated local profile", async () => {
  const directory = mkdtempSync(join(tmpdir(), "career-ops-editor-test-"));
  const profilePath = join(directory, "target-profile.yml");
  const editor = startEditor(profilePath);
  let browser;
  let context;

  try {
    browser = await launchBrowser();
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(await editor.url());
    await page.locator('textarea[name="roles"]').fill("Cloud Security Architect");
    await page.locator('textarea[name="seniority"]').fill("Principal");
    await page.locator('textarea[name="allowedRegions"]').fill("United States");
    await page.locator('textarea[name="preferredRegions"]').fill("Nashville\nDallas\nColorado");
    await page.locator('textarea[name="dreamIndustries"]').fill("sports\nentertainment");
    await page.locator('textarea[name="dreamRegions"]').fill("London\nBarcelona");
    await page.locator('input[name="dreamAnyRegion"]').check();
    await page.locator('input[name="floor"]').fill("150000");
    await page.locator('input[name="maxTravelPercent"]').fill("50");
    await page.locator('input[name="maxOfficeDaysPerWeek"]').fill("4");
    await page.locator('textarea[name="workAuthorization"]').fill("United States work authorized");
    await page.locator('textarea[name="mustHave"]').fill("Security architecture ownership");
    await page.locator('textarea[name="evidenceReferences"]').fill("resume|cv.md|Primary resume");
    await page.getByRole("button", { name: "Save Target Profile" }).click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Saved at"));

    const profile = loadTargetProfile(profilePath);
    assert.equal(profile.targetRoles[0].title, "Cloud Security Architect");
    assert.deepEqual(profile.location.allowedRegions, ["United States"]);
    assert.deepEqual(profile.location.preferredRegions, ["Nashville", "Dallas", "Colorado"]);
    assert.deepEqual(profile.preferences.dreamIndustries, ["sports", "entertainment"]);
    assert.deepEqual(profile.location.dreamRegions, ["London", "Barcelona"]);
    assert.equal(profile.location.dreamAnyRegion, true);
    assert.equal(profile.compensation.floor, 150000);
    assert.equal(profile.criteria.maxTravelPercent, 50);
    assert.equal(profile.criteria.maxOfficeDaysPerWeek, 4);
    assert.deepEqual(profile.discovery.sources, ["greenhouse", "ashby", "lever"]);
  } finally {
    await context?.close();
    await browser?.close();
    await stopEditor(editor.child);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("editor preserves role aliases, priorities, seniority, and evidence timestamps on an unchanged save", async () => {
  const directory = mkdtempSync(join(tmpdir(), "career-ops-editor-preserve-"));
  const profilePath = join(directory, "target-profile.yml");
  const profile = emptyTargetProfile();
  profile.targetRoles = [
    { title: "Security Architect", aliases: ["Cloud Security Architect"], priority: "primary", seniority: ["Principal"] },
    { title: "Field CISO", aliases: [], priority: "adjacent", seniority: ["Director"] },
  ];
  profile.evidenceReferences = [{ kind: "resume", localPath: "cv.md", label: "Resume", updatedAt: "2026-10-01T12:00:00.000Z" }];
  saveTargetProfile(profile, profilePath);
  const editor = startEditor(profilePath);
  let browser;
  let context;
  try {
    browser = await launchBrowser();
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(await editor.url());
    await page.getByRole("button", { name: "Save Target Profile" }).click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Saved at"));
    const saved = loadTargetProfile(profilePath);
    assert.deepEqual(saved.targetRoles, profile.targetRoles);
    assert.deepEqual(saved.evidenceReferences, profile.evidenceReferences);
  } finally {
    await context?.close();
    await browser?.close();
    await stopEditor(editor.child);
    rmSync(directory, { recursive: true, force: true });
  }
});
