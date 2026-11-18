// Out-of-sync moments: stretches where a pair does clearly worse than it usually does, e.g. one
// person falls behind for a few seconds while the rest of the video is in step, and which body part
// and joints were late.
//
// A window is "off" for a pair when
//   - its correlation or pose similarity is clearly below the pair's own median (the pair is compared
//     with itself, so a pair that is always a little apart is not one long episode), or
//   - the whole body is reliably late (window lag ≥ lagSec with ρ ≥ ρmin), or
//   - a limb is late: shifting the second person's limb (e.g. right arm = right elbow + right shoulder)
//     in time by τ makes its angle gap clearly smaller: gain = D(0) − min D(τ) ≥ partGainDeg and
//     ≥ partGainShare · D(0), with lagSec ≤ |τ| < τmax, where D(τ) = mean |θA(t) − θB(t + τ)| over
//     the limb's joints. This works on the angles themselves, so it also catches one arm late while the
//     rest is in step, which the whole-body scores average away. The share and the τmax edge keep a
//     shift that lines a limb up with a different repetition of a move from counting.
// Off windows in a row covering at least minOffSec (gaps up to bridgeSec bridged) form an episode. Windows are
// one per frame in v2 files and every hopSec (0.5 s) in v1 files; the rule is in seconds so both read the same.
import { JOINTS, MIRROR } from "./angles.ts";
import type { SyncResult, SyncWindow } from "./types.ts";

export interface EpisodeSettings {
  /** A window is off when its correlation (0-1) is this far below the pair's median… */
  corrDrop: number;
  /** …or its pose similarity (0-1) is this far below the pair's median… */
  poseDrop: number;
  /** …or one person (whole body, or a body part) is at least this late, in seconds */
  lagSec: number;
  /** Limb late: shifting it by the lag shrinks its mean angle gap by at least this (degrees)… */
  partGainDeg: number;
  /** …and by at least this share of the gap */
  partGainShare: number;
  /** Joint late: shifting it by its part's lag shrinks its angle gap by at least this (degrees) */
  jointGainDeg: number;
  /** Joint different: its angle gap is this much larger than its usual gap in the video (degrees) */
  jointDiffDeg: number;
  /** An episode needs off windows covering at least this long (each window stands for the step to the next)… */
  minOffSec: number;
  /** …and a quiet stretch up to this long between off windows does not split it */
  bridgeSec: number;
}

/** Shortest lag that can be told from noise: 3 frames at 25 fps. Below it, on poomsae-720reso nearly half the
 *  video was flagged (pairs in step still measure 0.04-0.16 s window lags). The UI's lower limit. */
export const MIN_LATE_SEC = 0.12;

// Tuned on poomsae-720reso (RTMPose-m) by delaying one real person's whole body, both arms, one arm,
// both legs or one leg by 0.3-0.5 s for 2-3 s (18 cases; CLAUDE.md, "Out-of-sync moments").
export const DEFAULT_EPISODE_SETTINGS: EpisodeSettings = {
  corrDrop: 0.15, poseDrop: 0.06, lagSec: 0.2, partGainDeg: 3, partGainShare: 0.2, jointGainDeg: 2, jointDiffDeg: 15,
  // Same as v1's "2 off windows, 1 quiet window bridged" at its 0.5 s step.
  minOffSec: 1, bridgeSec: 0.5,
};

/** Limbs for the lag breakdown (indices into JOINTS); they don't overlap, so each hip goes with its leg. */
export const BREAKDOWN_PARTS = { left_arm: [0, 2], right_arm: [1, 3], left_leg: [4, 6], right_leg: [5, 7] };
export type BreakdownPart = keyof typeof BREAKDOWN_PARTS;
const PART_NAMES = Object.keys(BREAKDOWN_PARTS) as BreakdownPart[];

/** angles[person][joint][frame], degrees, NaN = missing (from analyzeSync or the -angles.csv). */
export type Angles = Float64Array[][];

export interface PartLag {
  part: BreakdownPart;
  /** + = the second person of the pair moves later */
  lagSec: number;
  lagFrames: number;
  /** How much shifting by the lag shrinks the part's mean angle gap (degrees; largest window) */
  gainDeg: number;
  /** Frames [start, end) of the windows where this part was late */
  spanStart: number;
  spanEnd: number;
}

export interface SyncEpisode {
  pair: [number, number];
  /** Index in SyncResult.pairs (for the pair's color) */
  pairIndex: number;
  startTime: number;
  endTime: number;
  /** Lowest window score inside the episode */
  minScore: number | null;
  /** Body parts that were late (from the angles; empty without them) */
  lateParts: PartLag[];
  /** Whole-body lag inside the episode (+ = second person later), when the windows found one */
  lagSec: number | null;
  lagReliable: boolean;
  /** Frames [spanStart, spanEnd) covered by the episode's off windows */
  spanStart: number;
  spanEnd: number;
  /** Mode most of those windows matched in */
  mode: "normal" | "mirror";
}

export interface JointBreakdown {
  /** Joint of the pair's first person, e.g. "right_elbow" */
  joint: string;
  part: BreakdownPart;
  /** The second person's joint it was compared with (the other side when mirrored) */
  jointB: string;
  /** late: shifting it by its part's lag shrinks its gap by ≥ jointGainDeg; different: its gap grew by
   *  ≥ jointDiffDeg over the usual; still: neither person moved it; no-data: keypoints missing */
  status: "late" | "different" | "ok" | "still" | "no-data";
  /** Its part's lag, for late joints */
  lagSec: number | null;
  /** Gap shrink from the shift (degrees), when its part was late */
  gainDeg: number | null;
  /** Mean |θA − θB| in the episode and over the whole video, degrees */
  diffDeg: number | null;
  usualDiffDeg: number | null;
}

export function findEpisodes(
  sync: SyncResult, angles: Angles | null = null, settings: EpisodeSettings = DEFAULT_EPISODE_SETTINGS,
): SyncEpisode[] {
  const { rhoMin } = sync.config;
  const step = sync.config.hopSec ?? 1 / sync.fps;
  const tauMax = Math.max(1, Math.round(sync.config.tauMaxSec * sync.fps));
  const minTau = Math.round(settings.lagSec * sync.fps);
  const episodes: SyncEpisode[] = [];
  sync.pairs.forEach((pair, pairIndex) => {
    const own = sync.windows.filter((w) => w.pair[0] === pair.pair[0] && w.pair[1] === pair.pair[1]);
    const corrMed = median(own.map((w) => w.corr));
    const poseMed = median(own.map((w) => w.pose));
    const below = (v: number | null, med: number | null, drop: number) => v !== null && med !== null && v < med - drop;
    const lagged = (w: SyncWindow) => w.lagSec !== null && Math.abs(w.lagSec) >= settings.lagSec;

    // Late body parts per window, from the angles.
    const A = angles?.[pair.pair[0] - 1], B0 = angles?.[pair.pair[1] - 1];
    const lateParts = own.map((w) => {
      if (!A || !B0) return [];
      const B = w.mode === "mirror" ? MIRROR.map((m) => B0[m]) : B0;
      return PART_NAMES.flatMap((part) => {
        const best = bestShift(A, B, BREAKDOWN_PARTS[part], w.startFrame, w.endFrame, tauMax);
        return best && Math.abs(best.tau) >= minTau && Math.abs(best.tau) < tauMax && best.gain >= settings.partGainDeg && best.gain >= settings.partGainShare * best.d0
          ? [{ part, tau: best.tau, gain: best.gain, w }] : [];
      });
    });
    const off = (k: number) => {
      const w = own[k];
      return w.score !== null && (below(w.corr, corrMed, settings.corrDrop) || below(w.pose, poseMed, settings.poseDrop)
        || (lagged(w) && (w.rhoMax ?? -1) >= rhoMin) || lateParts[k].length > 0);
    };

    // Runs of off windows; a single quiet window between two off ones does not split the run.
    let run: number[] = [];
    let quiet = 0;
    const close = () => {
      const flagged = run.filter(off);
      if (flagged.length * step >= settings.minOffSec - 1e-6) {
        const ws = flagged.map((k) => own[k]);
        const lags = ws.filter(lagged);
        const parts = lateParts.filter((_, k) => flagged.includes(k)).flat();
        episodes.push({
          pair: pair.pair, pairIndex,
          startTime: Math.max(0, round(ws[0].centerTime - step / 2)),
          endTime: round(ws[ws.length - 1].centerTime + step / 2),
          minScore: minOrNull(ws.map((w) => w.score)),
          lateParts: PART_NAMES.flatMap((part) => {
            // Windows that found the part late in the other direction (usually a shift onto another
            // repetition of the move) are dropped, so the median is not pulled towards 0.
            const all = parts.filter((p) => p.part === part);
            const sign = Math.sign(all.reduce((s, h) => s + Math.sign(h.tau), 0)) || Math.sign(all[0]?.tau ?? 0);
            const hits = all.filter((h) => Math.sign(h.tau) === sign);
            // Only parts late for at least half of minOffSec (v1: 2 windows) count, or in every window of a short episode.
            if (hits.length * step < Math.min(settings.minOffSec / 2 + step, ws.length * step) - 1e-6) return [];
            const lagFrames = Math.round(median(hits.map((h) => h.tau))!);
            return [{
              part,
              lagSec: round(lagFrames / sync.fps),
              lagFrames,
              gainDeg: round(Math.max(...hits.map((h) => h.gain))),
              spanStart: hits[0].w.startFrame,
              spanEnd: hits[hits.length - 1].w.endFrame,
            }];
          }),
          lagSec: lags.length ? median(lags.map((w) => w.lagSec)) : null,
          lagReliable: lags.some((w) => (w.rhoMax ?? -1) >= rhoMin),
          spanStart: ws[0].startFrame,
          spanEnd: ws[ws.length - 1].endFrame,
          mode: ws.filter((w) => w.mode === "mirror").length * 2 > ws.length ? "mirror" : "normal",
        });
      }
      run = [];
      quiet = 0;
    };
    own.forEach((_, k) => {
      if (off(k)) { run.push(k); quiet = 0; return; }
      if (run.length && ++quiet * step <= settings.bridgeSec + 1e-6) { run.push(k); return; }
      close();
    });
    close();
  });
  return episodes.sort((a, b) => a.startTime - b.startTime || a.pairIndex - b.pairIndex);
}

/**
 * Per joint, over the episode: late when shifting it by its (late) part's lag shrinks its angle gap
 * by ≥ jointGainDeg (a joint that doesn't move can't look late); different when its angle gap is
 * ≥ jointDiffDeg larger than its usual gap in this video. Late joints first, then different, ok, still.
 */
export function episodeJoints(
  e: SyncEpisode, angles: Angles, minStdDeg: number, settings: EpisodeSettings = DEFAULT_EPISODE_SETTINGS,
): JointBreakdown[] {
  const A = angles[e.pair[0] - 1], B0 = angles[e.pair[1] - 1];
  if (!A || !B0) return [];
  const B = e.mode === "mirror" ? MIRROR.map((m) => B0[m]) : B0;
  const rows = JOINTS.map((joint, j): JointBreakdown => {
    const part = PART_NAMES.find((p) => BREAKDOWN_PARTS[p].includes(j))!;
    const late = e.lateParts.find((p) => p.part === part);
    const base = {
      joint: joint.name, part, jointB: JOINTS[e.mode === "mirror" ? MIRROR[j] : j].name,
      lagSec: null, gainDeg: null, diffDeg: null, usualDiffDeg: null,
    };
    const diffDeg = gap(A, B, [j], e.spanStart, e.spanEnd, 0);
    const usualDiffDeg = gap(A, B, [j], 0, A[j].length, 0);
    if (diffDeg === null) return { ...base, status: "no-data" };
    const moves = std(A[j], e.spanStart, e.spanEnd) >= minStdDeg || std(B[j], e.spanStart, e.spanEnd) >= minStdDeg;
    let gainDeg: number | null = null;
    if (late && moves) {
      const d0 = gap(A, B, [j], late.spanStart, late.spanEnd, 0);
      const dTau = gap(A, B, [j], late.spanStart, late.spanEnd, late.lagFrames);
      if (d0 !== null && dTau !== null) gainDeg = round(d0 - dTau);
    }
    const isLate = gainDeg !== null && gainDeg >= settings.jointGainDeg;
    const different = usualDiffDeg !== null && diffDeg - usualDiffDeg >= settings.jointDiffDeg;
    return {
      ...base, gainDeg, lagSec: isLate ? late!.lagSec : null,
      diffDeg: round(diffDeg), usualDiffDeg: usualDiffDeg === null ? null : round(usualDiffDeg),
      status: isLate ? "late" : different ? "different" : moves ? "ok" : "still",
    };
  });
  const rank = { late: 0, different: 1, ok: 2, still: 3, "no-data": 4 };
  const extra = (r: JointBreakdown) => (r.diffDeg ?? 0) - (r.usualDiffDeg ?? 0);
  return rows.sort((a, b) => rank[a.status] - rank[b.status] || (b.gainDeg ?? 0) - (a.gainDeg ?? 0) || extra(b) - extra(a));
}

/** "person 2 is 0.36 s behind person 1", or "in step" for a zero lag. */
export function lagText(pair: [number, number], lagSec: number): string {
  if (Math.abs(lagSec) < 1e-6) return "in step";
  const [behind, ahead] = lagSec > 0 ? [pair[1], pair[0]] : [pair[0], pair[1]];
  return `person ${behind} is ${Math.abs(lagSec).toFixed(2)} s behind person ${ahead}`;
}

/**
 * Who is behind in a late limb: "person 2's right arm is 0.52 s behind person 1". The limb is named
 * from the side of the person who is behind (the other side for the second person when mirrored).
 */
export function partLagText(e: SyncEpisode, p: PartLag): string {
  const secondBehind = p.lagSec > 0;
  const [behind, ahead] = secondBehind ? [e.pair[1], e.pair[0]] : [e.pair[0], e.pair[1]];
  const limb = secondBehind && e.mode === "mirror" ? otherSide(p.part) : p.part;
  return `person ${behind}'s ${jointLabel(limb)} is ${Math.abs(p.lagSec).toFixed(2)} s behind person ${ahead}`;
}

/** The joint as named for the person who is behind in its limb (see partLagText). */
export function behindJointName(j: JointBreakdown): string {
  return j.lagSec !== null && j.lagSec > 0 ? j.jointB : j.joint;
}

const otherSide = (name: string) => (name.startsWith("left") ? name.replace("left", "right") : name.replace("right", "left"));

/** "right elbow" from "right_elbow". */
export const jointLabel = (name: string) => name.replace("_", " ");

/** Best time shift of B against A for these joints over [start, end): τ (frames) and how much it shrinks the gap. */
function bestShift(A: Float64Array[], B: Float64Array[], joints: number[], start: number, end: number, tauMax: number) {
  const d0 = gap(A, B, joints, start, end, 0);
  if (d0 === null) return null;
  let best = { tau: 0, gain: 0, d0 };
  for (let tau = -tauMax; tau <= tauMax; tau++) {
    const d = gap(A, B, joints, start, end, tau);
    if (d !== null && d0 - d > best.gain) best = { tau, gain: d0 - d, d0 };
  }
  return best;
}

/** D(τ) = mean |θA(t) − θB(t + τ)| over the joints and t in [start, end); null when under half the values exist. */
function gap(A: Float64Array[], B: Float64Array[], joints: number[], start: number, end: number, tau: number): number | null {
  let sum = 0, n = 0;
  for (const j of joints) {
    for (let t = start; t < end; t++) {
      const u = t + tau;
      if (u < 0 || u >= B[j].length) continue;
      const d = A[j][t] - B[j][u];
      if (!Number.isNaN(d)) { sum += Math.abs(d); n++; }
    }
  }
  return n >= 0.5 * (end - start) * joints.length ? sum / n : null;
}

function std(a: Float64Array, start: number, end: number): number {
  let sum = 0, sq = 0, n = 0;
  for (let t = start; t < end; t++) if (!Number.isNaN(a[t])) { sum += a[t]; sq += a[t] * a[t]; n++; }
  return n ? Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) : 0;
}

function median(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function minOrNull(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.min(...v) : null;
}

const round = (v: number) => Math.round(v * 100) / 100;
