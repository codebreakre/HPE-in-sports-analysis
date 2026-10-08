// Helpers shared by the model adapters. Every adapter returns the same Results shape as
// @ultralytics/yolo, so drawing (annotate), stats and saving work the same for all models.
import * as ort from "onnxruntime-web/webgpu";
import type { PoseInput, Point, Results, Speed } from "../types";

export { ort };

export interface DetectedPerson {
  box: [x1: number, y1: number, x2: number, y2: number];
  conf: number;
  /** 17 COCO keypoints in image pixels */
  points: Point[];
}

type Drawable = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

const PERSON_COLOR = "#042AFF"; // Ultralytics palette color for class 0 ("person")

export function makeResults(width: number, height: number, persons: DetectedPerson[], speed: Speed): Results {
  return {
    task: "pose",
    width,
    height,
    boxes: persons.map((p) => ({
      x1: p.box[0], y1: p.box[1], x2: p.box[2], y2: p.box[3],
      conf: p.conf, cls: 0, name: "person", color: PERSON_COLOR,
    })),
    keypoints: persons.map((p) => ({ points: p.points, color: PERSON_COLOR })),
    // Unused by pose, but annotate() expects them.
    obb: [], probs: null, masks: new Uint8Array(0), depth: new Uint8Array(0),
    speed,
  };
}

/** Pixel size of anything drawable. */
export function sourceSize(source: Drawable): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}

/** Image files and raw pixels must be decoded before they can be drawn; video elements can be drawn directly. */
export async function toDrawable(input: PoseInput): Promise<HTMLVideoElement | ImageBitmap> {
  return input instanceof HTMLVideoElement ? input : createImageBitmap(input);
}

export function missingWeightsError(url: string, status: number): Error {
  return new Error(`${url} not found (${status}). Run "npm run models" to download the weights.`);
}

let frameCanvas: OffscreenCanvas | null = null; // reused between frames

/** Draws an input onto a canvas we can read pixels from. */
export async function toCanvas(input: PoseInput): Promise<OffscreenCanvas> {
  const image = await toDrawable(input);
  const { width, height } = sourceSize(image);
  frameCanvas ??= new OffscreenCanvas(width, height);
  if (frameCanvas.width !== width || frameCanvas.height !== height) {
    frameCanvas.width = width;
    frameCanvas.height = height;
  }
  frameCanvas.getContext("2d", { willReadFrequently: true })!.drawImage(image, 0, 0, width, height);
  return frameCanvas;
}

/** Loads an ONNX model on WebGPU, falling back to CPU (wasm) when WebGPU is unavailable. */
export async function createSession(url: string): Promise<{ session: ort.InferenceSession; device: string }> {
  const res = await fetch(url);
  if (!res.ok) throw missingWeightsError(url, res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());

  if ("gpu" in navigator) {
    try {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: ["webgpu"] });
      return { session, device: "webgpu" };
    } catch (err) {
      console.warn(`WebGPU failed for ${url}, using CPU:`, err);
    }
  }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  return { session, device: "cpu" };
}
