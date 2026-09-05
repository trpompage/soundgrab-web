const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 80;
const COBALT = "cobalt-production-90d3.up.railway.app";

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function proxy(targetPath, req, res) {
  const opts = {
    hostname: COBALT,
    port: 443,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: COBALT },
  };
  const proxyReq = https.request(opts, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    headers["access-control-allow-origin"] = "*";
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });
  proxyReq.on("error", () => { res.writeHead(502); res.end("Proxy error"); });
  req.pipe(proxyReq);
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "Content-Type,Accept" });
    return res.end();
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api") return proxy("/" + url.search, req, res);
  if (url.pathname.startsWith("/tunnel")) return proxy(url.pathname + url.search, req, res);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(PORT, () => console.log("SoundGrab on port " + PORT));
