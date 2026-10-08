# CLAUDE.md

## Project purpose

This is my bachelor's thesis project: **"Human pose estimation in sports analytics"**.

- I add sports/dance videos (e.g. from AIST Dance DB), run them through HPE models, and save the results.
- **The saved results are the core deliverable.** I will use them to build diagrams and statistics comparing models (e.g. which model tracks best, keypoint confidence/visibility, inference speed, synchronization scores).
- I will try **many HPE models**, not only YOLO11n-pose. Every model must produce results in the same, comparable format so they can be analyzed side by side.

## The 5 models compared

YOLO11, YOLOv8, RTMPose, ViTPose, MediaPipe. All are in the app (`src/models/index.ts`); the `id` is the results folder:

| Model | id / results folder | Notes |
|---|---|---|
| YOLO11 | `yolo11n-pose` | single-stage |
| YOLOv8 | `yolov8n-pose` | single-stage |
| RTMPose | `rtmpose-m` | top-down, uses YOLO11n (`yolo11n.onnx`) as person detector |
| ViTPose | `vitpose-b` | top-down, same YOLO11n detector; fp32 ONNX, 344 MB |
| MediaPipe | `mediapipe-pose-full` | own BlazePose detector; 33 landmarks mapped to COCO 17; IMAGE mode (no temporal tracking) |

- RTMPose and ViTPose share one detector, so their people counts per frame are identical by design; they differ only in keypoints.
- Keypoint `conf` means something different per model (recorded in the JSON as `keypointConfidence`); don't compare raw conf values across models without noting this.
- Weights: `npm run models` → `public/models/` (not in git, too large).

## Folder layout

- `data/`: input videos/images (dance, sports). Subfolders are allowed (e.g. `data/aist/`, `data/football/`). Not tracked in git (too large).
- `results/<model-name>/`: one folder per HPE model (e.g. `results/yolo11n-pose/`). Each run writes `<video>-pose.json`, `<video>-pose.csv`, `<video>-tracking.csv` and the annotated video `<video>-annotated.mp4`. Running the same video again with the same model gives `<video>_run2-*`, `_run3-*`, …; nothing is overwritten. JSON/CSV are tracked in git; annotated videos are not.
- Saving to disk is done by `server/files-plugin.ts` (Vite dev/preview server middleware), so it works only via `npm run dev` / `npm run preview`.

## People tracking

- Current videos contain **3 people**; the expected count is the "People in video" setting (default 3).
- `<video>-tracking.csv`: one row per frame: `frame,time,detected,tracked,expected,rate`. `tracked = min(detected, expected)`, `rate = tracked / expected`. This counts per-frame detections, not identity tracking (no person IDs yet).
- The JSON `tracking` block summarizes it: `allTrackedRate` (share of frames with all people found), `meanTracked`, `meanTrackedRate`, `framesOverDetected` (false positives), `trackedHistogram` (index k = frames with exactly k tracked).

## Rules for working on this repo

- Never break or silently change the output format (`*-pose.json`, `*-pose.csv`). If a format change is needed, keep it backward compatible or tell me first, since older results must still be comparable.
- Results should always record which model (name + version/variant), device/backend, and source video produced them, so runs can be grouped and compared later.
- When adding a new model, reuse the same keypoint naming (17 COCO keypoints) and output schema; if a model uses a different skeleton, map it to COCO and note the mapping.
- Don't delete or overwrite saved result files.
- Prefer outputs that are easy to load in Python/pandas for plotting (flat CSV, consistent column names).

## App overview

Browser-based HPE (Vite). See [README.md](README.md) for run instructions and output details.

- Run: `npm install`, `npm run models`, then `npm run dev` (Chrome/Edge, WebGPU)
- Every model adapter returns the `@ultralytics/yolo` Results shape, so drawing/stats/saving are shared.
- Stack: TypeScript (strict) + React (.tsx) + Mantine UI. Run `npm run typecheck` after changes.
- Keep this structure: one job per file; models/, processing/ and results/ have no UI code; components only render state and call AppController methods; long-running work lives in AppController, not in React.

```
src/                        (TypeScript + React, UI built with Mantine)
  main.tsx                  entry: Mantine provider + the one AppController
  App.tsx                   page layout (header, controls, stage, results)
  types.ts                  shared types; also the saved data formats
  keypoints.ts              the 17 COCO keypoint names (shared order for all models)
  api.ts                    talks to the dev server: list/load data/, save to results/
  app/
    controller.ts           AppController: app state + steps (load model → open input → process → save)
    AppContext.tsx          gives components the controller and its state
  components/               React UI: AppHeader, ControlPanel, Stage, ResultsPanel,
                            StatGrid, KeypointTable, TrackingSection, TrackingChart
  models/
    index.ts                the 5 models (id = results folder, weights file, metadata)
    yolo.ts                 YOLO11 / YOLOv8 (single-stage)
    topdown.ts              RTMPose / ViTPose: person detector → crop → pose model → decode
    mediapipe.ts            MediaPipe Pose Landmarker (33 landmarks → COCO 17)
    common.ts               shared Results shape, ONNX session (WebGPU → CPU fallback)
  processing/               video.ts, image.ts, webcam.ts, mp4-encoder.ts (no UI code)
  results/                  records.ts, tracking.ts, output-files.ts (builds the saved files)
server/files-plugin.ts      Vite middleware: serves data/, writes results/
scripts/download-models.ts  `npm run models`
```
