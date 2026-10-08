# Browser Human Pose Estimation

YOLO11n-pose running fully in the browser (WebGPU, CPU/wasm fallback) via `@ultralytics/yolo`.

## Run

```bash
npm install
npm run dev      # opens http://localhost:5173
```

Use Chrome or Edge (WebGPU + WebCodecs). Needs internet on first load: ONNX Runtime Web (~25 MB) comes from cdn.pyke.io and is then cached.

## Use

- **Video**: choose a file, set Processing FPS, click *Process video*. Every frame is processed (none dropped), and the annotated MP4 keeps the original timing.
- **Image**: choose a file; results appear immediately.
- **Webcam**: live inference; on stop you get a WebM recording plus results.

## Outputs

- Annotated video (MP4/WebM) or PNG
- `*-pose.json`: per frame → persons → box, confidence, 17 COCO keypoints `{name, x, y, conf}`, timing
- `*-pose.csv`: one row per person per frame (wide format, `<keypoint>_x/_y/_conf`)
- On-page stats: device, avg inference ms, model vs. pipeline FPS, per-keypoint mean confidence and visibility

## Files

- `public/models/yolo11n-pose.onnx`: model (Ultralytics assets v8.4.0)
- `src/main.js`: app logic; `src/style.css`, `index.html`: UI
