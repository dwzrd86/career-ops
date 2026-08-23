#!/usr/bin/env node
import { createServer } from "node:http";
import { chmodSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  DEFAULT_TARGET_PROFILE_PATH,
  TargetProfileValidationError,
  emptyTargetProfile,
  loadTargetProfile,
  saveTargetProfile,
} from "../store/target-profile.mjs";

const command = process.argv[2] || "help";
const profilePath = process.env.CAREER_OPS_TARGET_PROFILE || DEFAULT_TARGET_PROFILE_PATH;
const templatePath = resolve("config/target-profile.example.yml");
const editorPath = resolve("agent/ui/target-profile.html");

function usage() {
  console.log(`Usage: npm run profile -- <command>

Commands:
  init       Create config/target-profile.yml from the committed example
  show       Print the validated local Target Profile as YAML
  validate   Validate config/target-profile.yml
  edit       Open a loopback-only editor at a tokenized local URL
`);
}

function fail(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.length > 200_000) throw new Error("Profile payload exceeds 200 KB");
  return JSON.parse(body);
}

function startEditor() {
  const token = randomBytes(32).toString("base64url");
  const html = readFileSync(editorPath, "utf8");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(html);
      return;
    }

    if (url.pathname !== "/api/profile") {
      json(response, 404, { error: "not_found" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      json(response, 401, { error: "unauthorized" });
      return;
    }

    try {
      if (request.method === "GET") {
        json(response, 200, { profile: loadTargetProfile(profilePath) || emptyTargetProfile() });
        return;
      }
      if (request.method === "PUT") {
        const profile = await readBody(request);
        json(response, 200, { profile: saveTargetProfile(profile, profilePath) });
        return;
      }
      json(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      if (error instanceof TargetProfileValidationError) {
        json(response, 422, { error: "invalid_profile", details: error.errors });
        return;
      }
      json(response, 400, { error: "invalid_request", details: [error instanceof Error ? error.message : String(error)] });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to determine local editor port");
    console.log(`Target Profile editor: http://127.0.0.1:${address.port}/#token=${token}`);
    console.log("Keep this terminal open while editing. Press Ctrl+C to stop the local editor.");
  });
}

try {
  if (command === "help" || command === "--help" || command === "-h") usage();
  else if (command === "init") {
    if (existsSync(profilePath)) throw new Error(`${profilePath} already exists; use edit or validate instead`);
    copyFileSync(templatePath, profilePath, 0);
    chmodSync(profilePath, 0o600);
    console.log(`Created ${profilePath}`);
  } else if (command === "show") {
    const profile = loadTargetProfile(profilePath);
    if (profile === null) throw new Error(`${profilePath} does not exist; run npm run profile -- init`);
    console.log(readFileSync(profilePath, "utf8"));
  } else if (command === "validate") {
    const profile = loadTargetProfile(profilePath);
    if (profile === null) throw new Error(`${profilePath} does not exist; run npm run profile -- init`);
    console.log(`Target Profile is valid: ${profile.targetRoles.length} target role(s), version ${profile.schemaVersion}`);
  } else if (command === "edit") startEditor();
  else {
    usage();
    process.exitCode = 1;
  }
} catch (error) {
  fail(error);
}
