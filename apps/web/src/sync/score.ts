// Window scores for one pair (report 3.6). Inputs are joint-angle series angles[j][t] (degrees).
//   S_pose  formula 3.1: 1 − Σ α_k |θA − θB|_k / 180°, |θA − θB|_k = mean over the window's valid frames
//   S_corr  (Σ α_k r_k + 1) / 2, r_k = Pearson correlation per joint
//   (α_k = joint weights; renormalized over the joints that have data, so a body part's own score
//   weighs its joints equally)
//   S_lag   formula 3.2: cross-correlation of the angle velocities finds τ*; 1 − |τ*| / τmax if ρmax ≥ ρmin
//   score   formula 3.3: weighted sum of the three, × 100
// Still joints: a joint that barely moves (std < minStdDeg) in both people carries no timing
// information, so it is left out of S_corr and S_lag; if it moves in only one of them, r = 0.
// When no joint moves in either person (both holding a pose), S_corr and S_lag are undefined and
// the score is S_pose alone (the weights are renormalized over the components that exist).

export interface ScoreSettings {
  tauMax: number;      // frames
  rhoMin: number;
  weights: [number, number, number];
  minStdDeg: number;
  minValidShare: number;
  /** α_k per joint (index into JOINTS) */
  alpha: number[];
  lagConfidence?: "hard" | "ramp" | "drop";
  lagRampWidth?: number;
}

export interface WindowScore {
  score: number | null;  // 0-100
  pose: number | null;   // 0-1
  corr: number | null;
  lag: number | null;
  lagFrames: number | null;
  rhoMax: number | null;
}

const EMPTY: WindowScore = { score: null, pose: null, corr: null, lag: null, lagFrames: null, rhoMax: null };

/**
 * Scores frames [start, end) of A against B for the given joints. `b` may be the mirrored series.
 * `velA`/`velB` are the angle velocities (θ[t+1] − θ[t]) over the whole video, so a shifted window of
 * B can reach outside [start, end).
 */
export function windowScore(
  a: Float64Array[], b: Float64Array[], velA: Float64Array[], velB: Float64Array[],
  joints: number[], start: number, end: number, s: ScoreSettings,
): WindowScore {
  const len = end - start;
  let valid = 0, poseNum = 0, poseDen = 0;
  for (const j of joints) {
    let n = 0, sum = 0;
    for (let t = start; t < end; t++) {
      const d = a[j][t] - b[j][t];
      if (!Number.isNaN(d)) { n++; sum += Math.abs(d); }
    }
    valid += n;
    if (n) { poseNum += s.alpha[j] * (sum / n); poseDen += s.alpha[j]; }
  }
  if (valid < s.minValidShare * len * joints.length || !poseDen) return EMPTY;
  const pose = 1 - poseNum / poseDen / 180;

  // Correlation per joint; also note which joints move in both people (used for the lag).
  let corrNum = 0, corrDen = 0;
  const moving: number[] = [];
  for (const j of joints) {
    const xs: number[] = [], ys: number[] = [];
    for (let t = start; t < end; t++) {
      if (!Number.isNaN(a[j][t]) && !Number.isNaN(b[j][t])) { xs.push(a[j][t]); ys.push(b[j][t]); }
    }
    if (xs.length < s.minValidShare * len) continue;
    const stillA = std(xs) < s.minStdDeg, stillB = std(ys) < s.minStdDeg;
    if (stillA && stillB) continue;
    corrDen += s.alpha[j];
    if (stillA || stillB) continue; // r = 0
    corrNum += s.alpha[j] * (pearson(xs, ys) ?? 0);
    moving.push(j);
  }
  const corr = corrDen ? (corrNum / corrDen + 1) / 2 : null;

  let lag: number | null = null, lagFrames: number | null = null, rhoMax: number | null = null;
  if (moving.length) {
    const best = crossCorrelation(velA, velB, moving, start, end - 1, s.tauMax, s.minValidShare);
    if (best) {
      lagFrames = best.tau;
      rhoMax = best.rho;
      const base = Math.max(0, 1 - Math.abs(best.tau) / s.tauMax);
      const mode = s.lagConfidence ?? "hard";
      if (mode === "ramp") {
        const w = s.lagRampWidth ?? 0.2;
        lag = base * Math.min(1, Math.max(0, (best.rho - (s.rhoMin - w / 2)) / w));
      } else {
        lag = best.rho >= s.rhoMin ? base : mode === "drop" ? null : 0;
      }
    }
  }

  const parts: [number | null, number][] = [[pose, s.weights[0]], [corr, s.weights[1]], [lag, s.weights[2]]];
  let num = 0, den = 0;
  for (const [v, w] of parts) if (v !== null) { num += v * w; den += w; }
  return { score: den ? (100 * num) / den : null, pose, corr, lag, lagFrames, rhoMax };
}

/**
 * Normalized cross-correlation (formula 2.3) of velocity series over [start, end), averaged over the
 * joints: ρ(τ) = corr(vA[t], vB[t + τ]) for |τ| ≤ tauMax. Returns the best τ (the smallest |τ| on a tie).
 * Positive τ: B moves later than A.
 */
export function crossCorrelation(
  velA: Float64Array[], velB: Float64Array[], joints: number[],
  start: number, end: number, tauMax: number, minValidShare = 0.5,
): { tau: number; rho: number } | null {
  const T = velB[0]?.length ?? 0;
  let best: { tau: number; rho: number } | null = null;
  for (let k = 0; k <= 2 * tauMax; k++) {
    const tau = k % 2 ? (k + 1) / 2 : -k / 2; // 0, 1, −1, 2, −2, … so ties keep the smallest |τ|
    const rhos: number[] = [];
    for (const j of joints) {
      const xs: number[] = [], ys: number[] = [];
      for (let t = start; t < end; t++) {
        const u = t + tau;
        if (u < 0 || u >= T) continue;
        const va = velA[j][t], vb = velB[j][u];
        if (!Number.isNaN(va) && !Number.isNaN(vb)) { xs.push(va); ys.push(vb); }
      }
      if (xs.length < Math.max(5, minValidShare * (end - start))) continue;
      const r = pearson(xs, ys);
      if (r !== null) rhos.push(r);
    }
    if (!rhos.length) continue;
    const rho = mean(rhos);
    if (!best || rho > best.rho) best = { tau, rho };
  }
  return best;
}

/** θ[t+1] − θ[t] per joint (NaN where either is missing); same length as θ, last value NaN. */
export function velocities(angles: Float64Array[]): Float64Array[] {
  return angles.map((a) => {
    const v = new Float64Array(a.length).fill(NaN);
    for (let t = 0; t + 1 < a.length; t++) v[t] = a[t + 1] - a[t];
    return v;
  });
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

export const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

function std(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
