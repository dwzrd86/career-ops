import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory = resolve(scriptDirectory, "..");
const convexUrlPattern = /https:\/\/[^\s"'\\]+\.convex\.cloud\b/g;

function fail(message) {
  throw new Error(`Production build guard: ${message}`);
}

export function parseDeploymentUrl(value, label = "VITE_CONVEX_URL") {
  if (!value) fail(`${label} must be supplied by the production deploy command.`);

  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} must be an absolute HTTPS Convex URL.`);
  }

  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.cloud") || value !== url.origin) {
    fail(`${label} must be an HTTPS Convex deployment URL without a path, query, or fragment.`);
  }

  return url.origin;
}

export function developmentDeploymentUrls(value = process.env.CONVEX_DEV_DEPLOYMENT_URLS) {
  if (!value) return [];
  return value
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => parseDeploymentUrl(url, "CONVEX_DEV_DEPLOYMENT_URLS"));
}

export function validateProductionUrl({ productionUrl, developmentUrls = [] }) {
  const normalizedProductionUrl = parseDeploymentUrl(productionUrl);
  const normalizedDevelopmentUrls = developmentUrls.map((url) => parseDeploymentUrl(url, "CONVEX_DEV_DEPLOYMENT_URLS"));

  if (normalizedDevelopmentUrls.includes(normalizedProductionUrl)) {
    fail("VITE_CONVEX_URL matches a development deployment URL.");
  }

  return normalizedProductionUrl;
}

export function validateTurnstileSiteKey(value = process.env.VITE_TURNSTILE_SITE_KEY) {
  if (!value || !value.trim()) fail("VITE_TURNSTILE_SITE_KEY must be configured for bot-protected registration.");
  return value;
}

export function embeddedConvexUrls(source) {
  return [...new Set(source.match(convexUrlPattern) || [])];
}

export function verifyDist(expectedUrl, assetsDirectory = resolve(webDirectory, "dist", "assets")) {
  if (!existsSync(assetsDirectory)) fail("dist/assets does not exist; run the production build first.");

  const files = readdirSync(assetsDirectory).filter((file) => file.endsWith(".js"));
  if (files.length === 0) fail("dist/assets contains no JavaScript bundle to verify.");

  const urls = new Set();
  for (const file of files) {
    for (const url of embeddedConvexUrls(readFileSync(resolve(assetsDirectory, file), "utf8"))) {
      urls.add(url);
    }
  }

  if (urls.size === 0) fail("no Convex deployment URL was embedded in dist/assets JavaScript.");
  if (urls.size !== 1 || !urls.has(expectedUrl)) {
    fail("dist/assets JavaScript must embed only the expected production Convex URL.");
  }
}

function build(outputDirectory) {
  validateTurnstileSiteKey();
  const expectedUrl = validateProductionUrl({
    productionUrl: process.env.VITE_CONVEX_URL,
    developmentUrls: developmentDeploymentUrls(),
  });

  execFileSync("npm", ["run", "build:app", "--", "--outDir", outputDirectory], {
    cwd: webDirectory,
    env: process.env,
    stdio: "inherit",
  });
  verifyDist(expectedUrl, resolve(outputDirectory, "assets"));
}

function verify(outputDirectory) {
  validateTurnstileSiteKey();
  const expectedUrl = validateProductionUrl({
    productionUrl: process.env.VITE_CONVEX_URL,
    developmentUrls: developmentDeploymentUrls(),
  });
  verifyDist(expectedUrl, resolve(outputDirectory, "assets"));
}

function main() {
  const command = process.argv[2];
  const options = process.argv.slice(3);
  if (options.length && (options.length !== 2 || options[0] !== "--out-dir" || !options[1])) {
    fail("the only supported option is --out-dir <directory>.");
  }
  const outputDirectory = resolve(webDirectory, options[1] ?? "dist");
  if (command === "build") return build(outputDirectory);
  if (command === "verify") return verify(outputDirectory);
  fail("use either `build` or `verify`.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
