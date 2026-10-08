// Runs a model over a video offline, frame by frame. It seeks to every 1/fps second,
// so no frame is skipped however slow the model is.
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

export async function processVideo(options: {
  model: PoseModel;
  /** <video> element with the source loaded */
  video: HTMLVideoElement;
  /** Canvas the annotated frames are drawn on */
  canvas: HTMLCanvasElement;
  fps: number;
  conf: number;
  exportMp4: boolean;
  /** Return true to stop early (frames so far are kept) */
  shouldStop: () => boolean;
  onProgress: (progress: VideoProgress) => void;
}): Promise<Run> {
  const { model, video, canvas, fps, conf, exportMp4, shouldStop, onProgress } = options;
  const total = Math.max(1, Math.floor(video.duration * fps));
  const width = video.videoWidth & ~1; // H.264 needs even dimensions
  const height = video.videoHeight & ~1;
  const encoder = exportMp4 ? await createMp4Encoder(width, height, fps) : null;

  const frames: FrameRecord[] = [];
  const start = performance.now();
  for (let i = 0; i < total && !shouldStop(); i++) {
    const time = Math.min(i / fps, video.duration - 0.001);
    await seekVideo(video, time);
    const result = await model.predict(video, { conf });
    await annotate(canvas, video, result);
    frames.push(toFrameRecord(i, time, result));
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
  return { frames, width, height, fps, conf, wallMs, media, mediaName: "annotated.mp4", mediaError };
}
