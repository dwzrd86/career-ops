import { beforeEach, expect, test } from "vitest";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import betterAuthTest from "@convex-dev/better-auth/test";
import schema from "./schema";
import { api, components } from "./_generated/api";
import { deliveredEmails } from "./auth.test.setup";
import { jobInput, discoveryProjection } from "./authorizationFixtures";
import { rehearseIdentityRebind } from "../scripts/identity-migration-rehearsal";

// Expand-schema fixture only. Current required authId cannot be deployed over
// legacy users lacking it. Legacy auth tables need separate approved handling.
const expandSchema = defineSchema({ ...schema.tables, users: defineTable({
  ...schema.tables.users.validator.fields, authId: v.optional(v.string()),
}).index("by_auth_id", ["authId"]) });
function deployment() {
  const t = convexTest(expandSchema, import.meta.glob("./**/*.ts"));
  betterAuthTest.register(t);
  return t;
}
type Deployment = ReturnType<typeof deployment>;
const origin = "https://tests.example.test";
const email = "recovery@migration.example.test";
const password = "FreshFictionalPassword123";
async function request(t: Deployment, path: string, body?: Record<string, unknown>, cookie?: string) {
  return t.fetch(`/api/auth${path}`, { method: body ? "POST" : "GET",
    headers: { origin, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function recover(t: Deployment, address = email) {
  const token = (await t.action(api.enrollment.issueInvite, { adminKey: "test-only-enrollment-admin-key" })).token;
  expect((await request(t, "/sign-up/email", { email: address, password, name: "Fictional recovery",
    inviteToken: token, botProtectionToken: "fake-bot", callbackURL: origin })).status).toBe(200);
  const user = await t.run(ctx => ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user", where: [{ field: "email", value: address }],
  }));
  const verify = async () => {
    const link = new URL(deliveredEmails.findLast(m => m.to === address && m.subject.includes("Verify"))!.text.trim().split("\n").at(-1)!);
    expect((await request(t, `/verify-email${link.search}`)).status).toBeLessThan(400);
  };
  const signIn = async (value = password) => {
    const response = await request(t, "/sign-in/email", { email: address, password: value });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
    const session = await (await request(t, "/get-session", undefined, cookie)).json();
    return { cookie, client: t.withIdentity({ subject: session.user.id, sessionId: session.session.id } as any) };
  };
  return { authId: user!._id, verify, signIn };
}
async function legacy(t: Deployment, oldAuthId: string | undefined = "legacy-identity") {
  return t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { authId: oldAuthId, email, emailVerificationTime: 1 });
    const otherId = await ctx.db.insert("users", { authId: "legacy-other", email: "other@migration.example.test", emailVerificationTime: 1 });
    const jobs = [];
    for (const id of [ownerId, otherId]) jobs.push(await ctx.db.insert("jobs", { ...jobInput(id), ownerId: id,
      status: "discovered", createdAt: 1, updatedAt: 1 }));
    for (let i = 0; i < jobs.length; i++) await ctx.db.insert("resumeBundles", {
      ownerId: [ownerId, otherId][i], jobId: jobs[i], sourceResume: "Fictional source",
      description: "Fictional posting", resume: "Fictional saved draft", revision: 3, reviewedAt: null, updatedAt: 1,
    });
    return { ownerId, otherId, jobs };
  });
}
async function snapshot(t: Deployment) {
  return t.run(async ctx => ({ users: await ctx.db.query("users").collect(), jobs: await ctx.db.query("jobs").collect(),
    bundles: await ctx.db.query("resumeBundles").collect(), invites: await ctx.db.query("alphaInvites").collect() }));
}
beforeEach(() => { deliveredEmails.length = 0; });

test("explicit empty branch starts at zero and normal signup preserves ownership", async () => {
  const t = deployment();
  expect(await snapshot(t)).toEqual({ users: [], jobs: [], bundles: [], invites: [] });
  const a = await recover(t); await a.verify(); const { client } = await a.signIn();
  await client.mutation(api.privacy.acknowledge, {});
  const jobId = await client.mutation(api.jobs.create, jobInput("empty-target"));
  await client.mutation(api.resumeBundles.save, { jobId, sourceResume: "Fictional source", description: "Fictional posting",
    resume: "Fictional draft", reviewed: false, expectedRevision: null });
  const rows = await snapshot(t);
  expect([rows.users.length, rows.jobs.length, rows.bundles.length]).toEqual([1, 1, 1]);
  expect(rows.jobs[0].ownerId).toBe(rows.users[0]._id);
  expect(rows.bundles[0]).toMatchObject({ ownerId: rows.users[0]._id, jobId });
});

test("verified recovery preserves original owner and content", async () => {
  const oldAuthId = "legacy-identity";
  const t = deployment(); const seeded = await legacy(t, oldAuthId); const before = await snapshot(t);
  const a = await recover(t);
  const input = { ownerId: seeded.ownerId, expectedLegacyAuthId: oldAuthId, verifiedAuthId: a.authId };
  await expect(t.run(ctx => rehearseIdentityRebind(ctx as any, input))).rejects.toThrow("Verified recovery contact mismatch");
  await a.verify(); const session = await a.signIn();
  await t.run(ctx => rehearseIdentityRebind(ctx as any, input));
  const after = await snapshot(t);
  expect(after.users).toHaveLength(2); expect(after.jobs).toEqual(before.jobs); expect(after.bundles).toEqual(before.bundles);
  expect(after.users.find(u => u._id === seeded.ownerId)?.authId).toBe(a.authId);
  expect(after.invites[0].claimedBy).toBe(seeded.ownerId);
  expect((await session.client.query(api.jobs.list, {})).map(j => j._id)).toEqual([seeded.jobs[0]]);
  expect(await session.client.query(api.resumeBundles.get, { jobId: seeded.jobs[0] })).toMatchObject({ resume: "Fictional saved draft", revision: 3 });
  expect(await session.client.query(api.resumeBundles.get, { jobId: seeded.jobs[1] })).toBeNull();
  await expect(session.client.mutation(api.jobs.remove, { id: seeded.jobs[1] })).rejects.toThrow("Job not found");
  // Supported recovery route establishes a NEW credential and revokes old sessions.
  expect((await request(t, "/request-password-reset", { email, redirectTo: origin })).status).toBe(200);
  const link = new URL(deliveredEmails.findLast(m => m.subject.includes("Reset"))!.text.trim().split("\n").at(-1)!);
  const callback = await request(t, link.pathname.replace("/api/auth", "") + link.search);
  const token = new URL(callback.headers.get("location")!).searchParams.get("token");
  const newPassword = "RecoveredFictionalPassword456";
  expect((await request(t, "/reset-password", { token, newPassword })).status).toBe(200);
  await expect(session.client.query(api.jobs.list, {})).rejects.toThrow("Authentication required");
  expect((await request(t, "/sign-in/email", { email, password })).status).toBe(401);
  const recovered = await a.signIn(newPassword);
  const exported = await recovered.client.query(api.account.exportData, {});
  expect(exported.jobs).toHaveLength(1); expect(exported.resumeBundles).toHaveLength(1);
  expect((await snapshot(t)).bundles).toEqual(before.bundles);
  expect((await request(t, "/reset-password", { token, newPassword })).status).toBeGreaterThanOrEqual(400);
  // Reapplying a stale manifest cannot reassign the recovered account.
  await expect(t.run(ctx => rehearseIdentityRebind(ctx as any, input))).rejects.toThrow("Stale legacy mapping");
});

test.each(["missingAuthId", "mismatch", "ambiguous", "unverifiedLegacy", "stale", "used", "discovery", "expiredInvite", "missingInvite", "overCapacity", "deleted", "abort"])(
  "%s recovery has explicit transactional continuity behavior", async scenario => {
    const t = deployment(); const seeded = await legacy(t);
    if (scenario === "missingAuthId") await t.run(ctx => ctx.db.patch(seeded.ownerId, { authId: undefined }));
    if (scenario === "unverifiedLegacy") await t.run(ctx => ctx.db.patch(seeded.ownerId, { emailVerificationTime: undefined }));
    if (scenario === "ambiguous") await t.run(ctx => ctx.db.insert("users", { email, emailVerificationTime: 1 }));
    const a = await recover(t, scenario === "mismatch" ? "wrong@migration.example.test" : email);
    await a.verify(); const { client } = await a.signIn();
    if (scenario === "used" || scenario === "discovery") {
      await client.mutation(api.privacy.acknowledge, {});
      if (scenario === "used") await client.mutation(api.jobs.create, jobInput("already-used"));
      else await client.mutation(api.discovery.project, discoveryProjection("already-used"));
      // Exercise owned-record guard independently of acknowledgement guard.
      await t.run(async ctx => { const row = await ctx.db.query("users").withIndex("by_auth_id", q => q.eq("authId", a.authId)).unique();
        await ctx.db.patch(row!._id, { privacyAcknowledgedAt: undefined }); });
    }
    if (scenario === "expiredInvite" || scenario === "missingInvite") await t.run(async ctx => {
      const invite = (await ctx.db.query("alphaInvites").unique())!;
      if (scenario === "missingInvite") await ctx.db.delete(invite._id);
      else await ctx.db.patch(invite._id, { expiredAt: Date.now() });
    });
    if (scenario === "overCapacity") await t.run(async ctx => {
      for (let i = 0; i < 100; i++) await ctx.db.insert("users", { authId: `legacy-capacity-${i}` });
    });
    if (scenario === "deleted") await t.run(ctx => ctx.db.delete(seeded.ownerId));
    const before = await snapshot(t);
    const run = () => t.run(async ctx => {
      await rehearseIdentityRebind(ctx as any, { ownerId: seeded.ownerId,
        expectedLegacyAuthId: scenario === "missingAuthId" ? null : scenario === "stale" ? "wrong" : "legacy-identity", verifiedAuthId: a.authId });
      if (scenario === "abort") throw new Error("Simulated cutover interruption");
    });
    if (scenario === "missingAuthId") {
      await run(); expect((await snapshot(t)).jobs).toEqual(before.jobs);
      expect((await snapshot(t)).bundles).toEqual(before.bundles);
      expect((await client.query(api.jobs.list, {}))).toHaveLength(1);
    } else {
      await expect(run()).rejects.toThrow(); expect(await snapshot(t)).toEqual(before);
    }
  });


test("frozen-write mapping rollback preserves legacy IDs and denies the new identity", async () => {
  const t = deployment(); const seeded = await legacy(t); const before = await snapshot(t);
  const a = await recover(t); await a.verify(); const { client } = await a.signIn();
  await t.run(ctx => rehearseIdentityRebind(ctx as any, { ownerId: seeded.ownerId,
    expectedLegacyAuthId: "legacy-identity", verifiedAuthId: a.authId }));
  await expect(client.query(api.jobs.list, {})).resolves.toHaveLength(1);
  // Simulated operator rollback in the frozen-write fixture. This is NOT an
  // assertion that a historical backend/schema/auth store can be redeployed.
  await t.run(async ctx => {
    const owner = await ctx.db.get(seeded.ownerId);
    expect(owner?.authId).toBe(a.authId);
    await ctx.db.patch(seeded.ownerId, { authId: "legacy-identity" });
  });
  await expect(client.query(api.jobs.list, {})).rejects.toThrow("Authentication required");
  const after = await snapshot(t);
  expect(after.users).toEqual(before.users);
  expect(after.jobs).toEqual(before.jobs); expect(after.bundles).toEqual(before.bundles);
  // Legacy's optional authId reader still resolves each owner and draft by ID.
  await t.run(async ctx => {
    for (const job of after.jobs) {
      expect(await ctx.db.get(job.ownerId!)).not.toBeNull();
      expect(await ctx.db.query("resumeBundles").withIndex("by_owner_job", q => q.eq("ownerId", job.ownerId!).eq("jobId", job._id)).unique())
        .toMatchObject({ resume: "Fictional saved draft", revision: 3 });
    }
  });
});
