import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const secretPatterns = [
  /(?:netlify|convex)[_-]?(?:api)?[_-]?token\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i,
  /(?:netlify|convex)[_-]?deploy[_-]?key\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
];

const trackedFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .map((file) => resolve(root, file));

const matches = [];
for (const file of trackedFiles) {
  if (statSync(file).size > 1_000_000) continue;
  const content = readFileSync(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(content))) matches.push(relative(root, file));
}

if (matches.length > 0) {
  console.error(`Secret-pattern scan failed in ${matches.length} file(s). Values were not printed.`);
  process.exit(1);
}

console.log("Secret-pattern scan passed.");
