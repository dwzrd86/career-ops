#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');
const REQUIRED_NODE_MAJOR = 24;

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

function filesMatching(directory, predicate) {
  const absoluteDirectory = join(ROOT, directory);
  if (!existsSync(absoluteDirectory)) return [];
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(directory, entry.name);
    if (entry.isDirectory()) return filesMatching(relativePath, predicate);
    return predicate(relativePath) ? [relativePath] : [];
  });
}

console.log('\n🧪 career-ops test suite\n');

// ── 1. RUNTIME ─────────────────────────────────────────────────

console.log('1. Runtime');

const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
if (nodeMajor === REQUIRED_NODE_MAJOR) {
  pass(`Node.js ${REQUIRED_NODE_MAJOR}.x is active (v${process.versions.node})`);
} else {
  fail(`Node.js ${REQUIRED_NODE_MAJOR}.x is required for the release gate (found v${process.versions.node})`);
}

// ── 2. SYNTAX CHECKS ────────────────────────────────────────────

console.log('\n2. Syntax checks');

const mjsFiles = [
  ...readdirSync(ROOT).filter(f => f.endsWith('.mjs')),
  ...filesMatching('agent', (path) => path.endsWith('.mjs')),
];
for (const f of mjsFiles) {
  const result = run('node', ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 3. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n3. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs', expectExit: 0 },
  { name: 'dedup-tracker.mjs', expectExit: 0 },
  { name: 'merge-tracker.mjs', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run('node', name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 4. AUTODISCOVERY TEST SUITE ─────────────────────────────────

console.log('\n4. Autonomous-discovery fixture suite');

const agentTests = filesMatching('agent/test', (path) => path.endsWith('.test.mjs'));
const requiredAgentTests = [
  'agent/test/target-profile.test.mjs',
  'agent/test/matching.test.mjs',
  'agent/test/collectors.test.mjs',
  'agent/test/scheduler.test.mjs',
  'agent/test/interceptor.test.mjs',
  'agent/test/evaluation.test.mjs',
];
const missingAgentTests = requiredAgentTests.filter((path) => !agentTests.includes(path));
if (missingAgentTests.length > 0) {
  fail(`Missing required autonomous-discovery test coverage: ${missingAgentTests.join(', ')}`);
} else {
  const result = run('node', ['--test', ...agentTests], { timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`Autonomous-discovery fixture suite passed (${agentTests.length} files)`);
  } else {
    fail('Autonomous-discovery fixture suite failed');
  }
}

// ── 5. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n5. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }

  const closedMycareersfuture = classifyLiveness({
    finalUrl: 'https://www.mycareersfuture.gov.sg/job/engineering/senior-staff-embedded-software-engineer',
    bodyText: [
      'Senior Staff Embedded Software Engineer',
      'MaxLinear Asia Singapore Private Limited',
      '9 applications    Posted 27 Oct 2025    Closed on 26 Nov 2025',
      'Applications have closed for this job',
      'Log in to Apply',
      "You'll need to log in with Singpass to verify your identity.",
      'Roles & Responsibilities: design, develop and maintain embedded firmware for broadband communications ICs.',
    ].join('\n'),
    applyControls: ['Log in to Apply'],
  });
  if (closedMycareersfuture.result === 'expired') {
    pass('Closed postings with "Applications have closed" banner are detected');
  } else {
    fail(`Closed mycareersfuture posting misclassified as ${closedMycareersfuture.result}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 6. DASHBOARD BUILD ──────────────────────────────────────────

if (!QUICK) {
  console.log('\n6. Dashboard build');
  const goBuild = run('cd dashboard && go build -o /tmp/career-dashboard-test . 2>&1');
  if (goBuild !== null) {
    pass('Dashboard compiles');
  } else {
    fail('Dashboard build failed');
  }
} else {
  console.log('\n6. Dashboard build (skipped --quick)');
}

// ── 7. DATA CONTRACT ────────────────────────────────────────────

console.log('\n7. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/career-ops/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

const alphaPolicyDocuments = [
  {
    path: 'docs/PRIVACY.md',
    required: ['# Jobbie alpha privacy notice', '**Version:** 2026-08-01', 'Data collected and why', 'Retention and deletion', 'automatically submit applications', 'Jobbie alpha data request'],
  },
  {
    path: 'docs/TERMS.md',
    required: ['# Jobbie alpha terms of use', 'does **not** automatically submit job applications', 'Material changes'],
  },
  {
    path: 'docs/SECURITY_CONTACT.md',
    required: ['# Jobbie security contact', 'hi@santifer.io', 'Do **not**', '72 hours'],
  },
  {
    path: 'docs/INCIDENT_RESPONSE.md',
    required: ['# Jobbie alpha incident response', 'User-reported account compromise', 'Exposed credential rotation', 'Unauthorized-data report', 'Abusive signup spike', 'Service rollback', 'Local discovery data or context loss', 'Post-incident review', '[[RELEASE_RUNBOOK]]'],
  },
  {
    path: 'docs/SECURITY.md',
    required: ['# Security and data handling', 'Local-agent output audit', 'Local discovery retention and recovery', 'worker credential exists in this release'],
  },
  {
    path: 'docs/RELEASE_RUNBOOK.md',
    required: ['# Career-Ops web release runbook', 'Local scheduler emergency stop', 'data/autodiscovery-backups/', 'This release has no worker token.'],
  },
  {
    path: 'docs/ALPHA_OPERATIONS.md',
    required: ['# Jobbie closed alpha operations', 'Production data export request', 'Production account-data deletion request', '[[INCIDENT_RESPONSE]]', 'does **not** automatically submit job applications'],
  },
];

for (const { path, required } of alphaPolicyDocuments) {
  if (!fileExists(path)) {
    fail(`Missing alpha policy document: ${path}`);
    continue;
  }
  const policy = readFile(path);
  const missing = required.filter(fragment => !policy.includes(fragment));
  if (missing.length === 0) {
    pass(`Alpha policy document is complete: ${path}`);
  } else {
    fail(`Alpha policy document is missing required content: ${path} (${missing.join(', ')})`);
  }
}

// User-specific and local-agent state must both be ignored, including browser
// context and raw job-detail storage.
const localOnlyPaths = [
  'config/profile.yml', 'config/target-profile.yml', 'modes/_profile.md', 'portals.yml',
  'data/autodiscovery/', 'data/autodiscovery-backups/', 'data/autodiscovery-exports/',
  'agent/.local/', '.interceptor-isolated-profile/',
];
for (const f of localOnlyPaths) {
  const tracked = run('git', ['ls-files', f]);
  const ignored = run('git', ['check-ignore', '-q', f]);
  if ((tracked === '' || tracked === null) && ignored !== null) {
    pass(`Local-only path is untracked and ignored: ${f}`);
  } else {
    fail(`Local-only path must be untracked and ignored: ${f}`);
  }
}

// ── 8. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n8. Personal data leak check');

const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  'hi@santifer.io', '688921377', '/Users/santifer/',
];

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'sh', 'go', 'json'];
const allowedFiles = [
  // English README + localized translations (all legitimately credit Santiago)
  'README.md', 'README.es.md', 'README.ja.md', 'README.ko-KR.md',
  'README.pt-BR.md', 'README.ru.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'go.mod', 'test-all.mjs',
  // Community / governance files (added in v1.3.0, all legitimately reference the maintainer)
  'CODE_OF_CONDUCT.md', 'GOVERNANCE.md', 'SECURITY.md', 'SUPPORT.md',
  '.github/SECURITY.md',
  // Published alpha policies intentionally provide the public security contact.
  'docs/PRIVACY.md', 'docs/TERMS.md', 'docs/SECURITY_CONTACT.md',
  'docs/INCIDENT_RESPONSE.md', 'docs/ALPHA_OPERATIONS.md',
  // Dashboard credit string
  'dashboard/internal/ui/screens/pipeline.go',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  const result = run(
    `git grep -n "${pattern}" -- ${grepPathspec} 2>/dev/null`
  );
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      if (file.includes('dashboard/go.mod')) continue;
      warn(`Possible personal data in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No personal data leaks outside allowed files');
}

// ── 9. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n9. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.md' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 10. MODE FILE INTEGRITY ─────────────────────────────────────

console.log('\n10. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

// ── 11. CLAUDE.md INTEGRITY ─────────────────────────────────────

console.log('\n11. CLAUDE.md integrity');

const claude = readFile('CLAUDE.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (claude.includes(section)) {
    pass(`CLAUDE.md has section: ${section}`);
  } else {
    fail(`CLAUDE.md missing section: ${section}`);
  }
}

// ── 12. VERSION FILE ────────────────────────────────────────────

console.log('\n12. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
