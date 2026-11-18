// Controlled delay test for the out-of-sync moments (src/sync/episodes.ts): in a real pose run, one person's
// whole body or one limb is delayed by d seconds for a few seconds (their keypoints at t are replaced by their
// own keypoints at t − d), then the sync algorithm runs and we check that a moment is listed at that time, for a
// pair with that person, naming them as behind (and, for a limb, the right limb).
//   npm run sync-delay-test -- results/rtmpose-m/poomsae-720reso_run3-pose.json [--out dir]   (from the repo root;
//   default out: results/sync-delay-test/)
// Writes <out>/<stem>-cases.csv (one row per case) and prints a summary. Existing files are not overwritten.
import fs from "node:fs";
import path from "node:path";
import { analyzeSync, findEpisodes, DEFAULT_EPISODE_SETTINGS, type SyncFrame } from "../src/sync/index.ts";
import { assignPeople, countPeople } from "../src/sync/assign.ts";

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith("--"));
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : path.resolve(import.meta.dirname, "../../../results/sync-delay-test");
if (!input) {
  console.log("usage: npm run sync-delay-test -- <pose.json> [--out dir]");
  process.exit(1);
}

// COCO keypoints per delayed part. Limbs as the episode breakdown names them.
const PARTS: Record<string, { keypoints: number[]; limbs: string[] }> = {
  whole_body: { keypoints: [...Array(17).keys()], limbs: [] },
  both_arms: { keypoints: [5, 6, 7, 8, 9, 10], limbs: ["left_arm", "right_arm"] },
  right_arm: { keypoints: [6, 8, 10], limbs: ["right_arm"] },
  both_legs: { keypoints: [11, 12, 13, 14, 15, 16], limbs: ["left_leg", "right_leg"] },
  left_leg: { keypoints: [11, 13, 15], limbs: ["left_leg"] },
};
// Case grid: part × delay × (person, start). Same design as the v1 tuning: 0.3-0.5 s delays for 2-3 s.
const DELAYS = [0.3, 0.5];
const SPOTS = [{ person: 2, startSec: 8, lengthSec: 3 }, { person: 3, startSec: 18, lengthSec: 2.5 }];

const json = JSON.parse(fs.readFileSync(input, "utf8"));
const fps: number = json.fps ?? json.sourceVideo?.fps ?? 25;
const frames: SyncFrame[] = json.frames;
const n = countPeople(frames);
const base = analyzeSync(frames, fps);
const baseEpisodes = findEpisodes(base.result, base.angles);

const rows: (string | number)[][] = [];
for (const [partName, part] of Object.entries(PARTS)) {
  for (const delay of DELAYS) {
    for (const spot of SPOTS) {
      const clone: SyncFrame[] = structuredClone(frames);
      const orig = assignPeople(frames, n).tracks[spot.person - 1];
      const copy = assignPeople(clone, n).tracks[spot.person - 1];
      const d = Math.round(delay * fps);
      const t0 = Math.round(spot.startSec * fps), t1 = Math.round((spot.startSec + spot.lengthSec) * fps);
      for (let t = t0; t < t1 && t < clone.length; t++) {
        const from = orig[t - d], to = copy[t];
        if (!from || !to) continue;
        for (const k of part.keypoints) to.keypoints[k] = { ...from.keypoints[k] };
      }
      const a = analyzeSync(clone, fps);
      const eps = findEpisodes(a.result, a.angles);
      const startSec = t0 / fps, endSec = t1 / fps;
      // New moments overlapping the delayed span that involve the delayed person.
      const isNew = (e: (typeof eps)[number]) => !baseEpisodes.some((b) => b.pair.join() === e.pair.join()
        && Math.abs(b.startTime - e.startTime) < 0.5 && Math.abs(b.endTime - e.endTime) < 0.5);
      const hits = eps.filter((e) => e.pair.includes(spot.person) && e.startTime < endSec && e.endTime > startSec && isNew(e));
      const behind = (e: (typeof eps)[number], lag: number) => (lag > 0 ? e.pair[1] : e.pair[0]) === spot.person;
      const personRight = hits.some((e) => e.lateParts.some((p) => behind(e, p.lagSec))
        || (e.lagSec !== null && behind(e, e.lagSec)));
      const limbRight = part.limbs.length === 0 ? personRight
        : hits.some((e) => e.lateParts.some((p) => behind(e, p.lagSec) && part.limbs.includes(sideOf(e, p))));
      const lags = hits.flatMap((e) => e.lateParts.filter((p) => behind(e, p.lagSec)).map((p) => Math.abs(p.lagSec)));
      rows.push([partName, delay, spot.person, startSec, endSec, hits.length ? 1 : 0, personRight ? 1 : 0, limbRight ? 1 : 0,
        lags.length ? Math.max(...lags) : "", hits.map((e) => `${e.startTime}-${e.endTime}`).join(" ")]);
    }
  }
}

/** The limb as named for the person who is behind (the other side for the pair's second person when mirrored). */
function sideOf(e: { mode: string; pair: [number, number] }, p: { part: string; lagSec: number }): string {
  const flip = p.lagSec > 0 && e.mode === "mirror";
  return flip ? (p.part.startsWith("left") ? p.part.replace("left", "right") : p.part.replace("right", "left")) : p.part;
}

const stem = path.basename(input).replace(/-pose\.json$/, "");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${stem}-cases.csv`);
const header = ["part", "delay_sec", "person", "start_sec", "end_sec", "found", "person_right", "limb_right", "found_lag_sec", "moments"];
const text = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
try {
  fs.writeFileSync(file, text, { flag: "wx" });
  console.log(`wrote ${file}`);
} catch {
  console.log(`kept existing ${file} (not overwritten)`);
}
const sum = (col: number) => rows.reduce((s, r) => s + Number(r[col]), 0);
console.log(`${base.result.algorithm}, late from ${DEFAULT_EPISODE_SETTINGS.lagSec} s: ${rows.length} cases, `
  + `found ${sum(5)}, right person ${sum(6)}, right person and limb ${sum(7)}; baseline moments ${baseEpisodes.length}`);
for (const r of rows) console.log("  " + r.slice(0, 9).join("\t"));
