export type Provider = "greenhouse" | "ashby" | "lever";

export const ATS_SOURCES: ReadonlyArray<{ company: string; industry: string; provider: Provider; url: string }> = [
  { company: "Wiz", industry: "cybersecurity", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/wizinc/jobs" },
  { company: "Netskope", industry: "cybersecurity", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/netskope/jobs" },
  { company: "Rubrik", industry: "cybersecurity", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/rubrik/jobs" },
  { company: "Zscaler", industry: "cybersecurity", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/zscaler/jobs" },
  { company: "Axonius", industry: "cybersecurity", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/axonius/jobs" },
  { company: "Tines", industry: "cybersecurity", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/tines/jobs" },
  { company: "Vanta", industry: "cybersecurity", provider: "ashby", url: "https://api.ashbyhq.com/posting-api/job-board/vanta?includeCompensation=true" },
  { company: "Cloudflare", industry: "cloud", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/cloudflare/jobs" },
  { company: "GitLab", industry: "cloud", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/gitlab/jobs" },
  { company: "Anthropic", industry: "technology", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/anthropic/jobs" },
  { company: "SeatGeek", industry: "entertainment", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/seatgeek/jobs" },
  { company: "FanDuel", industry: "sports", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/fanduel/jobs" },
  { company: "AXS", industry: "entertainment", provider: "greenhouse", url: "https://boards-api.greenhouse.io/v1/boards/axs/jobs" },
];

type Profile = {
  targetRoles: Array<{ title: string; aliases: string[]; seniority: string[] }>;
  home: string;
  workplaceModes: Array<"remote" | "hybrid" | "onsite">;
  allowedRegions: string[];
  preferredRegions: string[];
  dreamRegions: string[];
  dreamIndustries: string[];
  excludedCompanies: string[];
  excludedIndustries: string[];
  frameworks: string[];
  cloudPlatforms: string[];
  salaryFloor?: number;
  currency: string;
  clearanceLevels: string[];
  maxTravelPercent?: number;
  maxOfficeDaysPerWeek?: number;
};

export type Candidate = {
  company: string;
  title: string;
  location?: string;
  url: string;
  provider: Provider;
  sourceLabel: string;
  industry: string;
  externalId: string;
  postedAt?: number;
  remote: boolean;
  salary?: { minimum?: number; maximum?: number; currency: string };
  description?: string;
};

export type Decision = {
  outcome: "ranked" | "needsReview" | "rejected";
  score: number;
  hardFilters: Array<{ ruleId: string; outcome: "pass" | "fail" | "unknown" | "notApplicable"; reasonCode: string }>;
  explanationCodes: string[];
};

function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function lower(value: string) { return value.toLocaleLowerCase(); }
function includesAny(values: string[], value: string) { return values.some((entry) => lower(value).includes(lower(entry))); }

export function isRelevantTitle(profile: Pick<Profile, "targetRoles">, title: string) {
  const value = lower(title);
  if (profile.targetRoles.some((role) => [role.title, ...role.aliases].some((entry) => value.includes(lower(entry))))) return true;
  const cyberProfile = profile.targetRoles.some((role) => /security|cyber|grc|ciso/i.test(role.title));
  return cyberProfile && /\b(security|cybersecurity|grc)\b/i.test(title)
    && /\b(architect|director|head|manager|ciso)\b/i.test(title)
    && !/\b(marketing|sales|account executive|recruiter|software|program manager)\b/i.test(title);
}

function compensation(value: any) {
  const salaries = value?.summaryComponents?.filter((entry: any) => entry?.compensationType === "Salary" && entry?.interval === "1 YEAR" && entry?.currencyCode === "USD") ?? [];
  if (salaries.length === 0) return undefined;
  const minimum = Math.min(...salaries.map((entry: any) => entry.minValue).filter(Number.isFinite));
  const maximum = Math.max(...salaries.map((entry: any) => entry.maxValue).filter(Number.isFinite));
  if (!Number.isFinite(minimum) && !Number.isFinite(maximum)) return undefined;
  return { ...(Number.isFinite(minimum) ? { minimum } : {}), ...(Number.isFinite(maximum) ? { maximum } : {}), currency: "USD" };
}

export function parseFeed(source: (typeof ATS_SOURCES)[number], payload: unknown): Candidate[] {
  const jobs = source.provider === "lever" ? payload : (payload as any)?.jobs;
  if (!Array.isArray(jobs)) throw new Error("INVALID_FEED");
  const output: Candidate[] = [];
  for (const row of jobs) {
    const title = text(source.provider === "lever" ? row?.text : row?.title);
    const url = text(source.provider === "greenhouse" ? row?.absolute_url : source.provider === "ashby" ? row?.jobUrl : row?.hostedUrl);
    if (!title || !url) continue;
    let parsed: URL;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) continue;
    const location = text(source.provider === "greenhouse" ? row?.location?.name : source.provider === "lever" ? row?.categories?.location : row?.location);
    const published = source.provider === "ashby" ? Date.parse(text(row?.publishedAt)) : NaN;
    output.push({
      company: source.company,
      title,
      location: location || undefined,
      url: parsed.toString(),
      provider: source.provider,
      sourceLabel: `${source.provider}: ${source.company}`,
      industry: source.industry,
      externalId: String(row?.id ?? parsed.pathname),
      ...(Number.isFinite(published) ? { postedAt: published } : {}),
      remote: row?.isRemote === true || /\bremote\b/i.test(location),
      ...(source.provider === "ashby" && compensation(row?.compensation) ? { salary: compensation(row?.compensation) } : {}),
      ...(source.provider === "ashby" && text(row?.descriptionPlain) ? { description: text(row.descriptionPlain).slice(0, 30_000) } : {}),
    });
  }
  return output;
}

function regionAllowed(profile: Profile, candidate: Candidate) {
  const location = lower(candidate.location ?? "");
  if (!location) return "unknown";
  if (includesAny(profile.dreamRegions, location)) return "pass";
  const us = /(?:^|[\s,();.-])(?:united states|usa|u\.s\.|us)(?=$|[\s,();.-])/i.test(location);
  if (candidate.remote && profile.allowedRegions.some((region) => lower(region) === "united states" ? us : location.includes(lower(region)))) return "pass";
  if (!candidate.remote && (includesAny(profile.preferredRegions, location) || (profile.home && location.includes(lower(profile.home))))) return "pass";
  if (!candidate.remote && us) return "unknown";
  if (candidate.remote && location === "remote") return "unknown";
  return "fail";
}

export function evaluateCandidate(profile: Profile, candidate: Candidate): Decision {
  const filters: Decision["hardFilters"] = [];
  const add = (ruleId: string, outcome: Decision["hardFilters"][number]["outcome"], reasonCode: string) => filters.push({ ruleId, outcome, reasonCode });
  const mode = candidate.remote ? "remote" : /hybrid/i.test(candidate.location ?? "") ? "hybrid" : /in-office|onsite|on-site/i.test(candidate.location ?? "") ? "onsite" : "unknown";
  add("WORKPLACE_MODE", mode === "unknown" ? "unknown" : profile.workplaceModes.includes(mode) ? "pass" : "fail", mode === "unknown" ? "WORKPLACE_MODE_UNKNOWN" : profile.workplaceModes.includes(mode) ? "WORKPLACE_MODE_ALLOWED" : "WORKPLACE_MODE_EXCLUDED");
  const region = regionAllowed(profile, candidate);
  add("LOCATION", region, region === "pass" ? "LOCATION_ALLOWED" : region === "fail" ? "LOCATION_OUTSIDE_ALLOWED_REGIONS" : "LOCATION_UNKNOWN");
  if (profile.salaryFloor === undefined) add("SALARY_FLOOR", "notApplicable", "SALARY_FLOOR_NOT_CONFIGURED");
  else if (!candidate.salary || candidate.salary.currency !== profile.currency || candidate.salary.maximum === undefined) add("SALARY_FLOOR", "unknown", "SALARY_UNKNOWN");
  else if (candidate.salary.maximum < profile.salaryFloor) add("SALARY_FLOOR", "fail", "SALARY_BELOW_FLOOR");
  else if (candidate.salary.minimum !== undefined && candidate.salary.minimum >= profile.salaryFloor) add("SALARY_FLOOR", "pass", "SALARY_MEETS_FLOOR");
  else add("SALARY_FLOOR", "unknown", "SALARY_RANGE_CROSSES_FLOOR");
  add("EXCLUDED_COMPANY", includesAny(profile.excludedCompanies, candidate.company) ? "fail" : "pass", includesAny(profile.excludedCompanies, candidate.company) ? "COMPANY_EXCLUDED" : "COMPANY_ALLOWED");
  add("EXCLUDED_INDUSTRY", includesAny(profile.excludedIndustries, candidate.industry) ? "fail" : "pass", includesAny(profile.excludedIndustries, candidate.industry) ? "INDUSTRY_EXCLUDED" : "INDUSTRY_ALLOWED");
  const description = lower(candidate.description ?? "");
  const clearanceRequired = /\b(active|current)\s+(?:[\w\s/-]{0,25})?\bclearance\b|\bts\/sci\b/i.test(description);
  add("CLEARANCE", clearanceRequired && profile.clearanceLevels.length === 0 ? "fail" : clearanceRequired ? "pass" : "unknown", clearanceRequired && profile.clearanceLevels.length === 0 ? "CLEARANCE_UNCONFIRMED" : clearanceRequired ? "CLEARANCE_CONFIRMED" : "CLEARANCE_UNKNOWN");
  add("WORK_AUTHORIZATION", "unknown", "WORK_AUTHORIZATION_UNKNOWN");
  const travel = description.match(/\btravel\s+(?:up to |over |more than )?(\d{1,3})\s*%|\b(\d{1,3})\s*%\s*travel/);
  const travelPercent = travel ? Number(travel[1] ?? travel[2]) : null;
  if (profile.maxTravelPercent !== undefined) add("TRAVEL", travelPercent === null ? "unknown" : travelPercent > profile.maxTravelPercent ? "fail" : "pass", travelPercent === null ? "TRAVEL_UNKNOWN" : travelPercent > profile.maxTravelPercent ? "TRAVEL_EXCEEDS_LIMIT" : "TRAVEL_WITHIN_LIMIT");
  const office = description.match(/\b(\d)\s*days?\s*(?:per|a)?\s*week\s*(?:in(?: the)? office|on[- ]site)|\b(?:in[- ]office|on[- ]site)\s*(\d)\s*days?/);
  const officeDays = office ? Number(office[1] ?? office[2]) : null;
  if (profile.maxOfficeDaysPerWeek !== undefined) add("OFFICE_DAYS", officeDays === null ? "unknown" : officeDays > profile.maxOfficeDaysPerWeek ? "fail" : "pass", officeDays === null ? "OFFICE_DAYS_UNKNOWN" : officeDays > profile.maxOfficeDaysPerWeek ? "OFFICE_DAYS_EXCEEDS_LIMIT" : "OFFICE_DAYS_WITHIN_LIMIT");
  const title = lower(candidate.title);
  const exact = profile.targetRoles.some((role) => [role.title, ...role.aliases].some((entry) => title.includes(lower(entry))));
  const expertise = [...profile.frameworks, ...profile.cloudPlatforms].filter((entry) => description.includes(lower(entry)));
  const score = Math.min(100, (exact ? 65 : 30) + Math.min(25, expertise.length * 5) + (includesAny(profile.dreamIndustries, candidate.industry) ? 10 : 0));
  const outcome = filters.some((entry) => entry.outcome === "fail") ? "rejected" : filters.some((entry) => entry.outcome === "unknown") ? "needsReview" : "ranked";
  return { outcome, score, hardFilters: filters, explanationCodes: [exact ? "ROLE_MATCH" : "ROLE_RELATED_TITLE", ...expertise.map(() => "EXPERTISE_MATCH"), ...filters.filter((entry) => entry.outcome === "unknown" || entry.outcome === "fail").map((entry) => entry.reasonCode)] };
}
