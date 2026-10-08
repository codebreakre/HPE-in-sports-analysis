// Types shared across the app. The data shapes here (FrameRecord, TrackingSummary, …)
// are also the saved file formats, so change them only by adding fields.
import type { Results, Speed } from "@ultralytics/yolo";

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
  /** Annotated video/image, if one was made */
  media: Blob | null;
  mediaName: string;
  mediaError?: string | null;
}

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

export interface RunAnalysis {
  summary: FrameSummary;
  perKeypoint: KeypointStat[];
  trackingRows: TrackingRow[];
  tracking: TrackingSummary;
}

// ---------- output files ----------

export type OutputKind = "json" | "poseCsv" | "trackingCsv" | "media";

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
