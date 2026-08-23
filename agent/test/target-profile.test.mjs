import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  TargetProfileValidationError,
  emptyTargetProfile,
  loadTargetProfile,
  saveTargetProfile,
  validateTargetProfile,
} from "../store/target-profile.mjs";

function validProfile() {
  const profile = emptyTargetProfile();
  profile.targetRoles = [{ title: "Cloud Security Architect", aliases: ["Security Architect"], priority: "primary", seniority: ["Principal"] }];
  profile.location.allowedRegions = ["United States"];
  profile.eligibility.workAuthorization = ["United States work authorized"];
  profile.criteria.mustHave = ["Security architecture ownership"];
  profile.evidenceReferences = [{ kind: "resume", localPath: "cv.md", label: "Primary resume", updatedAt: null }];
  return profile;
}

test("validates and persists a versioned Target Profile with private file permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "career-ops-profile-"));
  const profilePath = join(directory, "target-profile.yml");
  const saved = saveTargetProfile(validProfile(), profilePath);

  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.profileVersion, 1);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(readFileSync(profilePath, "utf8"), /Cloud Security Architect/);
  assert.equal(statSync(profilePath).mode & 0o777, 0o600);
  assert.deepEqual(loadTargetProfile(profilePath), saved);
});

test("rejects a profile without a target role or with invalid discovery controls", () => {
  const profile = validProfile();
  profile.targetRoles = [];
  profile.discovery.maxPerRun = 501;
  const errors = validateTargetProfile(profile);
  assert.ok(errors.some((error) => error.includes("targetRoles")));
  assert.ok(errors.some((error) => error.includes("maxPerRun")));
  assert.throws(() => saveTargetProfile(profile, join(tmpdir(), "invalid-target-profile.yml")), TargetProfileValidationError);
});

test("requires a dedicated context and source allowlist when Interceptor is enabled", () => {
  const profile = validProfile();
  profile.discovery.sources.push("interceptor");
  let errors = validateTargetProfile(profile);
  assert.ok(errors.some((error) => error.includes("contextId is required")));
  assert.ok(errors.some((error) => error.includes("allowedSources is required")));

  profile.discovery.interceptor = {
    contextId: "jobbie-discovery-2026",
    allowedSources: ["https://careers.example.test/jobs"],
  };
  errors = validateTargetProfile(profile);
  assert.deepEqual(errors, []);
});

test("profile show emits only metadata, never profile form values or local evidence paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "career-ops-profile-output-"));
  const profilePath = join(directory, "target-profile.yml");
  const profile = validProfile();
  profile.criteria.notes = "Private narrative never belongs in command output";
  profile.evidenceReferences[0].localPath = "private/resume.pdf";
  saveTargetProfile(profile, profilePath);

  const result = spawnSync(process.execPath, ["agent/commands/profile.mjs", "show"], {
    cwd: resolve("."),
    encoding: "utf8",
    env: { ...process.env, CAREER_OPS_TARGET_PROFILE: profilePath },
  });

  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(summary).sort(), ["discovery", "profileVersion", "schemaVersion", "targetRoleCount", "updatedAt"]);
  assert.equal(summary.targetRoleCount, 1);
  assert.doesNotMatch(result.stdout, /Private narrative|private\/resume\.pdf|Cloud Security Architect/);
});

test("rejects compensation targets below the salary floor", () => {
  const profile = validProfile();
  profile.compensation.floor = 200000;
  profile.compensation.target = 180000;
  assert.ok(validateTargetProfile(profile).some((error) => error.includes("target must not be lower")));
});

test("rejects stale profile saves instead of overwriting a newer profile", () => {
  const directory = mkdtempSync(join(tmpdir(), "career-ops-profile-stale-"));
  const profilePath = join(directory, "target-profile.yml");
  const saved = saveTargetProfile(validProfile(), profilePath);
  assert.throws(() => saveTargetProfile({ ...saved, profileVersion: 0 }, profilePath), TargetProfileValidationError);
});
