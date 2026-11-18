// The files a sync analysis is saved as, next to the run's pose files:
//   <stem>-sync.json          the full SyncResult plus which run it came from
//   <stem>-sync-windows.csv   one row per pair per window (pandas: time series of the scores)
//   <stem>-sync-frames.csv    one row per frame (v2): time_s, group, each person, and per pair its score,
//                             lag (ms), mode and arms/legs/torso scores; match it to the video by time_s
//   <stem>-angles.csv         one row per person per frame: the 8 joint angles after preprocessing
import { JOINTS } from "./angles.ts";
import type { SyncAnalysis } from "./index.ts";
import type { SyncFrame } from "./types.ts";

/** Which run the analysis belongs to (repeated in every file so they can be concatenated). */
export interface SyncSource {
  model: string;
  modelLabel?: string;
  source: string;
  sourcePath?: string | null;
  /** The pose JSON it was computed from, e.g. "results/rtmpose-m/clip-pose.json" (omitted when it is the sibling file) */
  poseFile?: string;
}

export interface SyncFile {
  suffix: "-sync.json" | "-sync-windows.csv" | "-sync-frames.csv" | "-angles.csv";
  type: string;
  text: string;
}

export function syncFiles(analysis: SyncAnalysis, frames: SyncFrame[], src: SyncSource): SyncFile[] {
  const { result, angles } = analysis;
  const json = { ...src, createdAt: new Date().toISOString(), ...result };

  const meta = [src.model, src.source];
  const windowRows = result.windows.map((w) => [
    ...meta, w.pair[0], w.pair[1], w.startFrame, w.endFrame, w.startTime, w.endTime, w.centerTime,
    w.score, w.pose, w.corr, w.lag, w.lagFrames, w.lagSec, w.rhoMax, w.mode, w.parts.arms, w.parts.legs, w.parts.torso,
  ]);
  const angleRows = angles.flatMap((person, p) => frames.map((f, t) => [
    ...meta, f.frame, f.time, p + 1, ...person.map((joint) => (Number.isNaN(joint[t]) ? null : Math.round(joint[t] * 10) / 10)),
  ]));

  // Wide per-frame table: window k of every pair is centred on the same frame (v2: one window per frame).
  const steps = result.timeline;
  const pairCols = result.pairs.flatMap(({ pair: [a, b] }) =>
    ["score", "lag_ms", "rho_max", "mode", "arms", "legs", "torso"].map((c) => `pair_${a}_${b}_${c}`));
  const frameRows = steps.map((step, k) => {
    const ws = result.pairs.map((_, p) => result.windows[p * steps.length + k]);
    const personScore = (n: number) => {
      const v = ws.filter((w) => w.pair.includes(n) && w.score !== null).map((w) => w.score!);
      return v.length ? r3(v.reduce((x, y) => x + y, 0) / v.length) : null;
    };
    return [
      ...meta, step.frame ?? ws[0]?.frame ?? k, step.centerTime, step.group,
      ...result.persons.map((p) => personScore(p.person)),
      ...ws.flatMap((w) => [w.score, w.lagSec === null ? null : Math.round(w.lagSec * 1000), w.rhoMax, w.mode,
        w.parts.arms, w.parts.legs, w.parts.torso]),
    ];
  });

  return [
    { suffix: "-sync.json", type: "application/json", text: JSON.stringify(json, null, 1) },
    {
      suffix: "-sync-windows.csv", type: "text/csv",
      text: csv(["model", "source", "person_a", "person_b", "start_frame", "end_frame", "start_time", "end_time",
        "center_time", "score", "pose", "corr", "lag_score", "lag_frames", "lag_sec", "rho_max", "mode",
        "arms", "legs", "torso"], windowRows),
    },
    {
      suffix: "-sync-frames.csv", type: "text/csv",
      text: csv(["model", "source", "frame", "time_s", "group", ...result.persons.map((p) => `person_${p.person}`), ...pairCols], frameRows),
    },
    {
      suffix: "-angles.csv", type: "text/csv",
      text: csv(["model", "source", "frame", "time", "person", ...JOINTS.map((j) => j.name)], angleRows),
    },
  ];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function csv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n");
}

/**
 * Reads an -angles.csv back into angles[person][joint][frame] (NaN = missing), e.g. for the
 * out-of-sync breakdown of a saved run. Rows of each person are in frame order.
 */
export function parseAnglesCsv(text: string): Float64Array[][] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const personCol = header.indexOf("person");
  const jointCols = JOINTS.map((j) => header.indexOf(j.name));
  if (personCol < 0 || jointCols.some((c) => c < 0)) throw new Error("Not an -angles.csv: missing person or joint columns");
  const rows: number[][][] = [];
  for (const line of lines.slice(1)) {
    // Counted from the end: the model and source columns before them may hold quoted commas.
    const cells = line.split(",");
    const at = (col: number) => cells[cells.length - (header.length - col)];
    const p = Number(at(personCol)) - 1;
    (rows[p] ??= []).push(jointCols.map((c) => (at(c) === "" ? NaN : Number(at(c)))));
  }
  return rows.map((person) => JOINTS.map((_, j) => Float64Array.from(person, (r) => r[j])));
}
