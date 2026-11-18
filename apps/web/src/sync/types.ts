// Synchronization algorithm (report 3.3-3.6): input shapes, settings and results.
// The sync module runs both in the browser and in Node (scripts/sync.ts), so it imports nothing
// from the app: the input types are structural and match the saved pose JSON frames.

// ---------- input (a saved pose JSON's `frames`) ----------

export interface SyncKeypoint {
  x: number;
  y: number;
  conf: number;
}

export interface SyncPerson {
  box: number[];
  conf: number;
  keypoints: SyncKeypoint[];
}

export interface SyncFrame {
  frame: number;
  time: number;
  persons: SyncPerson[];
}

// ---------- settings ----------

/** "auto" scores each window both ways and keeps the higher (report 3.6, two-mode comparison). */
export type MirrorMode = "auto" | "normal" | "mirror";

export type LagConfidence = "hard" | "ramp" | "drop";

export type BodyPart = "arms" | "legs" | "torso";

/** Joint weight presets α_k (body part shares, %; a part's share is split equally between its joints). */
export type JointWeightPreset = "general" | "ballet" | "hand-dance" | "custom";
export const JOINT_WEIGHT_PRESETS: Record<Exclude<JointWeightPreset, "custom">, Record<BodyPart, number>> = {
  general: { arms: 50, legs: 25, torso: 25 },
  ballet: { arms: 20, legs: 60, torso: 20 },
  "hand-dance": { arms: 60, legs: 20, torso: 20 },
};

export interface SyncConfig {
  /** People in the video; null = the most common count in the first 2 s (report 3.3) */
  persons: number | null;
  /** Keypoints below this confidence are treated as missing and filled in (report 3.4) */
  confThreshold: number;
  /** Longest gap filled by linear interpolation, in seconds; longer gaps stay missing */
  maxGapSec: number;
  /** Savitzky-Golay smoothing of the keypoint coordinates (report 3.4) */
  smooth: boolean;
  smoothWindowSec: number;
  /** Sliding window W in seconds. There is one window per frame, centred on it (t − W/2 … t + W/2);
   *  near the start and end of the video the window is moved inside it, so it stays W long. */
  windowSec: number;
  /** v1 only (windows every hopSec seconds); v2 has one window per frame and leaves it out */
  hopSec?: number;
  /** Largest lag searched by the cross-correlation, and the lag where S_lag reaches 0 */
  tauMaxSec: number;
  /** Lag is trusted only when the best correlation reaches this (report formula 3.2) */
  rhoMin: number;
  /** What S_lag does around ρmin. "hard": 0 below ρmin (report formula 3.2). "ramp": scaled by
   *  (ρmax − (ρmin − w/2)) / w, clamped to 0-1, so it rises smoothly over ρmin ± w/2 (w = lagRampWidth).
   *  "drop": below ρmin the lag counts as unmeasured and S_lag is left out of the score (weights renormalized). */
  lagConfidence: LagConfidence;
  lagRampWidth: number;
  /** w1, w2, w3 for pose similarity, correlation and lag (report formula 3.3) */
  weights: [number, number, number];
  /** A joint whose angle varies less than this (std, degrees) in a window counts as still */
  minStdDeg: number;
  /** A window needs at least this share of valid angle values, else it gets no score */
  minValidShare: number;
  mirror: MirrorMode;
  /** "auto": a window is scored mirrored only when that scores at least this much higher (0-100 points),
   *  so the mode does not flicker; when the two are close, the normal mode is kept */
  mirrorMargin: number;
  /** Joint weights α_k in S_pose and S_corr; "custom" uses partWeights as given */
  jointWeightPreset: JointWeightPreset;
  /** Body part shares (any scale, normalized); filled from the preset unless it is "custom" */
  partWeights: Record<BodyPart, number>;
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  persons: null,
  confThreshold: 0.3,
  maxGapSec: 1,
  smooth: true,
  smoothWindowSec: 0.3,
  windowSec: 2,
  // Tuned on poomsae-720reso (RTMPose-m) with keypoint-level controlled pairs (report 4.1):
  // tauMax must exceed the largest lag tested (1 s), and the windows' ρmax was ≈0.42 (median) for
  // people performing together, ≈0.13 for different motion and 1.0 for an exact copy, so the
  // report's example ρmin = 0.5 rejected real synchronized motion while 0.3 separates the two.
  tauMaxSec: 1.5,
  rhoMin: 0.3,
  lagConfidence: "hard",
  lagRampWidth: 0.2,
  weights: [1 / 3, 1 / 3, 1 / 3],
  minStdDeg: 3,
  minValidShare: 0.5,
  mirror: "auto",
  mirrorMargin: 5,
  jointWeightPreset: "general",
  partWeights: { ...JOINT_WEIGHT_PRESETS.general },
};

// ---------- results ----------

/** Window or pair scores. Components are 0-1; `score` is 0-100. null = not enough data. */
export interface ScoreParts {
  score: number | null;
  pose: number | null;
  corr: number | null;
  lag: number | null;
}

export interface SyncWindow extends ScoreParts {
  /** v2: the frame this window is centred on (one window per frame); absent in v1 files */
  frame?: number;
  /** 1-based person numbers, left to right */
  pair: [number, number];
  startFrame: number;
  /** Exclusive */
  endFrame: number;
  startTime: number;
  endTime: number;
  centerTime: number;
  /** Positive: the second person moves later than the first */
  lagFrames: number | null;
  lagSec: number | null;
  rhoMax: number | null;
  mode: "normal" | "mirror";
  parts: Record<BodyPart, number | null>;
}

export interface SyncPair extends ScoreParts {
  pair: [number, number];
  /** Lag over the whole video (cross-correlation of the full series) */
  lagFrames: number | null;
  lagSec: number | null;
  rhoMax: number | null;
  /** rhoMax ≥ rhoMin */
  lagReliable: boolean;
  /** Share of scored windows that matched better mirrored */
  mirrorShare: number;
  parts: Record<BodyPart, number | null>;
  windowsScored: number;
}

export interface SyncPersonResult {
  /** 1-based, left to right */
  person: number;
  /** S_i: mean of the pair scores this person is in (report formula 3.4) */
  score: number | null;
  /** Share of frames where this person was not detected */
  missingFrameRate: number;
  /** Share of keypoint values filled in by interpolation */
  interpolatedRate: number;
  /** Share of keypoint values still missing after interpolation */
  missingValueRate: number;
}

/** One step of the timeline shown during playback: group and pair scores of one window. */
export interface SyncTimelineStep {
  /** v2: the frame of this step (one step per frame); absent in v1 files */
  frame?: number;
  startTime: number;
  endTime: number;
  centerTime: number;
  group: number | null;
  /** In the order of `pairs` */
  pairs: (number | null)[];
}

export interface SyncResult {
  /** v1: 3 s windows every 0.5 s, unweighted joints. v2: 2 s window centred on every frame, joint weights α_k,
   *  mirror only with a 5-point margin, legs = knees */
  algorithm: "joint-angle sync v1" | "joint-angle sync v2";
  config: SyncConfig;
  fps: number;
  frameCount: number;
  personCount: number;
  /** How detections were split into people (report 3.3) */
  assignment: { framesExact: number; framesFewer: number; framesMore: number };
  /** S_group (report formula 3.4); mostDeviating = the person with the lowest S_i (3+ people) */
  group: { score: number | null; mostDeviating: number | null };
  persons: SyncPersonResult[];
  pairs: SyncPair[];
  timeline: SyncTimelineStep[];
  windows: SyncWindow[];
}
