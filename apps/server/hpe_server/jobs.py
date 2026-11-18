"""Processing jobs: an uploaded video is processed frame by frame (none skipped) in one worker thread, so jobs
on the GPU run one at a time. The upload is deleted as soon as its job ends (done, failed or cancelled);
results stay in memory until the client fetches them and deletes the job."""
from __future__ import annotations

import queue
import shutil
import tempfile
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import cv2

from . import models

UPLOAD_DIR = Path(tempfile.gettempdir()) / "hpe-server-uploads"


@dataclass
class Job:
    id: str
    model_id: str
    conf: float
    fps: float | None          # processing rate; None = the video's own rate
    planned: int | None        # frames to process (the browser's floor(duration * fps)); None = all
    video_path: Path
    filename: str
    status: str = "queued"     # queued | running | done | error | cancelled
    done: int = 0
    total: int = 0
    error: str | None = None
    device: str | None = None
    created: float = field(default_factory=time.time)
    started: float | None = None
    finished: float | None = None
    width: int = 0
    height: int = 0
    native_fps: float | None = None
    native_frames: int | None = None
    frames: list[dict] = field(default_factory=list)
    cancel: threading.Event = field(default_factory=threading.Event)

    def public(self) -> dict:
        elapsed = ((self.finished or time.time()) - self.started) if self.started else 0.0
        return {
            "id": self.id, "status": self.status, "model": self.model_id, "device": self.device,
            "done": self.done, "total": self.total, "progress": self.done / self.total if self.total else 0.0,
            "elapsedMs": round(elapsed * 1000, 1), "error": self.error, "filename": self.filename,
            "width": self.width, "height": self.height, "nativeFps": self.native_fps, "nativeFrames": self.native_frames,
        }

    def keypoints(self) -> dict:
        """Same fields as the browser run (apps/web/src/types.ts Run + FrameRecord)."""
        spec = models.MODELS[self.model_id]
        return {
            "model": spec.public(), "device": self.device, "width": self.width, "height": self.height,
            "fps": self.fps or self.native_fps, "conf": self.conf, "plannedFrames": self.total,
            "processingMs": round(((self.finished or time.time()) - (self.started or time.time())) * 1000, 1),
            "frames": self.frames,
        }


_jobs: dict[str, Job] = {}
_queue: "queue.Queue[str]" = queue.Queue()


def create(upload, filename: str, model_id: str, conf: float, fps: float | None, planned: int | None) -> Job:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    job_id = uuid.uuid4().hex[:12]
    path = UPLOAD_DIR / f"{job_id}{Path(filename).suffix or '.mp4'}"
    with open(path, "wb") as f:
        shutil.copyfileobj(upload, f, length=1 << 20)
    job = Job(job_id, model_id, conf, fps, planned, path, filename)
    _jobs[job_id] = job
    _queue.put(job_id)
    return job


def get(job_id: str) -> Job | None:
    return _jobs.get(job_id)


def delete(job_id: str) -> bool:
    job = _jobs.pop(job_id, None)
    if not job:
        return False
    job.cancel.set()
    if job.status == "queued":
        job.status = "cancelled"
        _remove(job.video_path)
    return True


def _remove(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def _worker() -> None:
    while True:
        job = _jobs.get(_queue.get())
        if job is None or job.cancel.is_set():
            continue
        try:
            _run(job)
            job.status = "cancelled" if job.cancel.is_set() else "done"
        except Exception as err:
            traceback.print_exc()
            job.status, job.error = "error", str(err)
        finally:
            job.finished = time.time()
            _remove(job.video_path)


def _run(job: Job) -> None:
    job.status, job.started = "running", time.time()
    model = models.load(job.model_id)
    job.device = model.device
    cap = cv2.VideoCapture(str(job.video_path))
    if not cap.isOpened():
        raise ValueError(f"cannot open {job.filename}")
    try:
        native_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        native_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        job.native_fps, job.native_frames = (native_fps or None), (native_frames or None)
        job.width, job.height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = job.fps or native_fps or 30.0
        duration = native_frames / native_fps if native_fps and native_frames else None
        total = job.planned or (int(duration * fps) if duration else native_frames)
        job.total = max(1, total)

        # Frame i is at time i / fps (as the browser seeks); it shows the video frame floor(time * native_fps).
        index, frame = -1, None
        for i in range(job.total):
            if job.cancel.is_set():
                return
            t = i / fps
            if duration:
                t = min(t, duration - 0.001)
            want = int(t * native_fps + 1e-6) if native_fps else i
            while index < want:
                ok, nxt = cap.read()
                if not ok:
                    break
                index, frame = index + 1, nxt
            if frame is None:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pred = model.predict(rgb, job.conf)
            job.frames.append(_frame_record(i, t, pred))
            job.done = i + 1
    finally:
        cap.release()


def _frame_record(i: int, t: float, pred) -> dict:
    """apps/web/src/results/records.ts toFrameRecord: same keys and rounding."""
    r1 = lambda v: round(float(v), 1)
    r3 = lambda v: round(float(v), 3)
    return {
        "frame": i,
        "time": r3(t),
        "persons": [{
            "box": [r1(v) for v in p.box],
            "conf": r3(p.conf),
            "keypoints": [{"name": models.KEYPOINT_NAMES[k] if k < len(models.KEYPOINT_NAMES) else f"kpt_{k}",
                           "x": r1(x), "y": r1(y), "conf": r3(c)} for k, (x, y, c) in enumerate(p.points)],
        } for p in pred.persons],
        "speed": {"preprocess": r1(pred.pre_ms), "inference": r1(pred.inf_ms), "postprocess": r1(pred.post_ms)},
    }


threading.Thread(target=_worker, name="hpe-worker", daemon=True).start()
