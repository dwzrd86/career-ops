import { vi } from "vitest";

export type DeliveredEmail = {
  subject: string;
  text: string;
  to: string;
};

export const deliveredEmails: DeliveredEmail[] = [];

process.env.AUTH_ABUSE_KEY = "test-only-abuse-key";
process.env.ENROLLMENT_ADMIN_KEY = "test-only-enrollment-admin-key";
process.env.ENROLLMENT_INVITE_KEY = "test-only-enrollment-invite-key";
process.env.AUTH_RESEND_FROM = "Jobbie Tests <test@example.test>";
process.env.AUTH_RESEND_KEY = "test-only-resend-key";
process.env.AUTH_TURNSTILE_HOSTNAME = "tests.example.test";
process.env.AUTH_TURNSTILE_SECRET = "test-only-turnstile-secret";
process.env.CONVEX_SITE_URL = "https://tests.example.test";
process.env.SITE_URL = "https://tests.example.test";
vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    return Response.json({ action: "signup", hostname: "tests.example.test", success: true });
  }
  if (url === "https://api.resend.com/emails") {
    const payload = JSON.parse(String(init?.body)) as { subject: string; text: string; to: string[] };
    deliveredEmails.push({ subject: payload.subject, text: payload.text, to: payload.to[0] });
    return Response.json({ id: "fake-email" }, { status: 200 });
  }
  return new Response("Unexpected request", { status: 500 });
}));
