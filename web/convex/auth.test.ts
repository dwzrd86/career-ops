import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { deliveredEmails } from "./auth.test.setup";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const securePassword = "a secure password 123";

function createTest() {
  return convexTest(schema, modules);
}

function signIn(
  t: ReturnType<typeof createTest>,
  params: Record<string, unknown>,
) {
  return t.action(api.auth.signIn, { params, provider: "password" });
}

async function issueInvite(t: ReturnType<typeof createTest>, expiresInMinutes = 60 * 24 * 7) {
  return await t.action(api.enrollment.issueInvite, {
    adminKey: "test-only-enrollment-admin-key",
    expiresInMinutes,
  });
}

function verificationCode(subject: string) {
  const email = [...deliveredEmails].reverse().find((candidate) => candidate.subject === subject);
  expect(email).toBeDefined();
  const code = email?.text.match(/\b\d{8}\b/)?.[0];
  expect(code).toBeDefined();
  return code!;
}

async function passwordAccount(t: ReturnType<typeof createTest>, email: string) {
  return await t.run(async (ctx) => await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (query) => query.eq("provider", "password").eq("providerAccountId", email))
    .unique());
}

async function passwordAccounts(t: ReturnType<typeof createTest>) {
  return await t.run(async (ctx) => await ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (query) => query.eq("provider", "password"))
    .collect());
}

function asPasswordUser(t: ReturnType<typeof createTest>, userId: Id<"users">) {
  return t.withIdentity({ issuer: "https://tests.example.test", subject: `${userId}|test-session` });
}

async function verifiedPasswordUser(t: ReturnType<typeof createTest>, email: string) {
  const invite = await issueInvite(t);
  await signIn(t, { botProtectionToken: "bot-token", email, flow: "signUp", inviteToken: invite.token, password: securePassword });
  const account = await passwordAccount(t, email);
  expect(account).not.toBeNull();
  await signIn(t, { code: verificationCode("email verification"), email, flow: "email-verification" });
  const user = asPasswordUser(t, account!.userId);
  await user.mutation(api.privacy.acknowledge, {});
  return user;
}

async function resetRequestNotice(t: ReturnType<typeof createTest>, email: string) {
  try {
    await signIn(t, { email, flow: "reset" });
  } catch {
    // Keep this aligned with AccessScreen: reset requests never surface a
    // known-versus-unknown address distinction to the person requesting it.
  }
  return "If an account matches that address, a reset code is on its way.";
}

beforeEach(() => {
  deliveredEmails.splice(0);
  vi.useRealTimers();
});

describe("password account lifecycle", () => {
  test("rejects malformed addresses and weak passwords before creating an account", async () => {
    const t = createTest();

    await expect(signIn(t, {
      botProtectionToken: "bot-token",
      email: "not-an-email",
      flow: "signUp",
      password: securePassword,
    })).rejects.toThrow("valid email");

    await expect(signIn(t, {
      botProtectionToken: "bot-token",
      email: "weak@example.test",
      flow: "signUp",
      password: "too-short",
    })).rejects.toThrow("at least 12 characters");

    expect(await passwordAccount(t, "weak@example.test")).toBeNull();
  });

  test("normalizes addresses and delivers verification through fake mail after a valid invite", async () => {
    const t = createTest();
    const email = "candidate@example.test";
    const invite = await issueInvite(t);

    await expect(signIn(t, {
      botProtectionToken: "bot-token",
      email: " Candidate@Example.Test ",
      flow: "signUp",
      inviteToken: invite.token,
      password: securePassword,
    })).resolves.toMatchObject({ tokens: null });

    const account = await passwordAccount(t, email);
    expect(account).toMatchObject({ providerAccountId: email });
    expect(account?.emailVerified).toBeUndefined();
    expect(deliveredEmails).toHaveLength(1);
    expect(deliveredEmails[0]).toMatchObject({ subject: "email verification", to: email });
    await t.run(async (ctx) => {
      const storedInvite = await ctx.db
        .query("alphaInvites")
        .withIndex("by_claimed_by", (query) => query.eq("claimedBy", account!.userId))
        .unique();
      expect(storedInvite).toMatchObject({ claimedBy: account!.userId, claimedAt: expect.any(Number) });
      expect(storedInvite?.tokenHash).not.toBe(invite.token);
      expect(storedInvite).not.toHaveProperty("token");

      const events = await ctx.db.query("enrollmentAuditEvents").collect();
      expect(events.map((event) => event.event)).toEqual(["inviteIssued", "inviteReserved", "inviteAccepted"]);
      for (const event of events) {
        expect(event).not.toHaveProperty("email");
        expect(event).not.toHaveProperty("token");
        expect(event).not.toHaveProperty("userId");
      }
    });

    // Verification may be resent through its dedicated flow, without making a
    // second sign-up attempt or reusing an invite.
    await expect(signIn(t, { email, flow: "email-verification" })).resolves.toMatchObject({ tokens: null });
    expect(await passwordAccounts(t)).toHaveLength(1);
    expect(deliveredEmails).toHaveLength(2);
  });

  test("requires a current privacy acknowledgement before a verified user can save career data", async () => {
    const t = createTest();
    const email = "verified@example.test";
    const invite = await issueInvite(t);
    await signIn(t, { botProtectionToken: "bot-token", email, flow: "signUp", inviteToken: invite.token, password: securePassword });
    const account = await passwordAccount(t, email);
    expect(account).not.toBeNull();
    const accountUser = asPasswordUser(t, account!.userId);

    await expect(accountUser.query(api.jobs.list)).rejects.toThrow("Email verification required");
    await expect(signIn(t, { code: verificationCode("email verification"), email, flow: "email-verification" }))
      .resolves.toMatchObject({ tokens: expect.any(Object) });

    expect((await passwordAccount(t, email))?.emailVerified).toBe(email);
    await expect(accountUser.query(api.jobs.list)).resolves.toEqual([]);
    await expect(accountUser.mutation(api.jobs.create, {
      company: "Example Co",
      location: "Remote",
      source: "Test",
      title: "Security Engineer",
      url: "https://example.test/jobs/1",
    })).rejects.toThrow("Privacy acknowledgement required");

    await expect(accountUser.query(api.privacy.status)).resolves.toEqual({
      acknowledgedAt: null,
      currentVersion: "2026-08-01",
      requiresAcknowledgement: true,
    });
    await accountUser.mutation(api.privacy.acknowledge, {});
    const privacyStatus = await accountUser.query(api.privacy.status);
    expect(privacyStatus).toMatchObject({
      acknowledgedAt: expect.any(Number),
      currentVersion: "2026-08-01",
      requiresAcknowledgement: false,
    });
    await t.run(async (ctx) => {
      const user = await ctx.db.get(account!.userId);
      expect(user).toMatchObject({
        privacyAcknowledgedAt: privacyStatus.acknowledgedAt,
        privacyPolicyVersion: "2026-08-01",
      });
      expect(user).not.toHaveProperty("privacyPolicyText");
    });
    await expect(accountUser.mutation(api.jobs.create, {
      company: "Example Co",
      location: "Remote",
      source: "Test",
      title: "Security Engineer",
      url: "https://example.test/jobs/1",
    })).resolves.toEqual(expect.any(String));
  });

  test("rejects an expired password reset code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const t = createTest();
    const email = "expired-reset@example.test";
    const invite = await issueInvite(t);
    await signIn(t, { botProtectionToken: "bot-token", email, flow: "signUp", inviteToken: invite.token, password: securePassword });
    await signIn(t, { email, flow: "reset" });
    const code = verificationCode("password reset");

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    await expect(signIn(t, {
      code,
      email,
      flow: "reset-verification",
      newPassword: "another secure password 456",
    })).rejects.toThrow();
  });

  test("enforces the hourly reset rate limit and gives unknown reset requests the same UI-safe outcome", async () => {
    const t = createTest();
    const email = "limited@example.test";
    const invite = await issueInvite(t);
    await signIn(t, { botProtectionToken: "bot-token", email, flow: "signUp", inviteToken: invite.token, password: securePassword });

    expect(await resetRequestNotice(t, email)).toBe(await resetRequestNotice(t, "unknown@example.test"));

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(signIn(t, { email, flow: "reset" })).resolves.toMatchObject({ tokens: null });
    }
    await expect(signIn(t, { email, flow: "reset" })).rejects.toThrow("Authentication temporarily unavailable");

    // The React access screen intentionally presents this exact same notice whether the request resolves or rejects.
    await expect(signIn(t, { email: "unknown@example.test", flow: "reset" })).rejects.toThrow();
  });
});

describe("closed alpha enrollment", () => {
  test("rejects invalid invite tokens before creating an account", async () => {
    const t = createTest();
    await expect(signIn(t, {
      botProtectionToken: "bot-token",
      email: "invalid-invite@example.test",
      flow: "signUp",
      inviteToken: "not-an-invite",
      password: securePassword,
    })).rejects.toThrow("valid alpha invite");
    expect(await passwordAccount(t, "invalid-invite@example.test")).toBeNull();
  });

  test("rejects expired unused invites before creating an account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const t = createTest();
    const invite = await issueInvite(t, 1);
    vi.advanceTimersByTime(60 * 1000 + 1);

    await expect(signIn(t, {
      botProtectionToken: "bot-token",
      email: "expired-invite@example.test",
      flow: "signUp",
      inviteToken: invite.token,
      password: securePassword,
    })).rejects.toThrow("expired");
    expect(await passwordAccount(t, "expired-invite@example.test")).toBeNull();
  });

  test("rejects reuse of an invite by the same account", async () => {
    const t = createTest();
    const invite = await issueInvite(t);
    const signup = { botProtectionToken: "bot-token", email: "reused-invite@example.test", flow: "signUp", inviteToken: invite.token, password: securePassword };
    await expect(signIn(t, signup)).resolves.toMatchObject({ tokens: null });
    await expect(signIn(t, signup)).rejects.toThrow("no longer available");
    expect(await passwordAccounts(t)).toHaveLength(1);
  });

  test("rejects a cross-account attempt to use a claimed invite", async () => {
    const t = createTest();
    const invite = await issueInvite(t);
    await signIn(t, {
      botProtectionToken: "bot-token",
      email: "first-invite@example.test",
      flow: "signUp",
      inviteToken: invite.token,
      password: securePassword,
    });
    await expect(signIn(t, {
      botProtectionToken: "bot-token",
      email: "second-invite@example.test",
      flow: "signUp",
      inviteToken: invite.token,
      password: securePassword,
    })).rejects.toThrow("no longer available");
    expect(await passwordAccount(t, "second-invite@example.test")).toBeNull();
  });
});

describe("job input validation", () => {
  test("backend failure reports retain diagnostic metadata but not job input", async () => {
    const t = createTest();
    const user = await verifiedPasswordUser(t, "error-reporting@example.test");
    const reportError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const privateNotes = "Private job note: do not contact my manager";
    const resumeFile = "candidate-resume.pdf";
    const fullUrl = "http://jobs.example.test/apply?token=secret-token&answer=private-answer";

    try {
      await expect(user.mutation(api.jobs.create, {
        company: "Example Company",
        location: "Remote",
        notes: `${privateNotes}; attachment=${resumeFile}`,
        source: "Manual entry",
        title: "Security Engineer",
        url: fullUrl,
      })).rejects.toThrow("valid HTTPS URL");

      expect(reportError).toHaveBeenCalledTimes(1);
      const report = JSON.parse(String(reportError.mock.calls[0][1]));
      expect(report).toEqual(expect.objectContaining({
        deploymentVersion: "unversioned",
        errorCategory: "validationFailed",
        operationType: "jobs.create",
        route: "/convex",
        occurredAt: expect.any(Number),
      }));
      const reportText = JSON.stringify(report);
      for (const value of [privateNotes, resumeFile, fullUrl, "secret-token", "private-answer"]) {
        expect(reportText).not.toContain(value);
      }
      expect(report).not.toHaveProperty("userId");
      expect(report).not.toHaveProperty("message");
      expect(report).not.toHaveProperty("stack");
    } finally {
      reportError.mockRestore();
    }
  });

  test("normalizes persisted job fields and accepts only parseable HTTPS URLs", async () => {
    const t = createTest();
    const user = await verifiedPasswordUser(t, "jobs@example.test");

    const id = await user.mutation(api.jobs.create, {
      company: "  Example\n\tCompany  ",
      location: "  Remote   -  USA ",
      notes: "  First\n\npriority  ",
      source: "  Company   careers page ",
      title: "  Security\tEngineer  ",
      url: "  HTTPS://EXAMPLE.TEST/jobs/1  ",
    });

    await t.run(async (ctx) => {
      expect(await ctx.db.get(id)).toMatchObject({
        company: "Example Company",
        location: "Remote - USA",
        notes: "First priority",
        source: "Company careers page",
        title: "Security Engineer",
        url: "https://example.test/jobs/1",
      });
    });

    await expect(user.mutation(api.jobs.create, {
      company: "Example Company",
      location: "Remote",
      source: "Manual entry",
      title: "Security Engineer",
      url: "http://example.test/jobs/1",
    })).rejects.toThrow("valid HTTPS URL");
    await expect(user.mutation(api.jobs.create, {
      company: "Example Company",
      location: "Remote",
      source: "Manual entry",
      title: "Security Engineer",
      url: "https://user:password@example.test/jobs/1",
    })).rejects.toThrow("valid HTTPS URL");
  });

  test("rejects blank or oversized fields and invalid statuses", async () => {
    const t = createTest();
    const user = await verifiedPasswordUser(t, "job-limits@example.test");
    const validJob = {
      company: "Example Company",
      location: "Remote",
      source: "Manual entry",
      title: "Security Engineer",
      url: "https://example.test/jobs/1",
    };
    const id = await user.mutation(api.jobs.create, validJob);

    await expect(user.mutation(api.jobs.create, { ...validJob, company: " \n\t " }))
      .rejects.toThrow("company is required");
    await expect(user.mutation(api.jobs.create, { ...validJob, title: "a".repeat(201) }))
      .rejects.toThrow("title must be at most 200 characters");
    await expect(user.mutation(api.jobs.create, { ...validJob, notes: "a".repeat(4_001) }))
      .rejects.toThrow("notes must be at most 4000 characters");
    await expect(user.mutation(api.jobs.updateStatus, { id, status: "invented" as any }))
      .rejects.toThrow();
  });
});

describe("job ownership authorization", () => {
  const validJob = {
    company: "Example Company",
    location: "Remote",
    source: "Manual entry",
    title: "Security Engineer",
    url: "https://example.test/jobs/1",
  };

  test("rejects anonymous pipeline reads and mutations", async () => {
    const t = createTest();
    const owner = await verifiedPasswordUser(t, "owner@example.test");
    const id = await owner.mutation(api.jobs.create, validJob);

    await expect(t.query(api.jobs.list)).rejects.toThrow("Authentication required");
    await expect(t.mutation(api.jobs.create, validJob)).rejects.toThrow("Authentication required");
    await expect(t.mutation(api.jobs.updateStatus, { id, status: "applied" })).rejects.toThrow("Authentication required");
    await expect(t.mutation(api.jobs.remove, { id })).rejects.toThrow("Authentication required");
  });

  test("does not reveal or modify another user's job", async () => {
    const t = createTest();
    const owner = await verifiedPasswordUser(t, "owner@example.test");
    const otherUser = await verifiedPasswordUser(t, "other@example.test");
    const ownerJobId = await owner.mutation(api.jobs.create, validJob);
    const otherJobId = await otherUser.mutation(api.jobs.create, { ...validJob, title: "Other user's role" });

    await expect(otherUser.mutation(api.jobs.updateStatus, { id: ownerJobId, status: "applied" }))
      .rejects.toThrow("Job not found");
    await expect(otherUser.mutation(api.jobs.remove, { id: ownerJobId }))
      .rejects.toThrow("Job not found");
    await expect(owner.query(api.jobs.list)).resolves.toEqual([
      expect.objectContaining({ _id: ownerJobId, status: "discovered" }),
    ]);
    await expect(otherUser.query(api.jobs.list)).resolves.toEqual([
      expect.objectContaining({ _id: otherJobId, title: "Other user's role" }),
    ]);

    await owner.mutation(api.jobs.remove, { id: ownerJobId });
    await expect(owner.query(api.jobs.list)).resolves.toEqual([]);
    await expect(otherUser.query(api.jobs.list)).resolves.toEqual([
      expect.objectContaining({ _id: otherJobId, title: "Other user's role" }),
    ]);
  });
});
