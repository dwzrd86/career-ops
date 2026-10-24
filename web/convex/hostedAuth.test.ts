import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import { deliveredEmails } from "./auth.test.setup";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const email = "candidate@hosted-auth.example.test";
const password = "FictionalPassword123";
const origin = "https://tests.example.test";

function deployment() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}
type Deployment = ReturnType<typeof deployment>;

async function request(t: Deployment, path: string, body?: Record<string, unknown>, cookie?: string) {
  return t.fetch(`/api/auth${path}`, {
    method: body ? "POST" : "GET",
    headers: { origin, "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function invite(t: Deployment) {
  return (await t.action(api.enrollment.issueInvite, { adminKey: "test-only-enrollment-admin-key" })).token;
}
async function signup(t: Deployment, token: string, address = email) {
  return request(t, "/sign-up/email", {
    email: address, password, name: "Fictional Candidate", inviteToken: token,
    botProtectionToken: "fake-bot-token", callbackURL: origin,
  });
}
function deliveredLink(subject: string) {
  const message = deliveredEmails.findLast(item => item.subject.includes(subject));
  expect(message?.to).toBe(email);
  return new URL(message!.text.trim().split("\n").at(-1)!);
}
async function verify(t: Deployment) {
  const link = deliveredLink("Verify");
  return request(t, `/verify-email${link.search}`);
}
function cookieFrom(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}
async function users(t: Deployment) {
  return t.run(ctx => ctx.db.query("users").collect());
}

beforeEach(() => { deliveredEmails.length = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.mocked(fetch).mockClear(); });

describe("configured hosted auth HTTP lifecycle (in-memory component, fake mail/bot only)", () => {
  test("signup claims a single invite, refuses unverified sign-in and app access, then verifies", async () => {
    const t = deployment();
    const token = await invite(t);
    const response = await signup(t, token);
    expect(response.status).toBe(200);
    expect((await response.json()).token).toBeNull();
    const [user] = await users(t);
    expect(user).toBeDefined();
    expect(await t.run(ctx => ctx.db.query("alphaInvites").unique())).toMatchObject({ claimedBy: user._id });
    expect((await request(t, "/sign-in/email", { email, password })).status).toBe(403);
    const session = await t.run(ctx => ctx.runMutation(components.betterAuth.adapter.create, {
      input: { model: "session", data: { userId: user.authId!, token: "unverified-fixture-session",
        createdAt: Date.now(), updatedAt: Date.now(), expiresAt: Date.now() + 60_000 } },
    })) as { _id: string };
    const unverified = t.withIdentity({ subject: user.authId, sessionId: session._id } as any);
    await expect(unverified.query(api.enrollment.status, {})).rejects.toThrow("Email verification required");
    await expect(unverified.query(api.jobs.list, {})).rejects.toThrow("Email verification required");
    const verified = await verify(t);
    expect(verified.status).toBeLessThan(400);
    expect((await request(t, "/sign-in/email", { email, password })).status).toBe(200);
    await expect(unverified.query(api.enrollment.status, {})).resolves.toEqual({ enrolled: true });
    const reused = await signup(t, token, "second@hosted-auth.example.test");
    expect(reused.status).toBeGreaterThanOrEqual(400);
    expect(await users(t)).toHaveLength(1);
  });

  test("expired and currently reserved invitations cannot create an account", async () => {
    for (const state of ["expired", "reserved"] as const) {
      const t = deployment();
      const token = await invite(t);
      await t.run(async ctx => {
        const record = (await ctx.db.query("alphaInvites").unique())!;
        await ctx.db.patch(record._id, state === "expired" ? { expiresAt: Date.now() - 1 } : {
          reservationEmailHash: "another-address", reservationExpiresAt: Date.now() + 60_000, reservationId: "another-request",
        });
      });
      expect((await signup(t, token)).status).toBeGreaterThanOrEqual(400);
      expect(await users(t)).toHaveLength(0);
      expect(deliveredEmails).toHaveLength(0);
    }
  });

  test.each([
    { success: false },
    { success: true, hostname: "wrong.example.test", action: "signup" },
    { success: true, hostname: "tests.example.test", action: "wrong-action" },
  ])("bot rejection fails before invitation reservation: %j", async result => {
    const t = deployment();
    const token = await invite(t);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(result));
    const response = await signup(t, token);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BOT_VERIFICATION_FAILED" });
    expect(await users(t)).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("alphaInvites").unique())).not.toHaveProperty("reservationId");
    expect(deliveredEmails).toHaveLength(0);
  });

  test.each(["AUTH_ABUSE_KEY", "AUTH_RESEND_FROM", "AUTH_RESEND_KEY", "AUTH_TURNSTILE_HOSTNAME", "AUTH_TURNSTILE_SECRET", "ENROLLMENT_INVITE_KEY"])("missing %s reports safe configuration failure before external calls", async key => {
    const t = deployment();
    const token = await invite(t);
    vi.stubEnv(key, "");
    const response = await signup(t, token);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_CONFIGURATION_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await users(t)).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("alphaInvites").unique())).not.toHaveProperty("reservationId");
  });

  test("password reset consumes its token, changes the credential and revokes every existing session", async () => {
    const t = deployment();
    expect((await signup(t, await invite(t))).status).toBe(200);
    await verify(t);
    const first = await request(t, "/sign-in/email", { email, password });
    const second = await request(t, "/sign-in/email", { email, password });
    const cookies = [cookieFrom(first), cookieFrom(second)];
    const clients = [];
    for (const cookie of cookies) {
      const session = await (await request(t, "/get-session", undefined, cookie)).json();
      expect(session?.user.email).toBe(email);
      const client = t.withIdentity({ subject: session.user.id, sessionId: session.session.id } as any);
      await expect(client.query(api.enrollment.status, {})).resolves.toEqual({ enrolled: true });
      clients.push(client);
    }
    expect((await request(t, "/request-password-reset", { email, redirectTo: origin })).status).toBe(200);
    const link = deliveredLink("Reset");
    const callback = await request(t, link.pathname.replace("/api/auth", "") + link.search);
    const token = new URL(callback.headers.get("location")!).searchParams.get("token");
    expect(token).toBeTruthy();
    const newPassword = "ChangedFictionalPassword456";
    expect((await request(t, "/reset-password", { token, newPassword })).status).toBe(200);
    for (const cookie of cookies) {
      expect(await (await request(t, "/get-session", undefined, cookie)).json()).toBeNull();
    }
    for (const client of clients) {
      await expect(client.query(api.enrollment.status, {})).rejects.toThrow("Authentication required");
    }
    expect((await request(t, "/sign-in/email", { email, password })).status).toBe(401);
    expect((await request(t, "/sign-in/email", { email, password: newPassword })).status).toBe(200);
    expect((await request(t, "/reset-password", { token, newPassword })).status).toBeGreaterThanOrEqual(400);
  });

  test("invalid verification and expired reset links fail without granting access or changing credentials", async () => {
    const t = deployment();
    expect((await signup(t, await invite(t))).status).toBe(200);
    const badVerification = await request(t, "/verify-email?token=invalid-token&callbackURL=" + encodeURIComponent(origin));
    expect(badVerification.headers.get("location")).toContain("error=");
    expect((await request(t, "/sign-in/email", { email, password })).status).toBe(403);
    await verify(t);
    await request(t, "/request-password-reset", { email, redirectTo: origin });
    const link = deliveredLink("Reset");
    const token = link.pathname.split("/").at(-1)!;
    await t.run(async ctx => {
      const record = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "verification", where: [{ field: "identifier", value: `reset-password:${token}` }],
      });
      expect(record).not.toBeNull();
      expect(record!.expiresAt - Date.now()).toBeGreaterThan(14 * 60_000);
      expect(record!.expiresAt - Date.now()).toBeLessThanOrEqual(15 * 60_000);
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: { model: "verification", where: [{ field: "_id", value: record!._id }], update: { expiresAt: Date.now() - 1 } },
      });
    });
    expect((await request(t, "/reset-password", { token, newPassword: "UnauthorizedPassword456" })).status).toBeGreaterThanOrEqual(400);
    expect((await request(t, "/sign-in/email", { email, password })).status).toBe(200);
  });

  test("supported delete-user route removes credentials, all sessions and app data while preserving another account", async () => {
    const t = deployment();
    expect((await signup(t, await invite(t))).status).toBe(200);
    await verify(t);
    const cookies = [];
    const clients = [];
    for (let i = 0; i < 2; i++) {
      const cookie = cookieFrom(await request(t, "/sign-in/email", { email, password }));
      cookies.push(cookie);
      const session = await (await request(t, "/get-session", undefined, cookie)).json();
      clients.push(t.withIdentity({ subject: session.user.id, sessionId: session.session.id } as any));
    }
    const [owner] = await users(t);
    const otherEmail = "other@hosted-auth.example.test";
    expect((await signup(t, await invite(t), otherEmail)).status).toBe(200);
    const otherLink = new URL(deliveredEmails.findLast(item => item.to === otherEmail)!.text.trim().split("\n").at(-1)!);
    expect((await request(t, `/verify-email${otherLink.search}`)).status).toBeLessThan(400);
    const otherCookie = cookieFrom(await request(t, "/sign-in/email", { email: otherEmail, password }));
    await clients[0].mutation(api.privacy.acknowledge, {});
    await clients[0].mutation(api.jobs.create, { company: "Fictional Co", title: "Analyst", location: "Remote", source: "manual", url: "https://jobs.example.test/delete" });
    // A failed password check cannot start cleanup or revoke either session.
    expect((await request(t, "/delete-user", { password: "IncorrectPassword123" }, cookies[0])).status).toBeGreaterThanOrEqual(400);
    expect(await users(t)).toHaveLength(2);
    expect((await clients[0].query(api.jobs.list, {}))).toHaveLength(1);
    expect((await request(t, "/delete-user", { password }, cookies[0])).status).toBe(200);
    for (const cookie of cookies) expect(await (await request(t, "/get-session", undefined, cookie)).json()).toBeNull();
    for (const client of clients) await expect(client.query(api.account.exportData, {})).rejects.toThrow("Authentication required");
    expect((await request(t, "/sign-in/email", { email, password })).status).toBe(401);
    expect((await (await request(t, "/get-session", undefined, otherCookie)).json()).user.email).toBe(otherEmail);
    await t.run(async ctx => {
      for (const model of ["user", "session", "account"] as const) {
        expect(await ctx.runQuery(components.betterAuth.adapter.findOne, { model,
          where: [{ field: model === "user" ? "_id" : "userId", value: owner.authId }] })).toBeNull();
      }
      expect(await ctx.db.get(owner._id)).toBeNull();
      expect(await ctx.db.query("jobs").withIndex("by_owner_created_at", q => q.eq("ownerId", owner._id)).collect()).toEqual([]);
      expect((await ctx.db.query("users").collect()).map(row => row.authId)).not.toContain(owner.authId);
    });
    // Verification/recovery records remain component-managed and expiry-bound;
    // this test makes no assertion of physical removal from providers/backups.
  });

  test("hosted local-owner action rejects even the correct operator credential before side effects", async () => {
    const t = deployment();
    for (const selected of ["", "prod:tests", "dev:tests"]) {
      vi.stubEnv("AUTH_LOCAL_OWNER_SETUP", selected);
      await expect(t.action(api.localOwner.create, { adminKey: "test-only-enrollment-admin-key", email, password })).rejects.toThrow("Local owner setup");
    }
    expect(await users(t)).toHaveLength(0);
    expect(await t.run(ctx => ctx.db.query("alphaInvites").collect())).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
