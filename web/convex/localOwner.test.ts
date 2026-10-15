import betterAuthTest from "@convex-dev/better-auth/test";
import { convexTest } from "convex-test";
import { afterEach, expect, test } from "vitest";
import { api, internal, components } from "./_generated/api";
import { requireLocalOwnerSetup } from "./localOwner";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const previous = { site: process.env.SITE_URL, convex: process.env.CONVEX_SITE_URL };
afterEach(() => {
  delete process.env.AUTH_LOCAL_OWNER_SETUP;
  process.env.SITE_URL = previous.site;
  process.env.CONVEX_SITE_URL = previous.convex;
});
function localConfig() {
  process.env.AUTH_LOCAL_OWNER_SETUP = "dev:local-test";
  process.env.CONVEX_SITE_URL = "https://local-test.convex.site";
  process.env.SITE_URL = "http://127.0.0.1:5174";
}
function deployment() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  return t;
}

test("owner setup fails closed without operator authorization and matching dev/loopback configuration", () => {
  expect(() => requireLocalOwnerSetup("test-only-enrollment-admin-key")).toThrow();
  localConfig();
  expect(() => requireLocalOwnerSetup("wrong-key")).toThrow();
  expect(() => requireLocalOwnerSetup("test-only-enrollment-admin-key")).not.toThrow();
  process.env.SITE_URL = "https://public.example.test";
  expect(() => requireLocalOwnerSetup("test-only-enrollment-admin-key")).toThrow();
  localConfig(); process.env.AUTH_LOCAL_OWNER_SETUP = "prod:local-test";
  expect(() => requireLocalOwnerSetup("test-only-enrollment-admin-key")).toThrow();
  localConfig(); process.env.CONVEX_SITE_URL = "https://different.convex.site";
  expect(() => requireLocalOwnerSetup("test-only-enrollment-admin-key")).toThrow();
});

test("owner reservation is exclusive, retryable for the same identity, and closes after an account exists", async () => {
  const t = deployment();
  await t.mutation(internal.localOwner.reserve, { emailHash: "first-owner-hash" });
  await t.mutation(internal.localOwner.reserve, { emailHash: "first-owner-hash" });
  await expect(t.mutation(internal.localOwner.reserve, { emailHash: "other-owner-hash" })).rejects.toThrow("already in progress");
  expect((await t.run(ctx => ctx.db.query("alphaInvites").collect())).length).toBe(1);
  await t.run(ctx => ctx.db.insert("users", { authId: "existing-owner" }));
  await expect(t.mutation(internal.localOwner.reserve, { emailHash: "first-owner-hash" })).rejects.toThrow("already exists");
});

test("local owner action creates a verified password account and enrolls it without email or bot requests", async () => {
  localConfig();
  const t = deployment();
  const result = await t.action(api.localOwner.create, { adminKey: "test-only-enrollment-admin-key",
    email: "owner@local-test.example", password: "OwnerTestPassword123" });
  expect(result.created).toBe(true);
  const user = await t.run(ctx => ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "user", where: [{ field: "email", value: "owner@local-test.example" }],
  }));
  expect(user?.emailVerified).toBe(true);
  const users = await t.run(ctx => ctx.db.query("users").take(2));
  expect(users).toHaveLength(1);
  const invite = await t.run(ctx => ctx.db.query("alphaInvites").withIndex("by_claimed_by", q => q.eq("claimedBy", users[0]._id)).unique());
  expect(invite?.tokenHash).toBe("local-owner-bootstrap");
  await expect(t.action(api.localOwner.create, { adminKey: "test-only-enrollment-admin-key",
    email: "second@local-test.example", password: "OwnerTestPassword123" })).rejects.toThrow("already exists");
});
