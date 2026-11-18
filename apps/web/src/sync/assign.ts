// Person assignment (report 3.3): people don't swap places, so detections are numbered 1..N
// left to right by the x of their hip midpoint. N = the most common count in the first 2 s.
// A frame with more than N detections keeps the N most confident; a frame with fewer gives each
// detection to the person last seen nearest to it, and the rest stay missing (filled in later).
import type { SyncFrame, SyncPerson } from "./types.ts";

const LEFT_HIP = 11;
const RIGHT_HIP = 12;
const COUNT_WINDOW_SEC = 2;

export interface Assignment {
  /** tracks[i][t] = person i+1 in frame t, or null when not detected */
  tracks: (SyncPerson | null)[][];
  framesExact: number;
  framesFewer: number;
  framesMore: number;
}

/** Hip midpoint x, or the box centre when the hips are missing. */
function hipX(p: SyncPerson): number {
  const l = p.keypoints[LEFT_HIP];
  const r = p.keypoints[RIGHT_HIP];
  return l && r ? (l.x + r.x) / 2 : (p.box[0] + p.box[2]) / 2;
}

/** The most common non-zero detection count in the first 2 s (the largest on a tie). */
export function countPeople(frames: SyncFrame[]): number {
  const start = frames[0]?.time ?? 0;
  const counts = new Map<number, number>();
  for (const f of frames) {
    if (f.time - start > COUNT_WINDOW_SEC) break;
    if (f.persons.length) counts.set(f.persons.length, (counts.get(f.persons.length) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = -1;
  for (const [n, c] of counts) if (c > bestCount || (c === bestCount && n > best)) [best, bestCount] = [n, c];
  return best || Math.max(0, ...frames.map((f) => f.persons.length));
}

export function assignPeople(frames: SyncFrame[], n: number): Assignment {
  const tracks: (SyncPerson | null)[][] = Array.from({ length: n }, () => []);
  const lastX: (number | null)[] = Array(n).fill(null);
  let framesExact = 0, framesFewer = 0, framesMore = 0;

  for (const frame of frames) {
    let dets = frame.persons;
    if (dets.length > n) {
      framesMore++;
      dets = [...dets].sort((a, b) => b.conf - a.conf).slice(0, n);
    } else if (dets.length < n) {
      framesFewer++;
    } else {
      framesExact++;
    }

    const slots: (SyncPerson | null)[] = Array(n).fill(null);
    if (dets.length === n) {
      [...dets].sort((a, b) => hipX(a) - hipX(b)).forEach((d, i) => (slots[i] = d));
    } else if (lastX.some((x) => x !== null)) {
      // Greedy nearest match to where each person was last seen.
      const pairs = dets.flatMap((d, di) => lastX.flatMap((x, si) =>
        x === null ? [] : [{ di, si, dist: Math.abs(hipX(d) - x) }])).sort((a, b) => a.dist - b.dist);
      const usedDet = new Set<number>();
      for (const { di, si } of pairs) {
        if (usedDet.has(di) || slots[si]) continue;
        slots[si] = dets[di];
        usedDet.add(di);
      }
    } // else: nobody seen yet and too few detections to number them; the frame stays empty.

    slots.forEach((p, i) => {
      tracks[i].push(p);
      if (p) lastX[i] = hipX(p);
    });
  }
  return { tracks, framesExact, framesFewer, framesMore };
}
