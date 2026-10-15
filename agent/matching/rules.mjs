const PASS = "pass";
const FAIL = "fail";
const UNKNOWN = "unknown";
const NOT_APPLICABLE = "not-applicable";

function normalized(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function includesNormalized(values, value) {
  const candidate = normalized(value);
  return candidate !== "" && values.some((entry) => normalized(entry) === candidate);
}

function hasConfigured(values) {
  return Array.isArray(values) && values.length > 0;
}

function isDreamIndustry(profile, job) {
  const industry = normalized(job.role.industry);
  return industry !== "" && (profile.preferences.dreamIndustries || []).some((entry) => industry.includes(normalized(entry)));
}

function regionMatches(region, location) {
  if (normalized(region) === "united states") return /(?:^|[\s,()])(?:united states|usa|us|u\.s\.a?\.?)(?=$|[\s,()])/i.test(location);
  return location.includes(normalized(region));
}

function isDreamLocation(profile, location) {
  return (profile.location.dreamRegions || []).some((region) => normalized(location).includes(normalized(region)));
}

function result(ruleId, outcome, reasonCode) {
  return { ruleId, outcome, reasonCode };
}

function evaluateWorkplaceMode(profile, job) {
  const modes = profile.location.workplaceModes;
  const mode = job.role.workplaceMode;
  if (mode === "unknown") return result("WORKPLACE_MODE", UNKNOWN, "WORKPLACE_MODE_UNKNOWN");
  return includesNormalized(modes, mode)
    ? result("WORKPLACE_MODE", PASS, "WORKPLACE_MODE_ALLOWED")
    : result("WORKPLACE_MODE", FAIL, "WORKPLACE_MODE_EXCLUDED");
}

function evaluateLocation(profile, job) {
  const location = job.role.location;
  if (!hasConfigured(profile.location.allowedRegions) && !hasConfigured(profile.location.excludedRegions) && !hasConfigured(profile.location.dreamRegions)) {
    return result("LOCATION", NOT_APPLICABLE, "LOCATION_NOT_CONFIGURED");
  }
  if (location === null) return result("LOCATION", UNKNOWN, "LOCATION_UNKNOWN");

  const candidate = normalized(location);
  if (profile.location.excludedRegions.some((region) => candidate.includes(normalized(region)))) {
    return result("LOCATION", FAIL, "LOCATION_EXCLUDED_REGION");
  }
  if (isDreamLocation(profile, candidate)) return result("LOCATION", PASS, "DREAM_LOCATION_ALLOWED");
  const preferred = profile.location.preferredRegions || [];
  if (job.role.workplaceMode !== "remote" && preferred.some((region) => candidate.includes(normalized(region)))) return result("LOCATION", PASS, "LOCATION_PREFERRED_REGION");
  if (profile.location.allowedRegions.length > 0 && !profile.location.allowedRegions.some((region) => regionMatches(region, candidate))) {
    if (profile.location.dreamAnyRegion && isDreamIndustry(profile, job)) return result("LOCATION", UNKNOWN, "DREAM_INDUSTRY_REGION_UNKNOWN");
    if (job.role.workplaceMode === "remote" && candidate === "remote") return result("LOCATION", UNKNOWN, "REMOTE_REGION_UNKNOWN");
    return result("LOCATION", FAIL, "LOCATION_OUTSIDE_ALLOWED_REGIONS");
  }
  if (profile.location.dreamAnyRegion && isDreamIndustry(profile, job)) return result("LOCATION", PASS, "DREAM_INDUSTRY_LOCATION_ALLOWED");
  if (job.role.workplaceMode !== "remote" && profile.location.radiusMiles !== null && profile.location.home.trim() !== "" && !candidate.includes(normalized(profile.location.home))) {
    return result("LOCATION", UNKNOWN, "LOCATION_DISTANCE_UNKNOWN");
  }
  return result("LOCATION", PASS, "LOCATION_ALLOWED");
}

function evaluateSalaryFloor(profile, job) {
  const floor = profile.compensation.floor;
  if (floor === null) return result("SALARY_FLOOR", NOT_APPLICABLE, "SALARY_FLOOR_NOT_CONFIGURED");
  const salary = job.role.salary;
  if (salary === null || salary.basis !== "annual" || salary.currency !== profile.compensation.currency || salary.maximum === null) {
    return result("SALARY_FLOOR", UNKNOWN, "SALARY_UNKNOWN");
  }
  if (salary.maximum < floor) return result("SALARY_FLOOR", FAIL, "SALARY_BELOW_FLOOR");
  if (salary.minimum !== null && salary.minimum >= floor) return result("SALARY_FLOOR", PASS, "SALARY_MEETS_FLOOR");
  return result("SALARY_FLOOR", UNKNOWN, "SALARY_RANGE_CROSSES_FLOOR");
}

function evaluateWorkAuthorization(profile, job) {
  const location = job.role.location;
  if (location !== null && isDreamLocation(profile, location) && profile.location.allowedRegions.length > 0 && !profile.location.allowedRegions.some((region) => regionMatches(region, normalized(location)))) {
    return result("WORK_AUTHORIZATION", UNKNOWN, "DREAM_LOCATION_WORK_AUTHORIZATION_UNKNOWN");
  }
  if (job.role.workAuthorization === "unknown") return result("WORK_AUTHORIZATION", UNKNOWN, "WORK_AUTHORIZATION_UNKNOWN");
  if (job.role.workAuthorization === "not-required") return result("WORK_AUTHORIZATION", PASS, "WORK_AUTHORIZATION_NOT_REQUIRED");
  return hasConfigured(profile.eligibility.workAuthorization)
    ? result("WORK_AUTHORIZATION", PASS, "WORK_AUTHORIZATION_CONFIRMED")
    : result("WORK_AUTHORIZATION", FAIL, "WORK_AUTHORIZATION_UNCONFIRMED");
}

function evaluateClearance(profile, job) {
  if (job.role.clearance === "unknown") return result("CLEARANCE", UNKNOWN, "CLEARANCE_UNKNOWN");
  if (job.role.clearance === "not-required") return result("CLEARANCE", PASS, "CLEARANCE_NOT_REQUIRED");
  return hasConfigured(profile.eligibility.clearance.levels)
    ? result("CLEARANCE", PASS, "CLEARANCE_CONFIRMED")
    : result("CLEARANCE", FAIL, "CLEARANCE_UNCONFIRMED");
}

function evaluateExcludedValue(ruleId, configuredValues, actualValue, failCode, passCode, unknownCode) {
  if (!hasConfigured(configuredValues)) return result(ruleId, NOT_APPLICABLE, `${ruleId}_NOT_CONFIGURED`);
  if (actualValue === null) return result(ruleId, UNKNOWN, unknownCode);
  return includesNormalized(configuredValues, actualValue)
    ? result(ruleId, FAIL, failCode)
    : result(ruleId, PASS, passCode);
}

function evaluateDealBreakers(profile, job) {
  const dealBreakers = profile.criteria.dealBreakers;
  if (!hasConfigured(dealBreakers)) return result("DEAL_BREAKER", NOT_APPLICABLE, "DEAL_BREAKER_NOT_CONFIGURED");
  const requirements = job.evidence?.requirements;
  if (requirements === undefined || requirements === null) return result("DEAL_BREAKER", UNKNOWN, "DEAL_BREAKER_UNKNOWN");
  const hasMatch = requirements.some((requirement) => dealBreakers.some((dealBreaker) => {
    const left = normalized(requirement);
    const right = normalized(dealBreaker);
    return left.includes(right) || right.includes(left);
  }));
  return hasMatch
    ? result("DEAL_BREAKER", FAIL, "DEAL_BREAKER_MATCHED")
    : result("DEAL_BREAKER", PASS, "DEAL_BREAKER_CLEAR");
}

function evaluateTravel(profile, job) {
  const maximum = profile.criteria.maxTravelPercent;
  if (maximum === undefined || maximum === null) return result("TRAVEL", NOT_APPLICABLE, "TRAVEL_LIMIT_NOT_CONFIGURED");
  const requirements = job.evidence?.requirements;
  if (!Array.isArray(requirements)) return result("TRAVEL", UNKNOWN, "TRAVEL_UNKNOWN");
  const text = requirements.join(" ").toLowerCase();
  const percentages = [...text.matchAll(/\btravel(?:\s+(?:required|up to|over|more than))?\s*[:\-]?\s*(\d{1,3})\s*%|\b(\d{1,3})\s*%\s*(?:of the time\s*)?travel\b/g)].map((match) => Number(match[1] ?? match[2]));
  if (percentages.length === 0) return result("TRAVEL", /\btravel\b/.test(text) ? UNKNOWN : NOT_APPLICABLE, /\btravel\b/.test(text) ? "TRAVEL_PERCENT_UNKNOWN" : "TRAVEL_NOT_STATED");
  if (percentages.some((value) => value > maximum) || new RegExp(`(?:\\b(?:more than|over)\\s*${maximum}\\s*%\\s*travel\\b|\\btravel\\s+(?:over|more than)\\s*${maximum}\\s*%)`).test(text)) return result("TRAVEL", FAIL, "TRAVEL_EXCEEDS_LIMIT");
  return result("TRAVEL", PASS, "TRAVEL_WITHIN_LIMIT");
}

function evaluateOfficeDays(profile, job) {
  const maximum = profile.criteria.maxOfficeDaysPerWeek;
  if (maximum === undefined || maximum === null) return result("OFFICE_DAYS", NOT_APPLICABLE, "OFFICE_DAYS_LIMIT_NOT_CONFIGURED");
  const requirements = job.evidence?.requirements;
  if (!Array.isArray(requirements)) return result("OFFICE_DAYS", UNKNOWN, "OFFICE_DAYS_UNKNOWN");
  const text = requirements.join(" ").toLowerCase();
  const days = [...text.matchAll(/\b(\d)\s*days?(?:\s+(?:per|a)\s+week)?\s*(?:in\s+(?:the\s+)?office|on[- ]site)\b|\b(?:in[- ]office|on[- ]site)\s*(\d)\s*days?\b/g)].map((match) => Number(match[1] ?? match[2]));
  if (days.length === 0) return result("OFFICE_DAYS", NOT_APPLICABLE, "OFFICE_DAYS_NOT_STATED");
  return days.some((value) => value > maximum)
    ? result("OFFICE_DAYS", FAIL, "OFFICE_DAYS_EXCEEDS_LIMIT")
    : result("OFFICE_DAYS", PASS, "OFFICE_DAYS_WITHIN_LIMIT");
}

export function evaluateHardFilters(profile, job) {
  return [
    evaluateWorkplaceMode(profile, job),
    evaluateLocation(profile, job),
    evaluateSalaryFloor(profile, job),
    evaluateWorkAuthorization(profile, job),
    evaluateClearance(profile, job),
    evaluateExcludedValue("EXCLUDED_COMPANY", profile.preferences.excludedCompanies, job.role.company, "COMPANY_EXCLUDED", "COMPANY_ALLOWED", "COMPANY_UNKNOWN"),
    evaluateExcludedValue("EXCLUDED_INDUSTRY", profile.preferences.excludedIndustries, job.role.industry, "INDUSTRY_EXCLUDED", "INDUSTRY_ALLOWED", "INDUSTRY_UNKNOWN"),
    evaluateDealBreakers(profile, job),
    evaluateTravel(profile, job),
    evaluateOfficeDays(profile, job),
  ];
}

export function hardFilterOutcome(results) {
  if (results.some((entry) => entry.outcome === FAIL)) return "rejected";
  if (results.some((entry) => entry.outcome === UNKNOWN)) return "needs-review";
  return "ranked";
}
