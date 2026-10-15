const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLocalRequest(req, requireOrigin = false) {
  let url;
  try { url = new URL(`http://${req.headers.host}`); } catch { return false; }
  return loopback.has(req.socket.remoteAddress) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
    Number(url.port || 80) === req.socket.localPort &&
    (!requireOrigin && !req.headers.origin || req.headers.origin === url.origin) &&
    req.headers["x-career-ops-local"] === "1";
}
