// The HPE models compared in the thesis (see ModelSpec in ../types.ts for the fields).
// Weights live in public/models/ (download with `npm run models`).
import type { ModelSpec } from "../types";
import { loadYolo } from "./yolo";
import { loadTopDown, decodeSimcc, decodeHeatmap } from "./topdown";
import { loadMediaPipe } from "./mediapipe";

const weights = (file: string) => `/models/${file}`;
const PERSON_DETECTOR = "yolo11n.onnx"; // used by both top-down models

export const MODELS: ModelSpec[] = [
  {
    id: "yolo11n-pose",
    label: "YOLO11n-pose",
    family: "YOLO11",
    file: "yolo11n-pose.onnx",
    pipeline: "single-stage",
    detector: null,
    keypointConf: "sigmoid keypoint visibility (0–1)",
    load: () => loadYolo(weights("yolo11n-pose.onnx")),
  },
  {
    id: "yolov8n-pose",
    label: "YOLOv8n-pose",
    family: "YOLOv8",
    file: "yolov8n-pose.onnx",
    pipeline: "single-stage",
    detector: null,
    keypointConf: "sigmoid keypoint visibility (0–1)",
    load: () => loadYolo(weights("yolov8n-pose.onnx")),
  },
  {
    id: "rtmpose-m",
    label: "RTMPose-m (body7, 256×192)",
    family: "RTMPose",
    file: "rtmpose-m.onnx",
    pipeline: "top-down",
    detector: PERSON_DETECTOR,
    keypointConf: "SimCC peak, min(x, y) (≈0–1, not a probability)",
    load: () => loadTopDown({
      poseUrl: weights("rtmpose-m.onnx"),
      detectorUrl: weights(PERSON_DETECTOR),
      inputWidth: 192,
      inputHeight: 256,
      decode: decodeSimcc,
    }),
  },
  {
    id: "vitpose-b",
    label: "ViTPose-B (simple, 256×192)",
    family: "ViTPose",
    file: "vitpose-base-simple.onnx",
    pipeline: "top-down",
    detector: PERSON_DETECTOR,
    keypointConf: "heatmap peak value (≈0–1)",
    load: () => loadTopDown({
      poseUrl: weights("vitpose-base-simple.onnx"),
      detectorUrl: weights(PERSON_DETECTOR),
      inputWidth: 192,
      inputHeight: 256,
      decode: decodeHeatmap,
    }),
  },
  {
    id: "mediapipe-pose-full",
    label: "MediaPipe Pose (full)",
    family: "MediaPipe",
    file: "pose_landmarker_full.task",
    pipeline: "top-down (built-in BlazePose detector)",
    detector: "BlazePose",
    keypointConf: "landmark visibility (0–1)",
    load: () => loadMediaPipe(weights("pose_landmarker_full.task")),
  },
];
