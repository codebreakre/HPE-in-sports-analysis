// Re-scores the two cases where the automatic person count failed (copy at 25 % size: the small person is
// found in only ~1/3 of frames, so the count is 1; 240p: small false detections make it 4), with the person
// count given as 2, from the saved server keypoints. → results/experiments/forced-count.csv
//   node apps/web/scripts/experiments-forced.ts
import fs from "node:fs";
import path from "node:path";
import { analyzeSync } from "../src/sync/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const EXP = path.join(ROOT, "results", "experiments");
const CASES = [
  { video: "distance-25-00f", truth: 0 },
  { video: "distance-25-08f", truth: 0.32 },
  { video: "resolution-240p-08f", truth: 0.32 },
];
const rows = ["video,persons_given,frames_exact,frames_fewer,frames_more,pair12,lag_sec,lag_error_ms,rho_max,missing_frames_p2"];
for (const c of CASES) {
  const p = JSON.parse(fs.readFileSync(path.join(EXP, "pose", `${c.video}-pose.json`), "utf8"));
  const r = analyzeSync(p.frames, p.fps, { persons: 2 }).result;
  const pr = r.pairs[0];
  const err = pr.lagSec === null ? "" : Math.round(Math.abs(pr.lagSec - c.truth) * 1000);
  rows.push([c.video, 2, r.assignment.framesExact, r.assignment.framesFewer, r.assignment.framesMore, pr.score, pr.lagSec, err, pr.rhoMax,
    r.persons[1].missingFrameRate].join(","));
}
fs.writeFileSync(path.join(EXP, "forced-count.csv"), rows.join("\n"));
console.log(rows.join("\n"));
