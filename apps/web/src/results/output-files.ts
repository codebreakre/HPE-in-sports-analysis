// Turns a finished run into the stats shown on the page and the files that get saved:
//   <video>-pose.json      everything: model info, summary, tracking, every frame
//   <video>-pose.csv       one row per person per frame
//   <video>-tracking.csv   one row per frame (people found vs. expected)
//   <video>-metrics.csv    one row: model comparison metrics (speed, detection, stability, …)
//   <video>-keypoint-metrics.csv  one row per keypoint: confidence and jitter
//   <video>-sync.json, -sync-windows.csv, -sync-frames.csv, -angles.csv  synchronization (src/sync/), video runs only
//   <video>-annotated.mp4  (or .png / .webm) the drawn video, if one was made
import { KEYPOINT_NAMES } from "../keypoints";
import type { FrameRecord, ModelSpec, OutputFile, OutputFiles, ProcessingInfo, Run, RunAnalysis, Source } from "../types";
import { analyzeSync } from "../sync/index.ts";
import { syncFiles } from "../sync/files.ts";
import { computeMetrics, keypointMetricsCsv, metricsCsv } from "./metrics";
import { keypointStats, summarizeFrames } from "./records";
import { trackingCsv, trackingRows, trackingSummary } from "./tracking";

/** A run plus what produced it: needed for the JSON metadata. */
export interface RunContext {
  run: Run;
  spec: ModelSpec;
  device: string;
  source: Source | null;
}

/** `withSync`: also run the synchronization algorithm (videos; needs a frame rate and 2+ frames). */
export function analyzeRun(run: Run, expectedPersons: number, withSync = false): RunAnalysis {
  const { frames } = run;
  const canSync = withSync && run.fps !== null && frames.length > 1;
  const rows = trackingRows(frames, expectedPersons);
  return {
    summary: summarizeFrames(frames),
    perKeypoint: keypointStats(frames),
    trackingRows: rows,
    tracking: trackingSummary(rows, expectedPersons),
    metrics: computeMetrics(run, expectedPersons),
    sync: canSync ? analyzeSync(frames, run.fps!) : null,
  };
}

export function buildOutputFiles(context: RunContext, analysis: RunAnalysis): OutputFiles {
  const { run } = context;
  const createdAt = new Date().toISOString();
  const json = JSON.stringify(buildResultJson(context, analysis, createdAt), null, 1);
  const meta = metricsMeta(context, analysis, createdAt);
  const csvBlob = (text: string) => new Blob([text], { type: "text/csv" });
  const files: OutputFile[] = [
    { kind: "json", suffix: "-pose.json", blob: new Blob([json], { type: "application/json" }) },
    { kind: "poseCsv", suffix: "-pose.csv", blob: csvBlob(poseCsv(run.frames)) },
    { kind: "trackingCsv", suffix: "-tracking.csv", blob: csvBlob(trackingCsv(analysis.trackingRows)) },
    { kind: "metricsCsv", suffix: "-metrics.csv", blob: csvBlob(metricsCsv(meta, analysis.metrics)) },
    { kind: "keypointMetricsCsv", suffix: "-keypoint-metrics.csv", blob: csvBlob(keypointMetricsCsv(meta, analysis.metrics)) },
  ];
  if (analysis.sync) {
    const kinds = { "-sync.json": "syncJson", "-sync-windows.csv": "syncWindowsCsv", "-sync-frames.csv": "syncFramesCsv", "-angles.csv": "anglesCsv" } as const;
    const { spec, source } = context;
    for (const f of syncFiles(analysis.sync, run.frames, {
      model: spec.id, modelLabel: spec.label, source: source?.name ?? "webcam", sourcePath: source?.path ?? null,
    })) {
      files.push({ kind: kinds[f.suffix], suffix: f.suffix, blob: new Blob([f.text], { type: f.type }) });
    }
  }
  if (run.media) files.push({ kind: "media", suffix: `-${run.mediaName}`, blob: run.media });
  return { baseName: fileBaseName(context.source?.name ?? "webcam"), files };
}

function processingInfo(run: Run): ProcessingInfo {
  const planned = run.plannedFrames ?? null;
  const info: ProcessingInfo = { plannedFrames: planned, processedFrames: run.frames.length, completed: planned === null || run.frames.length >= planned };
  if (run.backend) info.backend = run.backend.kind;
  if (run.backend?.kind === "server") {
    info.uploadMs = Math.round(run.backend.uploadMs);
    info.serverMs = Math.round(run.backend.serverMs);
  }
  return info;
}

/** Leading columns of the metrics CSVs: what produced the run, so files from all models can be concatenated. */
function metricsMeta({ run, spec, device, source }: RunContext, analysis: RunAnalysis, createdAt: string) {
  const info = source?.info;
  const processing = processingInfo(run);
  return {
    model: spec.id,
    model_label: spec.label,
    model_family: spec.family,
    pipeline: spec.pipeline,
    detector: spec.detector,
    device,
    source: source?.name ?? "webcam",
    source_path: source?.path ?? null,
    source_sha256: info?.sha256 ?? null,
    source_size_bytes: info?.fileSize ?? null,
    source_codec: info?.codec ?? null,
    source_duration_sec: info?.durationSec ?? null,
    source_frames: info?.frameCount ?? null,
    source_fps: info?.fps ?? null,
    created_at: createdAt,
    width: run.width,
    height: run.height,
    fps: run.fps,
    conf_threshold: run.conf,
    frames: analysis.summary.n,
    planned_frames: processing.plannedFrames,
    completed: processing.completed,
    expected_persons: analysis.tracking.expectedPersons,
    all_tracked_rate: analysis.tracking.allTrackedRate,
    mean_tracked_rate: analysis.tracking.meanTrackedRate,
  };
}

// Field order and names are the saved format; add new fields, don't rename existing ones.
function buildResultJson({ run, spec, device, source }: RunContext, analysis: RunAnalysis, createdAt: string) {
  return {
    model: spec.file,
    modelName: spec.id,
    modelLabel: spec.label,
    modelFamily: spec.family,
    pipeline: spec.pipeline,
    detector: spec.detector,
    keypointConfidence: spec.keypointConf,
    device,
    source: source?.name ?? "webcam",
    sourcePath: source?.path ?? null,
    sourceVideo: source?.info ?? null,
    processing: processingInfo(run),
    createdAt,
    width: run.width,
    height: run.height,
    fps: run.fps,
    confThreshold: run.conf,
    keypointNames: KEYPOINT_NAMES,
    summary: analysis.summary,
    tracking: analysis.tracking,
    metrics: analysis.metrics,
    frames: run.frames,
  };
}

/** The `<video>-pose.csv` file: wide format, `<keypoint>_x/_y/_conf` columns. */
function poseCsv(frames: FrameRecord[]): string {
  const header = ["frame", "time", "person", "person_conf", "x1", "y1", "x2", "y2",
    ...KEYPOINT_NAMES.flatMap((name) => [`${name}_x`, `${name}_y`, `${name}_conf`])];
  const lines = [header.join(",")];
  for (const frame of frames) {
    frame.persons.forEach((p, i) => {
      lines.push([frame.frame, frame.time, i, p.conf, ...p.box, ...p.keypoints.flatMap((k) => [k.x, k.y, k.conf])].join(","));
    });
  }
  return lines.join("\n");
}

/** "my clip.mp4" → "my_clip" (safe as a file name on every OS). */
function fileBaseName(sourceName: string): string {
  return sourceName.replace(/\.[^.]+$/, "").replace(/[^\w.\-]/g, "_");
}
