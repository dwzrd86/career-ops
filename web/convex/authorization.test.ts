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

    const exportA = await accountA.client.query(api.account.exportData, {});
    expect(exportA.jobs).toEqual([
      expect.objectContaining({ id: jobA, company: "export-delete-a Company" }),
    ]);
    expect(exportA).toEqual(expect.objectContaining({ format: "jobbie-account-export-v2" }));
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
      expect(await ctx.db.query("accountPrivacyEvents").withIndex("by_user", (query) => query.eq("userId", accountA.userId as any)).collect())
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ action: "exportRequested" }),
          expect.objectContaining({ action: "accountDeleted" }),
        ]));
    });
  });
});
