// Types shared across the app. The data shapes here (FrameRecord, TrackingSummary, …)
// are also the saved file formats, so change them only by adding fields.
import type { Results, Speed } from "@ultralytics/yolo";
import type { SyncAnalysis } from "./sync/index.ts";

export type { Results, Speed };

// ---------- models ----------

/** Anything the app passes to a model: a video element (current frame), an image file, or raw pixels. */
export type PoseInput = HTMLVideoElement | Blob | ImageData;

/** A loaded model. predict() always returns 17 COCO keypoints per person. */
export interface PoseModel {
  device: string;
  predict(input: PoseInput, options: { conf: number }): Promise<Results>;
}

export interface ModelSpec {
  /** Also the results folder: results/<id>/ */
  id: string;
  label: string;
  family: string;
  /** Weights file in public/models/ */
  file: string;
  /** How people are found: single-stage, or top-down (detector first, then pose per person) */
  pipeline: string;
  detector: string | null;
  /** What a keypoint's `conf` means for this model (differs per model!) */
  keypointConf: string;
  load(): Promise<PoseModel>;
}

/** One keypoint in model output: [x, y, conf] in image pixels. */
export type Point = [x: number, y: number, conf: number];

// ---------- inputs ----------

export type SourceKind = "video" | "image" | "webcam";

export interface Source {
  kind: SourceKind;
  name: string;
  /** Location inside the project when the input came from data/, e.g. "data/clip1.mp4" */
  path: string | null;
  /** Facts about the file (null for the webcam) */
  info: VideoInfo | null;
}

/** The JSON `sourceVideo` block: the exact input file. Video fields are null when unknown (e.g. not MP4). */
export interface VideoInfo {
  fileName: string;
  fileSize: number;
  /** Same hash = same file, so runs of different models can be checked to share one input */
  sha256: string;
  lastModified: string | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  /** Native frame count from the container */
  frameCount: number | null;
  /** Native frame rate (frameCount / duration) */
  fps: number | null;
  variableFrameRate: boolean | null;
}

/** The JSON `processing` block: how much of the input was processed. */
export interface ProcessingInfo {
  /** Frames the run would have with no stop: the header's frame count at the native rate, else floor(duration × processing fps) */
  plannedFrames: number | null;
  processedFrames: number;
  /** false if the run was stopped early */
  completed: boolean;
  /** Where HPE ran; absent in runs saved before the server existed (they all ran in the browser) */
  backend?: "browser" | "server";
  /** Server runs: upload time and the server's own processing time (ms); wall time = upload + server + waiting */
  uploadMs?: number;
  serverMs?: number;
}

// ---------- saved records ----------

export interface KeypointRecord {
  name: string;
  x: number;
  y: number;
  conf: number;
}

export interface PersonRecord {
  box: [x1: number, y1: number, x2: number, y2: number];
  conf: number;
  keypoints: KeypointRecord[];
}

export interface FrameRecord {
  frame: number;
  /** Seconds from the start of the video */
  time: number;
  persons: PersonRecord[];
  speed: Speed;
}

/** A finished run over a video, image or webcam session. */
export interface Run {
  frames: FrameRecord[];
  width: number;
  height: number;
  /** Processing FPS for videos; null for images and webcam */
  fps: number | null;
  conf: number;
  wallMs: number;
  /** Frames a full video run has (null for images and webcam) */
  plannedFrames?: number | null;
  /** Annotated video/image, if one was made */
  media: Blob | null;
  mediaName: string;
  mediaError?: string | null;
  /** Where HPE ran (videos); saved in the JSON `processing` block. Absent for images and webcam (browser). */
  backend?: RunBackend;
}

/** Browser: the model ran in this browser. Server: on the HPE server (apps/server), with its timing (ms). */
export type RunBackend =
  | { kind: "browser" }
  | { kind: "server"; uploadMs: number; serverMs: number; drawMs: number };

// ---------- analysis ----------

export interface KeypointStat {
  name: string;
  meanConf: number;
  /** Share of detections with conf ≥ 0.5 */
  visibleRate: number;
}

/** The JSON `summary` block (short names are part of the saved format). */
export interface FrameSummary {
  n: number;          // frames
  withPerson: number; // frames with ≥1 person
  persons: number;    // total detections
  pre: number;        // mean preprocess ms
  inf: number;        // mean inference ms
  post: number;       // mean postprocess ms
}

export interface TrackingRow {
  frame: number;
  time: number;
  detected: number;
  /** min(detected, expected) */
  tracked: number;
  expected: number;
  /** tracked / expected */
  rate: number;
}

/** The JSON `tracking` block. */
export interface TrackingSummary {
  expectedPersons: number;
  framesAllTracked: number;
  allTrackedRate: number;
  meanTracked: number;
  meanTrackedRate: number;
  framesOverDetected: number;
  /** trackedHistogram[k] = number of frames with exactly k people tracked */
  trackedHistogram: number[];
}

export interface KeypointMetric {
  name: string;
  meanConf: number;
  /** Share with conf ≥ 0.5 */
  visibleRate: number;
  /** Share with conf < 0.3 */
  lowConfRate: number;
  /** Mean frame-to-frame acceleration, % of the person's box height */
  jitterPct: number;
  jitterMedianPct: number;
}

export interface LimbMetric {
  name: string;
  /** Coefficient of variation of the limb's length within a track, %, averaged over tracks */
  cvPct: number;
  /** Measurements used (0 = no track long enough) */
  samples: number;
}

/** The JSON `metrics` block (also `<video>-metrics.csv`): what the model comparison uses. */
export interface RunMetrics {
  // speed (ms per frame)
  meanTotalMs: number;
  stdTotalMs: number;
  p95TotalMs: number;
  meanInferenceMs: number;
  /** Mean total ms divided by mean people per frame (top-down models scale with people) */
  msPerPerson: number;
  /** 1000 / meanTotalMs */
  modelFps: number;
  /** Frames / wall-clock seconds, including seeking, drawing and encoding */
  pipelineFps: number;
  // detection
  meanDetected: number;
  /** Share of frames with fewer people than expected */
  missedFrameRate: number;
  /** Share of frames with more people than expected (false positives) */
  overDetectedRate: number;
  meanPersonConf: number;
  // tracks (box IoU between frames; ideally trackCount = people in video)
  trackCount: number;
  /** Tracks covering at least half of the frames */
  longTrackCount: number;
  // keypoint confidence (meaning differs per model: compare within a model only)
  meanKeypointConf: number;
  visibleRate: number;
  lowConfRate: number;
  // stability / anatomy (lower is better)
  jitterPct: number;
  jitterMedianPct: number;
  limbCvPct: number;
  perKeypoint: KeypointMetric[];
  perLimb: LimbMetric[];
}

export interface RunAnalysis {
  summary: FrameSummary;
  perKeypoint: KeypointStat[];
  trackingRows: TrackingRow[];
  tracking: TrackingSummary;
  metrics: RunMetrics;
  /** Synchronization (src/sync/), for video runs; null for images and when not computed */
  sync: SyncAnalysis | null;
}

// ---------- saved runs (read back from results/) ----------

/** The saved `<stem>-pose.json`. Older runs lack the newer blocks, so those are optional. */
export interface SavedRunJson {
  model: string;
  modelName: string;
  modelLabel?: string;
  modelFamily?: string;
  pipeline?: string;
  detector?: string | null;
  keypointConfidence?: string;
  device: string;
  source: string;
  sourcePath: string | null;
  sourceVideo?: VideoInfo | null;
  processing?: ProcessingInfo;
  createdAt: string;
  width: number;
  height: number;
  fps: number | null;
  confThreshold: number;
  summary: FrameSummary;
  tracking?: TrackingSummary;
  metrics?: RunMetrics;
  frames: FrameRecord[];
}

/** One entry of GET /api/results: the JSON without its frames, plus where the run's files are. */
export interface SavedRunSummary extends Omit<SavedRunJson, "model" | "frames"> {
  /** Results folder (= model id) */
  model: string;
  /** Weights file */
  weights: string;
  /** File stem, e.g. "poomsae-720reso_run2" */
  stem: string;
  frameCount: number;
  /** suffix ("-pose.json", "-annotated.mp4", …) → path under results/ */
  files: Record<string, string>;
}

// ---------- output files ----------

export type OutputKind =
  | "json" | "poseCsv" | "trackingCsv" | "metricsCsv" | "keypointMetricsCsv"
  | "syncJson" | "syncWindowsCsv" | "syncFramesCsv" | "anglesCsv" | "media";

export interface OutputFile {
  kind: OutputKind;
  /** Appended to the base name, e.g. "-pose.json" */
  suffix: string;
  blob: Blob;
}

export interface OutputFiles {
  /** File-safe name of the input, e.g. "my_clip" */
  baseName: string;
  files: OutputFile[];
}
