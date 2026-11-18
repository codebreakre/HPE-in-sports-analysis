"""The models the server can run. Ids, labels and files match apps/web/src/models/index.ts, so a server run is
saved in the same results/<id>/ folder and its JSON reads the same. Weights are the browser's own files in
apps/web/public/models/ (`npm run models`), or HPE_MODEL_DIR."""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

import onnxruntime as ort

from .pipeline import TopDownModel

REPO_ROOT = Path(__file__).resolve().parents[3]
MODEL_DIR = Path(os.environ.get("HPE_MODEL_DIR", REPO_ROOT / "apps" / "web" / "public" / "models"))
PREFER_GPU = os.environ.get("HPE_DEVICE", "auto").lower() != "cpu"

# The 17 COCO keypoints, same order and names as apps/web/src/keypoints.ts.
KEYPOINT_NAMES = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle",
    "right_ankle",
]


@dataclass(frozen=True)
class ModelSpec:
    id: str
    label: str
    family: str
    file: str
    pipeline: str
    detector: str
    keypoint_conf: str
    input_width: int
    input_height: int

    def public(self) -> dict:
        return {
            "id": self.id, "label": self.label, "family": self.family, "file": self.file, "pipeline": self.pipeline,
            "detector": self.detector, "keypointConf": self.keypoint_conf,
            "available": (MODEL_DIR / self.file).exists() and (MODEL_DIR / self.detector).exists(),
        }


MODELS: dict[str, ModelSpec] = {
    "rtmpose-m": ModelSpec(
        id="rtmpose-m", label="RTMPose-m (body7, 256×192)", family="RTMPose", file="rtmpose-m.onnx",
        pipeline="top-down", detector="yolo11n.onnx", keypoint_conf="SimCC peak, min(x, y) (≈0–1, not a probability)",
        input_width=192, input_height=256,
    ),
}

_loaded: dict[str, TopDownModel] = {}
_lock = threading.Lock()
_dlls_loaded = False


def load(model_id: str) -> TopDownModel:
    """Loads (once) and returns the model; raises KeyError / FileNotFoundError."""
    global _dlls_loaded
    spec = MODELS[model_id]
    with _lock:
        if model_id not in _loaded:
            for f in (spec.file, spec.detector):
                if not (MODEL_DIR / f).exists():
                    raise FileNotFoundError(f"{MODEL_DIR / f} not found; run `npm run models` from the repository root")
            if not _dlls_loaded and PREFER_GPU and hasattr(ort, "preload_dlls"):
                # CUDA / cuDNN DLLs installed by pip (onnxruntime-gpu[cuda,cudnn]).
                try:
                    ort.preload_dlls()
                except Exception as err:
                    print(f"Could not preload CUDA DLLs: {err}")
                _dlls_loaded = True
            _loaded[model_id] = TopDownModel(MODEL_DIR / spec.file, MODEL_DIR / spec.detector,
                                             spec.input_width, spec.input_height, PREFER_GPU)
        return _loaded[model_id]


def loaded_device(model_id: str) -> str | None:
    m = _loaded.get(model_id)
    return m.device if m else None
