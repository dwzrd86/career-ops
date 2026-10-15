import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { createCollectors } from "../collectors/approved-adapter.mjs";
import { detectApi } from "../../scan.mjs";
import { listDiscoveredJobs, listMatchDecisions } from "../store/discovered-jobs.mjs";
import { emptyTargetProfile } from "../store/target-profile.mjs";

test("approved ATS collector stores profile matches once and records a review decision", async () => {
  mkdirSync(resolve("data"), { recursive: true });
  const directory = mkdtempSync(resolve("data/approved-adapter-test-"));
  try {
    const portalsPath = join(directory, "portals.yml");
    writeFileSync(portalsPath, `tracked_companies:\n  - name: Acme\n    enabled: true\n    api: https://boards-api.greenhouse.io/v1/boards/acme/jobs\n`);
    const profile = emptyTargetProfile();
    profile.profileVersion = 1;
    profile.targetRoles = [{ title: "Principal Security Architect", aliases: [], priority: "primary", seniority: ["Principal"] }];
    profile.location.allowedRegions = ["United States"];
    const fetchFeed = async () => ({ jobs: [
      { id: 12, title: "Principal Security Architect", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/12", location: { name: "Remote - United States" } },
      { id: 13, title: "Account Executive", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/13", location: { name: "Remote - United States" } },
      { id: 14, title: "Senior Manager, Enterprise Security", absolute_url: "https://job-boards.greenhouse.io/acme/jobs/14", location: { name: "Remote - United States" } },
    ] });
    const collectors = createCollectors({ profile, rootPath: directory, portalsPath, fetchFeed });
    const request = { sourceId: "greenhouse", profileVersion: 1, maxResults: 10 };
    assert.deepEqual(await collectors.greenhouse(request), { status: "succeeded", resultCount: 2 });
    assert.deepEqual(await collectors.greenhouse(request), { status: "succeeded", resultCount: 0 });
    assert.equal(listDiscoveredJobs(directory).length, 2);
    assert.equal(listMatchDecisions(directory).length, 2);
    assert.ok(listMatchDecisions(directory).every((decision) => decision.outcome === "needs-review"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("explicit Ashby API feed is recognized", () => {
  assert.deepEqual(detectApi({ api: "https://api.ashbyhq.com/posting-api/job-board/vanta?includeCompensation=true" }), {
    type: "ashby",
    url: "https://api.ashbyhq.com/posting-api/job-board/vanta?includeCompensation=true",
  });
});
