// Loads the resolution-check analysis (made by analysis/resolution_check.py) from
// results/resolution-check/: how 360p / 480p / 720p versions of one video compare per model.
import { loadResultsText } from "../api";

export const RESOLUTION_CHECK_DIR = "resolution-check";

/** One row of resolution_summary.csv: one model at one resolution. */
export interface ResolutionRow {
  model: string;
  label: string;
  resolution: number;
  width: number;
  height: number;
  frames: number;
  device: string;
  all_tracked_pct: number;
  mean_tracked: number;
  frames_over_detected: number;
  mean_kp_conf: number;
  visible_kp_pct: number;
  inference_ms: number;
  total_ms: number;
  runs_count: number;
  inference_ms_min: number;
  inference_ms_max: number;
  /** The agreement columns are NaN for the 720p reference itself */
  matched_rate: number;
  mean_error_pct_box: number;
  median_error_pct_box: number;
  pck05_vs_720: number;
}

/** One row of keypoint_error.csv: shift of one keypoint vs. the 720p result. */
export interface KeypointErrorRow {
  model: string;
  label: string;
  resolution: number;
  keypoint: string;
  mean_error_pct_box: number;
  pck05_vs_720: number;
}

export interface ResolutionCheck {
  rows: ResolutionRow[];
  keypoints: KeypointErrorRow[];
  /** Ordered lists for charts: models in file order, resolutions ascending */
  models: { id: string; label: string }[];
  resolutions: number[];
  reference: number;
}

export async function loadResolutionCheck(): Promise<ResolutionCheck> {
  const [summary, keypointCsv] = await Promise.all([
    loadResultsText(`${RESOLUTION_CHECK_DIR}/resolution_summary.csv`),
    loadResultsText(`${RESOLUTION_CHECK_DIR}/keypoint_error.csv`),
  ]);
  const rows = parseCsv(summary) as unknown as ResolutionRow[];
  const keypoints = parseCsv(keypointCsv) as unknown as KeypointErrorRow[];
  const models = [...new Map(rows.map((r) => [r.model, { id: r.model, label: r.label }])).values()];
  const resolutions = [...new Set(rows.map((r) => r.resolution))].sort((a, b) => a - b);
  return { rows, keypoints, models, resolutions, reference: Math.max(...resolutions) };
}

/** Simple CSV (no quoted fields, as written by pandas here). Numeric-looking cells become numbers; empty → NaN. */
function parseCsv(text: string): Record<string, string | number>[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = header.split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(columns.map((col, i) => {
      const cell = cells[i] ?? "";
      if (cell === "") return [col, NaN];
      const n = Number(cell);
      return [col, Number.isNaN(n) ? cell : n];
    }));
  });
}
