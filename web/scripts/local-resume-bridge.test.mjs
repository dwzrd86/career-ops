import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resumeMiddleware } from "./local-resume-bridge.mjs";
import { ResumeGenerationError } from "./resume-generation-errors.mjs";
import { tailoringBrief } from "../src/resumeTailoring.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const brief = tailoringBrief({ company: "Example", title: "Analyst" }, "Zoë Example\nSQL", "SQL analyst");

async function fixture(model, generate, run) {
  const handler = resumeMiddleware({ root, model, generate });
  const server = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (data, headers = {}) => fetch(origin + "/__career_ops/resume", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Career-Ops-Local": "1", ...headers },
    body: JSON.stringify(data),
  });
  try { await run({ origin, request }); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("bridge rejects disabled configuration, cross-origin traffic, missing consent and invalid evidence without generating", async () => {
  let calls = 0;
  const generate = () => { calls++; throw new Error("must not run"); };
  await fixture(undefined, generate, async ({ request }) => {
    assert.equal((await request({ brief, consent: true })).status, 503);
  });
  await fixture("zai-coding-plan/glm-5", generate, async ({ request, origin }) => {
    const status = await fetch(origin + "/__career_ops/resume", { headers: { "X-Career-Ops-Local": "1" } });
    assert.equal((await status.json()).enabled, true);
    for (const [headers, expected] of [[{ Origin: "https://evil.test" }, 403], [{ "X-Career-Ops-Local": "" }, 403],
      [{ "Content-Type": "text/plain" }, 403]]) {
      assert.equal((await request({ brief, consent: true }, headers)).status, expected, JSON.stringify(headers));
    }
    // Fetch normalizes Host, so send rebinding probes over the raw HTTP client.
    for (const host of ["evil.test", "localhost:1"]) {
      const code = await new Promise((resolve, reject) => {
        const req = httpRequest(origin + "/__career_ops/resume", { headers: { Host: host, "X-Career-Ops-Local": "1" } }, res => {
          res.resume(); resolve(res.statusCode);
        });
        req.on("error", reject); req.end();
      });
      assert.equal(code, 403);
    }
    assert.equal((await request({ brief, consent: false })).status, 400);
    assert.equal((await request({ brief: "invalid", consent: true })).status, 400);
    assert.equal((await request({ brief: "x".repeat(400001), consent: true })).status, 413);
  });
  assert.equal(calls, 0);
});

test("bridge returns a private draft, prevents concurrent runs, cleans attachments and hides provider errors", async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let fail = false, directory;
  await fixture("zai-coding-plan/glm-5", async options => {
    directory = resolve(options.out, "..");
    assert.equal(options.send, true);
    assert.equal(options.model, "zai-coding-plan/glm-5");
    assert.equal(await readFile(options.brief, "utf8"), brief);
    started(); await barrier;
    if (fail) throw new Error("SECRET provider output");
    await writeFile(options.out, "Zoë Example\nSQL", { mode: 0o600 });
  }, async ({ request }) => {
    const first = request({ brief, consent: true });
    await ready;
    assert.equal((await request({ brief, consent: true })).status, 409);
    release();
    const result = await first;
    assert.equal(result.status, 200);
    assert.equal((await result.json()).draft, "Zoë Example\nSQL");
    // Response delivery can precede the asynchronous cleanup by one event-loop turn.
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await readdir(directory); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await assert.rejects(readdir(directory), /ENOENT/);
    fail = true;
    const failed = await request({ brief, consent: true });
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes("SECRET"));
  });
});

test("bridge preserves safe generation failure codes without forwarding arbitrary messages", async () => {
  for (const code of ["authentication", "quota", "timeout", "incomplete", "unavailable"]) {
    await fixture("zai-coding-plan/glm-4.7", async () => { throw new ResumeGenerationError(code); }, async ({ request }) => {
      const response = await request({ brief, consent: true });
      assert.equal(response.status, 502);
      const failure = await response.json();
      assert.equal(failure.code, code);
      assert.match(failure.error, /Your editor is unchanged/);
    });
  }
});
