// Top-down pose model (RTMPose): a person detector (YOLO11n) finds boxes, then the pose
// model runs on a crop of each box.
import { YOLO } from "@ultralytics/yolo";
import type { PoseModel, Point } from "../types";
import { createSession, makeResults, toCanvas, ort, type DetectedPerson } from "./common";

type ModelOutputs = ort.InferenceSession.OnnxValueMapType;

/** Model output → 17 keypoints in input-crop pixels. */
export type Decoder = (outputs: ModelOutputs, inputWidth: number) => Point[];

interface Region { x: number; y: number; w: number; h: number }

// ImageNet normalization (0–255 scale, RGB), as RTMPose was trained with.
const MEAN = [123.675, 116.28, 103.53];
const STD = [58.395, 57.12, 57.375];
const BOX_PADDING = 1.25; // boxes are enlarged by this before cropping, as in mmpose / transformers

export async function loadTopDown(options: {
  poseUrl: string;
  detectorUrl: string;
  inputWidth: number;
  inputHeight: number;
  decode: Decoder;
}): Promise<PoseModel> {
  const { poseUrl, detectorUrl, inputWidth: inW, inputHeight: inH, decode } = options;
  const [detector, { session, device }] = await Promise.all([loadDetector(detectorUrl), createSession(poseUrl)]);
  const inputName = session.inputNames[0];
  const crop = new OffscreenCanvas(inW, inH);
  // Warm up the pose model too (the detector finds nobody in a blank frame, so it would never run).
  await session.run({ [inputName]: new ort.Tensor("float32", new Float32Array(3 * inW * inH), [1, 3, inH, inW]) });

  return {
    device: device === detector.device ? device : `${device} (detector ${detector.device})`,

    async predict(input, { conf }) {
      const detection = await detector.predict(input, { conf, classes: [0] }); // class 0 = person
      const timing = { pre: 0, inf: 0, post: 0 };
      let t = performance.now();
      const frame = detection.boxes.length ? await toCanvas(input) : null;
      timing.pre += performance.now() - t;

      const persons: DetectedPerson[] = [];
      for (const box of detection.boxes) {
        t = performance.now();
        const region = cropRegion(box, inW, inH);
        const tensor = cropToTensor(frame!, region, crop);
        timing.pre += performance.now() - t;

        t = performance.now();
        const outputs = await session.run({ [inputName]: tensor });
        timing.inf += performance.now() - t;

        t = performance.now();
        const scaleX = region.w / inW, scaleY = region.h / inH;
        const points = decode(outputs, inW).map(([x, y, c]): Point => [region.x + x * scaleX, region.y + y * scaleY, c]);
        persons.push({ box: [box.x1, box.y1, box.x2, box.y2], conf: box.conf, points });
        timing.post += performance.now() - t;
      }

      // Timing includes the detector, so totals compare fairly with single-stage models.
      return makeResults(detection.width, detection.height, persons, {
        preprocess: detection.speed.preprocess + timing.pre,
        inference: detection.speed.inference + timing.inf,
        postprocess: detection.speed.postprocess + timing.post,
      });
    },
  };
}

// One detector instance, shared by every top-down model.
let detectorPromise: Promise<YOLO> | null = null;
function loadDetector(url: string): Promise<YOLO> {
  detectorPromise ??= (async () => {
    const detector = await YOLO.load(url);
    await detector.predict(new ImageData(640, 640)); // warm-up
    return detector;
  })();
  return detectorPromise;
}

/** Box → padded region with the model's aspect ratio (mmpose bbox_xyxy2cs + fix_aspect_ratio). */
function cropRegion(box: { x1: number; y1: number; x2: number; y2: number }, inW: number, inH: number): Region {
  const aspect = inW / inH;
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  let w = (box.x2 - box.x1) * BOX_PADDING;
  let h = (box.y2 - box.y1) * BOX_PADDING;
  if (w > h * aspect) h = w / aspect;
  else w = h * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Crops `region` of the frame to the model input size (outside the frame stays black)
 * and converts it to a normalized NCHW float tensor.
 */
function cropToTensor(frame: OffscreenCanvas, region: Region, crop: OffscreenCanvas): ort.Tensor {
  const ctx = crop.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, crop.width, crop.height);
  ctx.drawImage(frame, region.x, region.y, region.w, region.h, 0, 0, crop.width, crop.height);
  const { data } = ctx.getImageData(0, 0, crop.width, crop.height);

  const pixels = crop.width * crop.height;
  const tensor = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) tensor[c * pixels + i] = (data[i * 4 + c] - MEAN[c]) / STD[c];
  }
  return new ort.Tensor("float32", tensor, [1, 3, crop.height, crop.width]);
}

// ---------- decoders: model output → keypoints in input-crop pixels ----------

/**
 * RTMPose (SimCC): per keypoint, one 1-D score vector over x and one over y, at 2× input
 * resolution. Position = argmax of each; score = the smaller of the two peaks (mmpose get_simcc_maximum).
 */
export const decodeSimcc: Decoder = (outputs, inputWidth) => {
  const simccX = (outputs.simcc_x ?? Object.values(outputs)[0]) as ort.Tensor;
  const simccY = (outputs.simcc_y ?? Object.values(outputs)[1]) as ort.Tensor;
  const [, keypoints, lenX] = simccX.dims;
  const lenY = simccY.dims[2];
  const split = lenX / inputWidth; // bins per input pixel (2 for RTMPose)
  const dataX = simccX.data as Float32Array, dataY = simccY.data as Float32Array;

  const points: Point[] = [];
  for (let k = 0; k < keypoints; k++) {
    const x = argmax(dataX, k * lenX, lenX);
    const y = argmax(dataY, k * lenY, lenY);
    points.push([x.index / split, y.index / split, Math.min(x.value, y.value)]);
  }
  return points;
};

/** Index (relative to `start`) and value of the largest of `length` values. */
function argmax(data: Float32Array, start: number, length: number): { index: number; value: number } {
  let index = 0, value = -Infinity;
  for (let i = 0; i < length; i++) {
    if (data[start + i] > value) { value = data[start + i]; index = i; }
  }
  return { index, value };
}
