import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { evaluateCandidate, isRelevantTitle, parseFeed, ATS_SOURCES } from "./atsSources";
import { reservationEmailHash } from "./enrollmentCore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const createDeployment = () => {
  const deployment = convexTest(schema, modules);
  betterAuthTest.register(deployment);
  return deployment;
};

async function account(deployment: ReturnType<typeof createDeployment>, label: string) {
  const now = Date.now();
  const email = `${label}@auto-discovery-test.example`;
  await deployment.run(async (ctx) => {
    await ctx.db.insert("alphaInvites", {
      createdAt: now, expiresAt: now + 60_000,
      reservationEmailHash: await reservationEmailHash(email),
      reservationExpiresAt: now + 60_000, reservationId: `reservation-${label}`,
      tokenHash: `invite-${label}`,
    });
  });
  const authUser = await deployment.run(async (ctx) => await ctx.runMutation(components.betterAuth.adapter.create, {
    input: { data: { createdAt: now, email, emailVerified: true, name: label, updatedAt: now }, model: "user" },
  })) as { _id: string };
  await deployment.mutation(internal.auth.onCreate, { doc: authUser, model: "user" });
  const session = await deployment.run(async (ctx) => await ctx.runMutation(components.betterAuth.adapter.create, {
    input: { data: { createdAt: now, expiresAt: now + 60_000, token: `session-${label}`, updatedAt: now, userId: authUser._id }, model: "session" },
  })) as { _id: string };
  return deployment.withIdentity({ sessionId: session._id, subject: authUser._id } as any);
}

const profile = {
  targetRoles: [{ title: "Security Architect", aliases: ["Cybersecurity Architect"], seniority: ["Senior"] }],
  home: "Nashville", radiusMiles: 50,
  workplaceModes: ["remote", "hybrid"] as Array<"remote" | "hybrid" | "onsite">,
  allowedRegions: ["United States"], preferredRegions: ["Dallas", "Colorado"], dreamRegions: ["London"],
  dreamIndustries: ["sports"], excludedCompanies: [], excludedIndustries: [],
  frameworks: ["NIST"], cloudPlatforms: ["AWS"], salaryFloor: 150_000, currency: "USD",
  workAuthorization: ["US citizen"], clearanceLevels: [], maxTravelPercent: 50, maxOfficeDaysPerWeek: 4,
  sources: ["greenhouse", "ashby"] as Array<"greenhouse" | "ashby" | "lever">,
  schedule: "daily" as const, enabled: true,
};

describe("web auto discovery", () => {
  test("requires an enrolled, privacy-acknowledged owner and isolates profiles", async () => {
    const deployment = createDeployment();
    const alice = await account(deployment, "alice");
    const bob = await account(deployment, "bob");
    await expect(deployment.query(api.targetProfile.get, {})).rejects.toThrow("Authentication required");
    await expect(alice.mutation(api.targetProfile.save, { profile })).rejects.toThrow();
    await alice.mutation(api.privacy.acknowledge, {});
    await bob.mutation(api.privacy.acknowledge, {});
    await expect(alice.mutation(api.targetProfile.save, { profile })).resolves.toBe(1);
    await expect(alice.query(api.targetProfile.get, {})).resolves.toMatchObject({ targetRoles: profile.targetRoles, profileVersion: 1 });
    await expect(bob.query(api.targetProfile.get, {})).resolves.toBeNull();
    await expect(bob.query(api.autoDiscovery.listRuns, {})).resolves.toEqual([]);
  });

  test("enabled profiles need a hosted catalog source while manual professions remain valid", async () => {
    const deployment = createDeployment();
    const alice = await account(deployment, "source-validation");
    await alice.mutation(api.privacy.acknowledge, {});
    await expect(alice.mutation(api.targetProfile.save, { profile: { ...profile, sources: ["lever"] } }))
      .rejects.toThrow("Hosted discovery supports Greenhouse and Ashby");
    await expect(alice.mutation(api.targetProfile.save, { profile: { ...profile, targetRoles: [{ title: "Registered Nurse", aliases: [], seniority: [] }], enabled: false, sources: ["lever"] } }))
      .resolves.toBe(1);
  });

  test("manual scan queues once and ingestion deduplicates while preserving review state", async () => {
    const deployment = createDeployment();
    const alice = await account(deployment, "scan-owner");
    await alice.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.targetProfile.save, { profile });
    const runId = await alice.mutation(api.autoDiscovery.requestScan, {});
    expect(await alice.mutation(api.autoDiscovery.requestScan, {})).toBe(runId);
    expect(await alice.query(api.autoDiscovery.listRuns, {})).toHaveLength(1);
    expect(JSON.stringify(await alice.query(api.autoDiscovery.listRuns, {}))).not.toContain("ownerId");
    expect(await deployment.mutation(internal.autoDiscovery.claimRun, { runId })).toMatchObject({ profileVersion: 1 });
    const jobs = [{
      localJobId: "greenhouse-sample", company: "Example", title: "Security Architect",
      location: "Remote - United States", url: "https://jobs.example.test/123",
      source: { label: "greenhouse: Example", provider: "greenhouse" as const },
      decision: { outcome: "needsReview" as const, score: 70, hardFilters: [{ ruleId: "SALARY_FLOOR", outcome: "unknown" as const, reasonCode: "SALARY_UNKNOWN" }], explanationCodes: ["ROLE_MATCH", "SALARY_UNKNOWN"] },
    }];
    expect(await deployment.mutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: 1, jobs })).toBe(1);
    expect(await deployment.mutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: 1, jobs })).toBe(0);
    const listed = await alice.query(api.discovery.list, {});
    expect(listed).toHaveLength(1);
    await alice.mutation(api.discovery.shortlist, { id: listed[0]._id });
    const refreshRunId = await deployment.run(async (ctx) => {
      const original = await ctx.db.get(runId);
      return await ctx.db.insert("discoveryScanRuns", {
        ownerId: original!.ownerId, profileVersion: 1, trigger: "manual", status: "running", queuedAt: Date.now(),
        feedsSucceeded: 0, feedsFailed: 0, discovered: 0, reviewable: 0, rejected: 0,
      });
    });
    expect(await deployment.mutation(internal.autoDiscovery.ingestBatch, { runId: refreshRunId, profileVersion: 1, jobs })).toBe(0);
    expect((await alice.query(api.discovery.list, {}))[0].reviewStatus).toBe("shortlisted");
    await deployment.mutation(internal.autoDiscovery.finishRun, { runId: refreshRunId, status: "succeeded", feedsSucceeded: 1, feedsFailed: 0, discovered: 1, reviewable: 1, rejected: 0 });
    expect((await alice.query(api.autoDiscovery.listRuns, {}))[0].status).toBe("succeeded");
  });

  test.each(["ashby", "greenhouse"] as const)("%s posting survives approval, stays owner-scoped, and never replaces a saved bundle", async (provider) => {
    const deployment = createDeployment();
    const alice = await account(deployment, "posting-owner");
    const bob = await account(deployment, "posting-other");
    await bob.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.targetProfile.save, { profile });
    const runId = await alice.mutation(api.autoDiscovery.requestScan, {});
    await deployment.mutation(internal.autoDiscovery.claimRun, { runId });
    const [candidate] = parseFeed({ company: "Example", industry: "cloud", provider, url: "https://feeds.example.test/jobs" }, { jobs: [{
      id: "posting-one", title: "Security Architect", jobUrl: "https://jobs.example.test/posting-one",
      absolute_url: "https://jobs.example.test/posting-one",
      content: "&lt;p&gt;SQL and AWS required.&lt;/p&gt;&lt;p&gt;Build reliable reporting.&lt;/p&gt;",
      location: "Remote - United States", descriptionPlain: "SQL and AWS required.\nBuild reliable reporting.",
    }] });
    const item = { localJobId: "posting-one", company: candidate.company, title: candidate.title,
      url: candidate.url, source: { label: candidate.sourceLabel, provider: candidate.provider },
      postingText: candidate.description,
      decision: { outcome: "needsReview" as const, score: 70, hardFilters: [], explanationCodes: ["ROLE_MATCH"] } };
    await expect(deployment.mutation(internal.autoDiscovery.ingestBatch, {
      runId, profileVersion: 1, jobs: [{ ...item, postingText: "x".repeat(30001) }],
    })).rejects.toThrow("Posting exceeds");
    await deployment.mutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: 1, jobs: [item] });
    const [discovered] = await alice.query(api.discovery.list, {});
    expect(discovered.postingText).toBe(candidate.description);
    expect(await bob.query(api.discovery.list, {})).toEqual([]);
    await expect(bob.mutation(api.discovery.approveForEvaluation, { id: discovered._id })).rejects.toThrow("Discovered job not found");
    await alice.mutation(api.discovery.approveForEvaluation, { id: discovered._id });
    const [job] = await alice.query(api.jobs.list, {});
    expect(job.postingText).toBe(candidate.description);
    expect(await bob.query(api.jobs.list, {})).toEqual([]);
    await alice.mutation(api.resumeBundles.save, { jobId: job._id, sourceResume: "Factual source", description: "My corrected posting", resume: "Reviewed draft", reviewed: true, expectedRevision: null });
    await deployment.mutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: 1, jobs: [{ ...item, postingText: "Updated feed posting" }] });
    await alice.mutation(api.discovery.approveForEvaluation, { id: discovered._id });
    expect(await alice.query(api.jobs.list, {})).toHaveLength(1);
    expect((await alice.query(api.jobs.list, {}))[0].postingText).toBe(candidate.description);
    expect(await alice.query(api.resumeBundles.get, { jobId: job._id })).toMatchObject({ description: "My corrected posting", reviewedAt: expect.any(Number) });
    await deployment.mutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: 1, jobs: [{ ...item, postingText: undefined }] });
    expect((await alice.query(api.discovery.list, {}))[0].postingText).toBe("Updated feed posting");
    const exported = await alice.query(api.account.exportData, {});
    expect(exported.jobs[0].postingText).toBe(candidate.description);
    expect(exported.discovery[0].postingText).toBe("Updated feed posting");
  });

  test.each(["empty", "partial", "failed", "capacity"] as const)("worker records %s feeds with bounded results", async (scenario) => {
    const deployment = createDeployment();
    const alice = await account(deployment, `worker-${scenario}`);
    await alice.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.targetProfile.save, { profile });
    const runId = await alice.mutation(api.autoDiscovery.requestScan, {});
    const fetchMock = vi.fn(async (url: string) => {
      const source = ATS_SOURCES.find(source => source.url === url)!;
      if (scenario === "failed" || scenario === "partial" && source.company !== "Vanta") throw new Error("fixture feed failure");
      const jobs = scenario === "empty" ? [] : Array.from({ length: scenario === "capacity" ? 20 : 1 }, (_, index) => ({
        id: `${source.company}-${index}`, title: "Security Architect",
        absolute_url: `https://jobs.example.test/${source.company}/${index}`,
        jobUrl: `https://jobs.example.test/${source.company}/${index}`,
        location: source.provider === "ashby" ? "Remote - United States" : { name: "Remote - United States" },
        isRemote: true,
      }));
      return new Response(JSON.stringify({ jobs }));
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await deployment.action(internal.autoDiscoveryWorker.runForOwner, { runId });
      expect(fetchMock).toHaveBeenCalledTimes(ATS_SOURCES.length);
      const [run] = await alice.query(api.autoDiscovery.listRuns, {});
      const count = scenario === "capacity" ? ATS_SOURCES.length * 15 : scenario === "partial" ? 1 : 0;
      expect(run).toMatchObject({
        status: scenario === "partial" ? "partial" : scenario === "failed" ? "failed" : "succeeded",
        feedsSucceeded: scenario === "failed" ? 0 : scenario === "partial" ? 1 : ATS_SOURCES.length,
        feedsFailed: scenario === "failed" ? ATS_SOURCES.length : scenario === "partial" ? ATS_SOURCES.length - 1 : 0,
        discovered: count, reviewable: count,
      });
      expect(await alice.query(api.discovery.list, {})).toHaveLength(Math.min(count, 100));
      const stored = await deployment.run(async ctx => {
        const scan = (await ctx.db.get(runId))!;
        return await ctx.db.query("discoveredJobs").withIndex("by_owner_discovered_at", q => q.eq("ownerId", scan.ownerId)).take(196);
      });
      expect(stored).toHaveLength(count);
    } finally { vi.unstubAllGlobals(); }
  });

  test("a duplicate worker leaves the winning scan and its counters alone", async () => {
    const deployment = createDeployment();
    const alice = await account(deployment, "duplicate-worker");
    await alice.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.targetProfile.save, { profile });
    const runId = await alice.mutation(api.autoDiscovery.requestScan, {});
    expect(await deployment.mutation(internal.autoDiscovery.claimRun, { runId })).not.toBeNull();
    await deployment.action(internal.autoDiscoveryWorker.runForOwner, { runId });
    expect((await alice.query(api.autoDiscovery.listRuns, {}))[0].status).toBe("running");
    await deployment.mutation(internal.autoDiscovery.finishRun, { runId, status: "succeeded", feedsSucceeded: 1, feedsFailed: 0, discovered: 2, reviewable: 2, rejected: 0 });
    await deployment.action(internal.autoDiscoveryWorker.runForOwner, { runId });
    expect((await alice.query(api.autoDiscovery.listRuns, {}))[0]).toMatchObject({ status: "succeeded", discovered: 2 });
  });

  test("a profile edited after queueing cancels before collection starts", async () => {
    const deployment = createDeployment();
    const alice = await account(deployment, "changed-profile");
    await alice.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.targetProfile.save, { profile });
    const runId = await alice.mutation(api.autoDiscovery.requestScan, {});
    await alice.mutation(api.targetProfile.save, { profile: { ...profile, enabled: false } });
    expect(await deployment.mutation(internal.autoDiscovery.claimRun, { runId })).toBeNull();
    expect((await alice.query(api.autoDiscovery.listRuns, {}))[0]).toMatchObject({ status: "failed", errorCode: "PROFILE_CHANGED" });
  });

  for (const change of ["privacy", "enrollment"] as const) {
    test(`revoked ${change} prevents worker start and subsequent ingestion`, async () => {
      const deployment = createDeployment();
      const alice = await account(deployment, `revoked-${change}`);
      await alice.mutation(api.privacy.acknowledge, {});
      await alice.mutation(api.targetProfile.save, { profile });
      const runId = await alice.mutation(api.autoDiscovery.requestScan, {});
      await deployment.mutation(internal.autoDiscovery.claimRun, { runId });
      const queuedRunId = await deployment.run(async (ctx) => {
        const run = (await ctx.db.get(runId))!;
        if (change === "privacy") await ctx.db.patch(run.ownerId, { privacyPolicyVersion: "obsolete" });
        else {
          const invite = await ctx.db.query("alphaInvites").withIndex("by_claimed_by", q => q.eq("claimedBy", run.ownerId)).unique();
          await ctx.db.patch(invite!._id, { expiredAt: Date.now() });
        }
        const { _id, _creationTime, ...fields } = run;
        return await ctx.db.insert("discoveryScanRuns", { ...fields, status: "queued" });
      });
      await expect(deployment.mutation(internal.autoDiscovery.ingestBatch, { runId, profileVersion: 1, jobs: [] })).rejects.toThrow(change === "privacy" ? "Privacy acknowledgement required" : "Alpha enrollment required");
      expect(await deployment.mutation(internal.autoDiscovery.claimRun, { runId: queuedRunId })).toBeNull();
      expect(await deployment.run(ctx => ctx.db.get(queuedRunId))).toMatchObject({ status: "failed", errorCode: "ACCOUNT_ACCESS_CHANGED" });
    });
  }

  test("scheduled scans honor enabled profiles and current privacy", async () => {
    const deployment = createDeployment();
    const alice = await account(deployment, "scheduled-owner");
    await alice.mutation(api.privacy.acknowledge, {});
    await alice.mutation(api.targetProfile.save, { profile });
    expect(await deployment.mutation(internal.autoDiscovery.queueDueRuns, {})).toBe(1);
    expect(await deployment.mutation(internal.autoDiscovery.queueDueRuns, {})).toBe(0);
    expect((await alice.query(api.autoDiscovery.listRuns, {}))[0].trigger).toBe("scheduled");
  });
});

describe("approved feed matching", () => {
  test("Greenhouse requests content and converts encoded or raw HTML to inert bounded text", () => {
    const sources = ATS_SOURCES.filter(source => source.provider === "greenhouse");
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(new URL(source.url).searchParams.get("content")).toBe("true");
    const parse = (content: unknown) => parseFeed(sources[0], { jobs: [{
      id: 123, title: "Security Architect", absolute_url: "https://jobs.example.test/123",
      location: { name: "Remote - United States" }, content,
    }] })[0];
    for (const content of [
      "<h2>R&amp;D</h2><p>AWS &lt; 5 years</p><ul><li>NIST</li><li>Travel up to 75%</li></ul><script>secret()</script><style>secret{}</style><!-- secret --><iframe src='https://bad.test'>secret</iframe>",
      "&lt;h2&gt;R&amp;amp;D&lt;/h2&gt;&lt;p&gt;AWS &amp;lt; 5 years&lt;/p&gt;&lt;ul&gt;&lt;li&gt;NIST&lt;/li&gt;&lt;li&gt;Travel up to 75%&lt;/li&gt;&lt;/ul&gt;&lt;script&gt;secret()&lt;/script&gt;",
    ]) {
      const candidate = parse(content);
      expect(candidate.description).toBe("R&D\n\nAWS < 5 years\n\nNIST\n\nTravel up to 75%");
      expect(evaluateCandidate(profile, candidate).hardFilters).toContainEqual({ ruleId: "TRAVEL", outcome: "fail", reasonCode: "TRAVEL_EXCEEDS_LIMIT" });
    }
    expect(parse("<p>" + "x".repeat(31_000) + "</p>").description).toHaveLength(30_000);
    for (const content of [undefined, null, 123, "", "<p> </p>"]) expect(parse(content).description).toBeUndefined();
    expect(parse("<div>Use &lt;em&gt; literally</div>").description).toBe("Use <em> literally");
    expect(parse("Plain R&amp;D").description).toBe("Plain R&D");
  });

  test("parses public Ashby salaries and rejects known hard mismatches", () => {
    const source = ATS_SOURCES.find((entry) => entry.company === "Vanta")!;
    const jobs = parseFeed(source, { jobs: [{
      id: "sample", title: "Security Architect", jobUrl: "https://jobs.ashbyhq.com/vanta/sample",
      location: "Remote - United States", isRemote: true,
      compensation: { summaryComponents: [{ compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 100_000, maxValue: 130_000 }] },
      descriptionPlain: "Active TS/SCI clearance required. Travel up to 75%.",
    }] });
    expect(isRelevantTitle(profile, jobs[0].title)).toBe(true);
    const decision = evaluateCandidate(profile, jobs[0]);
    expect(decision.outcome).toBe("rejected");
    expect(decision.hardFilters.filter((entry) => entry.outcome === "fail").map((entry) => entry.ruleId)).toEqual(expect.arrayContaining(["SALARY_FLOOR", "CLEARANCE", "TRAVEL"]));
  });

  test.each(["Software Engineer", "Registered Nurse", "Electrician", "Administrative Assistant", "Teacher"])("%s supports fictional title matching without certifying credentials", (title) => {
    const target = { ...profile, targetRoles: [{ title, aliases: [], seniority: [] }] };
    const [candidate] = parseFeed(ATS_SOURCES[0], { jobs: [{ id: "fictional", title,
      absolute_url: "https://jobs.example.test/fictional", location: { name: "Remote - United States" },
      content: "Professional license and certification required.",
    }] });
    expect(isRelevantTitle(target, candidate.title)).toBe(true);
    const decision = evaluateCandidate(target, candidate);
    expect(decision.outcome).toBe("needsReview");
    expect(decision.explanationCodes).toEqual(expect.arrayContaining(["SALARY_UNKNOWN", "WORK_AUTHORIZATION_UNKNOWN"]));
    expect(isRelevantTitle(target, "Unrelated Position")).toBe(false);
  });

  test("feed absence does not certify closure and published age does not imply liveness", () => {
    const source = ATS_SOURCES.find(source => source.provider === "ashby")!;
    expect(parseFeed(source, { jobs: [] })).toEqual([]);
    expect(() => parseFeed(source, {})).toThrow("INVALID_FEED");
    const [candidate] = parseFeed(source, { jobs: [{ id: "old", title: "Security Architect",
      jobUrl: "https://jobs.example.test/old", location: "Remote - United States", isRemote: true,
      publishedAt: "2020-01-01T00:00:00Z",
    }] });
    expect(candidate.postedAt).toBe(Date.parse("2020-01-01T00:00:00Z"));
    expect(evaluateCandidate(profile, candidate).outcome).toBe("needsReview");
  });

  test("does not auto-accept uncertain commutes or missing compensation", () => {
    const candidate = { company: "Example", title: "Security Architect", location: "New York, NY, United States", url: "https://jobs.example.test/role", provider: "greenhouse" as const, sourceLabel: "greenhouse: Example", industry: "cloud", externalId: "one", remote: false };
    const decision = evaluateCandidate(profile, candidate);
    expect(decision.outcome).toBe("needsReview");
    expect(decision.hardFilters).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "LOCATION", outcome: "unknown" })]));
  });
});
