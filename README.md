# Human Pose Estimation in sports analysis

**Төслийг хэрхэн ажиллуулах заавар (монгол хэлээр): [HOW_TO_RUN.md](HOW_TO_RUN.md).** The thesis report: [report/thesis-final.pdf](report/thesis-final.pdf).

A monorepo (npm workspaces) with two apps:

- `apps/web`: the web app (Vite + React + TypeScript). HPE in the browser, synchronization, results, analysis pages.
- `apps/server`: an optional Python HPE server (FastAPI + ONNX Runtime, CUDA when available). It only does HPE: the
  web app uploads a video, the server returns the keypoints in the same JSON format, and stats, sync and saving
  stay in the web app. The page's *Process videos on: This browser / Server* switch picks where HPE runs.

`data/` (inputs), `results/` (outputs) and `analysis/` (Python figures) stay at the repository root and are shared.

Human pose estimation in the browser (WebGPU, CPU/wasm fallback) with **RTMPose-m** (body7, 256×192, results folder `rtmpose-m`): a top-down model with a YOLO11n person detector (OpenMMLab rtmposev1 ONNX, run with `onnxruntime-web`), 17 COCO keypoints. Its results feed the multi-person synchronization algorithm (below).

RTMPose-m was chosen after comparing six models on `poomsae-720reso.mp4`: YOLO11n-pose, YOLOv8n-pose, YOLO26n-pose, RTMPose-m, ViTPose-B and MediaPipe Pose. Their saved runs are still in `results/<model>/` (viewable on *Saved results*) and `analysis/model_comparison.py` / `(repository root)
analysis/resolution_check.py` still analyze them. The code for the other models was removed from the app; it is kept in git as `refs/backup/all-models` (`git show refs/backup/all-models:src/models/yolo.ts`).

## Run

All commands run from the repository root.

```bash
npm install
npm run models   # downloads RTMPose-m and its YOLO11n detector into apps/web/public/models/ (once; the server uses them too)
npm run dev      # web app on http://localhost:5173
npm run typecheck  # TypeScript check (also runs as part of npm run build)
```

Server (optional, for *Process videos on: Server*), in a second terminal:

```bash
npm run server:setup   # once: apps/server/.venv + requirements (onnxruntime-gpu with its CUDA/cuDNN DLLs from pip)
npm run server         # http://127.0.0.1:8000 (the web app reaches it through /server-api)
```

`HPE_DEVICE=cpu` forces the CPU, `HPE_SERVER_PORT` changes the port (then set `HPE_SERVER_URL` for `npm run dev`).
Server API: `GET /health`, `POST /jobs` (multipart: `file`, `model`, `conf`, `fps`, `frames`), `GET /jobs/{id}`,
`GET /jobs/{id}/keypoints`, `DELETE /jobs/{id}`; docs at http://127.0.0.1:8000/docs. Uploaded videos are deleted when
their job ends.

Use Chrome or Edge (WebGPU + WebCodecs). Needs internet on first load: ONNX Runtime Web for the person detector comes from cdn.pyke.io; it is then cached.

## Use

- **Inputs**: put videos/images in `data/` (subfolders OK), then pick one under *From data/ folder* (*Refresh list* after adding files). The file picker still works for one-off files.
- **Results**: with *Save results to results/rtmpose-m/* checked, every run is saved automatically to `results/rtmpose-m/` (e.g. `results/rtmpose-m/<video>-pose.json`, `-pose.csv`, `-annotated.mp4`). Re-runs get a `_run2`, `_run3`, … suffix; nothing is overwritten.
- **Video**: choose a file, set Processing FPS, click *Process video*. Every frame is processed (none dropped), and the annotated MP4 keeps the original timing. With *Process videos on: Server* the video is uploaded and processed by `apps/server` (same model files, same frames); the annotated MP4 is then drawn in the browser from the returned keypoints. The JSON `processing` block records `backend` (`browser` / `server`) and, for server runs, `uploadMs` and `serverMs`; `device` reads e.g. `cuda (server)`.
- **Image**: choose a file; results appear immediately.
- **Webcam**: live inference; on stop you get a WebM recording plus results.
- **Saved results** (header navigation): every run in `results/<model>/`, filterable by video and model (RTMPose-m by default; *All models* shows the comparison runs). Click a run to play its annotated video and see its stats, tracking chart and keypoint table, read from the saved JSON; nothing is processed again. Runs saved before synchronization existed get a *Compute synchronization* button.
- **Synchronization**: after a video run (and on Saved results), the annotated video plays with the scores of the current moment beside it (group, each pair, arms / legs / torso, lag, mirror mode) and a score timeline under it (click to seek). Every result video has a speed bar under it (0.1× to 2×) for watching movements slowly; the speed stays when another run is opened.
- **Resolution check** (header navigation): charts comparing `data/resolution-check-data/poomsae-{360,480,720}reso.mp4` across the six compared models: tracking, keypoint confidence, inference time and keypoint shift vs. 720p. The analysis is saved in `results/resolution-check/` (re-create it with `python (repository root)
analysis/resolution_check.py`, needs pandas + matplotlib, then *Reload analysis*).

## Outputs

- Annotated video (MP4/WebM) or PNG
- `*-pose.json`: model name, device, source path, `sourceVideo` (file size, SHA-256, codec, native frame count / fps / duration read from the MP4 header), `processing` (planned vs. processed frames, `completed`), timestamp, then per frame → persons → box, confidence, 17 COCO keypoints `{name, x, y, conf}`, timing
- `*-tracking.csv`: one row per frame with detected / tracked / expected people and tracking rate (expected = the most common number of people in the first 2 s, counted automatically as in the sync algorithm; runs made before this used the old *People in video* setting, default 3); summary in the JSON `tracking` block and a chart on the page
- `*-pose.csv`: one row per person per frame (wide format, `<keypoint>_x/_y/_conf`)
- `*-metrics.csv`: **one row per run** with the model-comparison metrics (also the JSON `metrics` block). Concatenate `results/*/<video>-metrics.csv` to compare all models:
  - speed: `mean_total_ms`, `std_total_ms`, `p95_total_ms`, `mean_inference_ms`, `ms_per_person`, `model_fps`, `pipeline_fps`
  - detection: `all_tracked_rate`, `mean_tracked_rate`, `mean_detected`, `missed_frame_rate`, `over_detected_rate`, `mean_person_conf`
  - tracks (box IoU frame to frame, metrics only): `track_count` (ideally = people in video), `long_track_count` (tracks covering ≥ half the frames)
  - keypoint confidence (compare within a model only): `mean_keypoint_conf`, `visible_rate` (≥ 0.5), `low_conf_rate` (< 0.3)
  - stability (lower is better): `jitter_pct` / `jitter_median_pct` = keypoint acceleration between consecutive frames as % of the person's box height; `limb_cv_pct` = coefficient of variation of the 8 limb lengths within a track, plus `limb_cv_pct_<limb>` per limb
- `*-keypoint-metrics.csv`: one row per keypoint (`mean_conf`, `visible_rate`, `low_conf_rate`, `jitter_pct`, `jitter_median_pct`), same leading model/source columns
- `*-sync.json`: synchronization of the people in the video (group score, per person S_i, per pair score / components / lag / body parts, the timeline, every window, and the settings used)
- `*-sync-frames.csv` (algorithm v2): one row per frame, matched to the video by `time_s`: `group`, `person_<i>` (S_i), and per pair `pair_<a>_<b>_score`, `_lag_ms` (+ = the second person moves later), `_rho_max`, `_mode` (normal / mirror), `_arms`, `_legs`, `_torso`
- `*-sync-windows.csv`: one row per pair per window (v2: one window per frame, centred on it): `score` (0-100), `pose`, `corr`, `lag_score` (0-1), `lag_frames`, `lag_sec` (+ = the second person moves later), `rho_max`, `mode` (normal / mirror), `arms`, `legs`, `torso`
- `*-angles.csv`: one row per person per frame: the 8 joint angles (degrees) after preprocessing; person 1..N = left to right

### Synchronization from the command line

`npm run sync -- results/rtmpose-m/clip-pose.json [more…] [--out dir] [--set key=value …]` runs the same algorithm in Node (for experiments and tuning). Without `--out` the sync files go next to the pose JSON; with `--out` to `<dir>/<model>/`. Existing files are never overwritten. `--set` changes a setting (see `SyncConfig` in `src/sync/types.ts`), e.g. `--set windowSec=4 --set smooth=false --set weights=0.5,0.25,0.25`. `--set jointWeightPreset=ballet` (general 50/25/25, ballet 20/60/20, hand-dance 60/20/20 for arms/legs/torso) or `--set partWeights=40,40,20` picks the joint weights α_k. `--late 0.3` lists out-of-sync moments only where someone is at least 0.3 s late (default 0.2 s, minimum 0.12 s; the same as the *Late from* slider on the page).
- Comparing models: the JSON also records `modelLabel`, `modelFamily`, `pipeline`, `detector` and `keypointConfidence`. Timing for top-down models includes the person detector. Keypoint confidence means something different per model (see `keypointConfidence`), so compare it within a model rather than across models.
- On-page stats: device, avg inference ms, model vs. pipeline FPS, per-keypoint mean confidence and visibility

## Files

```
package.json                workspaces + the commands above
apps/server/                Python HPE server
  run.mjs                   `npm run server` / `npm run server:setup` (venv in apps/server/.venv)
  requirements.txt
  hpe_server/main.py        FastAPI endpoints (health, jobs)
  hpe_server/jobs.py        job queue: one worker thread, every frame, upload deleted afterwards
  hpe_server/models.py      model registry (same ids/files as the web app)
  hpe_server/pipeline.py    YOLO11n letterbox + NMS → crop → RTMPose → SimCC, a port of src/models/topdown.ts
apps/web/                   web app; paths below are inside it
src/                        (TypeScript + React, UI built with Mantine)
  main.tsx                  entry: Mantine provider + the one AppController
  App.tsx                   page layout (header, controls, stage, results)
  types.ts                  shared types; also the saved data formats
  keypoints.ts              the 17 COCO keypoint names (shared order for all models)
  api.ts                    talks to the dev server: list/load data/, save to and read from results/
  analysis/resolution-check.ts  loads results/resolution-check/*.csv for the Resolution check page
  app/
    controller.ts           AppController: app state + steps (load model → open input → process → save)
    AppContext.tsx          gives components the controller and its state
  components/               React UI: AppHeader, ControlPanel, Stage, ResultsPanel,
                            StatGrid, KeypointTable, TrackingSection, TrackingChart,
                            SavedResultsPage, ResolutionCheckPage, GroupedBarChart, KeypointHeatmap,
                            SyncPanel (live scores beside the video + summary), SyncTimeline,
                            PlaybackVideo (video + playback speed bar, Settings.playbackSpeed)
  models/
    index.ts                the model, RTMPose-m (id = results folder, weights file, metadata)
    topdown.ts              person detector → crop → RTMPose → SimCC decode
    common.ts               shared Results shape, ONNX session (WebGPU → CPU fallback)
  processing/               video.ts, image.ts, webcam.ts, mp4-encoder.ts, server.ts (upload to the HPE server,
                            poll, fetch keypoints, draw the annotated video) (no UI code)
  sync/                     synchronization algorithm (report 3.3-3.6), no app/DOM imports, .ts imports so
                            Node can run it: assign.ts, preprocess.ts, angles.ts, score.ts, index.ts, files.ts,
                            episodes.ts (out-of-sync moments)
  results/                  records.ts, tracking.ts, metrics.ts, output-files.ts (builds the saved files),
                            saved-run.ts (rebuilds stats from a saved JSON)
dev-server/files-plugin.ts  Vite middleware: serves data/, writes results/ (both at the repository root)
scripts/download-models.ts  `npm run models`
scripts/sync.ts             `npm run sync -- <pose.json>…`: the sync algorithm in Node, for experiments
scripts/sync-delay-test.ts  `npm run sync-delay-test -- <pose.json>`: delays one person's body / limb, checks the out-of-sync moments → results/sync-delay-test/
scripts/lag-confidence-test.ts  `npm run lag-confidence-test -- <runA> <runB>`: S_lag variants around ρmin, stability + discrimination → results/lag-confidence-test/
(repository root)
analysis/resolution_check.py  360p/480p/720p comparison → results/resolution-check/ (CSVs + PNG figures)
analysis/model_comparison.py  all-model comparison on poomsae-720reso (skips models without a run) → results/model-comparison/ (CSVs + PNG figures)
```

Model weights live in `apps/web/public/models/` (`npm run models`); not in git (`yolo11n-pose.onnx` there is left over from the model comparison and no longer used). `index.html` only mounts the React app; styling comes from Mantine (plus a few rules in `src/styles.css`).
