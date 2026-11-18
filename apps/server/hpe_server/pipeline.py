"""RTMPose-m top-down pipeline, a port of apps/web/src/models/topdown.ts (and the @ultralytics/yolo detector).

Same ONNX files, same steps, so server keypoints match the browser's (small differences come from video
decoding and image resampling):
  1. YOLO11n person detector: letterbox to 640x640 (grey 114 padding), RGB / 255, class 0 only, NMS IoU 0.7
  2. each box -> padded region with the model's aspect ratio (x1.25, mmpose bbox_xyxy2cs + fix_aspect_ratio)
  3. region -> 192x256 crop (bilinear, outside the frame black), ImageNet normalization (RGB, 0-255 scale)
  4. RTMPose SimCC: argmax per axis / 2 -> crop pixels -> frame pixels; keypoint conf = min(peak x, peak y)
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

# ImageNet normalization (0-255 scale, RGB), as RTMPose was trained with.
MEAN = np.array([123.675, 116.28, 103.53], dtype=np.float32)
STD = np.array([58.395, 57.12, 57.375], dtype=np.float32)
BOX_PADDING = 1.25
DET_SIZE = 640
DET_IOU = 0.7      # @ultralytics/yolo DEFAULT_IOU
DET_MAX = 300      # Ultralytics max_det
LETTERBOX_FILL = 114


@dataclass
class Person:
    box: tuple[float, float, float, float]
    conf: float
    points: list[tuple[float, float, float]]  # 17 COCO keypoints (x, y, conf) in frame pixels


@dataclass
class Prediction:
    persons: list[Person]
    pre_ms: float
    inf_ms: float
    post_ms: float


def create_session(path: Path, prefer_gpu: bool = True) -> tuple[ort.InferenceSession, str]:
    """CUDA when it works, else CPU. Returns the session and "cuda" / "cpu"."""
    available = ort.get_available_providers()
    if prefer_gpu and "CUDAExecutionProvider" in available:
        try:
            session = ort.InferenceSession(str(path), providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
            if session.get_providers()[0] == "CUDAExecutionProvider":
                return session, "cuda"
        except Exception as err:  # missing CUDA/cuDNN DLLs and the like
            print(f"CUDA failed for {path.name}, using CPU: {err}")
    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"]), "cpu"


class TopDownModel:
    def __init__(self, pose_path: Path, detector_path: Path, input_width: int, input_height: int, prefer_gpu: bool = True):
        self.in_w, self.in_h = input_width, input_height
        self.detector, det_device = create_session(detector_path, prefer_gpu)
        self.pose, pose_device = create_session(pose_path, prefer_gpu)
        self.device = pose_device if pose_device == det_device else f"{pose_device} (detector {det_device})"
        self.det_input = self.detector.get_inputs()[0].name
        self.pose_input = self.pose.get_inputs()[0].name
        self.pose_outputs = [o.name for o in self.pose.get_outputs()]
        # Warm-up (the first CUDA run builds kernels).
        self.detector.run(None, {self.det_input: np.zeros((1, 3, DET_SIZE, DET_SIZE), np.float32)})
        self.pose.run(None, {self.pose_input: np.zeros((1, 3, self.in_h, self.in_w), np.float32)})

    def predict(self, frame_rgb: np.ndarray, conf: float) -> Prediction:
        """frame_rgb: HxWx3 uint8, RGB."""
        h, w = frame_rgb.shape[:2]
        pre = inf = post = 0.0

        t = time.perf_counter()
        tensor, ratio, pad = letterbox(frame_rgb)
        pre += time.perf_counter() - t
        t = time.perf_counter()
        out = self.detector.run(None, {self.det_input: tensor})[0]
        inf += time.perf_counter() - t
        t = time.perf_counter()
        boxes = detect_persons(out, conf, ratio, pad, w, h)
        post += time.perf_counter() - t

        persons: list[Person] = []
        for x1, y1, x2, y2, score in boxes:
            t = time.perf_counter()
            region = crop_region(x1, y1, x2, y2, self.in_w, self.in_h)
            crop = crop_to_tensor(frame_rgb, region, self.in_w, self.in_h)
            pre += time.perf_counter() - t
            t = time.perf_counter()
            simcc_x, simcc_y = self.pose.run(None, {self.pose_input: crop})[:2]
            inf += time.perf_counter() - t
            t = time.perf_counter()
            rx, ry, rw, rh = region
            sx, sy = rw / self.in_w, rh / self.in_h
            points = [(rx + x * sx, ry + y * sy, c) for x, y, c in decode_simcc(simcc_x, simcc_y, self.in_w)]
            persons.append(Person((x1, y1, x2, y2), score, points))
            post += time.perf_counter() - t
        return Prediction(persons, pre * 1000, inf * 1000, post * 1000)


def letterbox(img: np.ndarray) -> tuple[np.ndarray, float, tuple[float, float]]:
    """Ultralytics LetterBox(640, center=True): resize keeping the aspect ratio, pad with grey 114."""
    h, w = img.shape[:2]
    r = min(DET_SIZE / h, DET_SIZE / w)
    new_w, new_h = int(round(w * r)), int(round(h * r))
    dw, dh = (DET_SIZE - new_w) / 2, (DET_SIZE - new_h) / 2
    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR) if (new_w, new_h) != (w, h) else img
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    padded = cv2.copyMakeBorder(resized, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(LETTERBOX_FILL,) * 3)
    tensor = padded.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    return np.ascontiguousarray(tensor), r, (left, top)


def detect_persons(out: np.ndarray, conf: float, ratio: float, pad: tuple[float, float], w: int, h: int):
    """YOLO output (1, 4 + classes, anchors) -> person boxes [x1, y1, x2, y2, score] in frame pixels, after NMS."""
    pred = out[0].T  # anchors x (4 + classes)
    scores = pred[:, 4]  # class 0 = person
    keep = scores >= conf
    pred, scores = pred[keep], scores[keep]
    if not len(scores):
        return []
    cx, cy, bw, bh = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
    boxes = np.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], axis=1)
    order = nms(boxes, scores, DET_IOU)[:DET_MAX]
    result = []
    for i in order:
        x1, y1, x2, y2 = boxes[i]
        x1 = float(np.clip((x1 - pad[0]) / ratio, 0, w)); x2 = float(np.clip((x2 - pad[0]) / ratio, 0, w))
        y1 = float(np.clip((y1 - pad[1]) / ratio, 0, h)); y2 = float(np.clip((y2 - pad[1]) / ratio, 0, h))
        result.append((x1, y1, x2, y2, float(scores[i])))
    return result


def nms(boxes: np.ndarray, scores: np.ndarray, iou: float) -> list[int]:
    order = scores.argsort()[::-1]
    areas = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0]); yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2]); yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        overlap = inter / (areas[i] + areas[order[1:]] - inter + 1e-9)
        order = order[1:][overlap <= iou]
    return keep


def crop_region(x1: float, y1: float, x2: float, y2: float, in_w: int, in_h: int) -> tuple[float, float, float, float]:
    """Box -> padded region (x, y, w, h) with the model's aspect ratio (topdown.ts cropRegion)."""
    aspect = in_w / in_h
    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
    w, h = (x2 - x1) * BOX_PADDING, (y2 - y1) * BOX_PADDING
    if w > h * aspect:
        h = w / aspect
    else:
        w = h * aspect
    return cx - w / 2, cy - h / 2, w, h


def crop_to_tensor(img: np.ndarray, region: tuple[float, float, float, float], in_w: int, in_h: int) -> np.ndarray:
    """Like canvas drawImage(frame, region -> in_w x in_h): output pixel u samples source x + (u + 0.5) * s - 0.5."""
    x, y, w, h = region
    sx, sy = w / in_w, h / in_h
    m = np.array([[sx, 0, x + 0.5 * sx - 0.5], [0, sy, y + 0.5 * sy - 0.5]], dtype=np.float64)
    crop = cv2.warpAffine(img, m, (in_w, in_h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    tensor = (crop.astype(np.float32) - MEAN) / STD
    return np.ascontiguousarray(tensor.transpose(2, 0, 1)[None])


def decode_simcc(simcc_x: np.ndarray, simcc_y: np.ndarray, in_w: int) -> list[tuple[float, float, float]]:
    """SimCC (1, K, 2*W) / (1, K, 2*H) -> K x (x, y, conf) in crop pixels (topdown.ts decodeSimcc)."""
    split = simcc_x.shape[2] / in_w
    ix, iy = simcc_x[0].argmax(axis=1), simcc_y[0].argmax(axis=1)
    vx = simcc_x[0][np.arange(len(ix)), ix]
    vy = simcc_y[0][np.arange(len(iy)), iy]
    return [(float(ix[k] / split), float(iy[k] / split), float(min(vx[k], vy[k]))) for k in range(len(ix))]
