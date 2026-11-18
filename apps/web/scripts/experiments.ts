// Controlled video experiments for the thesis (report chapter 4), end to end:
//   FFmpeg builds a test video → the HPE server (apps/server, `npm run server`) finds the keypoints →
//   the sync algorithm (src/sync) scores it → one CSV row per video in results/experiments/<experiment>.csv.
//
//   npm run experiments -- [experiment …]      (from the repo root; no names = all)
//
// Experiments (report table 4.1): lag, mirror, different, distance, resolution, fps, people, real.
// The source is one person: the left half of data/latency-0.mp4 (a ballet dancer, 13.9 s, 30 fps), made
// 25 fps. A pair video is the source next to a changed copy of itself (hstack), so the true answer is known:
// person 1 = left = original, person 2 = right = the copy. "real" runs the real 3-person recordings
// data/personCount3_test*.mp4. Generated videos go to data/experiments/ (inputs, not in git); each server
// result is kept as results/experiments/pose/<video>-pose.json, so the sync step can be re-run without HPE.
// Needs FFmpeg (FFMPEG env, else tools/ffmpeg/ffmpeg.exe, else ffmpeg on PATH) and a running server
// (HPE_SERVER_URL, default http://127.0.0.1:8000). Existing videos and pose files are reused, CSVs rewritten.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { analyzeSync, findEpisodes, type SyncConfig, type SyncFrame } from "../src/sync/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const DATA = path.join(ROOT, "data", "experiments");
const OUT = path.join(ROOT, "results", "experiments");
const POSE = path.join(OUT, "pose");
const SERVER = process.env.HPE_SERVER_URL ?? "http://127.0.0.1:8000";
const FFMPEG = process.env.FFMPEG
  ?? (fs.existsSync(path.join(ROOT, "tools/ffmpeg/ffmpeg.exe")) ? path.join(ROOT, "tools/ffmpeg/ffmpeg.exe") : "ffmpeg");
const FPS = 25;
const SOURCE = path.join(DATA, "source-ballet-25fps.mp4");
const SOURCE30 = path.join(DATA, "source-ballet-30fps.mp4");
const ENCODE = ["-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-an"];

/** Default config (what the app saves) plus the proposed S_lag ramp and smoothing off, for comparison. */
const VARIANTS: Record<string, Partial<SyncConfig>> = {
  default: {},
  ramp: { lagConfidence: "ramp", lagRampWidth: 0.2 },
  nosmooth: { smooth: false },
};

// ---------- video building ----------

function ffmpeg(args: string[]) {
  execFileSync(FFMPEG, ["-v", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
}

/** Builds `name`.mp4 in data/experiments/ unless it exists. */
function video(name: string, build: (out: string) => void): string {
  const out = path.join(DATA, `${name}.mp4`);
  if (!fs.existsSync(out)) {
    console.log(`  building ${name}.mp4`);
    build(out);
  }
  return out;
}

function sources() {
  fs.mkdirSync(DATA, { recursive: true });
  const src = path.join(ROOT, "data", "latency-0.mp4");
  if (!fs.existsSync(SOURCE30)) ffmpeg(["-i", src, "-vf", "crop=iw/2:ih:0:0", ...ENCODE, SOURCE30]);
  if (!fs.existsSync(SOURCE)) ffmpeg(["-i", SOURCE30, "-vf", `fps=${FPS}`, ...ENCODE, SOURCE]);
}

/** Source next to a copy: `copy` is the filter chain for the right person (input label [b]), `after` runs on the pair. */
function pair(out: string, copy: string, { input = SOURCE, extra = [] as string[], after = "" } = {}) {
  const graph = `[0:v]split=2[a][b0];[b0]${copy || "null"}[b];[a][b]hstack=inputs=2:shortest=1${after ? `,${after}` : ""}[v]`;
  ffmpeg(["-i", input, ...extra, "-filter_complex", graph, "-map", "[v]", ...ENCODE, out]);
}

const delay = (frames: number, fps = FPS) => `tpad=start_duration=${(frames / fps).toFixed(4)}:start_mode=clone`;

// ---------- HPE on the server ----------

interface PoseFile { video: string; device: string; width: number; height: number; fps: number; frames: SyncFrame[]; processingMs: number; msPerFrame: number }

async function pose(file: string): Promise<PoseFile> {
  const name = path.basename(file, ".mp4");
  const cache = path.join(POSE, `${name}-pose.json`);
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, "utf8"));
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)]), path.basename(file));
  form.append("model", "rtmpose-m");
  form.append("conf", "0.25");
  type Job = { id: string; status: string; error: string | null };
  // A reused keep-alive socket can be closed by the server between jobs; a fresh try then works.
  let job: Job | null = null;
  for (let attempt = 1; !job; attempt++) {
    try {
      job = (await (await fetch(`${SERVER}/jobs`, { method: "POST", body: form, headers: { connection: "close" } })).json()) as Job;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  while (job.status === "queued" || job.status === "running") {
    await new Promise((r) => setTimeout(r, 500));
    job = (await (await fetch(`${SERVER}/jobs/${job.id}`)).json()) as Job;
  }
  if (job.status !== "done") throw new Error(`${name}: server job ${job.status} ${job.error ?? ""}`);
  const kp = (await (await fetch(`${SERVER}/jobs/${job.id}/keypoints`)).json()) as {
    device: string; width: number; height: number; fps: number; processingMs: number; frames: unknown[];
  };
  await fetch(`${SERVER}/jobs/${job.id}`, { method: "DELETE" });
  const frames = kp.frames as (SyncFrame & { speed: { preprocess: number; inference: number; postprocess: number } })[];
  const msPerFrame = frames.reduce((s, f) => s + f.speed.preprocess + f.speed.inference + f.speed.postprocess, 0) / Math.max(1, frames.length);
  const result: PoseFile = {
    video: path.relative(ROOT, file).replaceAll("\\", "/"), device: kp.device, width: kp.width, height: kp.height,
    fps: kp.fps, frames, processingMs: kp.processingMs, msPerFrame: round(msPerFrame),
  };
  fs.mkdirSync(POSE, { recursive: true });
  fs.writeFileSync(cache, JSON.stringify(result));
  console.log(`  ${name}: ${frames.length} frames, ${result.msPerFrame} ms/frame on ${kp.device}`);
  return result;
}

// ---------- scoring ----------

type Row = Record<string, string | number | null>;

/** Sync of one video, for every config variant; `truth` = the true lag of person 2 behind person 1 (s), if known. */
function score(p: PoseFile, info: Row, truth: number | null, persons: number | null = null): Row {
  const row: Row = { ...info, video: p.video, frames: p.frames.length, fps: p.fps, width: p.width, height: p.height, ms_per_frame: p.msPerFrame };
  for (const [variant, config] of Object.entries(VARIANTS)) {
    const a = analyzeSync(p.frames, p.fps, { ...config, persons });
    const r = a.result;
    const pr = r.pairs.find((x) => x.pair[0] === 1 && x.pair[1] === 2) ?? r.pairs[0];
    const v = variant === "default" ? "" : `${variant}_`;
    row[`${v}group`] = r.group.score;
    row[`${v}pair12`] = pr?.score ?? null;
    if (variant !== "default") continue;
    row.persons = r.personCount;
    row.frames_exact = r.assignment.framesExact;
    row.pose = pr?.pose ?? null;
    row.corr = pr?.corr ?? null;
    row.lag_score = pr?.lag ?? null;
    row.lag_sec = pr?.lagSec ?? null;
    row.rho_max = pr?.rhoMax ?? null;
    row.lag_reliable = pr?.lagReliable ? 1 : 0;
    row.lag_error_ms = truth !== null && pr?.lagSec !== null && pr?.lagSec !== undefined ? Math.round(Math.abs(pr.lagSec - truth) * 1000) : null;
    row.mirror_share = pr?.mirrorShare ?? null;
    row.arms = pr?.parts.arms ?? null;
    row.legs = pr?.parts.legs ?? null;
    row.torso = pr?.parts.torso ?? null;
    row.person_scores = r.persons.map((x) => x.score).join(" ");
    row.most_deviating = r.group.mostDeviating;
    const eps = findEpisodes(r, a.angles);
    row.moments = eps.length;
    row.moments_list = eps.map((e) => `${e.startTime}-${e.endTime}s p${e.pair.join("-")}${e.lagSec !== null ? ` lag ${e.lagSec}` : ""}`).join("; ");
  }
  return row;
}

const round = (v: number) => Math.round(v * 100) / 100;

function writeCsv(name: string, rows: Row[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.csv`), [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n"));
  console.log(`wrote results/experiments/${name}.csv (${rows.length} rows)`);
}

/** Share of person 2's keypoints within 5 % of box height of the reference run (same frame, same person by hip order). */
function pck(ref: PoseFile, p: PoseFile, scale: number): number | null {
  let hit = 0, n = 0;
  const sorted = (f: SyncFrame) => [...f.persons].sort((a, b) => a.box[0] - b.box[0]);
  for (let t = 0; t < Math.min(ref.frames.length, p.frames.length); t++) {
    const A = sorted(ref.frames[t]), B = sorted(p.frames[t]);
    if (A.length !== B.length) continue;
    A.forEach((a, i) => {
      const h = a.box[3] - a.box[1];
      a.keypoints.forEach((k, j) => {
        const m = B[i].keypoints[j];
        if (k.conf < 0.3) return;
        n++;
        if (Math.hypot(k.x - m.x * scale, k.y - m.y * scale) <= 0.05 * h) hit++;
      });
    });
  }
  return n ? round((hit / n) * 100) : null;
}

// ---------- experiments ----------

const LAGS = [0, 1, 2, 3, 5, 8, 12, 25];

const EXPERIMENTS: Record<string, () => Promise<void>> = {
  async lag() {
    const rows: Row[] = [];
    for (const d of LAGS) {
      const v = video(`lag-${String(d).padStart(2, "0")}f`, (out) => pair(out, d ? delay(d) : ""));
      rows.push(score(await pose(v), { condition: d ? `lag ${d} frames` : "in step", lag_frames: d, true_lag_sec: d / FPS }, d / FPS));
    }
    writeCsv("lag", rows);
  },
  async mirror() {
    const rows: Row[] = [];
    for (const d of [0, 8]) {
      const v = video(`mirror-${String(d).padStart(2, "0")}f`, (out) => pair(out, d ? `hflip,${delay(d)}` : "hflip"));
      rows.push(score(await pose(v), { condition: `mirrored${d ? `, lag ${d} frames` : ""}`, lag_frames: d, true_lag_sec: d / FPS }, d / FPS));
    }
    writeCsv("mirror", rows);
  },
  async different() {
    const rows: Row[] = [];
    for (const off of [4, 7, 10]) {
      // The right person is the same dancer started `off` seconds later (looped): a different move at each moment.
      const v = video(`different-${off}s`, (out) => ffmpeg(["-i", SOURCE, "-stream_loop", "1", "-ss", String(off), "-i", SOURCE,
        "-filter_complex", "[0:v][1:v]hstack=inputs=2:shortest=1[v]", "-map", "[v]", ...ENCODE, out]));
      rows.push(score(await pose(v), { condition: `different motion (${off} s apart)`, offset_sec: off }, null));
    }
    writeCsv("different", rows);
  },
  async distance() {
    const rows: Row[] = [];
    for (const d of [0, 8]) {
      for (const s of [1, 0.75, 0.5, 0.25]) {
        const shrink = s === 1 ? "" : `scale=trunc(iw*${s}/2)*2:-2,pad=960:1080:(ow-iw)/2:oh-ih:color=0xE8DCD6`;
        const chain = [shrink, d ? delay(d) : ""].filter(Boolean).join(",");
        const v = video(`distance-${Math.round(s * 100)}-${String(d).padStart(2, "0")}f`, (out) => pair(out, chain));
        rows.push(score(await pose(v), { condition: `copy at ${Math.round(s * 100)} %${d ? `, lag ${d} frames` : ""}`, size_pct: s * 100, lag_frames: d, true_lag_sec: d / FPS }, d / FPS));
      }
    }
    writeCsv("distance", rows);
  },
  async resolution() {
    const rows: Row[] = [];
    const ref = await pose(video("lag-08f", (out) => pair(out, delay(8))));
    for (const h of [1080, 720, 480, 360, 240]) {
      const v = h === 1080 ? path.join(DATA, "lag-08f.mp4")
        : video(`resolution-${h}p-08f`, (out) => ffmpeg(["-i", path.join(DATA, "lag-08f.mp4"), "-vf", `scale=-2:${h}`, ...ENCODE, out]));
      const p = await pose(v);
      rows.push({ ...score(p, { condition: `${h}p, lag 8 frames`, height_px: h, lag_frames: 8, true_lag_sec: 8 / FPS }, 8 / FPS),
        pck05_vs_1080: pck(ref, p, 1080 / h) });
    }
    writeCsv("resolution", rows);
  },
  async fps() {
    const rows: Row[] = [];
    // 0.3 s lag at 30 fps (9 frames), then the pair resampled to lower rates.
    const base = video("fps-30-lag0.3s", (out) => pair(out, delay(9, 30), { input: SOURCE30 }));
    for (const f of [30, 25, 15, 10]) {
      const v = f === 30 ? base : video(`fps-${f}-lag0.3s`, (out) => ffmpeg(["-i", base, "-vf", `fps=${f}`, ...ENCODE, out]));
      rows.push(score(await pose(v), { condition: `${f} fps, lag 0.3 s`, video_fps: f, true_lag_sec: 0.3 }, 0.3));
    }
    writeCsv("fps", rows);
  },
  async people() {
    const rows: Row[] = [];
    for (const n of [2, 3, 4]) {
      // n copies side by side; the last one is 8 frames (0.32 s) late, so it should be the least in sync.
      const v = video(`people-${n}`, (out) => {
        const labels = Array.from({ length: n }, (_, i) => `[c${i}]`);
        const late = labels.map((l, i) => (i === n - 1 ? `${l}${delay(8)}[d${i}]` : `${l}null[d${i}]`)).join(";");
        const graph = `[0:v]split=${n}${labels.join("")};${late};${labels.map((_, i) => `[d${i}]`).join("")}hstack=inputs=${n}:shortest=1[v]`;
        ffmpeg(["-i", SOURCE, "-filter_complex", graph, "-map", "[v]", ...ENCODE, out]);
      });
      rows.push(score(await pose(v), { condition: `${n} people, last one 8 frames late`, people: n, late_person: n }, null, n));
    }
    writeCsv("people", rows);
  },
  async real() {
    const rows: Row[] = [];
    for (const name of ["personCount3_test1", "personCount3_test4", "personCount3_test5", "personCount3_test6"]) {
      const file = path.join(ROOT, "data", `${name}.mp4`);
      if (!fs.existsSync(file)) continue;
      rows.push(score(await pose(file), { condition: `real recording ${name}` }, null));
    }
    writeCsv("real", rows);
  },
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(EXPERIMENTS);
sources();
for (const name of names) {
  if (!EXPERIMENTS[name]) throw new Error(`unknown experiment ${name}; known: ${Object.keys(EXPERIMENTS).join(", ")}`);
  console.log(`== ${name}`);
  await EXPERIMENTS[name]();
}
