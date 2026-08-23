import { canonicalizeUrl } from "./normalize.mjs";
import { assertValidTargetProfile } from "../store/target-profile.mjs";

const ALLOWED_PAGE_KINDS = new Set(["listing", "detail"]);
const ALLOWED_SELECTORS = new Set(["main", "[role=\"main\"]", "[data-job-listing]", "[data-job-detail]"]);
const RESTRICTED_ROUTE = /(?:^|\/)(?:apply|application|applications|submit)(?:[\/_-]|$)/i;
const RESTRICTED_QUERY = /(?:apply|application|submit|cookie|storage|history|password|credential|session|auth|login)/i;
const RESTRICTED_SELECTOR = /(?:apply|application|submit|cookie|storage|history|password|credential|session|auth|login|sign-in)/i;
const LOGIN_SIGNAL = /(?:login|log-in|sign-in|sign in|authentication required|unauthenticated)/i;
const CAPTCHA_SIGNAL = /(?:captcha|recaptcha|hcaptcha|challenge required)/i;
const ACCESS_DENIED_SIGNAL = /(?:access denied|forbidden|not authorized|permission denied)/i;

function blocked(errorCode) {
  return { outcome: "blocked", errorCode, page: null };
}

function safeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function containsRestrictedRoute(url) {
  return RESTRICTED_ROUTE.test(url.pathname) || [...url.searchParams].some(([key, value]) => RESTRICTED_QUERY.test(key) || RESTRICTED_QUERY.test(value));
}

function sourceAllows(source, candidate) {
  try {
    const allowed = new URL(source);
    if (allowed.protocol !== candidate.protocol || allowed.hostname !== candidate.hostname || allowed.port !== candidate.port) return false;
    const allowedPath = allowed.pathname.endsWith("/") ? allowed.pathname : `${allowed.pathname}/`;
    return candidate.pathname === allowed.pathname || candidate.pathname.startsWith(allowedPath);
  } catch {
    return false;
  }
}

function responseBlockedCode(response) {
  const status = Number(response?.status);
  const signal = [response?.code, response?.errorCode, response?.message, response?.error].filter((value) => typeof value === "string").join(" ");
  if (CAPTCHA_SIGNAL.test(signal)) return "CAPTCHA_REQUIRED";
  if (LOGIN_SIGNAL.test(signal) || status === 401) return "LOGIN_REQUIRED";
  if (ACCESS_DENIED_SIGNAL.test(signal) || status === 403) return "ACCESS_DENIED";
  return "NAVIGATION_FAILED";
}

function safeSelectors(selectors) {
  if (!Array.isArray(selectors) || selectors.length === 0 || selectors.some((selector) => typeof selector !== "string")) return null;
  if (selectors.some((selector) => RESTRICTED_SELECTOR.test(selector))) return "REFUSED_APPLY_SELECTOR";
  return selectors.every((selector) => ALLOWED_SELECTORS.has(selector)) ? null : "REFUSED_SELECTOR";
}

/**
 * Reads a career listing or detail page through a narrow, injectable
 * Interceptor CLI contract. The collector never receives a generic browser
 * control capability: the only permitted request is `read-career-page`.
 *
 * `runCli` receives `{ action, contextId, url, pageKind, selectors }` and may
 * return `{ ok: true, page: { url, title, text } }`. Its response is retained
 * only in memory; callers must pass text directly to normalization rather than
 * logging it.
 */
export async function readInterceptorCareerPage({ profile, contextId, sourceUrl, pageKind, selectors = ["main", "[role=\"main\"]"], runCli } = {}) {
  try {
    assertValidTargetProfile(profile);
  } catch {
    return blocked("INVALID_TARGET_PROFILE");
  }

  const interceptor = profile.discovery?.interceptor;
  if (!profile.discovery.sources.includes("interceptor")) return blocked("INTERCEPTOR_DISABLED");
  if (!interceptor?.contextId || typeof contextId !== "string" || contextId.trim() === "") return blocked("MISSING_CONTEXT");
  if (contextId !== interceptor.contextId) return blocked("CONTEXT_MISMATCH");
  if (!ALLOWED_PAGE_KINDS.has(pageKind)) return blocked("REFUSED_PAGE_KIND");

  const selectorError = safeSelectors(selectors);
  if (selectorError) return blocked(selectorError);

  let requestedUrl;
  try {
    requestedUrl = new URL(canonicalizeUrl(sourceUrl));
  } catch {
    return blocked("NAVIGATION_FAILED");
  }
  if (containsRestrictedRoute(requestedUrl)) return blocked("REFUSED_APPLY_ROUTE");
  if (!interceptor.allowedSources.some((source) => sourceAllows(source, requestedUrl))) return blocked("SOURCE_NOT_ALLOWLISTED");
  if (typeof runCli !== "function") return blocked("INTERCEPTOR_UNAVAILABLE");

  let response;
  try {
    response = await runCli(Object.freeze({
      action: "read-career-page",
      contextId,
      url: requestedUrl.toString(),
      pageKind,
      selectors: Object.freeze([...selectors]),
    }));
  } catch {
    return blocked("NAVIGATION_FAILED");
  }

  if (!response || response.ok !== true || !response.page || typeof response.page !== "object") return blocked(responseBlockedCode(response));

  let finalUrl;
  try {
    finalUrl = new URL(canonicalizeUrl(response.page.url || requestedUrl.toString()));
  } catch {
    return blocked("NAVIGATION_FAILED");
  }
  if (containsRestrictedRoute(finalUrl)) return blocked("REFUSED_APPLY_ROUTE");
  if (!interceptor.allowedSources.some((source) => sourceAllows(source, finalUrl))) return blocked("SOURCE_NOT_ALLOWLISTED");

  return {
    outcome: "active",
    errorCode: null,
    page: {
      url: finalUrl.toString(),
      title: safeText(response.page.title),
      text: typeof response.page.text === "string" ? response.page.text : "",
    },
  };
}
