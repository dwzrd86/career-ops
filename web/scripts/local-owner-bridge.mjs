import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { isLocalRequest } from "./local-request.mjs";

export function localOwnerMiddleware({ adminKey, convexUrl, create }) {
  return async (req, res, next) => {
    if (req.url !== "/__career_ops/local-owner") return next();
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (!isLocalRequest(req, req.method === "POST")) return reply(403, { error: "Use the local dashboard." });
    const enabled = Boolean(adminKey && /^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(convexUrl ?? ""));
    if (req.method === "GET") return reply(200, { enabled });
    if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
    if (!enabled) return reply(503, { error: "Local owner setup is not configured." });
    if (req.headers["content-type"] !== "application/json") return reply(403, { error: "JSON request required." });
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4096) return reply(413, { error: "Account details exceed the limit." });
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return reply(400, { error: "Enter your email and password." }); }
      if (typeof data?.email !== "string" || typeof data?.password !== "string") return reply(400, { error: "Enter your email and password." });
      const provision = create ?? (input => new ConvexHttpClient(convexUrl).action(anyApi.localOwner.create, input));
      await provision({ adminKey, email: data.email, password: data.password });
      reply(200, { created: true });
    } catch {
      reply(400, { error: "Could not create the local owner. If you already created an account, sign in instead. Use a password of 12–128 characters with a letter and number." });
    }
  };
}

export function localOwnerPlugin() {
  return { name: "local-first-owner", apply: "serve", configureServer(server) {
    server.middlewares.use(localOwnerMiddleware({ adminKey: process.env.CAREER_OPS_OWNER_ADMIN_KEY,
      convexUrl: process.env.CAREER_OPS_OWNER_CONVEX_URL }));
  } };
}
