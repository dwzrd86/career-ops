// Server-only transport. Never import this module from src/.
import { parseResumeDraft } from "../src/resumeTailoring";

export const ZAI_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";
export const PROVIDER_TIMEOUT_MS = 45_000;
export const MAX_RESPONSE_BYTES = 256_000;
export type Permit = {
  provider: string; model: string; brief: string; evidence: string;
  maxInputTokens: number; maxTotalOutputTokens: number;
  inputMicroUsdPerMillion: number; outputMicroUsdPerMillion: number;
};

export function providerBody(permit: Permit, boundsEvidence: string | undefined) {
  if (permit.provider !== "zai" || permit.model !== "glm-4.7"
    || !boundsEvidence || boundsEvidence !== permit.evidence) throw new Error("UNAVAILABLE");
  const body = JSON.stringify({ model: "glm-4.7", stream: false,
    thinking: { type: "disabled" }, max_tokens: permit.maxTotalOutputTokens,
    messages: [{ role: "user", content: permit.brief }] });
  // CONDITIONAL bound: release must verify <=1 token/UTF-8 byte plus <=4096
  // provider template tokens, and max_tokens covering ALL billable output.
  // Matching server attestation is required; this arithmetic is not that proof.
  if (!Number.isSafeInteger(permit.maxInputTokens) || permit.maxInputTokens > 200_000
    || !Number.isSafeInteger(permit.maxTotalOutputTokens) || permit.maxTotalOutputTokens < 1
    || permit.maxTotalOutputTokens > 8_192
    || new TextEncoder().encode(body).length + 4_096 > permit.maxInputTokens) throw new Error("UNAVAILABLE");
  return body;
}

async function boundedJson(response: Response) {
  if (!response.body) throw new Error("PROVIDER_FAILED");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("PROVIDER_FAILED");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally { await reader.cancel().catch(() => {}); }
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function count(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000;
}
export type ProviderResult = { draft: string | null; billedMicroUsd: number | null;
  failureCode?: "providerBalance" | "providerRateLimited" | "providerOverloaded" | "providerTimeout" };

// One fetch, no SDK retries, no redirects/key forwarding, no alternate endpoint.
// Fixed results only: never bubble provider bodies/errors/headers into logs.
export async function callProvider(body: string, key: string, permit: Permit): Promise<ProviderResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unknown = { draft: null, billedMicroUsd: null };
  const operation = async (): Promise<ProviderResult> => {
    const response = await fetch(ZAI_ENDPOINT, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body, signal: controller.signal });
    if (!response.ok) {
      const data = record(await boundedJson(response));
      const code = String(record(data?.error)?.code ?? data?.code ?? "");
      const codes = { "1113": "providerBalance", "1302": "providerRateLimited", "1305": "providerOverloaded" } as const;
      const failureCode = codes[code as keyof typeof codes];
      return failureCode ? { ...unknown, failureCode } : unknown;
    }
    const data = record(await boundedJson(response));
    if (!data || data.model !== permit.model) return unknown;
    const choices = data.choices;
    const choice = Array.isArray(choices) && choices.length === 1 ? record(choices[0]) : null;
    const message = record(choice?.message);
    // Unexpected reasoning/tools/search invalidate the attested billing boundary.
    if (message?.reasoning_content || (message?.tool_calls !== undefined
      && (!Array.isArray(message.tool_calls) || message.tool_calls.length))
      || (data.web_search !== undefined && (!Array.isArray(data.web_search) || data.web_search.length))) return unknown;
    const usage = record(data.usage);
    if (!usage || !count(usage.prompt_tokens) || !count(usage.completion_tokens)
      || !count(usage.total_tokens) || usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) return unknown;
    // No assumed cache discount. Settle a conservative charge upper bound at
    // the reserved uncached rates; release reconciles it against actual bills.
    const billedMicroUsd = Number((BigInt(usage.prompt_tokens) * BigInt(permit.inputMicroUsdPerMillion)
      + BigInt(usage.completion_tokens) * BigInt(permit.outputMicroUsdPerMillion) + 999_999n) / 1_000_000n);
    const invalid = { draft: null, billedMicroUsd };
    if (usage.prompt_tokens > permit.maxInputTokens || usage.completion_tokens > permit.maxTotalOutputTokens) return invalid;
    if (!Array.isArray(choices) || choices.length !== 1) return invalid;
    if (choice?.finish_reason !== "stop" || message?.role !== "assistant"
      || typeof message.content !== "string" || message.refusal) return invalid;
    try {
      const draft = parseResumeDraft(message.content);
      if (/```|<\/?(?:html|script|table)\b/i.test(draft) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(draft)) return invalid;
      return { draft, billedMicroUsd };
    } catch { return invalid; }
  };
  try {
    // Promise race also bounds a stalled body read; abort cancels the transport.
    return await Promise.race([operation(), new Promise<ProviderResult>(resolve => {
      timer = setTimeout(() => { resolve({ ...unknown, failureCode: "providerTimeout" }); controller.abort(); }, PROVIDER_TIMEOUT_MS);
    })]);
  } catch { return unknown; }
  finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
