const INVITE_PREFIX = "jbi_";

function requiredEnrollmentEnvironment() {
  const value = process.env.ENROLLMENT_INVITE_KEY;
  if (!value) {
    throw new Error("Alpha enrollment is temporarily unavailable. Please try again later.");
  }
  return value;
}

export function normalizeInviteToken(value: unknown) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!new RegExp(`^${INVITE_PREFIX}[A-Za-z0-9_-]{32,128}$`).test(token)) {
    throw new Error("A valid alpha invite is required.");
  }
  return token;
}

export async function inviteTokenHash(value: unknown) {
  const token = normalizeInviteToken(value);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requiredEnrollmentEnvironment()),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${INVITE_PREFIX}${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
}

export function secureEquals(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const maximumLength = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < maximumLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
