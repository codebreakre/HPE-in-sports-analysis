// Live webcam inference: predicts as fast as the model allows and can record
// the annotated canvas as WebM.
import { annotate } from "@ultralytics/yolo";
import type { FrameRecord, PoseModel, Run } from "../types";
import { toFrameRecord } from "../results/records";

export interface WebcamFrameInfo {
  fps: number;
  inferenceMs: number;
  persons: number;
}

export interface WebcamSession {
  /** Stops the camera and returns everything recorded so far. */
  stop(): Promise<Run>;
}

export async function startWebcam(options: {
  model: PoseModel;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  conf: number;
  /** Also record the annotated canvas as WebM */
  record: boolean;
  onFrame: (info: WebcamFrameInfo) => void;
}): Promise<WebcamSession> {
  const { model, video, canvas, conf, record, onFrame } = options;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  video.src = "";
  video.srcObject = stream;
  await video.play();

  // The first annotate sizes the canvas, so do it before the recorder starts capturing it.
  await annotate(canvas, video, await model.predict(video, { conf }));
  const recorder = record ? startCanvasRecorder(canvas) : null;

  const frames: FrameRecord[] = [];
  const start = performance.now();
  let running = true;
  let lastFrameAt = start;
  let smoothedFps = 0;

  async function loop() {
    if (!running) return;
    const result = await model.predict(video, { conf });
    await annotate(canvas, video, result);
    const now = performance.now();
    frames.push(toFrameRecord(frames.length, (now - start) / 1000, result));

    const fps = 1000 / (now - lastFrameAt);
    smoothedFps = smoothedFps ? smoothedFps * 0.9 + fps * 0.1 : fps;
    lastFrameAt = now;
    onFrame({ fps: smoothedFps, inferenceMs: result.speed.inference, persons: result.boxes.length });
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    async stop() {
      running = false;
      const media = recorder ? await recorder.stop() : null;
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      return {
        frames: frames.slice(),
        width: canvas.width,
        height: canvas.height,
        fps: null,
        conf,
        wallMs: performance.now() - start,
        media,
        mediaName: "annotated-webcam.webm",
      };
    },
  };
}

function startCanvasRecorder(canvas: HTMLCanvasElement): { stop(): Promise<Blob> } | null {
  if (!("MediaRecorder" in window)) return null;
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.start(1000);
  return {
    stop: () => new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
      recorder.stop();
    }),
  };
}
