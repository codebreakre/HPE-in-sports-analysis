// MediaPipe Pose Landmarker (BlazePose): its own person detector + a 33-landmark model.
// Runs in IMAGE mode (every frame independent, like the other models); its 33 landmarks
// are mapped to the 17 COCO keypoints.
import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";
import type { PoseModel, Point } from "../types";
import { makeResults, missingWeightsError, sourceSize, toDrawable, type DetectedPerson } from "./common";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MAX_POSES = 10; // high enough that over-detections are still counted, like the other models
const DEFAULT_CONF = 0.25;

// MediaPipe landmark index for each COCO keypoint, in COCO order:
// nose, eyes, ears, shoulders, elbows, wrists, hips, knees, ankles (left before right).
const MEDIAPIPE_TO_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export async function loadMediaPipe(modelUrl: string): Promise<PoseModel> {
  const check = await fetch(modelUrl, { method: "HEAD" });
  if (!check.ok) throw missingWeightsError(modelUrl, check.status);

  const { landmarker, device } = await createLandmarker(modelUrl);
  landmarker.detect(new ImageData(256, 256)); // warm-up
  let currentConf = DEFAULT_CONF;

  return {
    device,
    async predict(input, { conf }) {
      if (conf !== currentConf) {
        await landmarker.setOptions({ minPoseDetectionConfidence: conf, minPosePresenceConfidence: conf });
        currentConf = conf;
      }
      const image = await toDrawable(input);
      const { width, height } = sourceSize(image);

      const start = performance.now();
      const result = landmarker.detect(image);
      const detected = performance.now();
      const persons = result.landmarks.map((landmarks) => toPerson(landmarks, width, height));

      return makeResults(width, height, persons, {
        preprocess: 0,
        inference: detected - start,
        postprocess: performance.now() - detected,
      });
    },
  };
}

/** GPU (WebGL) if possible, else CPU. */
async function createLandmarker(modelUrl: string): Promise<{ landmarker: PoseLandmarker; device: string }> {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const create = (delegate: "GPU" | "CPU") => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: modelUrl, delegate },
    runningMode: "IMAGE",
    numPoses: MAX_POSES,
    minPoseDetectionConfidence: DEFAULT_CONF,
    minPosePresenceConfidence: DEFAULT_CONF,
  });
  try {
    return { landmarker: await create("GPU"), device: "gpu (webgl)" };
  } catch (err) {
    console.warn("MediaPipe GPU delegate failed, using CPU:", err);
    return { landmarker: await create("CPU"), device: "cpu" };
  }
}

/**
 * MediaPipe gives normalized landmarks and no box or person score, so:
 * box = extent of all 33 landmarks, score = mean visibility of the 17 COCO keypoints.
 */
function toPerson(landmarks: NormalizedLandmark[], width: number, height: number): DetectedPerson {
  const points = MEDIAPIPE_TO_COCO.map((i): Point => [
    landmarks[i].x * width,
    landmarks[i].y * height,
    landmarks[i].visibility ?? 1,
  ]);
  const xs = landmarks.map((l) => l.x * width);
  const ys = landmarks.map((l) => l.y * height);
  const box: DetectedPerson["box"] = [
    Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)),
    Math.min(width, Math.max(...xs)), Math.min(height, Math.max(...ys)),
  ];
  const conf = points.reduce((sum, p) => sum + p[2], 0) / points.length;
  return { box, conf, points };
}
