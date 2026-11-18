// Downloads the weight files the app uses (RTMPose-m and its YOLO11n person detector) into public/models/.
// Usage: npm run models   (from the repository root; skips files that are already there)
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

interface WeightFile {
  file: string;      // name in public/models/
  url: string;
  zipEntry?: string; // set when the download is a zip: the file to take out of it
}

const DIR = path.resolve(import.meta.dirname, "../public/models"); // apps/web/public/models (the server reads them too)
const ULTRALYTICS = "https://github.com/ultralytics/assets/releases/download/v8.4.0";

const WEIGHTS: WeightFile[] = [
  // Person detector for RTMPose (top-down).
  { file: "yolo11n.onnx", url: `${ULTRALYTICS}/yolo11n.onnx` },
  {
    file: "rtmpose-m.onnx",
    url: "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip",
    zipEntry: "end2end.onnx",
  },
];

async function download(url: string, dest: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** Finds `name` anywhere inside a folder (zips nest their files in a subfolder). */
function findFile(dir: string, name: string): string | null {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findFile(p, name);
      if (hit) return hit;
    } else if (entry.name === name) {
      return p;
    }
  }
  return null;
}

function unzip(zipName: string, cwd: string) {
  // Windows' own tar (bsdtar) reads zip; a GNU tar earlier on PATH (e.g. Git Bash) does not.
  if (process.platform === "win32") {
    const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    execFileSync(tar, ["-xf", zipName], { cwd });
  } else {
    execFileSync("unzip", ["-q", zipName], { cwd });
  }
}

async function downloadFromZip(weight: WeightFile & { zipEntry: string }, dest: string) {
  const tmp = fs.mkdtempSync(path.join(DIR, ".tmp-"));
  try {
    await download(weight.url, path.join(tmp, "model.zip"));
    unzip("model.zip", tmp);
    const entry = findFile(tmp, weight.zipEntry);
    if (!entry) throw new Error(`${weight.zipEntry} not found in ${weight.url}`);
    fs.renameSync(entry, dest);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

fs.mkdirSync(DIR, { recursive: true });
for (const weight of WEIGHTS) {
  const dest = path.join(DIR, weight.file);
  if (fs.existsSync(dest)) {
    console.log(`✓ ${weight.file} (already there)`);
    continue;
  }
  console.log(`↓ ${weight.file} …`);
  if (weight.zipEntry) await downloadFromZip({ ...weight, zipEntry: weight.zipEntry }, dest);
  else await download(weight.url, dest);
  console.log(`✓ ${weight.file} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
}
