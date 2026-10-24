import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { api, components, internal } from "./_generated/api";
import { reservationEmailHash } from "./enrollmentCore";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type DisposableAccount = {
  authUser: { _id: string; email: string };
  client: ReturnType<typeof convexTest>;
  userId: string;
};

export function createIsolatedDeployment() {
  const deployment = convexTest(schema, modules);
  betterAuthTest.register(deployment);
  return deployment;
}

export async function provisionDisposableAccount(
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

export const jobInput = (label: string) => ({
  company: `${label} Company`,
  location: "Remote",
  notes: `${label} private note`,
  source: "Manual entry",
  title: `${label} Engineer`,
  url: `https://jobs.example.test/${label}`,
});

export const discoveryProjection = (label: string) => {
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
