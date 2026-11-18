// Preprocessing (report 3.4): keypoints below the confidence threshold become missing, short gaps
// are filled by linear interpolation between the neighbouring frames, and each coordinate series
// is smoothed with a Savitzky-Golay filter (quadratic, window ≈ smoothWindowSec).
import type { SyncPerson } from "./types.ts";

const KEYPOINTS = 17;

/** One person's cleaned keypoints: x[k][t], y[k][t] in pixels, NaN = missing. */
export interface PersonSeries {
  x: Float64Array[];
  y: Float64Array[];
  missingFrameRate: number;
  interpolatedRate: number;
  missingValueRate: number;
}

export interface PreprocessOptions {
  confThreshold: number;
  maxGapFrames: number;
  /** Odd window length in frames; < 3 = no smoothing */
  smoothWindow: number;
}

export function preprocess(track: (SyncPerson | null)[], opts: PreprocessOptions): PersonSeries {
  const T = track.length;
  const x = Array.from({ length: KEYPOINTS }, () => new Float64Array(T).fill(NaN));
  const y = Array.from({ length: KEYPOINTS }, () => new Float64Array(T).fill(NaN));
  track.forEach((p, t) => {
    p?.keypoints.slice(0, KEYPOINTS).forEach((kp, k) => {
      if (kp.conf >= opts.confThreshold) {
        x[k][t] = kp.x;
        y[k][t] = kp.y;
      }
    });
  });

  let filled = 0;
  for (let k = 0; k < KEYPOINTS; k++) {
    filled += interpolateGaps(x[k], opts.maxGapFrames);
    interpolateGaps(y[k], opts.maxGapFrames);
    if (opts.smoothWindow >= 3) {
      x[k] = savitzkyGolay(x[k], opts.smoothWindow);
      y[k] = savitzkyGolay(y[k], opts.smoothWindow);
    }
  }
  const values = Math.max(1, T * KEYPOINTS);
  const stillMissing = x.reduce((sum, arr) => sum + arr.filter(Number.isNaN).length, 0);
  return {
    x, y,
    missingFrameRate: track.filter((p) => !p).length / Math.max(1, T),
    interpolatedRate: filled / values,
    missingValueRate: stillMissing / values,
  };
}

/** Fills NaN runs of at most maxGap values that have a valid value on both sides. Returns the count filled. */
export function interpolateGaps(a: Float64Array, maxGap: number): number {
  let filled = 0;
  let t = 0;
  while (t < a.length) {
    if (!Number.isNaN(a[t])) { t++; continue; }
    const start = t;
    while (t < a.length && Number.isNaN(a[t])) t++;
    const len = t - start;
    if (start > 0 && t < a.length && len <= maxGap) {
      const v0 = a[start - 1], v1 = a[t];
      for (let i = 0; i < len; i++) a[start + i] = v0 + ((v1 - v0) * (i + 1)) / (len + 1);
      filled += len;
    }
  }
  return filled;
}

/**
 * Quadratic Savitzky-Golay smoothing, applied to each run of valid values separately (NaN stays NaN).
 * Near the ends of a run the window shrinks so it stays centred; a 1-value window leaves the value as is.
 */
export function savitzkyGolay(a: Float64Array, window: number): Float64Array<ArrayBuffer> {
  const half = Math.floor(window / 2);
  const out = Float64Array.from(a);
  let t = 0;
  while (t < a.length) {
    if (Number.isNaN(a[t])) { t++; continue; }
    const start = t;
    while (t < a.length && !Number.isNaN(a[t])) t++;
    for (let i = start; i < t; i++) {
      const m = Math.min(half, i - start, t - 1 - i);
      if (m < 1) continue;
      const w = sgWeights(m);
      let sum = 0;
      for (let j = -m; j <= m; j++) sum += w[j + m] * a[i + j];
      out[i] = sum;
    }
  }
  return out;
}

const sgCache = new Map<number, number[]>();

/** Quadratic/cubic smoothing weights for half-width m: (3(3m²+3m−1) − 15i²) / ((2m+1)(4m²+4m−3)). */
function sgWeights(m: number): number[] {
  let w = sgCache.get(m);
  if (!w) {
    const denom = (2 * m + 1) * (4 * m * m + 4 * m - 3);
    w = Array.from({ length: 2 * m + 1 }, (_, i) => (3 * (3 * m * m + 3 * m - 1) - 15 * (i - m) ** 2) / denom);
    sgCache.set(m, w);
  }
  return w;
}
