"""HPE server: runs the pose model on uploaded videos and returns the keypoints in the browser's JSON format.
It only does HPE; synchronization, metrics and saving stay in the web app (apps/web), which reaches this server
through the Vite proxy at /server-api.

  GET    /health                status, models and the device they run on
  POST   /jobs                  multipart: video file, model (default rtmpose-m), conf, fps, frames -> {id, ...}
  GET    /jobs/{id}             status: queued | running | done | error | cancelled, progress, elapsedMs
  GET    /jobs/{id}/keypoints   the frames (same schema as the browser's saved frames), when done
  DELETE /jobs/{id}             cancel and forget the job (the uploaded video is deleted when its job ends)
"""
from __future__ import annotations

import onnxruntime as ort
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from . import jobs, models

app = FastAPI(title="HPE server", version="0.1.0")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "onnxruntime": ort.__version__,
        "providers": ort.get_available_providers(),
        "models": [{**spec.public(), "device": models.loaded_device(spec.id)} for spec in models.MODELS.values()],
    }


@app.post("/models/{model_id}/load")
def load_model(model_id: str) -> dict:
    """Loads the model now (else the first job does), so the client can show the device it will run on."""
    if model_id not in models.MODELS:
        raise HTTPException(404, f"unknown model {model_id}")
    try:
        return {"id": model_id, "device": models.load(model_id).device}
    except FileNotFoundError as err:
        raise HTTPException(503, str(err))


@app.post("/jobs")
def create_job(
    file: UploadFile = File(...),
    model: str = Form("rtmpose-m"),
    conf: float = Form(0.25),
    fps: float | None = Form(None),
    frames: int | None = Form(None),
) -> dict:
    if model not in models.MODELS:
        raise HTTPException(400, f"unknown model {model}; known: {', '.join(models.MODELS)}")
    job = jobs.create(file.file, file.filename or "video.mp4", model, conf, fps, frames)
    return job.public()


@app.get("/jobs/{job_id}")
def job_status(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    return job.public()


@app.get("/jobs/{job_id}/keypoints")
def job_keypoints(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "no such job")
    if job.status != "done":
        raise HTTPException(409, f"job is {job.status}")
    return job.keypoints()


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str) -> dict:
    if not jobs.delete(job_id):
        raise HTTPException(404, "no such job")
    return {"id": job_id, "deleted": True}
