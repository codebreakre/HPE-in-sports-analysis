// The app's state and steps: pick a model → open an input → process it → show and save
// the results. React components only read `AppState` and call these methods; all the
// long-running work (model loading, frame loops) lives here, outside React.
import { annotate } from "@ultralytics/yolo";
import { MODELS } from "../models";
import { listDataFiles, loadDataFile, saveResults } from "../api";
import { processVideo, seekVideo, type VideoProgress } from "../processing/video";
import { processImage } from "../processing/image";
import { startWebcam, type WebcamSession } from "../processing/webcam";
import { analyzeRun, buildOutputFiles } from "../results/output-files";
import type { ModelSpec, OutputFiles, PoseModel, Run, RunAnalysis, Source } from "../types";

export interface Settings {
  conf: number;
  expectedPersons: number;
  /** Processing frame rate for videos */
  fps: number;
  exportMp4: boolean;
  autosave: boolean;
}

export interface ModelStatus {
  kind: "loading" | "ready" | "error";
  text: string;
}

/** A finished run, ready to display. */
export interface RunView {
  run: Run;
  analysis: RunAnalysis;
  output: OutputFiles;
  modelLabel: string;
  device: string;
}

export interface AppState {
  modelId: string;
  modelStatus: ModelStatus;
  busy: boolean;
  source: Source | null;
  /** Line under the input controls, e.g. "clip.mp4 · 1920×1080 · 38.4 s" */
  sourceInfo: string;
  /** Files under data/; null when the dev server isn't available */
  dataFiles: string[] | null;
  selectedDataFile: string | null;
  settings: Settings;
  progress: { done: number; total: number } | null;
  progressText: string;
  webcamOn: boolean;
  result: RunView | null;
  saveInfo: string;
}

const INITIAL_STATE: AppState = {
  modelId: MODELS[0].id,
  modelStatus: { kind: "loading", text: "Loading model…" },
  busy: false,
  source: null,
  sourceInfo: "",
  dataFiles: [],
  selectedDataFile: null,
  settings: { conf: 0.25, expectedPersons: 3, fps: 30, exportMp4: true, autosave: true },
  progress: null,
  progressText: "",
  webcamOn: false,
  result: null,
  saveInfo: "",
};

/** Which controls can be used right now. */
export function controlAvailability(state: AppState) {
  const modelReady = state.modelStatus.kind === "ready";
  const ready = modelReady && !state.busy;
  const hasVideo = state.source?.kind === "video";
  return {
    changeModel: !state.busy,
    openInput: ready,
    toggleWebcam: modelReady && (!state.busy || state.webcamOn), // stays usable to stop the webcam
    process: ready && hasVideo,
    stop: state.busy && state.modelStatus.kind !== "loading",
  };
}

export class AppController {
  private state = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();

  // Live objects the steps work with; not rendered, so kept out of AppState.
  private model: PoseModel | null = null;
  private readonly loadedModels = new Map<string, Promise<PoseModel>>(); // so switching back is instant
  private stage: { video: HTMLVideoElement; canvas: HTMLCanvasElement } | null = null;
  private webcam: WebcamSession | null = null;
  private stopRequested = false;
  private runLabel = ""; // progress prefix while processing with all models, e.g. "[2/5 YOLOv8n-pose] "
  private sourceVideoUrl: string | null = null;
  private started = false;

  // ---------- store (React reads it through useSyncExternalStore) ----------

  getState = (): AppState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private get spec(): ModelSpec {
    return MODELS.find((m) => m.id === this.state.modelId) ?? MODELS[0];
  }

  private get stageElements() {
    if (!this.stage) throw new Error("Stage not ready");
    return this.stage;
  }

  // ---------- setup ----------

  /** Called once the <video> and <canvas> elements exist. */
  attachStage(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
    this.stage = { video, canvas };
  }

  start() {
    if (this.started) return; // React may mount twice in development
    this.started = true;
    void this.selectModel(MODELS[0].id);
    void this.refreshDataList();
  }

  updateSettings(patch: Partial<Settings>) {
    this.update({ settings: { ...this.state.settings, ...patch } });
  }

  // ---------- model ----------

  /** Loads (or reuses) a model from MODELS. Returns false if it failed to load. */
  async selectModel(id: string): Promise<boolean> {
    const spec = MODELS.find((m) => m.id === id) ?? MODELS[0];
    this.model = null;
    this.update({ modelId: spec.id, busy: true, modelStatus: { kind: "loading", text: `Loading ${spec.label}…` } });
    try {
      if (!this.loadedModels.has(spec.id)) this.loadedModels.set(spec.id, spec.load()); // load() also warms up
      this.model = await this.loadedModels.get(spec.id)!;
      this.update({ modelStatus: { kind: "ready", text: `${spec.label} ready · ${this.model.device}` } });
      return true;
    } catch (err) {
      this.loadedModels.delete(spec.id);
      console.error(err);
      this.update({ modelStatus: { kind: "error", text: `${spec.label} failed to load: ${(err as Error).message}` } });
      return false;
    } finally {
      this.update({ busy: false });
    }
  }

  // ---------- input ----------

  async refreshDataList() {
    try {
      this.update({ dataFiles: await listDataFiles() });
    } catch {
      this.update({ dataFiles: null });
    }
  }

  async openDataFile(path: string) {
    this.update({ selectedDataFile: path, sourceInfo: `Loading ${path}…` });
    try {
      await this.openInput(await loadDataFile(path), `data/${path}`);
    } catch (err) {
      this.fail(err, "sourceInfo");
    }
  }

  async openFile(file: File) {
    this.update({ selectedDataFile: null });
    try {
      await this.openInput(file, null);
    } catch (err) {
      this.fail(err, "sourceInfo");
    }
  }

  /** Opens a video or image. `path` is its location inside data/, when it came from there. */
  private async openInput(file: File, path: string | null) {
    await this.stopWebcam();
    const kind = file.type.startsWith("image/") ? "image" : "video";
    this.update({ result: null, source: { kind, name: file.name, path } });
    if (kind === "image") await this.runImage(file);
    else await this.openVideo(file);
    this.update({ busy: false });
  }

  private async openVideo(file: File) {
    const { video, canvas } = this.stageElements;
    video.srcObject = null;
    if (this.sourceVideoUrl) URL.revokeObjectURL(this.sourceVideoUrl);
    this.sourceVideoUrl = URL.createObjectURL(file);
    video.src = this.sourceVideoUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Cannot decode this video"));
    });
    this.update({ sourceInfo: `${file.name} · ${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(1)} s` });

    // Preview: the first frame with the pose drawn on it.
    await seekVideo(video, 0);
    await annotate(canvas, video, await this.model!.predict(video, { conf: this.state.settings.conf }));
  }

  // ---------- processing ----------

  async runVideo() {
    try {
      await this.processCurrentVideo();
    } catch (err) {
      this.fail(err);
    }
  }

  /** Runs the current video through every model in turn; each saves to its own results/<model>/ folder. */
  async runAllModels() {
    const startId = this.spec.id;
    try {
      for (const [i, spec] of MODELS.entries()) {
        this.runLabel = `[${i + 1}/${MODELS.length} ${spec.label}] `;
        if (!(await this.selectModel(spec.id))) continue; // the status shows why; go on with the next model
        await this.processCurrentVideo();
        if (this.stopRequested) break;
      }
      this.runLabel = "";
      if (this.spec.id !== startId && !this.stopRequested) await this.selectModel(startId);
    } catch (err) {
      this.fail(err);
    }
  }

  private async processCurrentVideo() {
    const { video, canvas } = this.stageElements;
    const { settings } = this.state;
    this.stopRequested = false;
    this.update({ result: null, busy: true, progress: { done: 0, total: 1 } });

    const run = await processVideo({
      model: this.model!,
      video,
      canvas,
      fps: clampFps(settings.fps),
      conf: settings.conf,
      exportMp4: settings.exportMp4,
      shouldStop: () => this.stopRequested,
      onProgress: (progress) => this.showVideoProgress(progress),
    });

    const outcome = this.stopRequested ? "Stopped" : "Done";
    const note = run.mediaError ? ` · ${run.mediaError}` : "";
    this.update({
      progress: null,
      progressText: `${this.runLabel}${outcome}: ${run.frames.length} frames in ${(run.wallMs / 1000).toFixed(1)} s${note}`,
    });
    await this.finishRun(run);
    this.update({ busy: false });
  }

  private showVideoProgress({ done, total, elapsedMs, persons }: VideoProgress) {
    const framesPerSecond = done / (elapsedMs / 1000);
    const eta = Math.ceil((total - done) / framesPerSecond);
    this.update({
      progress: { done, total },
      progressText: `${this.runLabel}Frame ${done}/${total} · ${framesPerSecond.toFixed(1)} frames/s · ETA ${eta} s · ${persons} person(s)`,
    });
  }

  private async runImage(file: File) {
    this.update({ busy: true });
    const run = await processImage({
      model: this.model!,
      file,
      canvas: this.stageElements.canvas,
      conf: this.state.settings.conf,
    });
    this.update({ sourceInfo: `${file.name} · ${run.width}×${run.height}` });
    await this.finishRun(run);
  }

  async toggleWebcam() {
    try {
      if (this.webcam) await this.stopWebcam({ showSummary: true });
      else await this.startWebcamRun();
    } catch (err) {
      this.update({ source: null }); // e.g. camera permission denied
      this.fail(err);
    }
  }

  private async startWebcamRun() {
    const { video, canvas } = this.stageElements;
    this.stopRequested = false;
    this.update({ result: null, busy: true, source: { kind: "webcam", name: "webcam", path: null } });
    this.webcam = await startWebcam({
      model: this.model!,
      video,
      canvas,
      conf: this.state.settings.conf,
      record: this.state.settings.exportMp4,
      onFrame: ({ fps, inferenceMs, persons }) => this.update({
        progressText: `Live · ${fps.toFixed(1)} FPS · inference ${inferenceMs.toFixed(1)} ms · ${persons} person(s)`,
      }),
    });
    this.update({ webcamOn: true, sourceInfo: `Webcam · ${video.videoWidth}×${video.videoHeight}` });
  }

  private async stopWebcam({ showSummary = false } = {}) {
    if (!this.webcam) return;
    const session = this.webcam;
    this.webcam = null;
    this.stopRequested = true;
    const run = await session.stop();
    this.update({ webcamOn: false });
    if (showSummary && run.frames.length) await this.finishRun(run);
    this.update({ source: null, busy: false });
  }

  /** Stop button: ends the video run (or all-models run) after the current frame, or stops the webcam. */
  stop() {
    this.stopRequested = true;
    if (this.webcam) void this.stopWebcam({ showSummary: true });
  }

  // ---------- results ----------

  /** Shows a finished run and, if auto-save is on, writes it to results/<model>/. */
  private async finishRun(run: Run) {
    const spec = this.spec;
    const device = this.model!.device;
    const analysis = analyzeRun(run.frames, clampExpected(this.state.settings.expectedPersons));
    const output = buildOutputFiles({ run, spec, device, source: this.state.source }, analysis);
    this.update({ result: { run, analysis, output, modelLabel: spec.label, device }, saveInfo: "" });

    if (!this.state.settings.autosave || !run.frames.length) return;
    this.update({ saveInfo: "Saving to results/…" });
    try {
      this.update({ saveInfo: `Saved to ${await saveResults(spec.id, output.baseName, output.files)}` });
    } catch (err) {
      this.update({ saveInfo: `Not saved (${(err as Error).message}); use the download buttons.` });
    }
  }

  private fail(err: unknown, where: "progressText" | "sourceInfo" = "progressText") {
    console.error(err);
    this.runLabel = "";
    this.update({ [where]: `Error: ${(err as Error).message}`, busy: false, progress: null });
  }
}

const clampFps = (fps: number) => Math.max(1, Math.min(60, Math.round(fps) || 30));
const clampExpected = (n: number) => Math.max(1, Math.round(n) || 1);
