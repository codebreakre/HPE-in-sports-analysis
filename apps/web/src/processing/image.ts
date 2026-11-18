// Runs a model on a single image.
import { annotate } from "@ultralytics/yolo";
import type { PoseModel, Run } from "../types";
import { toFrameRecord } from "../results/records";

/** @returns a run with one frame and the annotated PNG. */
export async function processImage(options: {
  model: PoseModel;
  file: File;
  canvas: HTMLCanvasElement;
  conf: number;
}): Promise<Run> {
  const { model, file, canvas, conf } = options;
  const result = await model.predict(file, { conf });
  await annotate(canvas, file, result);
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  return {
    frames: [toFrameRecord(0, 0, result)],
    width: result.width,
    height: result.height,
    fps: null,
    conf,
    wallMs: result.speed.inference,
    media: png,
    mediaName: "annotated.png",
  };
}
