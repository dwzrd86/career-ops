import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
