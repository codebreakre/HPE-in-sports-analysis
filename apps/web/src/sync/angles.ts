// Joint angles (report 3.5, table 3.1): the angle at b between a-b and c-b, in degrees (0-180).
// Angles don't depend on where a person stands or how big they appear, so no normalization is needed.
import type { BodyPart } from "./types.ts";
import type { PersonSeries } from "./preprocess.ts";

/** COCO keypoint indices (a, b, c); the angle is measured at b. */
export const JOINTS: { name: string; a: number; b: number; c: number; part: BodyPart }[] = [
  { name: "left_elbow", a: 5, b: 7, c: 9, part: "arms" },
  { name: "right_elbow", a: 6, b: 8, c: 10, part: "arms" },
  { name: "left_shoulder", a: 11, b: 5, c: 7, part: "arms" },
  { name: "right_shoulder", a: 12, b: 6, c: 8, part: "arms" },
  { name: "left_hip", a: 5, b: 11, c: 13, part: "torso" },
  { name: "right_hip", a: 6, b: 12, c: 14, part: "torso" },
  { name: "left_knee", a: 11, b: 13, c: 15, part: "legs" },
  { name: "right_knee", a: 12, b: 14, c: 16, part: "legs" },
];

/**
 * Joints per body part, without overlap so the part weights α add up: arms = elbows + shoulders,
 * legs = knees, torso = hips. (v1 counted the hips in both legs and torso.)
 */
export const PART_JOINTS: Record<BodyPart, number[]> = {
  arms: [0, 1, 2, 3],
  legs: [6, 7],
  torso: [4, 5],
};

/** α_k per joint: each body part's share split equally between its joints, summing to 1. */
export function jointWeights(partWeights: Record<BodyPart, number>): number[] {
  const total = Object.values(partWeights).reduce((s, w) => s + Math.max(0, w), 0) || 1;
  return JOINTS.map((j) => Math.max(0, partWeights[j.part]) / total / PART_JOINTS[j.part].length);
}

/** Index of each joint's left/right counterpart, for the mirror comparison (report 2.4). */
export const MIRROR = [1, 0, 3, 2, 5, 4, 7, 6];

/** angles[j][t] in degrees; NaN when a keypoint is missing. */
export function jointAngles(s: PersonSeries): Float64Array[] {
  const T = s.x[0]?.length ?? 0;
  return JOINTS.map(({ a, b, c }) => {
    const out = new Float64Array(T);
    for (let t = 0; t < T; t++) {
      const ux = s.x[a][t] - s.x[b][t], uy = s.y[a][t] - s.y[b][t];
      const vx = s.x[c][t] - s.x[b][t], vy = s.y[c][t] - s.y[b][t];
      const zero = (ux === 0 && uy === 0) || (vx === 0 && vy === 0);
      // atan2(|u×v|, u·v) = arccos of formula 2.1, but stable near 0° and 180°
      out[t] = zero ? NaN : (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI;
    }
    return out;
  });
}
