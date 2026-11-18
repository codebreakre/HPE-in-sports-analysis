// Synchronization of 2+ people from saved pose frames (report 3.1, steps 3-6), algorithm v2:
//   assign people (3.3) → preprocess (3.4) → joint angles (3.5) → pair and group scores (3.6).
// Pure computation: no app or DOM imports, so it also runs in Node (scripts/sync.ts).
import { JOINTS, MIRROR, PART_JOINTS, jointAngles, jointWeights } from "./angles.ts";
import { assignPeople, countPeople } from "./assign.ts";
import { preprocess } from "./preprocess.ts";
import { mean, velocities, windowScore, crossCorrelation, type ScoreSettings } from "./score.ts";
import {
  DEFAULT_SYNC_CONFIG, JOINT_WEIGHT_PRESETS, type BodyPart, type SyncConfig, type SyncFrame, type SyncPair, type SyncResult,
  type SyncTimelineStep, type SyncWindow,
} from "./types.ts";

export { DEFAULT_SYNC_CONFIG, JOINT_WEIGHT_PRESETS, JOINTS, PART_JOINTS };
export {
  DEFAULT_EPISODE_SETTINGS, MIN_LATE_SEC, behindJointName, episodeJoints, findEpisodes, jointLabel, lagText, partLagText,
  type Angles, type EpisodeSettings, type JointBreakdown, type PartLag, type SyncEpisode,
} from "./episodes.ts";
export type * from "./types.ts";

const ALL_JOINTS = JOINTS.map((_, j) => j);
const PARTS = Object.keys(PART_JOINTS) as BodyPart[];

/** Everything the algorithm produces, plus the per-frame angles (for the angles CSV). */
export interface SyncAnalysis {
  result: SyncResult;
  /** angles[person][joint][frame], degrees, NaN = missing */
  angles: Float64Array[][];
}

export function analyzeSync(frames: SyncFrame[], fps: number, config: Partial<SyncConfig> = {}): SyncAnalysis {
  const cfg: SyncConfig = { ...DEFAULT_SYNC_CONFIG, ...config };
  delete cfg.hopSec; // v2: one window per frame
  if (cfg.jointWeightPreset !== "custom") cfg.partWeights = { ...JOINT_WEIGHT_PRESETS[cfg.jointWeightPreset] };
  const T = frames.length;
  const n = cfg.persons ?? countPeople(frames);
  const frameCount = (sec: number) => Math.max(1, Math.round(sec * fps));

  // 3.3 + 3.4 + 3.5
  const assignment = assignPeople(frames, n);
  const smoothWindow = cfg.smooth ? Math.max(3, frameCount(cfg.smoothWindowSec) | 1) : 0;
  const series = assignment.tracks.map((track) => preprocess(track, {
    confThreshold: cfg.confThreshold, maxGapFrames: frameCount(cfg.maxGapSec), smoothWindow,
  }));
  const angles = series.map(jointAngles);
  const vel = angles.map(velocities);
  const mirrored = (j: Float64Array[]) => MIRROR.map((m) => j[m]);

  // 3.6: one window of W frames per frame t, centred on it (t − W/2 … t + W/2), moved inside the video at its
  // start and end so every window is W long (the whole video when it is shorter than W).
  const W = Math.min(T, frameCount(cfg.windowSec));
  const centres = Array.from({ length: W > 0 ? T : 0 }, (_, t) => t);
  const windowStart = (t: number) => Math.min(Math.max(0, t - Math.floor(W / 2)), T - W);
  const settings: ScoreSettings = {
    tauMax: frameCount(cfg.tauMaxSec), rhoMin: cfg.rhoMin, weights: cfg.weights,
    minStdDeg: cfg.minStdDeg, minValidShare: cfg.minValidShare, alpha: jointWeights(cfg.partWeights),
    lagConfidence: cfg.lagConfidence, lagRampWidth: cfg.lagRampWidth,
  };
  // A body part's own score weighs its joints equally (and exists even when the part's weight is 0).
  const partSettings: ScoreSettings = { ...settings, alpha: JOINTS.map(() => 1) };
  const time = (f: number) => frames[Math.min(f, T - 1)]?.time ?? f / fps;

  const pairIdx: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairIdx.push([i, j]);

  const windows: SyncWindow[] = [];
  const pairs: SyncPair[] = pairIdx.map(([i, j]) => {
    const own: SyncWindow[] = [];
    for (const t of centres) {
      const start = windowStart(t);
      const end = start + W;
      const normal = windowScore(angles[i], angles[j], vel[i], vel[j], ALL_JOINTS, start, end, settings);
      const mirror = cfg.mirror === "normal" ? null
        : windowScore(angles[i], mirrored(angles[j]), vel[i], mirrored(vel[j]), ALL_JOINTS, start, end, settings);
      const useMirror = cfg.mirror === "mirror"
        || (cfg.mirror === "auto" && mirror?.score != null && mirror.score - (normal.score ?? -Infinity) >= cfg.mirrorMargin);
      const best = useMirror && mirror ? mirror : normal;
      const bAngles = useMirror ? mirrored(angles[j]) : angles[j];
      const bVel = useMirror ? mirrored(vel[j]) : vel[j];
      const parts = Object.fromEntries(PARTS.map((p) => [p,
        windowScore(angles[i], bAngles, vel[i], bVel, PART_JOINTS[p], start, end, partSettings).score])) as Record<BodyPart, number | null>;
      own.push({
        frame: frames[t]?.frame ?? t,
        pair: [i + 1, j + 1], startFrame: start, endFrame: end,
        startTime: round(time(start)), endTime: round(time(end - 1)), centerTime: round(time(t)),
        score: best.score, pose: best.pose, corr: best.corr, lag: best.lag,
        lagFrames: best.lagFrames, lagSec: best.lagFrames === null ? null : round(best.lagFrames / fps),
        rhoMax: best.rhoMax, mode: useMirror ? "mirror" : "normal", parts,
      });
    }
    windows.push(...own);

    const scored = own.filter((w) => w.score !== null);
    const mirrorShare = scored.length ? scored.filter((w) => w.mode === "mirror").length / scored.length : 0;
    // Lag over the whole video, in the mode most windows matched in.
    const useMirror = mirrorShare > 0.5;
    const whole = crossCorrelation(vel[i], useMirror ? mirrored(vel[j]) : vel[j], ALL_JOINTS, 0, T - 1, settings.tauMax);
    const avg = (pick: (w: SyncWindow) => number | null) => meanOrNull(own.map(pick));
    return {
      pair: [i + 1, j + 1],
      score: avg((w) => w.score), pose: avg((w) => w.pose), corr: avg((w) => w.corr), lag: avg((w) => w.lag),
      lagFrames: whole?.tau ?? null,
      lagSec: whole ? round(whole.tau / fps) : null,
      rhoMax: whole ? round(whole.rho) : null,
      lagReliable: (whole?.rho ?? -1) >= cfg.rhoMin,
      mirrorShare: round(mirrorShare),
      parts: Object.fromEntries(PARTS.map((p) => [p, avg((w) => w.parts[p])])) as Record<BodyPart, number | null>,
      windowsScored: scored.length,
    };
  });

  // Group (formula 3.4): S_group = mean over pairs; S_i = mean over the pairs person i is in.
  const persons = series.map((s, i) => ({
    person: i + 1,
    score: meanOrNull(pairs.filter((p) => p.pair.includes(i + 1)).map((p) => p.score)),
    missingFrameRate: round(s.missingFrameRate),
    interpolatedRate: round(s.interpolatedRate),
    missingValueRate: round(s.missingValueRate),
  }));
  const groupScore = meanOrNull(pairs.map((p) => p.score));
  const ranked = persons.filter((p) => p.score !== null).sort((a, b) => a.score! - b.score!);
  const timeline: SyncTimelineStep[] = centres.map((t, k) => {
    const scores = pairs.map((_, p) => windows[p * centres.length + k].score);
    const start = windowStart(t);
    return {
      frame: frames[t]?.frame ?? t,
      startTime: round(time(start)), endTime: round(time(start + W - 1)), centerTime: round(time(t)),
      group: meanOrNull(scores), pairs: scores.map((s) => (s === null ? null : round(s))),
    };
  });

  const result: SyncResult = {
    algorithm: "joint-angle sync v2",
    config: cfg,
    fps,
    frameCount: T,
    personCount: n,
    assignment: { framesExact: assignment.framesExact, framesFewer: assignment.framesFewer, framesMore: assignment.framesMore },
    group: { score: groupScore, mostDeviating: n >= 3 && ranked.length ? ranked[0].person : null },
    persons,
    pairs: pairs.map(roundPair),
    timeline,
    windows: windows.map(roundWindow),
  };
  return { result, angles };
}

function meanOrNull(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? round(mean(v)) : null;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const r = (v: number | null) => (v === null ? null : round(v));

function roundParts(p: Record<BodyPart, number | null>) {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, r(v)])) as Record<BodyPart, number | null>;
}
function roundWindow(w: SyncWindow): SyncWindow {
  return { ...w, score: r(w.score), pose: r(w.pose), corr: r(w.corr), lag: r(w.lag), rhoMax: r(w.rhoMax), parts: roundParts(w.parts) };
}
function roundPair(p: SyncPair): SyncPair {
  return { ...p, parts: roundParts(p.parts) };
}
