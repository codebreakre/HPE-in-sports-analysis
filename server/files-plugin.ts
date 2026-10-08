// Vite dev/preview server endpoints that connect the browser app to the project folders
// (the browser cannot read or write local files by itself). Client side: src/api.ts.
//   GET  /api/data                      → list of videos/images under data/ (recursive)
//   GET  /data/<path>                   → one file from data/
//   POST /api/results/reserve           → { model, base } → free file stem in results/<model>/
//   PUT  /api/results/<model>/<file>    → write a result file (never overwrites; 409 if it exists)
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

const DATA_DIR = path.resolve("data");
const RESULTS_DIR = path.resolve("results");

const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp",
};

type Next = (err?: unknown) => void;

/** Plain file/folder names only: letters, digits, _ . - (no slashes, no leading dot). */
const isSafeName = (name: unknown): name is string =>
  typeof name === "string" && /^[\w.\-]+$/.test(name) && !name.startsWith(".");

/** Resolves `rel` inside `base`, rejecting anything that escapes it (e.g. "../"). */
function inside(base: string, rel: string): string {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base + path.sep)) throw new Error("Path outside folder");
  return resolved;
}

function listMedia(dir: string, rel = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listMedia(path.join(dir, entry.name), relPath);
    return MEDIA_TYPES[path.extname(entry.name).toLowerCase()] ? [relPath] : [];
  });
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  // List inputs.
  if (req.method === "GET" && url.pathname === "/api/data") {
    return sendJson(res, 200, { files: listMedia(DATA_DIR) });
  }

  // Serve one input file.
  if (req.method === "GET" && parts[0] === "data" && parts.length > 1) {
    const file = inside(DATA_DIR, parts.slice(1).join("/"));
    if (!fs.existsSync(file)) return sendJson(res, 404, { error: "Not found" });
    res.setHeader("Content-Type", MEDIA_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Content-Length", fs.statSync(file).size);
    return fs.createReadStream(file).pipe(res);
  }

  // Pick a file stem that no earlier run of this video/model uses: clip, clip_run2, clip_run3, …
  if (req.method === "POST" && url.pathname === "/api/results/reserve") {
    const { model, base } = JSON.parse((await readBody(req)).toString() || "{}");
    if (!isSafeName(model) || !isSafeName(base)) return sendJson(res, 400, { error: "Bad model or name" });
    const dir = inside(RESULTS_DIR, model);
    fs.mkdirSync(dir, { recursive: true });
    const existing = fs.readdirSync(dir);
    const isUsed = (stem: string) => existing.some((f) => f.startsWith(`${stem}-`));
    let stem = base;
    for (let n = 2; isUsed(stem); n++) stem = `${base}_run${n}`;
    return sendJson(res, 200, { stem, dir: `results/${model}` });
  }

  // Write one result file.
  if (req.method === "PUT" && parts[0] === "api" && parts[1] === "results" && parts.length === 4) {
    const [, , model, name] = parts;
    if (!isSafeName(model) || !isSafeName(name)) return sendJson(res, 400, { error: "Bad model or file name" });
    const dir = inside(RESULTS_DIR, model);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(inside(dir, name), await readBody(req), { flag: "wx" }); // wx: fail instead of overwriting
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return sendJson(res, 409, { error: `${name} already exists` });
      throw err;
    }
    return sendJson(res, 200, { path: `results/${model}/${name}` });
  }

  next();
}

export default function filesPlugin(): Plugin {
  // Must not return anything: Vite treats a returned function as a post-middleware hook.
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, res, next) => {
      handle(req, res, next).catch((err: Error) => sendJson(res, 500, { error: err.message }));
    });
  };
  return { name: "hpe-files", configureServer: mount, configurePreviewServer: mount };
}
