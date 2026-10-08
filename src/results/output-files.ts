// Turns a finished run into the stats shown on the page and the files that get saved:
//   <video>-pose.json      everything: model info, summary, tracking, every frame
//   <video>-pose.csv       one row per person per frame
//   <video>-tracking.csv   one row per frame (people found vs. expected)
//   <video>-annotated.mp4  (or .png / .webm) the drawn video, if one was made
import { KEYPOINT_NAMES } from "../keypoints";
import type { FrameRecord, ModelSpec, OutputFile, OutputFiles, Run, RunAnalysis, Source } from "../types";
import { keypointStats, summarizeFrames } from "./records";
import { trackingCsv, trackingRows, trackingSummary } from "./tracking";

/** A run plus what produced it: needed for the JSON metadata. */
export interface RunContext {
  run: Run;
  spec: ModelSpec;
  device: string;
  source: Source | null;
}

export function analyzeRun(frames: FrameRecord[], expectedPersons: number): RunAnalysis {
  const rows = trackingRows(frames, expectedPersons);
  return {
    summary: summarizeFrames(frames),
    perKeypoint: keypointStats(frames),
    trackingRows: rows,
    tracking: trackingSummary(rows, expectedPersons),
  };
}

export function buildOutputFiles(context: RunContext, analysis: RunAnalysis): OutputFiles {
  const { run } = context;
  const json = JSON.stringify(buildResultJson(context, analysis), null, 1);
  const files: OutputFile[] = [
    { kind: "json", suffix: "-pose.json", blob: new Blob([json], { type: "application/json" }) },
    { kind: "poseCsv", suffix: "-pose.csv", blob: new Blob([poseCsv(run.frames)], { type: "text/csv" }) },
    { kind: "trackingCsv", suffix: "-tracking.csv", blob: new Blob([trackingCsv(analysis.trackingRows)], { type: "text/csv" }) },
  ];
  if (run.media) files.push({ kind: "media", suffix: `-${run.mediaName}`, blob: run.media });
  return { baseName: fileBaseName(context.source?.name ?? "webcam"), files };
}

// Field order and names are the saved format; add new fields, don't rename existing ones.
function buildResultJson({ run, spec, device, source }: RunContext, analysis: RunAnalysis) {
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
    createdAt: new Date().toISOString(),
    width: run.width,
    height: run.height,
    fps: run.fps,
    confThreshold: run.conf,
    keypointNames: KEYPOINT_NAMES,
    summary: analysis.summary,
    tracking: analysis.tracking,
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
