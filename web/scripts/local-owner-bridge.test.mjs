import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { localOwnerMiddleware } from "./local-owner-bridge.mjs";

test("local owner bridge requires loopback origin/header and never exposes its operator key", async () => {
  const calls = [];
  const middleware = localOwnerMiddleware({ adminKey: "operator-test-only", convexUrl: "https://dev-test.convex.cloud",
    create: async input => { calls.push(input); } });
  const server = createServer((req, res) => { void middleware(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + "/__career_ops/local-owner";
  const payload = { email: "owner@example.test", password: "OwnerPassword123" };
  const send = (headers = {}, body = JSON.stringify(payload)) => fetch(url, { method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Career-Ops-Local": "1", ...headers }, body });
  try {
    const status = await fetch(url, { headers: { "X-Career-Ops-Local": "1" } });
    assert.deepEqual(await status.json(), { enabled: true });
    for (const headers of [{ Origin: "https://evil.test" }, { Origin: "" }, { "X-Career-Ops-Local": "" }, { "Content-Type": "text/plain" }]) {
      assert.equal((await send(headers)).status, 403);
    }
    assert.equal((await send({}, "x".repeat(4097))).status, 413);
    assert.equal((await send({}, "invalid")).status, 400);
    assert.equal(calls.length, 0);
    const response = await send();
    assert.deepEqual(await response.json(), { created: true });
    assert.deepEqual(calls, [{ ...payload, adminKey: "operator-test-only" }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
