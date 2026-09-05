const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 80;
const COBALT = "cobalt-production-90d3.up.railway.app";
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

function httpsReq(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, resolve);
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}
function readJSON(s) {
  return new Promise((resolve, reject) => {
    let d = ""; s.on("data", c => d += c);
    s.on("end", () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    s.on("error", reject);
  });
}
function followAndPipe(url, res, filename) {
  const u = new URL(url);
  console.log("Downloading:", u.hostname + u.pathname);
  https.get({ hostname: u.hostname, port: 443, path: u.pathname + u.search,
    headers: { "User-Agent": "SoundGrab/1.0", "Host": u.hostname }
  }, (dlRes) => {
    console.log("Tunnel status:", dlRes.statusCode, "Content-Length:", dlRes.headers["content-length"], "Type:", dlRes.headers["content-type"]);
    if (dlRes.statusCode >= 300 && dlRes.statusCode < 400 && dlRes.headers.location) {
      console.log("Redirect to:", dlRes.headers.location);
      return followAndPipe(dlRes.headers.location, res, filename);
    }
    const headers = {
      "Content-Type": dlRes.headers["content-type"] || "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "X-Filename, Content-Disposition",
      "Content-Disposition": "attachment; filename=\"" + filename + "\"",
      "X-Filename": encodeURIComponent(filename),
    };
    if (dlRes.headers["content-length"]) {
      headers["Content-Length"] = dlRes.headers["content-length"];
    }
    if (dlRes.headers["transfer-encoding"]) {
      headers["Transfer-Encoding"] = dlRes.headers["transfer-encoding"];
    }
    res.writeHead(200, headers);
    dlRes.pipe(res);
  }).on("error", (e) => {
    console.error("Download error:", e.message);
    if (!res.headersSent) { res.writeHead(502, {"Access-Control-Allow-Origin":"*","Content-Type":"application/json"}); res.end(JSON.stringify({error:"download_failed: "+e.message})); }
  });
}

async function handleConvert(req, res) {
  try {
    let body = ""; for await (const c of req) body += c;
    const p = JSON.parse(body);
    console.log("Convert request:", p.url);
    const apiBody = JSON.stringify({ url: p.url, downloadMode: "audio",
      audioFormat: p.audioFormat || "mp3", audioBitrate: p.audioBitrate || "128", alwaysProxy: true });

    const apiRes = await httpsReq({ hostname: COBALT, port: 443, path: "/", method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json",
        "Content-Length": Buffer.byteLength(apiBody), "Host": COBALT }
    }, apiBody);

    const data = await readJSON(apiRes);
    console.log("Cobalt response:", data.status, data.filename || "", data.url?.substring(0,80) || "");

    if (data.status === "error") {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ error: data.error?.code || "cobalt_error" }));
    }

    let dlUrl = null, filename = "audio.mp3";
    if (data.status === "tunnel" || data.status === "redirect") { dlUrl = data.url; if (data.filename) filename = data.filename; }
    else if (data.status === "picker" && data.picker?.length > 0) { dlUrl = data.audio || data.picker[0].url; if (data.filename) filename = data.filename; }

    if (!dlUrl) {
      res.writeHead(400, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ error: "no_url_" + data.status }));
    }

    console.log("Tunnel URL:", dlUrl.substring(0, 100));
    followAndPipe(dlUrl, res, filename);
  } catch (err) {
    console.error("Convert error:", err.message);
    if (!res.headersSent) { res.writeHead(500, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
      res.end(JSON.stringify({ error: err.message })); }
  }
}

http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Accept" });
    return res.end();
  }
  const url = new URL(req.url, "http://" + req.headers.host);
  if (url.pathname === "/convert" && req.method === "POST") return handleConvert(req, res);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(PORT, () => console.log("SoundGrab on port " + PORT));
