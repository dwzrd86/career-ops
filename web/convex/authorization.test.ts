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
