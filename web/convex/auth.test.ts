import { beforeEach, describe, expect, test } from "vitest";
import {
  inviteTokenHash,
  normalizeInviteToken,
  reservationEmailHash,
  secureEquals,
} from "./enrollmentCore";

beforeEach(() => {
  process.env.ENROLLMENT_INVITE_KEY = "test-only-enrollment-invite-key";
});

describe("Better Auth enrollment boundary", () => {
  test("accepts only opaque Jobbie invite tokens", () => {
    expect(normalizeInviteToken(" jbi_abcdefghijklmnopqrstuvwxyzABCDEF0123456789_- "))
      .toBe("jbi_abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-");
    expect(() => normalizeInviteToken("not-an-invite")).toThrow("valid alpha invite");
    expect(() => normalizeInviteToken("jbi_short")).toThrow("valid alpha invite");
  });

  test("derives keyed token and reservation values without retaining raw input", async () => {
    const token = "jbi_abcdefghijklmnopqrstuvwxyzABCDEF0123456789_-";
    const tokenHash = await inviteTokenHash(token);
    const firstAddressHash = await reservationEmailHash(" Candidate@Example.Test ");
    const secondAddressHash = await reservationEmailHash("candidate@example.test");

    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash).not.toContain(token);
    expect(firstAddressHash).toBe(secondAddressHash);
    expect(firstAddressHash).not.toContain("candidate@example.test");
  });

  test("compares operator secrets without early return", () => {
    expect(secureEquals("same-secret", "same-secret")).toBe(true);
    expect(secureEquals("same-secret", "different-secret")).toBe(false);
    expect(secureEquals("short", "longer")).toBe(false);
  });
});
