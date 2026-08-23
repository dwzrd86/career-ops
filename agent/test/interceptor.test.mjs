import assert from "node:assert/strict";
import test from "node:test";
import { readInterceptorCareerPage } from "../collectors/interceptor.mjs";
import { emptyTargetProfile } from "../store/target-profile.mjs";

function profile() {
  const result = emptyTargetProfile();
  result.targetRoles = [{ title: "Cloud Security Architect", aliases: ["Security Architect"], priority: "primary", seniority: ["Principal"] }];
  result.location.allowedRegions = ["United States"];
  result.eligibility.workAuthorization = ["United States work authorized"];
  result.criteria.mustHave = ["Security architecture ownership"];
  result.evidenceReferences = [{ kind: "resume", localPath: "cv.md", label: "Primary resume", updatedAt: null }];
  result.discovery.sources.push("interceptor");
  result.discovery.interceptor = {
    contextId: "jobbie-discovery-2026",
    allowedSources: ["https://careers.example.test/jobs"],
  };
  return result;
}

test("Interceptor invokes only the read-career-page CLI contract in the dedicated context", async () => {
  const calls = [];
  const result = await readInterceptorCareerPage({
    profile: profile(),
    contextId: "jobbie-discovery-2026",
    sourceUrl: "https://careers.example.test/jobs/123?utm_source=weekly",
    pageKind: "detail",
    runCli: async (request) => {
      calls.push(request);
      return { ok: true, page: { url: request.url, title: " Principal Architect ", text: "Private job detail" } };
    },
  });

  assert.deepEqual(result, {
    outcome: "active",
    errorCode: null,
    page: {
      url: "https://careers.example.test/jobs/123",
      title: "Principal Architect",
      text: "Private job detail",
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    action: "read-career-page",
    contextId: "jobbie-discovery-2026",
    url: "https://careers.example.test/jobs/123",
    pageKind: "detail",
    selectors: ["main", "[role=\"main\"]"],
  });
  assert.equal(JSON.stringify(calls[0]).match(/cookie|storage|history|password|credential/i), null);
});

test("Interceptor refuses missing or mismatched contexts before invoking a CLI", async () => {
  let called = false;
  const runCli = async () => { called = true; };
  const common = { profile: profile(), sourceUrl: "https://careers.example.test/jobs", pageKind: "listing", runCli };

  assert.deepEqual(await readInterceptorCareerPage(common), { outcome: "blocked", errorCode: "MISSING_CONTEXT", page: null });
  assert.deepEqual(await readInterceptorCareerPage({ ...common, contextId: "personal-browser-context" }), { outcome: "blocked", errorCode: "CONTEXT_MISMATCH", page: null });
  assert.equal(called, false);
});

test("Interceptor refuses unapproved sources and apply or submit routes and selectors", async () => {
  let called = false;
  const runCli = async () => { called = true; };
  const common = { profile: profile(), contextId: "jobbie-discovery-2026", pageKind: "detail", runCli };

  assert.equal((await readInterceptorCareerPage({ ...common, sourceUrl: "https://other.example.test/jobs/123" })).errorCode, "SOURCE_NOT_ALLOWLISTED");
  assert.equal((await readInterceptorCareerPage({ ...common, sourceUrl: "https://careers.example.test/jobs/123/apply" })).errorCode, "REFUSED_APPLY_ROUTE");
  assert.equal((await readInterceptorCareerPage({ ...common, sourceUrl: "https://careers.example.test/jobs/123", selectors: ["#submit-application"] })).errorCode, "REFUSED_APPLY_SELECTOR");
  assert.equal(called, false);
});

test("Interceptor maps login, CAPTCHA, access denial, and navigation failures to bounded blocked results", async () => {
  const common = { profile: profile(), contextId: "jobbie-discovery-2026", sourceUrl: "https://careers.example.test/jobs", pageKind: "listing" };
  const cases = [
    [{ ok: false, status: 401 }, "LOGIN_REQUIRED"],
    [{ ok: false, message: "CAPTCHA required" }, "CAPTCHA_REQUIRED"],
    [{ ok: false, status: 403 }, "ACCESS_DENIED"],
    [{ ok: false, message: "tab navigation failed" }, "NAVIGATION_FAILED"],
  ];
  for (const [response, errorCode] of cases) {
    const result = await readInterceptorCareerPage({ ...common, runCli: async () => response });
    assert.deepEqual(result, { outcome: "blocked", errorCode, page: null });
  }
  assert.deepEqual(await readInterceptorCareerPage({ ...common }), { outcome: "blocked", errorCode: "INTERCEPTOR_UNAVAILABLE", page: null });
});

test("Interceptor blocks redirects away from the approved read-only career route", async () => {
  const result = await readInterceptorCareerPage({
    profile: profile(),
    contextId: "jobbie-discovery-2026",
    sourceUrl: "https://careers.example.test/jobs/123",
    pageKind: "detail",
    runCli: async () => ({ ok: true, page: { url: "https://careers.example.test/jobs/123/apply", title: "Apply", text: "" } }),
  });
  assert.deepEqual(result, { outcome: "blocked", errorCode: "REFUSED_APPLY_ROUTE", page: null });
});
