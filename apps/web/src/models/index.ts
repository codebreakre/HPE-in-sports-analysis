// The HPE model the app runs: RTMPose-m, chosen after comparing six models on poomsae-720reso
// (YOLO11, YOLOv8, YOLO26, RTMPose, ViTPose, MediaPipe; their saved runs stay in results/ and
// analysis/model_comparison.py). See ModelSpec in ../types.ts for the fields.
// Weights live in public/models/ (download with `npm run models`).
import type { ModelSpec } from "../types";
import { loadTopDown, decodeSimcc } from "./topdown";

const weights = (file: string) => `/models/${file}`;
const PERSON_DETECTOR = "yolo11n.onnx";

export const MODEL: ModelSpec = {
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
};
