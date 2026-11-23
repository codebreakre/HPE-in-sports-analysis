# CLAUDE.md

## Project purpose

This is my bachelor's thesis project: **"Human pose estimation in sports analytics"**.

- I add sports/dance videos (e.g. from AIST Dance DB), run them through HPE models, and save the results.
- **The saved results are the core deliverable.** I will use them to build diagrams and statistics comparing models (e.g. which model tracks best, keypoint confidence/visibility, inference speed, synchronization scores).
- I will try **many HPE models**, not only YOLO11n-pose. Every model must produce results in the same, comparable format so they can be analyzed side by side.

## Model: RTMPose-m (the comparison is done)

The app runs only **RTMPose-m** (`rtmpose-m`, top-down, YOLO11n `yolo11n.onnx` person detector; `src/models/index.ts` exports `MODEL`). The user chose it after comparing six models on poomsae-720reso: YOLO11 (`yolo11n-pose`), YOLOv8 (`yolov8n-pose`), YOLO26 (`yolo26n-pose`), RTMPose (`rtmpose-m`), ViTPose (`vitpose-b`), MediaPipe (`mediapipe-pose-full`). Their saved runs stay in `results/<id>/` (report data: keep them, Saved results still shows them, `analysis/model_comparison.py` and `analysis/resolution_check.py` still read them). The other models' code was removed from the app on 2026-11-08; the last version with all six is the git ref `refs/backup/all-models` (a snapshot of the uncommitted working tree, e.g. `git show refs/backup/all-models:src/models/yolo.ts`).

- Keypoint `conf` for RTMPose is the SimCC peak, min(x, y) (≈0–1, not a probability; recorded in the JSON as `keypointConfidence`). In the comparison runs it meant something different per model.
- Weights: `npm run models` → `apps/web/public/models/` (the server reads them from there too) (RTMPose-m + YOLO11n; not in git, too large). `apps/web/public/models/yolo11n-pose.onnx` is tracked but no longer used.

## Folder layout

Monorepo (npm workspaces, since 2026-11-19): `apps/web` is the web app (everything that used to be at the root: src/, public/, scripts/, vite config; the dev-server plugin is now `apps/web/dev-server/files-plugin.ts`), `apps/server` is the Python HPE server (FastAPI + onnxruntime-gpu, venv in `apps/server/.venv`). Commands run from the root: `npm run dev`, `typecheck`, `models`, `sync`, `sync-delay-test`, `server:setup`, `server`. `data/`, `results/`, `analysis/` stay at the root. Paths like `src/...` below are inside `apps/web/`.

**Browser / server processing:** the page's *Process videos on* switch (`Settings.backend`). Server mode uploads the open video to `apps/server` through the Vite proxy `/server-api` (`src/processing/server.ts`); the server runs the same ONNX files with a Python port of the pipeline (`apps/server/hpe_server/pipeline.py`: letterbox 640 / grey 114, NMS IoU 0.7, crop like canvas drawImage, SimCC) and returns frames in the browser's FrameRecord format; the browser then draws the annotated MP4 and does stats, sync and saving as usual. Keep the two pipelines in step: a change to `src/models/topdown.ts` needs the same change in `pipeline.py`. Server runs save `device` = "<cuda|cpu> (server)" and JSON `processing.backend/uploadMs/serverMs` (new optional fields; older runs have none and ran in the browser). Server-side differences come from video decoding (OpenCV vs. the browser) and resampling; the browser-vs-server comparison is task T4.

**Frame-exact video processing (2026-11-19):** frame i is the video's i-th frame. The browser seeks to the middle of the frame, first-frame timestamp + (i + 0.5) / fps (`frameSeekTime`, `firstFrameTime` in `src/processing/video.ts`); the saved `time` stays i / fps, and at the native rate the planned frame count is the header's frame count. Runs before this sought to i / fps exactly, which Chrome resolves to the previous frame at the boundary: 30 fps videos (e.g. latency-*) came out as frames 0 1 1 3 4 4 … (a third repeated, a third skipped), and poomsae-720reso (first frame at 0.04 s) one frame late with 858 instead of 856 frames. Those older runs are still valid for comparing people within a run, but their jitter and lag numbers are affected; re-run them for the report. First check on poomsae-720reso (RTMPose-m): browser run6 (webgpu, 114 ms/frame) vs. server run5 (CUDA, 51 ms/frame): keypoints differ by median 0.6 px (0.29 % of box height), same person count in 98.6 % of frames; sync v2 group 82.6 vs 81.4. The sync gap comes from S_lag: a window's ρmax near ρmin = 0.3 flips S_lag between ≈0.9 and 0 (477 of 2568 windows got a different lag), so S_lag is the score's most fragile part. `SyncConfig.lagConfidence` (default still "hard") adds "ramp" (S_lag × clamp((ρmax − (ρmin − w/2)) / w, 0, 1), w = `lagRampWidth`) and "drop" (S_lag left out below ρmin); `npm run lag-confidence-test -- <runA> <runB>` compares them → `results/lag-confidence-test/`. On run5 vs run6: hard gap 1.21 (per-frame p95 10.8), ramp 0.2 gap 0.39 (p95 5.1) with the same ordering in step > 0.12-0.8 s delays > different motion (83.4 / 78.2 / 74.1 / 66.1 / 54.0 / 48.7); drop is the most stable but scores different motion (66-68) above a 0.8 s delay (63), so it is unusable. Proposed to the user: ramp, w = 0.2 (ρ 0.2-0.4, between the different-motion median ≈0.13 and the together median ≈0.42).

- `data/`: input videos/images (dance, sports). Subfolders are allowed (e.g. `data/aist/`, `data/football/`). Not tracked in git (too large).
- `results/<model-name>/`: one folder per HPE model (e.g. `results/yolo11n-pose/`). Each run writes `<video>-pose.json`, `<video>-pose.csv`, `<video>-tracking.csv`, `<video>-metrics.csv` (one row of comparison metrics), `<video>-keypoint-metrics.csv` (one row per keypoint) and the annotated video `<video>-annotated.mp4`. Running the same video again with the same model gives `<video>_run2-*`, `_run3-*`, …; nothing is overwritten. JSON/CSV are tracked in git; annotated videos are not.
- Saving to disk is done by `apps/web/dev-server/files-plugin.ts` (Vite dev/preview server middleware), so it works only via `npm run dev` / `npm run preview`.

## People tracking

- Current videos contain **3 people**. The expected count is automatic: the most common number of detections in the first 2 s (`countPeople` in `src/sync/assign.ts`, the same rule as the sync algorithm, report 3.3). Runs made before 2026-11-08 used a "People in video" setting (default 3); both are stored the same way (`expected` column, JSON `tracking.expectedPersons`).
- `<video>-tracking.csv`: one row per frame: `frame,time,detected,tracked,expected,rate`. `tracked = min(detected, expected)`, `rate = tracked / expected`. This counts per-frame detections, not identity tracking (no person IDs yet).
- The JSON `tracking` block summarizes it: `allTrackedRate` (share of frames with all people found), `meanTracked`, `meanTrackedRate`, `framesOverDetected` (false positives), `trackedHistogram` (index k = frames with exactly k tracked).

## Model comparison metrics

`src/results/metrics.ts` computes them per run (JSON `metrics` block + `-metrics.csv`; README lists the columns). No ground truth, so they are proxies: speed, detection (missed / over-detected frames), track count, keypoint confidence (within-model only), jitter (acceleration as % of box height) and limb length CV. Tracks come from box IoU between frames and are used only for these metrics, not saved as person IDs. Agreement between models (consensus) needs all model runs and is computed afterwards in Python from the pose CSVs. Runs made before this have no `metrics` block.

Every run also records the exact input: JSON `sourceVideo` (SHA-256, size, codec, native frames/fps/duration from the MP4 header, `src/processing/video-info.ts`) and `processing` (planned vs. processed frames, `completed`); the metrics CSV repeats them as `source_*`, `planned_frames`, `completed`. Opening a video sets the processing FPS to its native rate (a higher rate repeats frames, which distorts jitter).

The model-comparison video is `data/resolution-check-data/poomsae-720reso.mp4` (720×1280, 25 fps, 856 frames, 34.24 s). The older poomsae runs were processed at 30 fps, so they have 1027 frames with repeated frames.

## Synchronization algorithm

The thesis's main algorithm (report chapter 3), in `src/sync/`. **Version v2 (2026-11-19, `algorithm: "joint-angle sync v2"`)**, changed to match the supervisor's spec: one 2 s window per frame, centred on it (moved inside the video at the edges); joint weights α_k in S_pose and S_corr from body-part presets (general arms 50 / legs 25 / torso 25, ballet 20/60/20, hand-dance 60/20/20, or custom; `jointWeightPreset`, `partWeights`); parts no longer overlap (arms = elbows + shoulders, legs = knees, torso = hips); mirror mode is used only when it scores ≥ 5 points higher (`mirrorMargin`); new `-sync-frames.csv`, one row per frame. ρ_min stays 0.3 (the spec's 0.5 rejected real synchronized motion, see below). v1 files (3 s windows every 0.5 s, unweighted joints, no mirror margin, legs = hips + knees) still load in the UI. Description of v1 as it was: assign people left to right by hip x (3.3) → confidence < 0.3 → missing, linear interpolation of gaps ≤ 1 s, Savitzky-Golay smoothing (3.4) → 8 joint angles (3.5, table 3.1) → per pair, sliding windows: S_pose, S_corr, S_lag (cross-correlation of angle velocities with the ρ_min check), weighted score, normal vs. mirror per window; S_group and S_i over pairs (3.6, formula 3.4). Defaults are in `DEFAULT_SYNC_CONFIG`; τ_max = 1.5 s and ρ_min = 0.3 were tuned on poomsae-720reso with keypoint-level controlled pairs (see the comment there). Choices beyond the report: still joints (angle std < 3°) are left out of S_corr/S_lag, and a window where nothing moves is scored on S_pose alone; body parts are arms = elbows + shoulders, legs = hips + knees, torso = hips.

Out-of-sync moments (`src/sync/episodes.ts`): per pair, a window is off when its correlation is 0.15 or its pose similarity 0.06 below that pair's own median, the whole body is reliably late (lag ≥ 0.2 s, ρ ≥ ρ_min), or a limb is late. Limb lag (left/right arm = elbow + shoulder, left/right leg = hip + knee) works on the angles, not the scores: shift the second person's limb by τ and see how much the mean angle gap D(τ) shrinks; late when the gain is ≥ 3° and ≥ 20% of D(0), with 0.2 s ≤ |τ| < τ_max (the share and the edge stop a shift that lines the limb up with another repetition of a move). Each joint of a late limb is late when the same shift shrinks its own gap by ≥ 2°; a joint is "different" when its gap is ≥ 15° above its usual gap in the video. Off windows covering ≥ 1 s (quiet stretches ≤ 0.5 s bridged; the same as v1's "2+ off windows, one quiet window bridged" at its 0.5 s step) form a moment. Computed when shown, from `-sync.json` + `-angles.csv` (nothing extra saved); without angles only the window rules run. Shown under the video with Jump buttons and as bars under the timeline; printed by `npm run sync`. The "late" threshold (lagSec, default 0.2 s) is a viewer setting: the *Late from* slider (0.12-1.0 s in 0.04 s = 1-frame steps; `Settings.lateSec`) and `npm run sync -- … --late 0.3`. It only changes which moments are listed, never the saved scores. Floor 0.12 s (`MIN_LATE_SEC`): at 0.08 s nearly half of poomsae-720reso was flagged, from 0.12 s the list is stable (8 moments at 0.12-0.2 s, 5 at 0.3 s). Results in the report should use the default 0.2 s, the value the 18-case test was run with. Thresholds were picked by delaying one real person's whole body, both arms, one arm, both legs or one leg by 0.3-0.5 s for 2-3 s (18 cases on poomsae-720reso, RTMPose-m): 15 found with the right limb and person; a limb that barely moves during the delay can't be detected; with repeated moves the lag can come out as a full repetition (e.g. 0.9 s for 0.5 s). v2 re-check (`npm run sync-delay-test`, 20 cases on poomsae-720reso_run3 → `results/sync-delay-test/`): 18 found with the right person and limb, the misses are one leg delayed 0.3 s; the reported lag is often larger than the delay (0.3 s → 0.28-1.08 s); without any delay v2 lists 13 moments (v1: 8), as the 2 s windows are noisier.

The same code runs in the browser (after each video run, and on demand on Saved results) and in Node (`npm run sync`). Its files are `<stem>-sync.json`, `-sync-windows.csv`, `-sync-frames.csv` (v2), `-angles.csv`, written next to the run; they are never overwritten, so after changing the algorithm or its defaults, new results need `--out` or the old sync files moved away by the user.

## Controlled video experiments (thesis chapter 4, 2026-11-19)

`npm run experiments -- [lag mirror different distance resolution fps people real]` (`apps/web/scripts/experiments.ts`): FFmpeg (`tools/ffmpeg/`, not in git; or FFMPEG env) builds pair videos from one person (left half of `data/latency-0.mp4`, a ballet dancer, made 25 fps) into `data/experiments/`, the HPE server processes them (`npm run server` must be running), the sync algorithm scores them; one CSV per experiment in `results/experiments/` (default config, plus `ramp_*` and `nosmooth_*` columns), server keypoints cached in `results/experiments/pose/`. `experiments-forced.ts` re-scores the cases where the automatic person count failed (copy at 25 % size, 240p) with the count given as 2 → `forced-count.csv`. Figures: `python analysis/experiment_figures.py` (fig11-14) and `analysis/report_figures.py` (fig7-9) → `results/report-figures/`. Key results: lags 0-25 frames found exactly (0 ms error), score 99.8 → 54.3; mirror 99.3; different motion 45-62 (ρmax < 0.3); size 50 %, 360p, 10 fps barely change the result; 3-4 people: the late one has the lowest S_i; real 3-dancer recordings (personCount3_test*) score 67-79. The thesis LaTeX (final, "Бакалаврын судалгааны ажил") is in `report/` (compiled `report/thesis-final.pdf`, XeLaTeX via Tectonic; DejaVu Sans Mono is not installed, so the build copy uses `DejaVuSansMono.ttf` from the TeX bundle).

## Rules for working on this repo

- Never break or silently change the output format (`*-pose.json`, `*-pose.csv`). If a format change is needed, keep it backward compatible or tell me first, since older results must still be comparable.
- Results should always record which model (name + version/variant), device/backend, and source video produced them, so runs can be grouped and compared later.
- If a model is ever added back, reuse the same keypoint naming (17 COCO keypoints) and output schema; if it uses a different skeleton, map it to COCO and note the mapping.
- Don't delete or overwrite saved result files.
- Prefer outputs that are easy to load in Python/pandas for plotting (flat CSV, consistent column names).

## App overview

Browser-based HPE (Vite) plus an optional Python HPE server. See [README.md](README.md) for run instructions and output details.

- Run (from the root): `npm install`, `npm run models`, then `npm run dev` (Chrome/Edge, WebGPU); server: `npm run server:setup` once, then `npm run server`
- Every model adapter returns the `@ultralytics/yolo` Results shape, so drawing/stats/saving are shared.
- Stack: TypeScript (strict) + React (.tsx) + Mantine UI. Run `npm run typecheck` after changes.
- Server (apps/server): Python 3, FastAPI; it only does HPE (no sync, no saving). Keep its output identical in shape to the browser's FrameRecord.
- Keep this structure: one job per file; models/, processing/ and results/ have no UI code; components only render state and call AppController methods; long-running work lives in AppController, not in React.

```
apps/server/                Python HPE server: run.mjs (npm run server / server:setup), requirements.txt,
  hpe_server/               main.py (FastAPI endpoints), jobs.py (queue, one worker), models.py (registry),
                            pipeline.py (port of src/models/topdown.ts)
apps/web/                   web app; everything below is inside it
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
  processing/               video.ts, image.ts, webcam.ts, mp4-encoder.ts, server.ts (HPE server client) (no UI code)
  sync/                     synchronization algorithm (report 3.3-3.6), no app/DOM imports, .ts imports so
                            Node can run it: assign.ts, preprocess.ts, angles.ts, score.ts, index.ts, files.ts,
                            episodes.ts (out-of-sync moments)
  results/                  records.ts, tracking.ts, metrics.ts, output-files.ts (builds the saved files),
                            saved-run.ts (rebuilds stats from a saved JSON)
dev-server/files-plugin.ts  Vite middleware: serves data/, writes results/ (repo root)
scripts/download-models.ts  `npm run models`
scripts/sync.ts             `npm run sync -- <pose.json>…`: the sync algorithm in Node, for experiments
scripts/sync-delay-test.ts  `npm run sync-delay-test -- <pose.json>`: controlled delays → results/sync-delay-test/
(repository root)
analysis/resolution_check.py  360p/480p/720p comparison → results/resolution-check/ (CSVs + PNG figures)
analysis/model_comparison.py  all-model comparison on poomsae-720reso (skips models without a run) → results/model-comparison/ (CSVs + PNG figures)
```
