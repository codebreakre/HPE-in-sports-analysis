// Model-comparison metrics for one run, saved so the models can be compared later:
//   speed       timing per frame (mean, std, p95) and FPS
//   detection   people found vs. expected, false positives, box confidence
//   tracks      people followed frame to frame (box IoU); ideally one track per person
//   keypoints   confidence levels (only comparable within one model, see keypointConfidence)
//   stability   jitter: keypoint acceleration between frames, as % of the person's box height
//   anatomy     limb length consistency: CV of each limb's length over a person's track
// There is no ground truth, so these are proxies; agreement between models (consensus)
// needs all model runs and is computed afterwards from the pose CSVs.
import { KEYPOINT_NAMES } from "../keypoints";
import type { FrameRecord, KeypointMetric, LimbMetric, PersonRecord, Run, RunMetrics } from "../types";
import { round3 } from "./records";

/** Box overlap needed to continue a track in the next frame. */
const MATCH_IOU = 0.3;
/** A track can be picked up again after this many frames without a match. */
const MAX_GAP_FRAMES = 5;
/** Limbs shorter-lived than this (samples per track) are left out of the length CV. */
const MIN_LIMB_SAMPLES = 30;
const VISIBLE_CONF = 0.5;
const LOW_CONF = 0.3;

type CsvValue = string | number | boolean | null;

/** The 8 limbs whose length should stay constant: [name, from keypoint, to keypoint]. */
const LIMBS: [name: string, from: string, to: string][] = [
  ["left_upper_arm", "left_shoulder", "left_elbow"],
  ["right_upper_arm", "right_shoulder", "right_elbow"],
  ["left_forearm", "left_elbow", "left_wrist"],
  ["right_forearm", "right_elbow", "right_wrist"],
  ["left_thigh", "left_hip", "left_knee"],
  ["right_thigh", "right_hip", "right_knee"],
  ["left_shin", "left_knee", "left_ankle"],
  ["right_shin", "right_knee", "right_ankle"],
];

interface TrackPoint {
  frame: number;
  person: PersonRecord;
}

export function computeMetrics(run: Run, expectedPersons: number): RunMetrics {
  const { frames } = run;
  const n = Math.max(1, frames.length);
  const totals = frames.map((f) => f.speed.preprocess + f.speed.inference + f.speed.postprocess);
  const meanTotal = mean(totals);
  const detections = frames.reduce((sum, f) => sum + f.persons.length, 0);
  const persons = frames.flatMap((f) => f.persons);
  const tracks = buildTracks(frames);
  const perKeypoint = keypointMetrics(frames, tracks);
  const perLimb = limbMetrics(tracks);
  const allKeypoints = persons.flatMap((p) => p.keypoints);
  const allJitter = tracks.flatMap((t) => KEYPOINT_NAMES.flatMap((_, k) => accelerations(t, k)));

  return {
    meanTotalMs: round3(meanTotal),
    stdTotalMs: round3(std(totals)),
    p95TotalMs: round3(quantile(totals, 0.95)),
    meanInferenceMs: round3(mean(frames.map((f) => f.speed.inference))),
    msPerPerson: round3(detections ? meanTotal / (detections / n) : 0),
    modelFps: round3(meanTotal ? 1000 / meanTotal : 0),
    pipelineFps: round3(run.wallMs ? frames.length / (run.wallMs / 1000) : 0),

    meanDetected: round3(detections / n),
    missedFrameRate: round3(frames.filter((f) => f.persons.length < expectedPersons).length / n),
    overDetectedRate: round3(frames.filter((f) => f.persons.length > expectedPersons).length / n),
    meanPersonConf: round3(mean(persons.map((p) => p.conf))),

    trackCount: tracks.length,
    longTrackCount: tracks.filter((t) => t.length >= frames.length / 2).length,

    meanKeypointConf: round3(mean(allKeypoints.map((k) => k.conf))),
    visibleRate: round3(share(allKeypoints, (k) => k.conf >= VISIBLE_CONF)),
    lowConfRate: round3(share(allKeypoints, (k) => k.conf < LOW_CONF)),

    jitterPct: round3(mean(allJitter)),
    jitterMedianPct: round3(quantile(allJitter, 0.5)),
    limbCvPct: round3(mean(perLimb.filter((l) => l.samples).map((l) => l.cvPct))),

    perKeypoint,
    perLimb,
  };
}

/**
 * Follows people frame to frame: each detection joins the track whose last box overlaps it most
 * (IoU ≥ MATCH_IOU, seen in the last MAX_GAP_FRAMES frames), otherwise starts a new track.
 * Works well when people don't overlap; used only for the metrics, not saved as person IDs.
 */
function buildTracks(frames: FrameRecord[]): TrackPoint[][] {
  const tracks: TrackPoint[][] = [];
  for (const frame of frames) {
    const open = tracks.filter((t) => frame.frame - t[t.length - 1].frame <= MAX_GAP_FRAMES);
    const pairs = frame.persons.flatMap((person, p) =>
      open.map((track, t) => ({ p, t, iou: iou(person.box, track[track.length - 1].person.box) })))
      .filter((pair) => pair.iou >= MATCH_IOU)
      .sort((a, b) => b.iou - a.iou);
    const usedPersons = new Set<number>();
    const usedTracks = new Set<number>();
    for (const { p, t } of pairs) {
      if (usedPersons.has(p) || usedTracks.has(t)) continue;
      usedPersons.add(p);
      usedTracks.add(t);
      open[t].push({ frame: frame.frame, person: frame.persons[p] });
    }
    frame.persons.forEach((person, p) => {
      if (!usedPersons.has(p)) tracks.push([{ frame: frame.frame, person }]);
    });
  }
  return tracks;
}

/** |p(t-1) - 2·p(t) + p(t+1)| / box height · 100, for every 3 consecutive frames of a track. */
function accelerations(track: TrackPoint[], k: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < track.length - 1; i++) {
    const [a, b, c] = [track[i - 1], track[i], track[i + 1]];
    if (b.frame - a.frame !== 1 || c.frame - b.frame !== 1) continue;
    const [ka, kb, kc] = [a.person.keypoints[k], b.person.keypoints[k], c.person.keypoints[k]];
    const height = b.person.box[3] - b.person.box[1];
    if (!ka || !kb || !kc || height <= 0) continue;
    out.push((Math.hypot(ka.x - 2 * kb.x + kc.x, ka.y - 2 * kb.y + kc.y) / height) * 100);
  }
  return out;
}

function keypointMetrics(frames: FrameRecord[], tracks: TrackPoint[][]): KeypointMetric[] {
  return KEYPOINT_NAMES.map((name, k) => {
    const confs = frames.flatMap((f) => f.persons.flatMap((p) => (p.keypoints[k] ? [p.keypoints[k].conf] : [])));
    const jitter = tracks.flatMap((t) => accelerations(t, k));
    return {
      name,
      meanConf: round3(mean(confs)),
      visibleRate: round3(share(confs, (c) => c >= VISIBLE_CONF)),
      lowConfRate: round3(share(confs, (c) => c < LOW_CONF)),
      jitterPct: round3(mean(jitter)),
      jitterMedianPct: round3(quantile(jitter, 0.5)),
    };
  });
}

/** Per limb: the length CV within each track (enough samples), averaged over tracks. */
function limbMetrics(tracks: TrackPoint[][]): LimbMetric[] {
  return LIMBS.map(([name, from, to]) => {
    const [i, j] = [KEYPOINT_NAMES.indexOf(from as never), KEYPOINT_NAMES.indexOf(to as never)];
    const cvs: number[] = [];
    let samples = 0;
    for (const track of tracks) {
      const lengths = track.flatMap(({ person: { keypoints: kp } }) =>
        kp[i] && kp[j] ? [Math.hypot(kp[i].x - kp[j].x, kp[i].y - kp[j].y)] : []);
      const m = mean(lengths);
      if (lengths.length < MIN_LIMB_SAMPLES || m <= 0) continue;
      cvs.push((std(lengths) / m) * 100);
      samples += lengths.length;
    }
    return { name, cvPct: round3(mean(cvs)), samples };
  });
}

/** The `<video>-metrics.csv` file: one row with the run's metadata and every metric. */
export function metricsCsv(meta: Record<string, CsvValue>, m: RunMetrics): string {
  const { perKeypoint, perLimb, ...scalars } = m;
  const row: Record<string, CsvValue> = { ...meta };
  for (const [key, value] of Object.entries(scalars)) row[snakeCase(key)] = value;
  for (const limb of perLimb) row[`limb_cv_pct_${limb.name}`] = limb.cvPct;
  return csv([row]);
}

/** The `<video>-keypoint-metrics.csv` file: one row per keypoint, metadata repeated for easy concat. */
export function keypointMetricsCsv(meta: Record<string, CsvValue>, m: RunMetrics): string {
  return csv(m.perKeypoint.map(({ name, ...values }) => {
    const row: Record<string, CsvValue> = { ...meta, keypoint: name };
    for (const [key, value] of Object.entries(values)) row[snakeCase(key)] = value;
    return row;
  }));
}

// ---------- helpers ----------

function iou(a: PersonRecord["box"], b: PersonRecord["box"]): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = w * h;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

const share = <T,>(xs: T[], test: (x: T) => boolean) => (xs.length ? xs.filter(test).length / xs.length : 0);

const snakeCase = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function csv(rows: Record<string, CsvValue>[]): string {
  const header = Object.keys(rows[0] ?? {});
  const cell = (v: CsvValue) => {
    const s = v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(","), ...rows.map((r) => header.map((h) => cell(r[h])).join(","))].join("\n");
}
