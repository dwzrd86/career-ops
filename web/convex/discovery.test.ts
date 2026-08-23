import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, components, internal } from "./_generated/api";
import { reservationEmailHash } from "./enrollmentCore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function createIsolatedDeployment() {
  const deployment = convexTest(schema, modules);
  betterAuthTest.register(deployment);
  return deployment;
}

async function provisionAccount(deployment: ReturnType<typeof createIsolatedDeployment>, label: string) {
  const now = Date.now();
  const email = `${label}@discovery-test.example`;
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
  const authUser = await deployment.run(async (ctx) => await ctx.runMutation(components.betterAuth.adapter.create, {
    input: { data: { createdAt: now, email, emailVerified: true, name: label, updatedAt: now }, model: "user" },
  })) as { _id: string };
  await deployment.mutation(internal.auth.onCreate, { doc: authUser, model: "user" });
  const session = await deployment.run(async (ctx) => await ctx.runMutation(components.betterAuth.adapter.create, {
    input: { data: { createdAt: now, expiresAt: now + 60_000, token: `session-${label}`, updatedAt: now, userId: authUser._id }, model: "session" },
  })) as { _id: string };
  const client = deployment.withIdentity({ sessionId: session._id, subject: authUser._id } as any);
  await client.mutation(api.privacy.acknowledge, {});
  return client;
}

function projectedJob(label: string) {
  const now = Date.now();
  return {
    company: `${label} Company`,
    decision: {
      decidedAt: now,
      explanationCodes: ["ROLE_MATCH"],
      hardFilters: [
        { outcome: "pass" as const, reasonCode: "LOCATION_ALLOWED", ruleId: "LOCATION" },
        { outcome: "unknown" as const, reasonCode: "SALARY_UNKNOWN", ruleId: "SALARY" },
      ],
      outcome: "needsReview" as const,
      profileVersion: 1,
      score: 84,
    },
    discoveredAt: now,
    freshness: { checkedAt: now, postedAt: now - 86_400_000, status: "fresh" as const },
    localJobId: `local-${label}`,
    materialStatus: {
      artifacts: { checklistReady: true, pdfReady: true, reportReady: true },
      createdAt: now,
      reviewState: "draftAwaitingReview" as const,
      targetProfileVersion: 1,
    },
    location: "Remote",
    source: { label: "Greenhouse", provider: "greenhouse" as const },
    title: `${label} Engineer`,
    url: `https://jobs.example.test/${label}`,
  };
}

describe("discovery projection authorization boundary", () => {
  test("owners can review only their projected jobs and history", async () => {
    const deployment = createIsolatedDeployment();
    const accountA = await provisionAccount(deployment, "account-a");
    const accountB = await provisionAccount(deployment, "account-b");
    const manualJob = await accountA.mutation(api.jobs.create, {
      company: "Manual Company",
      location: "Remote",
      source: "Manual entry",
      title: "Manual Engineer",
      url: "https://jobs.example.test/manual",
    });
    const { discoveredJobId: jobA } = await accountA.mutation(api.discovery.project, projectedJob("account-a"));
    const { discoveredJobId: jobB } = await accountB.mutation(api.discovery.project, projectedJob("account-b"));

    await accountA.mutation(api.discovery.shortlist, { id: jobA });
    await accountA.mutation(api.discovery.overrideDecision, { id: jobA, outcome: "ranked", reason: "Portfolio evidence supports the role." });
    await accountA.mutation(api.discovery.approveForEvaluation, { id: jobA });

    await expect(accountA.query(api.discovery.list, {})).resolves.toEqual([
      expect.objectContaining({
        _id: jobA,
        effectiveOutcome: "ranked",
        reviewStatus: "approvedForEvaluation",
        decision: expect.objectContaining({ score: 84 }),
        materialStatus: {
          artifacts: { checklistReady: true, pdfReady: true, reportReady: true },
          createdAt: expect.any(Number),
          reviewState: "draftAwaitingReview",
          targetProfileVersion: 1,
        },
        override: expect.objectContaining({ reason: "Portfolio evidence supports the role." }),
      }),
    ]);
    await expect(accountB.query(api.discovery.list, {})).resolves.toEqual([
      expect.objectContaining({ _id: jobB, company: "account-b Company" }),
    ]);
    await expect(accountA.query(api.jobs.list, {})).resolves.toEqual([
      expect.objectContaining({ _id: manualJob, company: "Manual Company" }),
    ]);
    await expect(accountA.query(api.discovery.history, { id: jobB })).rejects.toThrow("Discovered job not found");
    await expect(accountB.mutation(api.discovery.archive, { id: jobA })).rejects.toThrow("Discovered job not found");
    await expect(accountB.mutation(api.discovery.overrideDecision, { id: jobA, outcome: "rejected", reason: "Not mine" }))
      .rejects.toThrow("Discovered job not found");

    const history = await accountA.query(api.discovery.history, { id: jobA });
    expect(history.statuses.map((entry: any) => entry.status)).toEqual(["approvedForEvaluation", "shortlisted", "discovered"]);
    expect(history.overrides).toEqual([expect.objectContaining({ outcome: "ranked" })]);
    expect(history.decisions).toEqual([expect.objectContaining({ score: 84 })]);
    expect(JSON.stringify(history)).not.toContain("ownerId");
  });

  test("anonymous callers cannot read or alter projected discovery metadata", async () => {
    const deployment = createIsolatedDeployment();
    const account = await provisionAccount(deployment, "anonymous-target");
    const { discoveredJobId } = await account.mutation(api.discovery.project, projectedJob("anonymous-target"));

    await expect(deployment.query(api.discovery.list, {})).rejects.toThrow("Authentication required");
    await expect(deployment.query(api.discovery.history, { id: discoveredJobId })).rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.discovery.shortlist, { id: discoveredJobId })).rejects.toThrow("Authentication required");
    await expect(deployment.mutation(api.discovery.overrideDecision, { id: discoveredJobId, outcome: "ranked", reason: "No session" }))
      .rejects.toThrow("Authentication required");
  });

  test("projection rejects local paths in place of a safe local record identifier", async () => {
    const deployment = createIsolatedDeployment();
    const account = await provisionAccount(deployment, "projection-validation");
    const invalidProjection = projectedJob("projection-validation");
    invalidProjection.localJobId = "data/autodiscovery/jobs/private-record.json";

    await expect(account.mutation(api.discovery.project, invalidProjection))
      .rejects.toThrow("localJobId must be a safe local record identifier");
  });
});
