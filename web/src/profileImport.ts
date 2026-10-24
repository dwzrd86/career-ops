import { load } from "js-yaml";
import type { TargetProfileInput } from "./convex";

export const emptyDiscoveryProfile: TargetProfileInput = {
  targetRoles: [{ title: "", aliases: [], seniority: [] }],
  home: "",
  workplaceModes: ["remote", "hybrid"],
  allowedRegions: ["United States"],
  preferredRegions: [],
  dreamRegions: [],
  dreamIndustries: [],
  excludedCompanies: [],
  excludedIndustries: [],
  frameworks: [],
  cloudPlatforms: [],
  currency: "USD",
  workAuthorization: [],
  clearanceLevels: [],
  sources: ["greenhouse", "ashby"],
  schedule: "manual",
  enabled: false,
};

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [];
const optionalNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;

export function importLocalProfile(contents: string): TargetProfileInput {
  const raw = load(contents) as any;
  if (!raw || !Array.isArray(raw.targetRoles) || raw.targetRoles.length === 0) throw new Error("This file does not contain a Target Profile.");
  const roles = raw.targetRoles.map((role: any) => ({ title: String(role?.title ?? "").trim(), aliases: strings(role?.aliases), seniority: strings(role?.seniority) }));
  if (roles.some((role: TargetProfileInput["targetRoles"][number]) => !role.title)) throw new Error("Each target role needs a title.");
  const workplaceModes = strings(raw.location?.workplaceModes).filter((mode): mode is TargetProfileInput["workplaceModes"][number] => ["remote", "hybrid", "onsite"].includes(mode));
  return {
    ...emptyDiscoveryProfile,
    targetRoles: roles,
    home: String(raw.location?.home ?? "").trim(),
    radiusMiles: optionalNumber(raw.location?.radiusMiles),
    workplaceModes: workplaceModes.length ? workplaceModes : ["remote"],
    allowedRegions: strings(raw.location?.allowedRegions),
    preferredRegions: strings(raw.location?.preferredRegions),
    dreamRegions: strings(raw.location?.dreamRegions),
    dreamIndustries: strings(raw.preferences?.dreamIndustries),
    excludedCompanies: strings(raw.preferences?.excludedCompanies),
    excludedIndustries: strings(raw.preferences?.excludedIndustries),
    frameworks: strings(raw.expertise?.frameworks),
    cloudPlatforms: strings(raw.expertise?.cloudPlatforms),
    salaryFloor: optionalNumber(raw.compensation?.floor),
    currency: String(raw.compensation?.currency ?? "USD").toUpperCase(),
    workAuthorization: strings(raw.eligibility?.workAuthorization),
    clearanceLevels: strings(raw.eligibility?.clearance?.levels),
    maxTravelPercent: optionalNumber(raw.criteria?.maxTravelPercent),
    maxOfficeDaysPerWeek: optionalNumber(raw.criteria?.maxOfficeDaysPerWeek),
    sources: ["greenhouse", "ashby"],
    schedule: "manual",
    enabled: false,
  };
}
