// Compares the S_lag variants around ρmin (SyncConfig.lagConfidence: hard / ramp / drop):
//   1. stability: the same video processed twice with nearly identical keypoints (browser vs. server run)
//      should get nearly the same scores; reports per-frame group score |diff| and the whole-video gap
//   2. discrimination: on one run, person B's whole body is delayed by d seconds (keypoint level), or replaced by
//      their own motion from far away in the video ("different motion"); the pair's score should fall with the
//      delay and be lowest for different motion
//   npm run lag-confidence-test -- <runA-pose.json> <runB-pose.json> [--pair 1,2] [--out dir]
// Writes <out>/<stemA>-stability.csv and -discrimination.csv (default out: results/lag-confidence-test/).
// Existing files are not overwritten.
import fs from "node:fs";
import path from "node:path";
import { analyzeSync, type SyncConfig, type SyncFrame } from "../src/sync/index.ts";
import { assignPeople, countPeople } from "../src/sync/assign.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const outDir = opt("--out") ?? path.resolve(import.meta.dirname, "../../../results/lag-confidence-test");
const [pa, pb] = (opt("--pair") ?? "1,2").split(",").map(Number);
const [fileA, fileB] = args;
if (!fileA || !fileB) {
  console.log("usage: npm run lag-confidence-test -- <runA-pose.json> <runB-pose.json> [--pair 1,2] [--out dir]");
  process.exit(1);
}

const VARIANTS: { name: string; config: Partial<SyncConfig> }[] = [
  { name: "hard", config: { lagConfidence: "hard" } },
  { name: "ramp 0.2", config: { lagConfidence: "ramp", lagRampWidth: 0.2 } },
  { name: "ramp 0.4", config: { lagConfidence: "ramp", lagRampWidth: 0.4 } },
  { name: "drop", config: { lagConfidence: "drop" } },
];
const DELAYS = [0, 0.12, 0.2, 0.4, 0.8];
const DIFFERENT_SHIFTS = [7, 13]; // seconds: B's motion from this far away = a different move

const load = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));
const A = load(fileA), B = load(fileB);
const fps: number = A.fps ?? A.sourceVideo?.fps ?? 25;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const pct = (xs: number[], p: number) => { const v = [...xs].sort((x, y) => x - y); return v[Math.floor(p * (v.length - 1))] ?? NaN; };
const r2 = (v: number) => Math.round(v * 100) / 100;

// 1. Stability
const stabilityRows: (string | number)[][] = [];
for (const v of VARIANTS) {
  const ra = analyzeSync(A.frames, fps, v.config).result, rb = analyzeSync(B.frames, fps, v.config).result;
  const d = ra.timeline.map((s, k) => Math.abs((s.group ?? 0) - (rb.timeline[k]?.group ?? 0)));
  stabilityRows.push([v.name, r2(ra.group.score ?? NaN), r2(rb.group.score ?? NaN), r2(Math.abs((ra.group.score ?? 0) - (rb.group.score ?? 0))),
    r2(mean(d)), r2(pct(d, 0.95)), r2(Math.max(...d))]);
}

// 2. Discrimination: replace person pb's keypoints at t with their own at t − shift.
const n = countPeople(A.frames);
function shifted(frames: SyncFrame[], shiftSec: number, wrap: boolean): SyncFrame[] {
  const clone: SyncFrame[] = structuredClone(frames);
  const orig = assignPeople(frames, n).tracks[pb - 1];
  const copy = assignPeople(clone, n).tracks[pb - 1];
  const d = Math.round(shiftSec * fps), T = frames.length;
  for (let t = 0; t < T; t++) {
    const to = copy[t];
    if (!to) continue;
    const u = wrap ? (((t - d) % T) + T) % T : t - d;
    const from = u >= 0 ? orig[u] : null;
    to.keypoints = from ? from.keypoints.map((k) => ({ ...k })) : to.keypoints.map((k) => ({ ...k, conf: 0 }));
  }
  return clone;
}
const conditions = [
  ...DELAYS.map((d) => ({ name: d === 0 ? "in step (original)" : `delayed ${d} s`, frames: d === 0 ? A.frames : shifted(A.frames, d, false) })),
  ...DIFFERENT_SHIFTS.map((s) => ({ name: `different motion (${s} s away)`, frames: shifted(A.frames, s, true) })),
];
const discRows: (string | number)[][] = [];
for (const c of conditions) {
  const row: (string | number)[] = [c.name];
  for (const v of VARIANTS) {
    const r = analyzeSync(c.frames, fps, v.config).result;
    const pair = r.pairs.find((p) => p.pair[0] === pa && p.pair[1] === pb);
    row.push(r2(pair?.score ?? NaN));
  }
  discRows.push(row);
}

const stem = path.basename(fileA).replace(/-pose\.json$/, "");
fs.mkdirSync(outDir, { recursive: true });
const write = (name: string, header: string[], rows: (string | number)[][]) => {
  const file = path.join(outDir, `${stem}-${name}.csv`);
  try {
    fs.writeFileSync(file, [header.join(","), ...rows.map((r) => r.map((c) => (String(c).includes(",") ? `"${c}"` : c)).join(","))].join("\n"), { flag: "wx" });
    console.log(`wrote ${file}`);
  } catch {
    console.log(`kept existing ${file} (not overwritten)`);
  }
};
write("stability", ["variant", "group_a", "group_b", "group_gap", "frame_diff_mean", "frame_diff_p95", "frame_diff_max"], stabilityRows);
write("discrimination", ["condition", ...VARIANTS.map((v) => `pair_${pa}_${pb}_${v.name.replace(" ", "_")}`)], discRows);

console.log(`\nStability (${path.basename(fileA)} vs ${path.basename(fileB)}): variant, group A, group B, gap, per-frame |diff| mean / p95 / max`);
for (const r of stabilityRows) console.log("  " + r.join("\t"));
console.log(`\nDiscrimination, pair ${pa}-${pb} score (${path.basename(fileA)}, person ${pb} changed): ${VARIANTS.map((v) => v.name).join(" | ")}`);
for (const r of discRows) console.log("  " + r.join("\t"));
