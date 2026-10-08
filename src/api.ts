// Client for the dev-server endpoints in server/files-plugin.ts:
// reading input videos from data/ and saving outputs to results/.
import type { OutputFile } from "./types";

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
