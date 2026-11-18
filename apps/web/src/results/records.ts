// Per-frame records (what goes into the saved JSON/CSV) and the summary stats over a run.
import { KEYPOINT_NAMES } from "../keypoints";
import type { FrameRecord, FrameSummary, KeypointStat, Results, Speed } from "../types";

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Converts one model result into a saved frame record. */
export function toFrameRecord(frameIndex: number, time: number, result: Results): FrameRecord {
  return {
    frame: frameIndex,
    time: round3(time),
    persons: result.boxes.map((box, i) => ({
      box: [round1(box.x1), round1(box.y1), round1(box.x2), round1(box.y2)],
      conf: round3(box.conf),
      keypoints: (result.keypoints[i]?.points ?? []).map(([x, y, conf], k) => ({
        name: KEYPOINT_NAMES[k] ?? `kpt_${k}`, x: round1(x), y: round1(y), conf: round3(conf),
      })),
    })),
    speed: {
      preprocess: round1(result.speed.preprocess),
      inference: round1(result.speed.inference),
      postprocess: round1(result.speed.postprocess),
    },
  };
}

/** The JSON `summary` block: frame counts and mean timing. */
export function summarizeFrames(frames: FrameRecord[]): FrameSummary {
  const n = frames.length;
  const mean = (stage: keyof Speed) => frames.reduce((sum, f) => sum + f.speed[stage], 0) / Math.max(1, n);
  return {
    n,
    withPerson: frames.filter((f) => f.persons.length).length,
    persons: frames.reduce((sum, f) => sum + f.persons.length, 0),
    pre: mean("preprocess"),
    inf: mean("inference"),
    post: mean("postprocess"),
  };
}

/** Per-keypoint mean confidence and visible rate (conf ≥ 0.5), over every detected person. */
export function keypointStats(frames: FrameRecord[]): KeypointStat[] {
  return KEYPOINT_NAMES.map((name, k) => {
    let confSum = 0, count = 0, visible = 0;
    for (const frame of frames) {
      for (const person of frame.persons) {
        const kp = person.keypoints[k];
        if (!kp) continue;
        confSum += kp.conf;
        count++;
        if (kp.conf >= 0.5) visible++;
      }
    }
    return { name, meanConf: count ? confSum / count : 0, visibleRate: count ? visible / count : 0 };
  });
}
