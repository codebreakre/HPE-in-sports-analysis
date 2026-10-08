# Browser Human Pose Estimation

Five human pose estimation models running fully in the browser (WebGPU, CPU/wasm fallback), all producing the same 17-keypoint COCO output so they can be compared:

| Model (results folder) | Type | Weights | Runtime |
|---|---|---|---|
| YOLO11n-pose (`yolo11n-pose`) | single-stage | Ultralytics v8.4.0 | `@ultralytics/yolo` |
| YOLOv8n-pose (`yolov8n-pose`) | single-stage | Ultralytics v8.4.0 | `@ultralytics/yolo` |
| RTMPose-m body7 256×192 (`rtmpose-m`) | top-down, YOLO11n person detector | OpenMMLab rtmposev1 ONNX | `onnxruntime-web` |
| ViTPose-B simple 256×192 (`vitpose-b`) | top-down, YOLO11n person detector | onnx-community/vitpose-base-simple (fp32) | `onnxruntime-web` |
| MediaPipe Pose Landmarker full (`mediapipe-pose-full`) | built-in BlazePose detector, 33 landmarks → COCO 17 | Google MediaPipe | `@mediapipe/tasks-vision` |

## Run

```bash
npm install
npm run models   # downloads all model weights into public/models/ (~450 MB, once)
npm run dev      # opens http://localhost:5173
npm run typecheck  # TypeScript check (also runs as part of npm run build)
```

Use Chrome or Edge (WebGPU + WebCodecs). Needs internet on first load: ONNX Runtime Web for the YOLO models comes from cdn.pyke.io and MediaPipe's wasm from cdn.jsdelivr.net; both are then cached.

## Use

- **Model**: pick one at the top. *Process with all 5 models* runs the current video through every model in turn, each saving to its own `results/<model>/` folder.
- **Inputs**: put videos/images in `data/` (subfolders OK), then pick one under *From data/ folder* (*Refresh list* after adding files). The file picker still works for one-off files.
- **Results**: with *Save results to results/&lt;model&gt;/* checked, every run is saved automatically to `results/<model-name>/` (e.g. `results/yolo11n-pose/<video>-pose.json`, `-pose.csv`, `-annotated.mp4`). Re-runs get a `_run2`, `_run3`, … suffix; nothing is overwritten.
- **Video**: choose a file, set Processing FPS, click *Process video*. Every frame is processed (none dropped), and the annotated MP4 keeps the original timing.
- **Image**: choose a file; results appear immediately.
- **Webcam**: live inference; on stop you get a WebM recording plus results.

## Outputs

- Annotated video (MP4/WebM) or PNG
- `*-pose.json`: model name, device, source path, timestamp, then per frame → persons → box, confidence, 17 COCO keypoints `{name, x, y, conf}`, timing
- `*-tracking.csv`: one row per frame with detected / tracked / expected people and tracking rate (set *People in video*, default 3); summary in the JSON `tracking` block and a chart on the page
- `*-pose.csv`: one row per person per frame (wide format, `<keypoint>_x/_y/_conf`)
- Comparing models: the JSON also records `modelLabel`, `modelFamily`, `pipeline`, `detector` and `keypointConfidence`. Timing for top-down models includes the person detector. Keypoint confidence means something different per model (see `keypointConfidence`), so compare it within a model rather than across models.
- On-page stats: device, avg inference ms, model vs. pipeline FPS, per-keypoint mean confidence and visibility

## Files

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

Model weights live in `public/models/` (`npm run models`); not in git except `yolo11n-pose.onnx`. `index.html` only mounts the React app; styling comes from Mantine (plus a few rules in `src/styles.css`).
