// Rebuilds the on-page analysis of a run from its saved JSON, so saved results can be viewed
// without processing the video again. Stats come from the saved frames; the saved `metrics`
// block wins when present (it has the measured pipeline FPS, which the frames don't record).
import type { Run, RunAnalysis, SavedRunJson } from "../types";
import { analyzeRun } from "./output-files";

export interface SavedRunAnalysis {
  analysis: RunAnalysis;
  /** false for runs saved before the metrics block existed (metrics recomputed from frames) */
  metricsSaved: boolean;
}

export function analyzeSavedRun(json: SavedRunJson): SavedRunAnalysis {
  const run: Run = {
    frames: json.frames,
    width: json.width,
    height: json.height,
    fps: json.fps,
    conf: json.confThreshold,
    wallMs: 0, // not saved
    media: null,
    mediaName: "",
  };
  const analysis = analyzeRun(run, json.tracking?.expectedPersons ?? 3);
  if (json.metrics) analysis.metrics = json.metrics;
  return { analysis, metricsSaved: Boolean(json.metrics) };
}
