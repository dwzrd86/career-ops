import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, components, internal } from "./_generated/api";
import { reservationEmailHash } from "./enrollmentCore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type DisposableAccount = {
  authUser: { _id: string; email: string };
  client: ReturnType<typeof convexTest>;
  userId: string;
};

function createIsolatedDeployment() {
  const deployment = convexTest(schema, modules);
  betterAuthTest.register(deployment);
  return deployment;
}

async function provisionDisposableAccount(
  deployment: ReturnType<typeof createIsolatedDeployment>,
  label: string,
): Promise<DisposableAccount> {
  const now = Date.now();
  const email = `${label}@authorization-test.example`;

  // A reserved invite lets the same Better Auth user trigger used in production
  // create the app-owned user mapping and alpha enrollment record.
  await deployment.run(async (ctx) => {
    await ctx.db.insert("alphaInvites", {
      createdAt: now,
      expiresAt: now + 60_000,
      reservationEmailHash: await reservationEmailHash(email),
      reservationExpiresAt: now + 60_000,
      reservationId: `reservation-${label}`,
      tokenHash: `test-invite-${label}`,
    });
  });

  const authUser = await deployment.run(async (ctx) => await ctx.runMutation(
    components.betterAuth.adapter.create,
    {
      input: {
        data: {
          createdAt: now,
          email,
          emailVerified: true,
          name: `Disposable ${label}`,
          updatedAt: now,
        },
        model: "user",
      },
    },
  )) as { _id: string; email: string };

  await deployment.mutation(internal.auth.onCreate, {
    doc: authUser,
    model: "user",
  });

  const session = await deployment.run(async (ctx) => await ctx.runMutation(
    components.betterAuth.adapter.create,
    {
      input: {
        data: {
          createdAt: now,
          expiresAt: now + 60_000,
          token: `session-token-${label}`,
          updatedAt: now,
          userId: authUser._id,
        },
        model: "session",
      },
    },
  )) as { _id: string };

  const appUser = await deployment.run(async (ctx) => await ctx.db
    .query("users")
    .withIndex("by_auth_id", (query) => query.eq("authId", authUser._id))
    .unique());
  if (appUser === null) throw new Error("Disposable account provisioning failed");

  const client = deployment.withIdentity({
    sessionId: session._id,
    subject: authUser._id,
  } as any);
  await client.mutation(api.privacy.acknowledge, {});

  return { authUser, client: client as ReturnType<typeof convexTest>, userId: appUser._id };
}

const jobInput = (label: string) => ({
  company: `${label} Company`,
  location: "Remote",
  notes: `${label} private note`,
  source: "Manual entry",
  title: `${label} Engineer`,
  url: `https://jobs.example.test/${label}`,
});

const discoveryProjection = (label: string) => {
  const now = Date.now();
  return {
    company: `${label} Discovery Company`,
    decision: {
      decidedAt: now,
      explanationCodes: ["ROLE_MATCH"],
      hardFilters: [{ outcome: "unknown" as const, reasonCode: "SALARY_UNKNOWN", ruleId: "SALARY" }],
      outcome: "needsReview" as const,
      profileVersion: 1,
      score: 84,
    },
    discoveredAt: now,
    freshness: { checkedAt: now, status: "unknown" as const },
    localJobId: `local-${label}`,
    source: { label: "Greenhouse", provider: "greenhouse" as const },
    title: `${label} Discovery Engineer`,
    url: `https://jobs.example.test/discovery-${label}`,
  };
};

describe("isolated Convex authorization boundary", () => {
  test("two disposable accounts cannot read, update, or delete each other's jobs", async () => {
    const deployment = createIsolatedDeployment();
    const accountA = await provisionDisposableAccount(deployment, "account-a");
    const accountB = await provisionDisposableAccount(deployment, "account-b");
    const jobA = await accountA.client.mutation(api.jobs.create, jobInput("account-a"));
    const jobB = await accountB.client.mutation(api.jobs.create, jobInput("account-b"));

    await expect(accountA.client.query(api.jobs.list, {})).resolves.toEqual([
      expect.objectContaining({ _id: jobA, company: "account-a Company" }),
    ]);
    await expect(accountB.client.query(api.jobs.list, {})).resolves.toEqual([
      expect.objectContaining({ _id: jobB, company: "account-b Company" }),
    ]);

    await expect(accountB.client.mutation(api.jobs.updateStatus, { id: jobA, status: "offer" }))
      .rejects.toThrow("Job not found");
    await expect(accountB.client.mutation(api.jobs.remove, { id: jobA }))
      .rejects.toThrow("Job not found");

    await deployment.run(async (ctx) => {
      expect(await ctx.db.get(jobA)).toEqual(expect.objectContaining({ status: "discovered" }));
      expect(await ctx.db.get(jobB)).toEqual(expect.objectContaining({ ownerId: accountB.userId }));
    });
  });

  test("anonymous calls to private job, privacy, and export functions fail", async () => {
    const deployment = createIsolatedDeployment();
    const account = await provisionDisposableAccount(deployment, "anonymous-target");
    const jobId = await account.client.mutation(api.jobs.create, jobInput("anonymous-target"));

    await expect(deployment.query(api.jobs.list, {})).rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.jobs.create, jobInput("anonymous"))).rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.jobs.updateStatus, { id: jobId, status: "offer" }))
      .rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.jobs.remove, { id: jobId }))
      .rejects.toThrow("Authentication required");
    await expect(deployment.query(api.privacy.status, {})).rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.privacy.acknowledge, {})).rejects.toThrow("Authentication required");
    await expect(deployment.query(api.account.exportData, {})).rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.account.recordExportRequest, {})).rejects.toThrow("Authentication required");
  });

  test("export and account deletion affect only the requesting disposable account", async () => {
    const deployment = createIsolatedDeployment();
    const accountA = await provisionDisposableAccount(deployment, "export-delete-a");
    const accountB = await provisionDisposableAccount(deployment, "export-delete-b");
    const jobA = await accountA.client.mutation(api.jobs.create, jobInput("export-delete-a"));
    const jobB = await accountB.client.mutation(api.jobs.create, jobInput("export-delete-b"));
    const { discoveredJobId: discoveredJobA } = await accountA.client.mutation(api.discovery.project, discoveryProjection("export-delete-a"));
    const { discoveredJobId: discoveredJobB } = await accountB.client.mutation(api.discovery.project, discoveryProjection("export-delete-b"));
    await accountA.client.mutation(api.discovery.shortlist, { id: discoveredJobA });
    await accountA.client.mutation(api.discovery.overrideDecision, {
      id: discoveredJobA,
      outcome: "ranked",
      reason: "Relevant portfolio evidence supports this role.",
    });
    await accountA.client.mutation(api.targetProfile.save, { profile: {
      targetRoles: [{ title: "Security Architect", aliases: [], seniority: ["Senior"] }],
      home: "Nashville", workplaceModes: ["remote"], allowedRegions: ["United States"],
      preferredRegions: [], dreamRegions: [], dreamIndustries: [], excludedCompanies: [], excludedIndustries: [],
      frameworks: [], cloudPlatforms: [], currency: "USD", workAuthorization: ["US citizen"], clearanceLevels: [],
      sources: ["greenhouse"], schedule: "manual", enabled: true,
    } });
    await accountA.client.mutation(api.autoDiscovery.requestScan, {});

    const exportA = await accountA.client.query(api.account.exportData, {});
    expect(exportA.jobs).toEqual([
      expect.objectContaining({ id: jobA, company: "export-delete-a Company" }),
    ]);
    expect(exportA).toEqual(expect.objectContaining({ format: "jobbie-account-export-v4", targetProfile: expect.objectContaining({ targetRoles: [expect.objectContaining({ title: "Security Architect" })] }), discoveryScanRuns: [expect.objectContaining({ trigger: "manual" })] }));
    expect(exportA.discovery).toEqual([
      expect.objectContaining({
        id: discoveredJobA,
        company: "export-delete-a Discovery Company",
        matchDecisions: [expect.objectContaining({ score: 84 })],
        reviewerOverrides: [expect.objectContaining({ outcome: "ranked" })],
        statusHistory: expect.arrayContaining([expect.objectContaining({ status: "shortlisted" })]),
      }),
    ]);
    expect(JSON.stringify(exportA)).not.toContain("export-delete-b Company");
    expect(JSON.stringify(exportA)).not.toContain("export-delete-b Discovery Company");
    expect(JSON.stringify(exportA)).not.toContain("ownerId");

    await accountA.client.mutation(api.account.recordExportRequest, {});
    await deployment.mutation(internal.auth.onDelete, {
      doc: accountA.authUser,
      model: "user",
    });

    await deployment.run(async (ctx) => {
      expect(await ctx.db.get(jobA)).toBeNull();
      expect(await ctx.db.get(jobB)).toEqual(expect.objectContaining({ ownerId: accountB.userId }));
      expect(await ctx.db.get(discoveredJobA)).toBeNull();
      expect(await ctx.db.get(discoveredJobB)).toEqual(expect.objectContaining({ ownerId: accountB.userId }));
      expect(await ctx.db.get(accountA.userId as any)).toBeNull();
      expect(await ctx.db.get(accountB.userId as any)).toEqual(expect.objectContaining({ authId: accountB.authUser._id }));
      expect(await ctx.db.query("discoveryMatchDecisions").withIndex("by_owner_job_decided_at", (query) => query.eq("ownerId", accountA.userId as any)).collect()).toEqual([]);
      expect(await ctx.db.query("discoveryReviewerOverrides").withIndex("by_owner_job_overridden_at", (query) => query.eq("ownerId", accountA.userId as any)).collect()).toEqual([]);
      expect(await ctx.db.query("discoveryStatusHistory").withIndex("by_owner_job_occurred_at", (query) => query.eq("ownerId", accountA.userId as any)).collect()).toEqual([]);
      expect(await ctx.db.query("targetProfiles").withIndex("by_owner", (query) => query.eq("ownerId", accountA.userId as any)).collect()).toEqual([]);
      expect(await ctx.db.query("discoveryScanRuns").withIndex("by_owner_queued_at", (query) => query.eq("ownerId", accountA.userId as any)).collect()).toEqual([]);
      expect(await ctx.db.query("accountPrivacyEvents").withIndex("by_user", (query) => query.eq("userId", accountA.userId as any)).collect())
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ action: "exportRequested" }),
          expect.objectContaining({ action: "accountDeleted" }),
        ]));
    });
  });
});


describe("saved resume bundles", () => {
  test("bundles are private, conflict-safe, validated, and follow job deletion", async () => {
    const deployment = createIsolatedDeployment();
    const a = await provisionDisposableAccount(deployment, "resume-a");
    const b = await provisionDisposableAccount(deployment, "resume-b");
    const jobId = await a.client.mutation(api.jobs.create, jobInput("resume-a"));
    const input = { jobId, sourceResume: "Original factual evidence", description: "Python required",
      resume: "Factual tailored draft", reviewed: true, expectedRevision: null };
    await expect(deployment.query(api.resumeBundles.get, { jobId })).rejects.toThrow("Authentication required");
    expect(await b.client.query(api.resumeBundles.get, { jobId })).toBeNull();
    await expect(b.client.mutation(api.resumeBundles.save, input)).rejects.toThrow("Job not found");
    await expect(a.client.mutation(api.resumeBundles.save, { ...input, sourceResume: " " })).rejects.toThrow("sourceResume");
    await expect(a.client.mutation(api.resumeBundles.save, { ...input, resume: "x".repeat(40001) })).rejects.toThrow("resume");
    expect(await a.client.mutation(api.resumeBundles.save, input)).toBe(1);
    const saved = await a.client.query(api.resumeBundles.get, { jobId });
    expect(saved).toEqual(expect.objectContaining({ sourceResume: input.sourceResume, resume: input.resume, revision: 1, reviewedAt: expect.any(Number) }));
    await expect(a.client.mutation(api.resumeBundles.save, input)).rejects.toThrow("another tab");
    await expect(b.client.mutation(api.resumeBundles.remove, { jobId, expectedRevision: 1 })).rejects.toThrow("Job not found");
    expect(await a.client.mutation(api.resumeBundles.save, { ...input, resume: "Edited draft", reviewed: false, expectedRevision: 1 })).toBe(2);
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toEqual(expect.objectContaining({ revision: 2, reviewedAt: null }));
    await expect(a.client.mutation(api.resumeBundles.remove, { jobId, expectedRevision: 1 })).rejects.toThrow("another tab");
    const exported = await a.client.query(api.account.exportData, {});
    expect(exported.resumeBundles).toEqual([expect.objectContaining({ jobId, sourceResume: input.sourceResume, resume: "Edited draft" })]);
    expect((await b.client.query(api.account.exportData, {})).resumeBundles).toEqual([]);
    await a.client.mutation(api.resumeBundles.remove, { jobId, expectedRevision: 2 });
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toBeNull();
    await a.client.mutation(api.resumeBundles.save, input);
    await a.client.mutation(api.jobs.remove, { id: jobId });
    expect((await a.client.query(api.account.exportData, {})).resumeBundles).toEqual([]);
  });

  test("resume queue exposes only owned metadata and tracks review changes and deletion", async () => {
    const deployment = createIsolatedDeployment();
    const a = await provisionDisposableAccount(deployment, "shelf-a");
    const b = await provisionDisposableAccount(deployment, "shelf-b");
    await expect(deployment.query(api.resumeBundles.summaries, {})).rejects.toThrow("Authentication required");
    const jobId = await a.client.mutation(api.jobs.create, jobInput("shelf-role"));
    const input = { jobId, sourceResume: "Private source", description: "Private posting",
      resume: "Private draft", reviewed: true, expectedRevision: null };
    await a.client.mutation(api.resumeBundles.save, input);
    expect(await a.client.query(api.resumeBundles.summaries, {})).toEqual([
      { jobId, revision: 1, reviewedAt: expect.any(Number), updatedAt: expect.any(Number) },
    ]);
    expect(await b.client.query(api.resumeBundles.summaries, {})).toEqual([]);
    await a.client.mutation(api.resumeBundles.save, { ...input, reviewed: false, expectedRevision: 1 });
    expect(await a.client.query(api.resumeBundles.summaries, {})).toEqual([
      { jobId, revision: 2, reviewedAt: null, updatedAt: expect.any(Number) },
    ]);
    await a.client.mutation(api.jobs.remove, { id: jobId });
    expect(await a.client.query(api.resumeBundles.summaries, {})).toEqual([]);
  });

  test("source library is private, deduplicates original evidence, and follows deletion", async () => {
    const deployment = createIsolatedDeployment();
    const a = await provisionDisposableAccount(deployment, "source-a");
    const b = await provisionDisposableAccount(deployment, "source-b");
    await expect(deployment.query(api.resumeBundles.sources, {})).rejects.toThrow("Authentication required");
    const first = await a.client.mutation(api.jobs.create, jobInput("source-first"));
    const second = await a.client.mutation(api.jobs.create, jobInput("source-second"));
    const save = { sourceResume: "Original evidence", description: "Python", resume: "Generated text must not be reused", reviewed: true, expectedRevision: null };
    await a.client.mutation(api.resumeBundles.save, { ...save, jobId: first });
    await a.client.mutation(api.resumeBundles.save, { ...save, jobId: second });
    await deployment.run(async ctx => {
      const item = await ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", a.userId as any).eq("jobId", second)).unique();
      await ctx.db.patch(item!._id, { updatedAt: Date.now() + 1000 });
    });
    expect(await a.client.query(api.resumeBundles.sources, {})).toEqual([{ jobId: second, company: "source-second Company", title: "source-second Engineer", sourceResume: "Original evidence", updatedAt: expect.any(Number) }]);
    expect(await b.client.query(api.resumeBundles.sources, {})).toEqual([]);
    await a.client.mutation(api.jobs.remove, { id: second });
    expect(await a.client.query(api.resumeBundles.sources, {})).toEqual([expect.objectContaining({ jobId: first })]);
    await a.client.mutation(api.resumeBundles.remove, { jobId: first, expectedRevision: 1 });
    expect(await a.client.query(api.resumeBundles.sources, {})).toEqual([]);
  });

  test("account deletion erases its bundles and preserves another account's evidence", async () => {
    const deployment = createIsolatedDeployment();
    const a = await provisionDisposableAccount(deployment, "resume-delete-a");
    const b = await provisionDisposableAccount(deployment, "resume-delete-b");
    for (const [account, label] of [[a, "a"], [b, "b"]] as const) {
      const jobId = await account.client.mutation(api.jobs.create, jobInput(label));
      await account.client.mutation(api.resumeBundles.save, { jobId, sourceResume: label,
        description: "Role requirements", resume: label, reviewed: false, expectedRevision: null });
    }
    await deployment.mutation(internal.auth.onDelete, { doc: a.authUser, model: "user" });
    await deployment.run(async (ctx) => {
      expect(await ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", a.userId as any)).take(50)).toEqual([]);
      expect(await ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", b.userId as any)).take(50)).toHaveLength(1);
    });
  });
});


test("discovery approval creates a private resume target once and preserves tracked work", async () => {
  const deployment = createIsolatedDeployment();
  const alice = await provisionDisposableAccount(deployment, "approval-a");
  const bob = await provisionDisposableAccount(deployment, "approval-b");
  const id = (await alice.client.mutation(api.discovery.project, discoveryProjection("approval"))).discoveredJobId;
  await expect(bob.client.mutation(api.discovery.approveForEvaluation, { id })).rejects.toThrow("Discovered job not found");
  await expect(deployment.mutation(api.discovery.approveForEvaluation, { id })).rejects.toThrow("Authentication required");
  expect(await alice.client.query(api.jobs.list, {})).toEqual([]);
  await alice.client.mutation(api.discovery.approveForEvaluation, { id });
  const [job] = await alice.client.query(api.jobs.list, {});
  expect(job).toMatchObject({ company: "approval Discovery Company", title: "approval Discovery Engineer", location: "Not specified", source: "Greenhouse", status: "discovered" });
  expect(await bob.client.query(api.jobs.list, {})).toEqual([]);
  await alice.client.mutation(api.jobs.updateStatus, { id: job._id, status: "applied" });
  await alice.client.mutation(api.resumeBundles.save, { jobId: job._id, sourceResume: "Fictional candidate: SQL reporting", description: "SQL reporting role", resume: "Fictional candidate: SQL reporting", reviewed: true, expectedRevision: null });
  await alice.client.mutation(api.discovery.approveForEvaluation, { id });
  expect(await alice.client.query(api.jobs.list, {})).toEqual([expect.objectContaining({ _id: job._id, status: "applied" })]);
  expect(await alice.client.query(api.resumeBundles.get, { jobId: job._id })).toMatchObject({ revision: 1, resume: "Fictional candidate: SQL reporting" });
  expect((await alice.client.query(api.discovery.history, { id })).statuses.filter(status => status.status === "approvedForEvaluation")).toHaveLength(1);
  const second = discoveryProjection("manual-duplicate");
  const manualId = await alice.client.mutation(api.jobs.create, { ...jobInput("manual-duplicate"), url: second.url });
  await bob.client.mutation(api.jobs.create, { ...jobInput("same-url-other-owner"), url: second.url });
  const secondId = (await alice.client.mutation(api.discovery.project, second)).discoveredJobId;
  await alice.client.mutation(api.discovery.approveForEvaluation, { id: secondId });
  expect(await alice.client.query(api.jobs.list, {})).toHaveLength(2);
  expect((await alice.client.query(api.jobs.list, {})).find(item => item._id === manualId)?.source).toBe("Manual entry");
});


describe("hosted resume request boundaries (no provider dispatch)", () => {
  const consent = { provider: "zai", model: "glm-4.7", version: "2026-10-24-zai-selected-evidence-v1", shareSelectedEvidence: true } as const;
  async function fixture() {
    const deployment = createIsolatedDeployment();
    const a = await provisionDisposableAccount(deployment, "hosted-a");
    const b = await provisionDisposableAccount(deployment, "hosted-b");
    const jobId = await a.client.mutation(api.jobs.create, jobInput("hosted-role"));
    const saved = { jobId, sourceResume: "Fictional Candidate\nSQL reporting", description: "SQL reporting role",
      resume: "Existing reviewed resume", reviewed: true, expectedRevision: null };
    await a.client.mutation(api.resumeBundles.save, saved);
    const input = { jobId, expectedRevision: 1, consent };
    return { deployment, a, b, jobId, saved, input };
  }

  test("requires authentication, owned saved evidence, current privacy, and matching explicit consent", async () => {
    const { deployment, a, b, jobId, input } = await fixture();
    await expect(deployment.mutation(api.hostedResumes.request, input)).rejects.toThrow("Authentication required");
    await expect(b.client.mutation(api.hostedResumes.request, input)).rejects.toThrow("Job not found");
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, consent: { ...consent, shareSelectedEvidence: false } })).rejects.toThrow("Explicit consent");
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, consent: { ...consent, version: "old" } })).rejects.toThrow("Explicit consent");
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, consent: { ...consent, provider: "claude" } } as any)).rejects.toThrow();
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, expectedRevision: 2 })).rejects.toThrow("current bundle");
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, expectedRevision: 1.5 })).rejects.toThrow("current bundle");
    const unsaved = await a.client.mutation(api.jobs.create, jobInput("unsaved"));
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, jobId: unsaved })).rejects.toThrow("current bundle");
    await deployment.run(ctx => ctx.db.patch(a.userId as any, { privacyPolicyVersion: "old" }));
    await expect(a.client.mutation(api.hostedResumes.request, input)).rejects.toThrow("Privacy acknowledgement");
    await a.client.mutation(api.privacy.acknowledge, {});
    await deployment.run(async ctx => {
      const invite = await ctx.db.query("alphaInvites").withIndex("by_claimed_by", q => q.eq("claimedBy", a.userId as any)).unique();
      await ctx.db.patch(invite!._id, { expiredAt: Date.now() });
    });
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, jobId })).rejects.toThrow("Alpha enrollment");
  });

  test("pending intent is private, one per owner, and has no scheduled or paid side effect", async () => {
    const { deployment, a, b, saved, input } = await fixture();
    const requestId = await a.client.mutation(api.hostedResumes.request, input);
    expect(await a.client.query(api.hostedResumes.status, { requestId })).toMatchObject({ requestId, status: "pending", provider: "zai", model: "glm-4.7", bundleRevision: 1 });
    expect(await b.client.query(api.hostedResumes.status, { requestId })).toBeNull();
    await expect(deployment.query(api.hostedResumes.status, { requestId })).rejects.toThrow("Authentication required");
    const otherJob = await a.client.mutation(api.jobs.create, jobInput("other-role"));
    await a.client.mutation(api.resumeBundles.save, { ...saved, jobId: otherJob });
    await expect(a.client.mutation(api.hostedResumes.request, { ...input, jobId: otherJob })).rejects.toThrow("already pending");
    await deployment.run(async ctx => {
      const item = await ctx.db.get(requestId);
      expect(item).not.toHaveProperty("sourceResume");
      expect(item).not.toHaveProperty("description");
      expect(await ctx.db.system.query("_scheduled_functions").collect()).toEqual([]);
    });
    expect(await deployment.mutation(internal.hostedResumes.fail, { requestId, code: "unavailable" })).toBe(true);
    expect(await a.client.query(api.hostedResumes.status, { requestId })).toMatchObject({ status: "failed", failureCode: "unavailable", finishedAt: expect.any(Number) });
    expect(await deployment.mutation(internal.hostedResumes.fail, { requestId, code: "providerFailed" })).toBe(false);
    expect(await a.client.mutation(api.hostedResumes.request, input)).not.toBe(requestId);
  });

  test.each(["\u0000binary", "bad\uFFFDencoding", "x".repeat(40001), "界".repeat(33000)])("rejects invalid or oversized saved evidence (%#)", async sourceResume => {
    const { deployment, a, input, jobId } = await fixture();
    // Legacy data can predate the request validator; validate at the boundary.
    await deployment.run(async ctx => {
      const bundle = await ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", a.userId as any).eq("jobId", jobId)).unique();
      await ctx.db.patch(bundle!._id, { sourceResume });
    });
    await expect(a.client.mutation(api.hostedResumes.request, input)).rejects.toThrow();
    expect(await deployment.run(ctx => ctx.db.query("hostedResumeRequests").collect())).toEqual([]);
  });

  test("completion updates only the bound bundle, clears review and is idempotent", async () => {
    const { deployment, a, jobId, input } = await fixture();
    const requestId = await a.client.mutation(api.hostedResumes.request, input);
    expect(await deployment.mutation(internal.hostedResumes.complete, { requestId, draft: "\uFEFFFictional Candidate\r\nSQL reporting\n" })).toBe(true);
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toMatchObject({ resume: "Fictional Candidate\nSQL reporting", reviewedAt: null, revision: 2 });
    expect(await a.client.query(api.hostedResumes.status, { requestId })).toMatchObject({ status: "succeeded", finishedAt: expect.any(Number) });
    expect(await deployment.mutation(internal.hostedResumes.complete, { requestId, draft: "Redelivery must not overwrite" })).toBe(false);
    expect(await deployment.mutation(internal.hostedResumes.fail, { requestId, code: "providerFailed" })).toBe(false);
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toMatchObject({ resume: "Fictional Candidate\nSQL reporting", revision: 2 });
  });

  test("newer edits reject stale completion and preserve the reviewed draft", async () => {
    const { deployment, a, jobId, saved, input } = await fixture();
    const requestId = await a.client.mutation(api.hostedResumes.request, input);
    await a.client.mutation(api.resumeBundles.save, { ...saved, resume: "Newer human edit", expectedRevision: 1 });
    expect(await deployment.mutation(internal.hostedResumes.complete, { requestId, draft: "Stale output" })).toBe(false);
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toMatchObject({ resume: "Newer human edit", revision: 2, reviewedAt: expect.any(Number) });
    expect(await a.client.query(api.hostedResumes.status, { requestId })).toMatchObject({ status: "failed", failureCode: "staleEvidence" });
  });

  test("delete/recreate at the same revision rejects the old request", async () => {
    const { deployment, a, saved, input, jobId } = await fixture();
    const requestId = await a.client.mutation(api.hostedResumes.request, input);
    await a.client.mutation(api.resumeBundles.remove, { jobId, expectedRevision: 1 });
    await a.client.mutation(api.resumeBundles.save, saved);
    expect(await deployment.mutation(internal.hostedResumes.complete, { requestId, draft: "Old callback" })).toBe(false);
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toMatchObject({ resume: saved.resume, revision: 1 });
  });

  test("invalid completion and safe provider failure preserve existing content", async () => {
    const { deployment, a, saved, input, jobId } = await fixture();
    for (const draft of [" ", "bad\uFFFD", "\u0000binary", "x".repeat(40001)]) {
      const requestId = await a.client.mutation(api.hostedResumes.request, input);
      expect(await deployment.mutation(internal.hostedResumes.complete, { requestId, draft })).toBe(false);
      expect(await a.client.query(api.hostedResumes.status, { requestId })).toMatchObject({ status: "failed", failureCode: "invalidDraft" });
    }
    const requestId = await a.client.mutation(api.hostedResumes.request, input);
    await deployment.mutation(internal.hostedResumes.fail, { requestId, code: "providerFailed" });
    expect(await a.client.query(api.resumeBundles.get, { jobId })).toMatchObject({ resume: saved.resume, reviewedAt: expect.any(Number), revision: 1 });
  });

  test.each(["privacy", "enrollment", "owner", "role"])("completion rechecks %s before accepting output", async boundary => {
    const { deployment, a, jobId, saved, input } = await fixture();
    const requestId = await a.client.mutation(api.hostedResumes.request, input);
    await deployment.run(async ctx => {
      if (boundary === "privacy") await ctx.db.patch(a.userId as any, { privacyPolicyVersion: "old" });
      if (boundary === "owner") await ctx.db.delete(a.userId as any);
      if (boundary === "role") await ctx.db.patch(jobId, { title: "New role" });
      if (boundary === "enrollment") {
        const invite = await ctx.db.query("alphaInvites").withIndex("by_claimed_by", q => q.eq("claimedBy", a.userId as any)).unique();
        await ctx.db.patch(invite!._id, { expiredAt: Date.now() });
      }
    });
    expect(await deployment.mutation(internal.hostedResumes.complete, { requestId, draft: "Late output" })).toBe(false);
    await deployment.run(async ctx => {
      expect(await ctx.db.get(requestId)).toMatchObject({ status: "failed", failureCode: boundary === "role" ? "staleEvidence" : "accessRevoked" });
      const bundle = await ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", a.userId as any).eq("jobId", jobId)).unique();
      expect(bundle).toMatchObject({ resume: saved.resume, revision: 1 });
    });
  });
});
