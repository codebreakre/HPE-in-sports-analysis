// Runs HPE on the Python server (apps/server) instead of in the browser. The video is uploaded, the server
// processes every frame and returns the keypoints in the browser's own frame format; then the annotated video
// is drawn here from those keypoints (seek + draw, no model), so the rest of the app (stats, sync, saving)
// sees an ordinary Run. Reached through the Vite proxy at /server-api (vite.config.ts).
import { annotate } from "@ultralytics/yolo";
import type { FrameRecord, Point, Results, Run } from "../types";
import { makeResults } from "../models/common";
import { createMp4Encoder } from "./mp4-encoder";
import { firstFrameTime, frameSeekTime, plannedFrames, seekVideo } from "./video";

const API = "/server-api";
const POLL_MS = 400;

export interface ServerHealth {
  /** e.g. "cuda" or "cpu"; null until the model has been loaded */
  device: string | null;
  modelAvailable: boolean;
  onnxruntime: string;
}

export interface ServerProgress {
  stage: "upload" | "queued" | "server" | "drawing";
  done: number;
  total: number;
  elapsedMs: number;
}

interface JobStatus {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  done: number;
  total: number;
  elapsedMs: number;
  error: string | null;
  device: string | null;
}

interface JobKeypoints {
  device: string;
  width: number;
  height: number;
  fps: number;
  conf: number;
  plannedFrames: number;
  processingMs: number;
  frames: FrameRecord[];
}

/** Is the server up, and can it run this model? Loads the model there, so the device is known. Throws when unreachable. */
export async function checkServer(modelId: string): Promise<ServerHealth> {
  const health = await getJson<{ onnxruntime: string; models: { id: string; available: boolean; device: string | null }[] }>(`${API}/health`);
  const model = health.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`the server has no model ${modelId}`);
  let device = model.device;
  if (model.available && !device) {
    device = (await getJson<{ device: string }>(`${API}/models/${modelId}/load`, { method: "POST" })).device;
  }
  return { device, modelAvailable: model.available, onnxruntime: health.onnxruntime };
}

export interface ServerRunTiming {
  uploadMs: number;
  /** Server time from the start of processing to the last frame */
  serverMs: number;
  /** Drawing the annotated video in the browser afterwards */
  drawMs: number;
}

export async function processVideoOnServer(options: {
  file: Blob;
  fileName: string;
  modelId: string;
  /** <video> element with the same video loaded (for drawing the annotated video) */
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  fps: number;
  conf: number;
  exportMp4: boolean;
  native?: { fps: number | null; frameCount: number | null } | null;
  shouldStop: () => boolean;
  onProgress: (progress: ServerProgress) => void;
}): Promise<{ run: Run; device: string; timing: ServerRunTiming }> {
  const { file, fileName, modelId, video, canvas, fps, conf, exportMp4, native, shouldStop, onProgress } = options;
  // The same frame list as processVideo: frame i = the video's i-th frame at the native rate
  // (the server counts decoded frames from its first one).
  const start0 = await firstFrameTime(video);
  const total = plannedFrames(video, fps, start0, native);
  const start = performance.now();

  // 1. Upload
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("model", modelId);
  form.append("conf", String(conf));
  form.append("fps", String(fps));
  form.append("frames", String(total));
  let job = await upload(form, (sent, size) => onProgress({ stage: "upload", done: sent, total: size, elapsedMs: performance.now() - start }));
  const uploadMs = performance.now() - start;

  // 2. Wait for the server (Stop cancels the job; frames done so far are not returned)
  try {
    while (job.status === "queued" || job.status === "running") {
      if (shouldStop()) throw new Error("Stopped (the server job was cancelled)");
      await new Promise((r) => setTimeout(r, POLL_MS));
      job = await getJson<JobStatus>(`${API}/jobs/${job.id}`);
      onProgress({ stage: job.status === "queued" ? "queued" : "server", done: job.done, total: job.total || total, elapsedMs: performance.now() - start });
    }
    if (job.status !== "done") throw new Error(`Server job ${job.status}${job.error ? `: ${job.error}` : ""}`);
    const result = await getJson<JobKeypoints>(`${API}/jobs/${job.id}/keypoints`);

    // 3. Annotated video, drawn here from the returned keypoints
    const drawStart = performance.now();
    const { media, mediaError, width, height } = await drawAnnotated(result, start0, video, canvas, exportMp4, (done) =>
      onProgress({ stage: "drawing", done, total: result.frames.length, elapsedMs: performance.now() - start }));
    const drawMs = performance.now() - drawStart;

    const run: Run = {
      frames: result.frames, width, height, fps, conf,
      // Upload + server processing: the time HPE took from the user's point of view (drawing excluded,
      // as the browser run's wallMs covers inference and drawing of each frame together).
      wallMs: drawStart - start,
      plannedFrames: total, media, mediaName: "annotated.mp4", mediaError,
    };
    return { run, device: `${result.device} (server)`, timing: { uploadMs, serverMs: result.processingMs, drawMs } };
  } finally {
    void fetch(`${API}/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
  }
}

async function drawAnnotated(result: JobKeypoints, start0: number, video: HTMLVideoElement, canvas: HTMLCanvasElement, exportMp4: boolean, onFrame: (done: number) => void) {
  const width = video.videoWidth & ~1; // H.264 needs even dimensions
  const height = video.videoHeight & ~1;
  const encoder = exportMp4 ? await createMp4Encoder(width, height, result.fps) : null;
  for (const [i, frame] of result.frames.entries()) {
    await seekVideo(video, frameSeekTime(frame.frame, result.fps, start0, video.duration));
    await annotate(canvas, video, toResults(frame, result.width, result.height));
    await encoder?.addFrame(canvas, i);
    onFrame(i + 1);
  }
  let media: Blob | null = null;
  let mediaError = exportMp4 && !encoder ? "MP4 export not supported in this browser" : null;
  if (encoder) {
    try {
      media = await encoder.finish();
    } catch (err) {
      mediaError = `MP4 export failed: ${(err as Error).message}`;
    }
  }
  return { media, mediaError, width, height };
}

/** A saved frame record back into the Results shape annotate() draws. */
export function toResults(frame: FrameRecord, width: number, height: number): Results {
  return makeResults(width, height, frame.persons.map((p) => ({
    box: p.box as [number, number, number, number],
    conf: p.conf,
    points: p.keypoints.map((k): Point => [k.x, k.y, k.conf]),
  })), frame.speed);
}

function upload(form: FormData, onProgress: (sent: number, size: number) => void): Promise<JobStatus> {
  // XMLHttpRequest, as fetch reports no upload progress.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/jobs`);
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new Error(`Server upload failed (${xhr.status}): ${errorDetail(xhr.responseText)}`));
    };
    xhr.onerror = () => reject(new Error("Server not reachable: start it with `npm run server`"));
    xhr.send(form);
  });
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Server not reachable: start it with `npm run server`");
  }
  const text = await res.text();
  // The Vite proxy answers 5xx with an empty / plain body when the server is down.
  if (!res.ok) throw new Error(res.status >= 500 && !text.startsWith("{") ? "Server not reachable: start it with `npm run server`" : `Server error ${res.status}: ${errorDetail(text)}`);
  return JSON.parse(text) as T;
}

function errorDetail(text: string): string {
  try {
    return JSON.parse(text).detail ?? text;
  } catch {
    return text || "no details";
  }
}
