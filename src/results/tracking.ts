// People tracking: how many of the expected people a model found in each frame.
// This counts detections per frame; it does not follow person identities.
import type { FrameRecord, TrackingRow, TrackingSummary } from "../types";
import { round3 } from "./records";

/**
 * One row per frame. `tracked` caps detections at the expected count, so extra
 * (false) detections don't inflate the rate; `detected` keeps the raw count.
 */
export function trackingRows(frames: FrameRecord[], expected: number): TrackingRow[] {
  return frames.map((f) => {
    const detected = f.persons.length;
    const tracked = Math.min(detected, expected);
    return { frame: f.frame, time: f.time, detected, tracked, expected, rate: round3(tracked / expected) };
  });
}

export function trackingSummary(rows: TrackingRow[], expected: number): TrackingSummary {
  const n = Math.max(1, rows.length);
  const histogram = Array.from({ length: expected + 1 }, (_, k) => rows.filter((r) => r.tracked === k).length);
  const meanTracked = rows.reduce((sum, r) => sum + r.tracked, 0) / n;
  return {
    expectedPersons: expected,
    framesAllTracked: histogram[expected],
    allTrackedRate: round3(histogram[expected] / n),
    meanTracked: round3(meanTracked),
    meanTrackedRate: round3(meanTracked / expected),
    framesOverDetected: rows.filter((r) => r.detected > expected).length,
    trackedHistogram: histogram,
  };
}

/** The `<video>-tracking.csv` file. */
export function trackingCsv(rows: TrackingRow[]): string {
  const header = "frame,time,detected,tracked,expected,rate";
  const lines = rows.map((r) => [r.frame, r.time, r.detected, r.tracked, r.expected, r.rate].join(","));
  return [header, ...lines].join("\n");
}
