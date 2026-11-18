// Runs the synchronization algorithm (src/sync/) on saved pose JSON files, outside the browser,
// for experiments and parameter tuning (report 4.3).
//   npm run sync -- results/rtmpose-m/clip-pose.json [more…] [--out dir] [--set key=value …]
// Without --out the files go next to the pose JSON (<stem>-sync.json, -sync-windows.csv, -sync-frames.csv, -angles.csv);
// with --out they go to <dir>/<model>/. Existing files are never overwritten. --set overrides a SyncConfig setting, e.g.
//   --set windowSec=4 --set mirror=normal --set smooth=false --set weights=0.5,0.25,0.25
//   --set jointWeightPreset=ballet   (general | ballet | hand-dance), or custom part weights:
//   --set partWeights=40,40,20       (arms, legs, torso; sets jointWeightPreset=custom)
// --late 0.3 lists out-of-sync moments only where someone is at least 0.3 s late (default 0.2, min 0.12).
import fs from "node:fs";
import path from "node:path";
import {
  analyzeSync, behindJointName, DEFAULT_EPISODE_SETTINGS, DEFAULT_SYNC_CONFIG, MIN_LATE_SEC, episodeJoints, findEpisodes, jointLabel, lagText, partLagText, type SyncConfig,
} from "../src/sync/index.ts";
import { syncFiles } from "../src/sync/files.ts";

const args = process.argv.slice(2);
const inputs: string[] = [];
let outDir: string | null = null;
let lateSec = DEFAULT_EPISODE_SETTINGS.lagSec;
const overrides: Record<string, unknown> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = args[++i];
  else if (args[i] === "--late") lateSec = Math.max(MIN_LATE_SEC, Number(args[++i]));
  else if (args[i] === "--set") Object.assign(overrides, parseSetting(args[++i]));
  else inputs.push(args[i]);
}
if (!inputs.length) {
  console.log("usage: npm run sync -- <pose.json> [more…] [--out dir] [--set key=value …] [--late seconds]");
  process.exit(1);
}

for (const input of inputs) {
  const json = JSON.parse(fs.readFileSync(input, "utf8"));
  const fps = json.fps ?? json.sourceVideo?.fps ?? 25;
  const analysis = analyzeSync(json.frames, fps, overrides as Partial<SyncConfig>);
  const stem = path.basename(input).replace(/-pose\.json$/, "");
  const dir = outDir ? path.join(outDir, json.modelName) : path.dirname(input);
  fs.mkdirSync(dir, { recursive: true });
  const files = syncFiles(analysis, json.frames, {
    model: json.modelName, modelLabel: json.modelLabel, source: json.source, sourcePath: json.sourcePath,
    poseFile: path.relative(process.cwd(), input).replaceAll("\\", "/"),
  });
  for (const f of files) {
    const file = path.join(dir, stem + f.suffix);
    try {
      fs.writeFileSync(file, f.text, { flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      console.log(`  kept existing ${file} (not overwritten)`);
    }
  }
  const { result: r } = analysis;
  const fmt = (v: number | null) => (v === null ? "–" : v.toFixed(1));
  console.log(`${input}: ${r.algorithm}, joint weights ${r.config.jointWeightPreset} `
    + `(arms ${r.config.partWeights.arms} / legs ${r.config.partWeights.legs} / torso ${r.config.partWeights.torso})`);
  console.log(`  ${r.personCount} people, ${r.frameCount} frames @ ${fps} fps → group ${fmt(r.group.score)}`);
  for (const p of r.pairs) {
    console.log(`  pair ${p.pair.join("-")}: ${fmt(p.score)} (pose ${fmt(p.pose && p.pose * 100)}, corr ${fmt(p.corr && p.corr * 100)}, `
      + `lag ${fmt(p.lag && p.lag * 100)}) · lag ${p.lagSec ?? "–"} s, ρ ${p.rhoMax ?? "–"}${p.lagReliable ? "" : " (unreliable)"}`
      + ` · mirror ${(p.mirrorShare * 100).toFixed(0)}% · arms ${fmt(p.parts.arms)} legs ${fmt(p.parts.legs)} torso ${fmt(p.parts.torso)}`);
  }
  console.log(`  per person: ${r.persons.map((p) => `${p.person}: ${fmt(p.score)}`).join(", ")}`
    + (r.group.mostDeviating ? ` · most deviating: ${r.group.mostDeviating}` : ""));
  const episodeSettings = { ...DEFAULT_EPISODE_SETTINGS, lagSec: lateSec };
  const episodes = findEpisodes(r, analysis.angles, episodeSettings);
  console.log(`  out-of-sync moments (late from ${lateSec} s): ${episodes.length ? "" : "none"}`);
  for (const e of episodes) {
    const what = e.lateParts.length ? e.lateParts.map((p) => partLagText(e, p)).join("; ")
      : e.lagSec !== null ? lagText(e.pair, e.lagSec) + (e.lagReliable ? "" : " (uncertain)") : "moving differently";
    console.log(`    ${e.startTime.toFixed(1)}–${e.endTime.toFixed(1)} s · pair ${e.pair.join("-")} · ${what} · lowest score ${fmt(e.minScore)}`);
    const joints = episodeJoints(e, analysis.angles, r.config.minStdDeg, episodeSettings);
    const late = joints.filter((j) => j.status === "late").map((j) => `${jointLabel(behindJointName(j))} (−${j.gainDeg}°)`);
    const different = joints.filter((j) => j.status === "different").map((j) => `${jointLabel(j.joint)} (+${Math.round(j.diffDeg! - j.usualDiffDeg!)}°)`);
    if (late.length) console.log(`      late joints: ${late.join(", ")}`);
    if (different.length) console.log(`      angle differs more than usual: ${different.join(", ")}`);
  }
}

/** "windowSec=4" → { windowSec: 4 }, typed like the default value. */
function parseSetting(arg: string): Record<string, unknown> {
  const [key, value] = arg.split("=");
  if (!(key in DEFAULT_SYNC_CONFIG)) throw new Error(`Unknown setting ${key}; known: ${Object.keys(DEFAULT_SYNC_CONFIG).join(", ")}`);
  const def = DEFAULT_SYNC_CONFIG[key as keyof SyncConfig];
  if (Array.isArray(def)) return { [key]: value.split(",").map(Number) };
  if (key === "partWeights") {
    const [arms, legs, torso] = value.split(",").map(Number);
    return { partWeights: { arms, legs, torso }, jointWeightPreset: "custom" };
  }
  if (typeof def === "boolean") return { [key]: value === "true" };
  if (typeof def === "number" || def === null) return { [key]: value === "null" ? null : Number(value) };
  return { [key]: value };
}
