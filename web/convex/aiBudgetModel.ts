import { v } from "convex/values";

// All money is integer micro-USD ($1 = 1,000,000 units), never floating dollars.
export const ADMISSION_CUTOFF = 8_000_000;
export const PILOT_CAP = 5;
export const MONTHLY_ATTEMPTS = 20;
export const priceFields = {
  provider: v.string(), model: v.string(),
  inputMicroUsdPerMillion: v.number(), outputMicroUsdPerMillion: v.number(),
  maxInputTokens: v.number(), maxTotalOutputTokens: v.number(),
  // Operator-reviewed evidence covering serialization overhead, reasoning,
  // all billable tokens/fees and model identity. No default live price exists.
  evidence: v.string(), validUntil: v.number(),
};
export const attemptState = v.union(v.literal("reserved"), v.literal("dispatched"),
  v.literal("unknown"), v.literal("settled"));
