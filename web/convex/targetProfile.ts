import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireVerifiedUser } from "./auth";
import { requireEnrolledUser } from "./enrollment";
import { requireCurrentPrivacyAcknowledgement } from "./privacy";
import { targetProfileFields, targetProfileInput } from "./targetProfileModel";

function boundedStrings(values: string[], field: string, max = 30) {
  if (values.length > max || values.some((value) => value.trim().length === 0 || value.length > 160)) {
    throw new Error(`${field} contains too many or invalid entries`);
  }
  return [...new Set(values.map((value) => value.trim()))];
}

export const get = query({
  args: {},
  returns: v.union(v.null(), v.object({
    ...targetProfileFields,
    profileVersion: v.number(),
    updatedAt: v.number(),
    lastScanAt: v.optional(v.number()),
  })),
  handler: async (ctx) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    const profile = await ctx.db.query("targetProfiles").withIndex("by_owner", (query) => query.eq("ownerId", ownerId)).unique();
    if (!profile) return null;
    const { _id: _id, _creationTime: _creationTime, ownerId: _ownerId, ...fields } = profile;
    return fields;
  },
});

export const save = mutation({
  args: { profile: targetProfileInput },
  returns: v.number(),
  handler: async (ctx, { profile }) => {
    const ownerId = await requireVerifiedUser(ctx);
    await requireEnrolledUser(ctx, ownerId);
    await requireCurrentPrivacyAcknowledgement(ctx, ownerId);
    if (profile.targetRoles.length < 1 || profile.targetRoles.length > 12) throw new Error("Enter 1 to 12 target roles");
    const targetRoles = profile.targetRoles.map((role) => ({
      title: boundedStrings([role.title], "target role", 1)[0],
      aliases: boundedStrings(role.aliases, "aliases"),
      seniority: boundedStrings(role.seniority, "seniority"),
    }));
    if (profile.home.length > 160) throw new Error("Home location is too long");
    if (profile.radiusMiles !== undefined && (!Number.isInteger(profile.radiusMiles) || profile.radiusMiles < 0 || profile.radiusMiles > 500)) throw new Error("Radius must be between 0 and 500 miles");
    if (profile.salaryFloor !== undefined && (!Number.isFinite(profile.salaryFloor) || profile.salaryFloor < 0 || profile.salaryFloor > 10_000_000)) throw new Error("Salary floor is invalid");
    if (profile.maxTravelPercent !== undefined && (!Number.isInteger(profile.maxTravelPercent) || profile.maxTravelPercent < 0 || profile.maxTravelPercent > 100)) throw new Error("Travel limit must be between 0 and 100 percent");
    if (profile.maxOfficeDaysPerWeek !== undefined && (!Number.isInteger(profile.maxOfficeDaysPerWeek) || profile.maxOfficeDaysPerWeek < 0 || profile.maxOfficeDaysPerWeek > 7)) throw new Error("Office days must be between 0 and 7");
    if (!/^[A-Z]{3}$/.test(profile.currency)) throw new Error("Currency must be a three-letter code");
    if (profile.workplaceModes.length === 0) throw new Error("Choose at least one workplace mode");
    if (profile.sources.length === 0) throw new Error("Choose at least one job source");
    if (profile.enabled && !profile.sources.some(source => source === "greenhouse" || source === "ashby")) {
      throw new Error("Hosted discovery supports Greenhouse and Ashby; choose at least one before enabling discovery");
    }
    const clean = {
      ...profile,
      targetRoles,
      home: profile.home.trim(),
      workplaceModes: [...new Set(profile.workplaceModes)],
      sources: [...new Set(profile.sources)],
      allowedRegions: boundedStrings(profile.allowedRegions, "allowed regions"),
      preferredRegions: boundedStrings(profile.preferredRegions, "preferred regions"),
      dreamRegions: boundedStrings(profile.dreamRegions, "dream regions"),
      dreamIndustries: boundedStrings(profile.dreamIndustries, "dream industries"),
      excludedCompanies: boundedStrings(profile.excludedCompanies, "excluded companies"),
      excludedIndustries: boundedStrings(profile.excludedIndustries, "excluded industries"),
      frameworks: boundedStrings(profile.frameworks, "frameworks"),
      cloudPlatforms: boundedStrings(profile.cloudPlatforms, "cloud platforms"),
      workAuthorization: boundedStrings(profile.workAuthorization, "work authorization"),
      clearanceLevels: boundedStrings(profile.clearanceLevels, "clearance levels"),
    };
    const existing = await ctx.db.query("targetProfiles").withIndex("by_owner", (query) => query.eq("ownerId", ownerId)).unique();
    const profileVersion = (existing?.profileVersion ?? 0) + 1;
    const updatedAt = Date.now();
    if (existing === null) await ctx.db.insert("targetProfiles", { ...clean, ownerId, profileVersion, updatedAt });
    else await ctx.db.patch(existing._id, { ...clean, profileVersion, updatedAt });
    return profileVersion;
  },
});
