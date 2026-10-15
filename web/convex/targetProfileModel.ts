import { v } from "convex/values";

export const targetRole = v.object({
  title: v.string(),
  aliases: v.array(v.string()),
  seniority: v.array(v.string()),
});

export const targetProfileFields = {
  targetRoles: v.array(targetRole),
  home: v.string(),
  radiusMiles: v.optional(v.number()),
  workplaceModes: v.array(v.union(v.literal("remote"), v.literal("hybrid"), v.literal("onsite"))),
  allowedRegions: v.array(v.string()),
  preferredRegions: v.array(v.string()),
  dreamRegions: v.array(v.string()),
  dreamIndustries: v.array(v.string()),
  excludedCompanies: v.array(v.string()),
  excludedIndustries: v.array(v.string()),
  frameworks: v.array(v.string()),
  cloudPlatforms: v.array(v.string()),
  salaryFloor: v.optional(v.number()),
  currency: v.string(),
  workAuthorization: v.array(v.string()),
  clearanceLevels: v.array(v.string()),
  maxTravelPercent: v.optional(v.number()),
  maxOfficeDaysPerWeek: v.optional(v.number()),
  sources: v.array(v.union(v.literal("greenhouse"), v.literal("ashby"), v.literal("lever"))),
  schedule: v.union(v.literal("manual"), v.literal("daily"), v.literal("weekdays")),
  enabled: v.boolean(),
} as const;

export const targetProfileInput = v.object(targetProfileFields);
