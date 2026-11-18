// Runs a model over a video offline, frame by frame. It seeks to every 1/fps second,
// so no frame is skipped however slow the model is.
// Frame i is the video's i-th frame (at the native rate): the seek goes to the middle of the frame,
// (i + 0.5) / fps after the first frame's own timestamp. Seeking to the exact boundary i / fps (as runs
// before 2026-11-19 did) is ambiguous: Chrome then sometimes shows the previous frame, so e.g. a 30 fps
// video came out as frames 0 1 1 3 4 4 6 … (a third repeated, a third skipped), and a video whose first
// frame is at 0.04 s came out one frame late. The saved `time` stays i / fps.
import { annotate } from "@ultralytics/yolo";
import type { FrameRecord, PoseModel, Run } from "../types";
import { toFrameRecord } from "../results/records";
import { createMp4Encoder } from "./mp4-encoder";

export interface VideoProgress {
  done: number;
  total: number;
  elapsedMs: number;
  /** People found in the latest frame */
  persons: number;
}

export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    video.addEventListener("seeked", () => resolve(), { once: true });
    video.currentTime = time;
  });
}

/**
 * Timestamp of the video's first frame on the <video> timeline (often 0; e.g. 0.04 s when the stream
 * starts later). Read from requestVideoFrameCallback after a seek to 0; 0 when that isn't available.
 */
export async function firstFrameTime(video: HTMLVideoElement): Promise<number> {
  if (!("requestVideoFrameCallback" in video)) return 0;
  // The callback fires only when a different frame is presented, so first move away from the start.
  await seekVideo(video, Math.min(0.5, video.duration / 2));
  const presented = new Promise<number | null>((resolve) => {
    video.requestVideoFrameCallback((_now, meta) => resolve(meta.mediaTime));
    setTimeout(() => resolve(null), 1000);
  });
  await seekVideo(video, 0);
  const t = await presented;
  if (t === null) console.warn("First frame time unknown; assuming 0");
  return Math.max(0, t ?? 0);
}

/** The video frames a run covers: the header's frame count at the native rate, else floor((duration − start) × fps). */
export function plannedFrames(video: HTMLVideoElement, fps: number, start: number, native?: { fps: number | null; frameCount: number | null } | null): number {
  if (native?.fps && native.frameCount && Math.abs(native.fps - fps) < 0.01) return native.frameCount;
  return Math.max(1, Math.floor((video.duration - start) * fps));
}

/** Where to seek for frame i: the middle of the frame, after the first frame's timestamp. */
export function frameSeekTime(i: number, fps: number, start: number, duration: number): number {
  return Math.min(start + (i + 0.5) / fps, duration - 0.001);
}

export async function processVideo(options: {
  model: PoseModel;
  /** <video> element with the source loaded */
  video: HTMLVideoElement;
  /** Canvas the annotated frames are drawn on */
  canvas: HTMLCanvasElement;
  fps: number;
  conf: number;
  exportMp4: boolean;
  /** The file's native fps and frame count (from its header), when known */
  native?: { fps: number | null; frameCount: number | null } | null;
  /** Return true to stop early (frames so far are kept) */
  shouldStop: () => boolean;
  onProgress: (progress: VideoProgress) => void;
}): Promise<Run> {
  const { model, video, canvas, fps, conf, exportMp4, native, shouldStop, onProgress } = options;
  const start0 = await firstFrameTime(video);
  const total = plannedFrames(video, fps, start0, native);
  const width = video.videoWidth & ~1; // H.264 needs even dimensions
  const height = video.videoHeight & ~1;
  const encoder = exportMp4 ? await createMp4Encoder(width, height, fps) : null;

  const frames: FrameRecord[] = [];
  const start = performance.now();
  for (let i = 0; i < total && !shouldStop(); i++) {
    await seekVideo(video, frameSeekTime(i, fps, start0, video.duration));
    const result = await model.predict(video, { conf });
    await annotate(canvas, video, result);
    frames.push(toFrameRecord(i, i / fps, result));
    await encoder?.addFrame(canvas, i);
    onProgress({ done: i + 1, total, elapsedMs: performance.now() - start, persons: result.boxes.length });
  }
  const wallMs = performance.now() - start;

  let media: Blob | null = null;
  let mediaError = exportMp4 && !encoder ? "MP4 export not supported in this browser" : null;
  if (encoder) {
    try {
      media = await encoder.finish();
    } catch (err) {
      console.error(err);
      mediaError = `MP4 export failed: ${(err as Error).message}`;
    }
  }
  return { frames, width, height, fps, conf, wallMs, plannedFrames: total, media, mediaName: "annotated.mp4", mediaError };
}
