import { YOLO, annotate } from "@ultralytics/yolo";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

const MODEL_URL = "/models/yolo11n-pose.onnx";

// COCO-17 keypoint order used by YOLO pose models.
const KPT_NAMES = [
  "nose", "left_eye", "right_eye", "left_ear", "right_ear",
  "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
  "left_wrist", "right_wrist", "left_hip", "right_hip",
  "left_knee", "right_knee", "left_ankle", "right_ankle",
];

const $ = (id) => document.getElementById(id);
const els = {
  status: $("status"), file: $("file"), webcam: $("webcam"), sourceInfo: $("source-info"),
  conf: $("conf"), confOut: $("conf-out"), fps: $("fps"), encode: $("encode"),
  process: $("process"), stop: $("stop"), progress: $("progress"), progressText: $("progress-text"),
  canvas: $("canvas"), video: $("video"),
  results: $("results"), stats: $("stats"), kptTable: $("kpt-table"),
  dlVideo: $("dl-video"), dlJson: $("dl-json"), dlCsv: $("dl-csv"),
  resultVideoWrap: $("result-video-wrap"), resultVideo: $("result-video"),
};

let model = null;
let source = null; // { kind: "video" | "image" | "webcam", name, file? }
let stopRequested = false;
let busy = false;
let objectUrls = [];
let sourceUrl = null;

// ---------- helpers ----------

const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const conf = () => Number(els.conf.value);

function setStatus(text, cls = "") {
  els.status.textContent = text;
  els.status.className = `status ${cls}`;
}

function setBusy(on) {
  busy = on;
  els.file.disabled = on;
  els.webcam.disabled = on && source?.kind !== "webcam";
  els.process.disabled = on || source?.kind !== "video";
  els.stop.disabled = !on;
}

function trackUrl(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function resetResults() {
  objectUrls.forEach(URL.revokeObjectURL);
  objectUrls = [];
  els.results.hidden = true;
  els.resultVideoWrap.hidden = true;
  els.dlVideo.hidden = true;
  els.resultVideo.removeAttribute("src");
}

function toRecord(frame, time, r) {
  return {
    frame,
    time: r3(time),
    persons: r.boxes.map((b, i) => ({
      box: [r1(b.x1), r1(b.y1), r1(b.x2), r1(b.y2)],
      conf: r3(b.conf),
      keypoints: (r.keypoints[i]?.points ?? []).map(([x, y, c], k) => ({
        name: KPT_NAMES[k] ?? `kpt_${k}`, x: r1(x), y: r1(y), conf: r3(c),
      })),
    })),
    speed: { preprocess: r1(r.speed.preprocess), inference: r1(r.speed.inference), postprocess: r1(r.speed.postprocess) },
  };
}

function seek(video, t) {
  return new Promise((resolve) => {
    video.addEventListener("seeked", resolve, { once: true });
    video.currentTime = t;
  });
}

// ---------- model ----------

async function loadModel() {
  try {
    model = await YOLO.load(MODEL_URL);
    // Warm-up: the first run compiles GPU shaders and would distort timing stats.
    setStatus("Warming up…");
    await model.predict(new ImageData(640, 640));
    setStatus(`Model ready · ${model.task} · ${model.device}`, "ok");
    els.file.disabled = false;
    els.webcam.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(`Model failed to load: ${err.message}`, "err");
  }
}

// ---------- input ----------

els.conf.addEventListener("input", () => (els.confOut.textContent = conf().toFixed(2)));

els.file.addEventListener("change", async () => {
  const file = els.file.files[0];
  if (!file) return;
  stopWebcam();
  resetResults();
  if (file.type.startsWith("image/")) {
    source = { kind: "image", name: file.name, file };
    await runImage(file);
  } else {
    source = { kind: "video", name: file.name, file };
    const v = els.video;
    v.srcObject = null;
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = URL.createObjectURL(file); // kept apart from result URLs, which resetResults() revokes
    v.src = sourceUrl;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("Cannot decode this video")); });
    els.sourceInfo.textContent = `${file.name} · ${v.videoWidth}×${v.videoHeight} · ${v.duration.toFixed(1)} s`;
    // Preview the first frame with pose on it.
    await seek(v, 0);
    const r = await model.predict(v, { conf: conf() });
    await annotate(els.canvas, v, r);
  }
  setBusy(false);
});

// ---------- image ----------

async function runImage(file) {
  setBusy(true);
  const r = await model.predict(file, { conf: conf() });
  await annotate(els.canvas, file, r);
  els.sourceInfo.textContent = `${file.name} · ${r.width}×${r.height}`;
  const frames = [toRecord(0, 0, r)];
  const png = await new Promise((res) => els.canvas.toBlob(res, "image/png"));
  showResults({ frames, width: r.width, height: r.height, fps: null, wallMs: r.speed.inference, media: png, mediaName: "annotated.png" });
  setBusy(false);
}

// ---------- video (offline, frame by frame) ----------

async function pickEncoderConfig(width, height, fps) {
  if (!("VideoEncoder" in window)) return null;
  const bitrate = Math.min(20e6, Math.max(2e6, width * height * fps * 0.12));
  for (const codec of ["avc1.640033", "avc1.640028", "avc1.4d0028", "avc1.42E01F"]) {
    const cfg = { codec, width, height, bitrate, framerate: fps };
    try {
      if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
    } catch { /* try next */ }
  }
  return null;
}

async function processVideo() {
  const v = els.video;
  const fps = Math.max(1, Math.min(60, Number(els.fps.value) || 30));
  const total = Math.max(1, Math.floor(v.duration * fps));
  const w = v.videoWidth & ~1; // H.264 needs even dimensions
  const h = v.videoHeight & ~1;

  resetResults();
  setBusy(true);
  stopRequested = false;
  els.progress.hidden = false;
  els.progress.max = total;

  // Optional MP4 encoder (WebCodecs + mp4-muxer) with exact per-frame timestamps.
  let encoder = null, muxer = null, encCanvas = null, encCtx = null, encError = null;
  if (els.encode.checked) {
    const cfg = await pickEncoderConfig(w, h, fps);
    if (cfg) {
      muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: w, height: h, frameRate: fps }, fastStart: "in-memory" });
      encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encError = e) });
      encoder.configure(cfg);
      encCanvas = new OffscreenCanvas(w, h);
      encCtx = encCanvas.getContext("2d");
    } else {
      els.progressText.textContent = "MP4 export not supported in this browser — results only.";
    }
  }

  const frames = [];
  const t0 = performance.now();
  for (let i = 0; i < total && !stopRequested; i++) {
    const t = Math.min(i / fps, v.duration - 0.001);
    await seek(v, t);
    const r = await model.predict(v, { conf: conf() });
    await annotate(els.canvas, v, r);
    frames.push(toRecord(i, t, r));

    if (encoder && !encError) {
      encCtx.drawImage(els.canvas, 0, 0, w, h);
      const vf = new VideoFrame(encCanvas, { timestamp: Math.round((i / fps) * 1e6), duration: Math.round(1e6 / fps) });
      encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (encoder.encodeQueueSize > 4) await new Promise((res) => setTimeout(res, 1));
    }

    const elapsed = (performance.now() - t0) / 1000;
    const rate = (i + 1) / elapsed;
    els.progress.value = i + 1;
    els.progressText.textContent =
      `Frame ${i + 1}/${total} · ${rate.toFixed(1)} frames/s · ETA ${Math.ceil((total - i - 1) / rate)} s · ${r.boxes.length} person(s)`;
  }
  const wallMs = performance.now() - t0;

  let media = null, note = "";
  if (encoder) {
    try {
      if (encError) throw encError;
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      media = new Blob([muxer.target.buffer], { type: "video/mp4" });
    } catch (err) {
      console.error(err);
      note = ` · MP4 export failed: ${err.message}`;
    }
  }

  els.progress.hidden = true;
  els.progressText.textContent = `${stopRequested ? "Stopped" : "Done"}: ${frames.length} frames in ${(wallMs / 1000).toFixed(1)} s${note}`;
  showResults({ frames, width: w, height: h, fps, wallMs, media, mediaName: "annotated.mp4" });
  setBusy(false);
}

els.process.addEventListener("click", () => processVideo().catch((err) => {
  console.error(err);
  els.progressText.textContent = `Error: ${err.message}`;
  setBusy(false);
}));
els.stop.addEventListener("click", () => {
  stopRequested = true;
  if (source?.kind === "webcam") stopWebcam(true);
});

// ---------- webcam (live) ----------

let webcam = null; // { stream, recorder, chunks, frames, t0 }

async function startWebcam() {
  resetResults();
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
  const v = els.video;
  v.src = "";
  v.srcObject = stream;
  await v.play();
  source = { kind: "webcam", name: "webcam" };
  els.sourceInfo.textContent = `Webcam · ${v.videoWidth}×${v.videoHeight}`;
  els.webcam.textContent = "Stop webcam";
  setBusy(true);
  stopRequested = false;

  // First annotate sizes the canvas; then start recording it.
  const first = await model.predict(v, { conf: conf() });
  await annotate(els.canvas, v, first);

  const chunks = [];
  let recorder = null;
  if (els.encode.checked && "MediaRecorder" in window) {
    recorder = new MediaRecorder(els.canvas.captureStream(30), { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(1000);
  }
  webcam = { stream, recorder, chunks, frames: [], t0: performance.now() };

  let last = performance.now(), fpsAvg = 0;
  const loop = async () => {
    if (!webcam || stopRequested) return;
    const r = await model.predict(v, { conf: conf() });
    await annotate(els.canvas, v, r);
    const now = performance.now();
    webcam.frames.push(toRecord(webcam.frames.length, (now - webcam.t0) / 1000, r));
    fpsAvg = fpsAvg ? fpsAvg * 0.9 + (1000 / (now - last)) * 0.1 : 1000 / (now - last);
    last = now;
    els.progressText.textContent = `Live · ${fpsAvg.toFixed(1)} FPS · inference ${r.speed.inference.toFixed(1)} ms · ${r.boxes.length} person(s)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function stopWebcam(showSummary = false) {
  if (!webcam) return;
  const { stream, recorder, chunks, frames, t0 } = webcam;
  webcam = null;
  stopRequested = true;
  let media = null;
  if (recorder) {
    await new Promise((res) => { recorder.onstop = res; recorder.stop(); });
    media = new Blob(chunks, { type: "video/webm" });
  }
  stream.getTracks().forEach((t) => t.stop());
  els.video.srcObject = null;
  els.webcam.textContent = "Start webcam";
  source = null;
  setBusy(false);
  if (showSummary && frames.length) {
    const c = els.canvas;
    showResults({ frames, width: c.width, height: c.height, fps: null, wallMs: performance.now() - t0, media, mediaName: "annotated-webcam.webm" });
  }
}

els.webcam.addEventListener("click", () => {
  if (webcam) stopWebcam(true);
  else startWebcam().catch((err) => {
    console.error(err);
    els.progressText.textContent = `Webcam error: ${err.message}`;
    setBusy(false);
  });
});

// ---------- results ----------

function summarize(frames) {
  const n = frames.length;
  const withPerson = frames.filter((f) => f.persons.length).length;
  const persons = frames.reduce((s, f) => s + f.persons.length, 0);
  const mean = (key) => frames.reduce((s, f) => s + f.speed[key], 0) / Math.max(1, n);
  const perKpt = KPT_NAMES.map((name, k) => {
    let sum = 0, cnt = 0, visible = 0;
    for (const f of frames) for (const p of f.persons) {
      const kp = p.keypoints[k];
      if (!kp) continue;
      sum += kp.conf; cnt++;
      if (kp.conf >= 0.5) visible++;
    }
    return { name, meanConf: cnt ? sum / cnt : 0, visibleRate: cnt ? visible / cnt : 0 };
  });
  return { n, withPerson, persons, pre: mean("preprocess"), inf: mean("inference"), post: mean("postprocess"), perKpt };
}

function toCsv(frames) {
  const head = ["frame", "time", "person", "person_conf", "x1", "y1", "x2", "y2",
    ...KPT_NAMES.flatMap((n) => [`${n}_x`, `${n}_y`, `${n}_conf`])];
  const rows = [head.join(",")];
  for (const f of frames) f.persons.forEach((p, i) => {
    rows.push([f.frame, f.time, i, p.conf, ...p.box, ...p.keypoints.flatMap((k) => [k.x, k.y, k.conf])].join(","));
  });
  return rows.join("\n");
}

function showResults({ frames, width, height, fps, wallMs, media, mediaName }) {
  const s = summarize(frames);
  const stat = (value, label) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
  els.stats.innerHTML = [
    stat(model.device, "Device"),
    stat(`${width}×${height}`, "Resolution"),
    stat(s.n, "Frames processed"),
    stat(`${s.withPerson} (${((s.withPerson / Math.max(1, s.n)) * 100).toFixed(0)}%)`, "Frames with a person"),
    stat((s.persons / Math.max(1, s.n)).toFixed(2), "Avg persons / frame"),
    stat(`${s.inf.toFixed(1)} ms`, "Avg inference"),
    stat(`${(s.pre + s.inf + s.post).toFixed(1)} ms`, "Avg pre+inf+post"),
    stat(`${(1000 / (s.pre + s.inf + s.post || 1)).toFixed(1)}`, "Model FPS (theoretical)"),
    stat(`${(s.n / (wallMs / 1000)).toFixed(1)}`, "Pipeline FPS (measured)"),
  ].join("");

  els.kptTable.innerHTML =
    `<tr><th>Keypoint</th><th>Mean confidence</th><th>Visible (conf ≥ 0.5)</th><th></th></tr>` +
    s.perKpt.map((k) => `<tr><td>${k.name}</td><td>${k.meanConf.toFixed(3)}</td><td>${(k.visibleRate * 100).toFixed(1)}%</td>` +
      `<td style="width:30%"><div class="bar" style="width:${(k.visibleRate * 100).toFixed(1)}%"></div></td></tr>`).join("");

  const meta = {
    model: MODEL_URL.split("/").pop(), device: model.device, source: source?.name ?? "webcam",
    width, height, fps, confThreshold: conf(), keypointNames: KPT_NAMES, summary: { ...s, perKpt: undefined }, frames,
  };
  const base = (source?.name ?? "webcam").replace(/\.[^.]+$/, "");
  els.dlJson.href = trackUrl(new Blob([JSON.stringify(meta, null, 1)], { type: "application/json" }));
  els.dlJson.download = `${base}-pose.json`;
  els.dlCsv.href = trackUrl(new Blob([toCsv(frames)], { type: "text/csv" }));
  els.dlCsv.download = `${base}-pose.csv`;

  if (media) {
    const url = trackUrl(media);
    els.dlVideo.href = url;
    els.dlVideo.download = `${base}-${mediaName}`;
    els.dlVideo.textContent = media.type.startsWith("image/") ? "Download annotated image" : "Download annotated video";
    els.dlVideo.hidden = false;
    if (media.type.startsWith("video/")) {
      els.resultVideo.src = url;
      els.resultVideoWrap.hidden = false;
    }
  }
  els.results.hidden = false;
}

loadModel();
