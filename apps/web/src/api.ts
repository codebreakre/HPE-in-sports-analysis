// Client for the dev-server endpoints in server/files-plugin.ts:
// reading input videos from data/ and saving outputs to results/.
import type { OutputFile, SavedRunJson, SavedRunSummary } from "./types";
import type { Angles, SyncResult } from "./sync/index.ts";
import { parseAnglesCsv } from "./sync/files.ts";

/** Paths of all videos/images under data/, e.g. ["clip1.mp4", "aist/clip2.mp4"]. */
export async function listDataFiles(): Promise<string[]> {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error(`Cannot list data/ (${res.status})`);
  const body: { files: string[] } = await res.json();
  return body.files;
}

/** Loads one file from data/ as a File object. */
export async function loadDataFile(path: string): Promise<File> {
  const res = await fetch(`/data/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (!res.ok) throw new Error(`Cannot load ${path} (${res.status})`);
  const blob = await res.blob();
  return new File([blob], path.split("/").pop()!, { type: blob.type });
}

/** Reads one text file from results/, e.g. "resolution-check/resolution_summary.csv". */
export async function loadResultsText(path: string): Promise<string> {
  const res = await fetch(`/results/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (res.status === 404) throw new Error(`results/${path} not found`);
  if (!res.ok) throw new Error(`Cannot load results/${path} (${res.status})`);
  return res.text();
}

/** Every run saved under results/<model>/, without frame data. */
export async function listSavedRuns(): Promise<SavedRunSummary[]> {
  const res = await fetch("/api/results");
  if (!res.ok) throw new Error(`Cannot list results/ (${res.status})`);
  const body: { runs: SavedRunSummary[] } = await res.json();
  return body.runs;
}

/** URL of a saved file, from a path under results/ (as in SavedRunSummary.files). */
export const resultsUrl = (path: string) => `/results/${path.split("/").map(encodeURIComponent).join("/")}`;

/** The full saved JSON of one run, frames included. */
export async function loadSavedRun(run: SavedRunSummary): Promise<SavedRunJson> {
  const path = run.files["-pose.json"];
  const res = await fetch(resultsUrl(path));
  if (!res.ok) throw new Error(`Cannot load results/${path} (${res.status})`);
  return res.json();
}

/** A saved run's -sync.json. */
export async function loadSavedSync(run: SavedRunSummary): Promise<SyncResult> {
  const path = run.files["-sync.json"];
  const res = await fetch(resultsUrl(path));
  if (!res.ok) throw new Error(`Cannot load results/${path} (${res.status})`);
  return res.json();
}

/** A saved run's -angles.csv as angles[person][joint][frame]. */
export async function loadSavedAngles(run: SavedRunSummary): Promise<Angles> {
  const path = run.files["-angles.csv"];
  const res = await fetch(resultsUrl(path));
  if (!res.ok) throw new Error(`Cannot load results/${path} (${res.status})`);
  return parseAnglesCsv(await res.text());
}

/** Adds files to an already saved run (results/<model>/<stem><suffix>); fails if one already exists. */
export async function saveRunFiles(modelId: string, stem: string, files: { suffix: string; blob: Blob }[]): Promise<void> {
  for (const { suffix, blob } of files) {
    const res = await fetch(`/api/results/${modelId}/${encodeURIComponent(stem + suffix)}`, { method: "PUT", body: blob });
    if (!res.ok) throw new Error((await res.json()).error);
  }
}

/**
 * Writes one run's files into results/<modelId>/ as `<baseName><suffix>`.
 * Never overwrites: a repeated run of the same video gets a "_run2", "_run3", … name.
 * @returns where the files went, e.g. "results/yolo11n-pose/clip1-*"
 */
export async function saveResults(modelId: string, baseName: string, files: OutputFile[]): Promise<string> {
  const reserve = await fetch("/api/results/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelId, base: baseName }),
  });
  if (!reserve.ok) throw new Error((await reserve.json()).error);
  const { stem, dir }: { stem: string; dir: string } = await reserve.json();

  for (const { suffix, blob } of files) {
    const res = await fetch(`/api/results/${modelId}/${encodeURIComponent(stem + suffix)}`, { method: "PUT", body: blob });
    if (!res.ok) throw new Error((await res.json()).error);
  }
  return `${dir}/${stem}-*`;
}
