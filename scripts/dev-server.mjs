import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, watch } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { spawn } from "node:child_process";

const root = normalize(process.cwd());
const clients = new Set();
const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const liveReload = `<script>(function(){const s=new EventSource('/__dev/events');s.onmessage=()=>location.reload()})();</script>`;

function safePath(urlPath) {
  const pathname = decodeURIComponent(urlPath);
  const requested = pathname === "/"
    ? "extension/setup.html"
    : pathname.replace(/^\/+/, "").startsWith("extension/")
      ? pathname.replace(/^\/+/, "")
      : join("extension", pathname.replace(/^\/+/, ""));
  const file = normalize(join(root, requested));
  return file === root || file.startsWith(`${root}${sep}`) ? file : null;
}

function broadcast() {
  for (const response of clients) response.write("data: reload\n\n");
}

const server = createServer((request, response) => {
  if (request.url === "/__dev/events") {
    response.writeHead(200, { "Cache-Control": "no-cache", Connection: "keep-alive", "Content-Type": "text/event-stream" });
    response.write("retry: 500\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  const file = safePath(new URL(request.url, "http://localhost").pathname);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Arquivo nao encontrado: popup requer extension/setup.html e extension/setup.css.\n");
    return;
  }

  let body = readFileSync(file);
  const type = mime[extname(file).toLowerCase()] || "application/octet-stream";
  if (type.startsWith("text/html")) body = Buffer.from(body.toString("utf8").replace("</body>", `${liveReload}</body>`));
  response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": type });
  response.end(body);
});

watch(join(root, "extension"), { recursive: true }, broadcast);
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`Popup dev: ${url}`);
  if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
});
