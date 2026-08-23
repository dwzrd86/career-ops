import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";
import { loadTargetProfile } from "../store/target-profile.mjs";

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

test("loopback Target Profile editor saves a validated local profile", async () => {
  const directory = mkdtempSync(join(repositoryRoot, "agent/.local/editor-test-"));
  const profilePath = join(directory, "target-profile.yml");
  const editor = startEditor(profilePath);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(await editor.url());
    await page.locator('textarea[name="roles"]').fill("Cloud Security Architect");
    await page.locator('textarea[name="seniority"]').fill("Principal");
    await page.locator('textarea[name="allowedRegions"]').fill("United States");
    await page.locator('textarea[name="workAuthorization"]').fill("United States work authorized");
    await page.locator('textarea[name="mustHave"]').fill("Security architecture ownership");
    await page.locator('textarea[name="evidenceReferences"]').fill("resume|cv.md|Primary resume");
    await page.getByRole("button", { name: "Save Target Profile" }).click();
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.startsWith("Saved at"));

    const profile = loadTargetProfile(profilePath);
    assert.equal(profile.targetRoles[0].title, "Cloud Security Architect");
    assert.deepEqual(profile.location.allowedRegions, ["United States"]);
    assert.deepEqual(profile.discovery.sources, ["greenhouse", "ashby", "lever"]);
  } finally {
    await browser.close();
    await stopEditor(editor.child);
  }
});
