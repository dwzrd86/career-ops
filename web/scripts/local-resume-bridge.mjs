import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { generationFailureResponse } from "./resume-generation-errors.mjs";

const endpoint = "/__career_ops/resume";
const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Development middleware only. The production build contains no runner or credentials.
export function resumeMiddleware({ root, model, generate }) {
  let running = false;
  return async (req, res, next) => {
    if (req.url?.split("?")[0] !== endpoint) return next();
    const reply = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(data));
    };
    let url;
    try { url = new URL(`http://${req.headers.host}`); } catch { return reply(403, { error: "Local connection required." }); }
    if (!loopback.has(req.socket.remoteAddress) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        Number(url.port || 80) !== req.socket.localPort ||
        (req.headers.origin && req.headers.origin !== url.origin) ||
        req.headers["x-career-ops-local"] !== "1") {
      return reply(403, { error: "Use Resume Studio from this local development server." });
    }
    const enabled = /^zai-coding-plan\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model ?? "");
    if (req.method === "GET") return reply(200, { enabled, model: enabled ? model : null, running });
    if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
    if (!enabled) return reply(503, { error: "Start the local server with CAREER_OPS_GLM_MODEL configured." });
    if (req.headers.origin !== url.origin || req.headers["content-type"] !== "application/json") {
      return reply(403, { error: "Same-origin JSON request required." });
    }
    if (running) return reply(409, { error: "A GLM draft is already generating. Try again when it finishes." });
    running = true;
    let directory;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 400000) { reply(413, { error: "Resume evidence is too large." }); return; }
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { return reply(400, { error: "Invalid resume evidence." }); }
      if (input?.consent !== true || typeof input?.brief !== "string") {
        return reply(400, { error: "Explicit provider consent and a resume brief are required." });
      }
      // Load the shared validator/runner from disk, outside Vite's config bundler.
      const runner = await import(pathToFileURL(resolve(root, "scripts/tailor-resume.mjs")).href);
      try { runner.canonicalBrief(input.brief); }
      catch { return reply(400, { error: "The brief needs a valid source resume and job description." }); }
      const local = resolve(root, "../agent/.local/resume-runs");
      await mkdir(local, { recursive: true, mode: 0o700 });
      directory = await mkdtemp(join(local, "bridge-"));
      const brief = join(directory, "brief.txt"), out = join(directory, "draft.txt");
      await writeFile(brief, input.brief, { mode: 0o600 });
      await (generate ?? runner.runTailoring)({ brief, out, model, send: true });
      const draft = await readFile(out, "utf8");
      reply(200, { draft });
    } catch (error) {
      reply(502, generationFailureResponse(error));
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
      running = false;
    }
  };
}

export function localResumePlugin() {
  return {
    name: "local-opencode-resume-generation",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(resumeMiddleware({ root: server.config.root,
        model: process.env.CAREER_OPS_GLM_MODEL }));
    },
  };
}
