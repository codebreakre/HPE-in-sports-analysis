// YOLO pose models (YOLO11, YOLOv8): single-stage, boxes and keypoints in one pass.
import { YOLO } from "@ultralytics/yolo";
import type { PoseModel } from "../types";

export async function loadYolo(url: string): Promise<PoseModel> {
  const model = await YOLO.load(url);
  // Warm-up: the first run compiles GPU shaders and would distort timing stats.
  await model.predict(new ImageData(640, 640));
  return {
    device: model.device,
    predict: (input, { conf }) => model.predict(input, { conf }),
  };
}
