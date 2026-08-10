import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("Port must be an integer from 0 to 65535.");
}

const files = new Map([
  ["/index.html", "text/html"],
  ["/styles.css", "text/css"],
  ["/app.mjs", "text/javascript"],
  ["/model.mjs", "text/javascript"],
]);

const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  const file = path === "/" ? "/index.html" : path;
  if (!files.has(file)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(new URL("." + file, import.meta.url));
    response.writeHead(200, { "Content-Type": files.get(file) + "; charset=utf-8" }).end(content);
  } catch {
    response.writeHead(500).end("Unable to load demo asset.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Grid-Forming Inverter Lab at http://127.0.0.1:${server.address().port}`);
});
