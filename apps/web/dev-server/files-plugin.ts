// Vite dev/preview server endpoints that connect the browser app to the project folders
// (the browser cannot read or write local files by itself). Client side: src/api.ts.
//   GET  /api/data                      → list of videos/images under data/ (recursive)
//   GET  /data/<path>                   → one file from data/
//   GET  /results/<path>                → one file from results/ (read-only, e.g. analysis CSVs, annotated videos)
//   GET  /api/results                   → every saved run (results/<model>/<stem>-pose.json): metadata + its files
// File responses support Range requests, so saved videos can be seeked.
//   POST /api/results/reserve           → { model, base } → free file stem in results/<model>/
//   PUT  /api/results/<model>/<file>    → write a result file (never overwrites; 409 if it exists)
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

// data/ and results/ are at the repository root (apps/web/dev-server/ → ../../..), shared with the Python server.
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const RESULTS_DIR = path.join(REPO_ROOT, "results");

const MEDIA_TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".bmp": "image/bmp",
};
// Extra types served from results/ (not listed as inputs).
const RESULT_TYPES: Record<string, string> = {
  ...MEDIA_TYPES, ".csv": "text/csv; charset=utf-8", ".json": "application/json; charset=utf-8",
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

/** Streams a file, honouring a single `Range: bytes=a-b` header (videos need it to seek). */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  const size = fs.statSync(file).size;
  res.setHeader("Content-Type", type);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-cache"); // re-running the analysis rewrites some of these files
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!range || (!range[1] && !range[2])) {
    res.setHeader("Content-Length", size);
    return fs.createReadStream(file).pipe(res);
  }
  // "a-b", "a-" (to the end) or "-n" (the last n bytes)
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    return res.end();
  }
  res.statusCode = 206;
  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  res.setHeader("Content-Length", end - start + 1);
  return fs.createReadStream(file, { start, end }).pipe(res);
}

/** One saved run, as listed by GET /api/results (the frames stay in the JSON file). */
interface RunMeta {
  model: string;
  stem: string;
  [field: string]: unknown;
}
interface SavedRunEntry extends RunMeta {
  /** Files of this run: suffix (e.g. "-pose.json", "-annotated.mp4") → path under results/ */
  files: Record<string, string>;
}

// Parsing a pose JSON takes a while (a few MB each), so entries are cached until the file changes.
const runCache = new Map<string, { mtimeMs: number; entry: RunMeta }>();

function listSavedRuns(): SavedRunEntry[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  const runs: SavedRunEntry[] = [];
  for (const dir of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const names = fs.readdirSync(path.join(RESULTS_DIR, dir.name));
    for (const name of names.filter((n) => n.endsWith("-pose.json"))) {
      const stem = name.slice(0, -"-pose.json".length);
      const entry = readRunEntry(dir.name, stem, path.join(RESULTS_DIR, dir.name, name));
      if (!entry) continue;
      const files = Object.fromEntries(names
        .filter((n) => n.startsWith(`${stem}-`))
        .map((n) => [n.slice(stem.length), `${dir.name}/${n}`]));
      runs.push({ ...entry, files });
    }
  }
  return runs;
}

function readRunEntry(model: string, stem: string, file: string): RunMeta | null {
  const { mtimeMs } = fs.statSync(file);
  const cached = runCache.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.entry;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const { frames, ...meta } = json; // everything but the per-frame data
    // `model` in the JSON is the weights file; here it is the results folder (= model id).
    const entry = { ...meta, weights: meta.model, model, stem, frameCount: Array.isArray(frames) ? frames.length : 0 };
    runCache.set(file, { mtimeMs, entry });
    return entry;
  } catch {
    return null; // not a pose result (or a broken file): leave it out
  }
}

async function handle(req: IncomingMessage, res: ServerResponse, next: Next) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

  // List inputs.
  if (req.method === "GET" && url.pathname === "/api/data") {
    return sendJson(res, 200, { files: listMedia(DATA_DIR) });
  }

  // List saved runs.
  if (req.method === "GET" && url.pathname === "/api/results") {
    return sendJson(res, 200, { runs: listSavedRuns() });
  }

  // Serve one input file, or one saved result file.
  if (req.method === "GET" && (parts[0] === "data" || parts[0] === "results") && parts.length > 1) {
    const [base, types] = parts[0] === "data" ? [DATA_DIR, MEDIA_TYPES] : [RESULTS_DIR, RESULT_TYPES];
    const file = inside(base, parts.slice(1).join("/"));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { error: "Not found" });
    return sendFile(req, res, file, types[path.extname(file).toLowerCase()] ?? "application/octet-stream");
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
