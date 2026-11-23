// The app's state and steps: load the model (RTMPose-m) → open an input → process it → show and
// save the results. React components only read `AppState` and call these methods; all the
// long-running work (model loading, frame loops) lives here, outside React.
import { annotate } from "@ultralytics/yolo";
import { MODEL } from "../models";
import { listDataFiles, listSavedRuns, loadDataFile, loadSavedAngles, loadSavedRun, loadSavedSync, saveResults, saveRunFiles } from "../api";
import { processVideo, seekVideo, type VideoProgress } from "../processing/video";
import { processImage } from "../processing/image";
import { checkServer, processVideoOnServer, type ServerProgress } from "../processing/server";
import { startWebcam, type WebcamSession } from "../processing/webcam";
import { analyzeRun, buildOutputFiles } from "../results/output-files";
import { analyzeSavedRun } from "../results/saved-run";
import { analyzeSync, DEFAULT_EPISODE_SETTINGS, type Angles, type SyncResult } from "../sync/index.ts";
import { countPeople } from "../sync/assign.ts";
import { syncFiles } from "../sync/files.ts";
import { loadResolutionCheck, type ResolutionCheck } from "../analysis/resolution-check";
import { readVideoInfo } from "../processing/video-info";
import type {
  OutputFiles, PoseModel, Run, RunAnalysis, SavedRunSummary, Source, VideoInfo,
} from "../types";

export interface Settings {
  conf: number;
  /** Out-of-sync moments: a person counts as late from this lag (s); only changes which moments are listed */
  lateSec: number;
  /** Processing frame rate for videos */
  fps: number;
  exportMp4: boolean;
  autosave: boolean;
  /** Where videos are processed: in this browser, or on the Python HPE server (apps/server) */
  backend: Backend;
  /** Playback speed of the result videos (1 = normal); a viewer setting, kept when another run is opened */
  playbackSpeed: number;
}

export type Backend = "browser" | "server";

/** The HPE server as last checked (only when the Server backend is picked). */
export type ServerStatus =
  | { kind: "unchecked" }
  | { kind: "checking" }
  | { kind: "ready"; device: string | null; text: string }
  | { kind: "error"; text: string };

export interface ModelStatus {
  kind: "loading" | "ready" | "error";
  text: string;
}

/** Top-level pages, picked in the header. */
export type Page = "pose" | "saved" | "resolution";

/** The saved resolution-check analysis, loaded on demand. */
export type AnalysisLoad<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; message: string };

/** A finished run, ready to display. */
export interface RunView {
  run: Run;
  analysis: RunAnalysis;
  output: OutputFiles;
  modelLabel: string;
  device: string;
}

/** A saved run, read back from results/ for viewing. */
export interface SavedRunView {
  run: SavedRunSummary;
  analysis: RunAnalysis;
  /** false: saved before the metrics block existed, so metrics were recomputed from the frames */
  metricsSaved: boolean;
  /** The run's saved -sync.json; "missing" until computed (computeSavedSync) */
  sync: AnalysisLoad<SyncResult> | { kind: "missing" };
  /** The run's saved -angles.csv (for which joints were late); null when missing or unreadable */
  syncAngles: Angles | null;
}

/** Key of a saved run in AppState.selectedSavedRun. */
export const savedRunKey = (run: SavedRunSummary) => `${run.model}/${run.stem}`;

export interface AppState {
  page: Page;
  resolutionCheck: AnalysisLoad<ResolutionCheck>;
  /** Runs saved in results/, for the Saved results page */
  savedRuns: AnalysisLoad<SavedRunSummary[]>;
  /** Key ("<model>/<stem>") of the saved run being viewed */
  selectedSavedRun: string | null;
  savedRun: AnalysisLoad<SavedRunView>;
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
  server: ServerStatus;
}

const INITIAL_STATE: AppState = {
  page: "pose",
  resolutionCheck: { kind: "idle" },
  savedRuns: { kind: "idle" },
  selectedSavedRun: null,
  savedRun: { kind: "idle" },
  modelStatus: { kind: "loading", text: "Loading model…" },
  busy: false,
  source: null,
  sourceInfo: "",
  dataFiles: [],
  selectedDataFile: null,
  settings: { conf: 0.25, lateSec: DEFAULT_EPISODE_SETTINGS.lagSec, fps: 30, exportMp4: true, autosave: true, backend: "browser", playbackSpeed: 1 },
  progress: null,
  progressText: "",
  webcamOn: false,
  result: null,
  saveInfo: "",
  server: { kind: "unchecked" },
};

/** Which controls can be used right now. */
export function controlAvailability(state: AppState) {
  const modelReady = state.modelStatus.kind === "ready";
  const ready = modelReady && !state.busy;
  const hasVideo = state.source?.kind === "video";
  return {
    openInput: ready,
    toggleWebcam: modelReady && (!state.busy || state.webcamOn), // stays usable to stop the webcam
    process: ready && hasVideo && (state.settings.backend === "browser" || state.server.kind === "ready"),
    stop: state.busy && state.modelStatus.kind !== "loading",
  };
}

export class AppController {
  private state = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();

  // Live objects the steps work with; not rendered, so kept out of AppState.
  private model: PoseModel | null = null;
  private stage: { video: HTMLVideoElement; canvas: HTMLCanvasElement } | null = null;
  private webcam: WebcamSession | null = null;
  private stopRequested = false;
  private sourceVideoUrl: string | null = null;
  /** The open video file, uploaded as is when the server processes it */
  private sourceFile: File | null = null;
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
    void this.loadModel();
    void this.refreshDataList();
  }

  // ---------- pages ----------

  /** Switches page. Runs keep going in the background; the analysis loads the first time it's opened. */
  setPage(page: Page) {
    this.update({ page });
    if (page === "resolution" && this.state.resolutionCheck.kind === "idle") void this.reloadResolutionCheck();
    if (page === "saved") void this.reloadSavedRuns(); // pick up runs saved since the last visit
  }

  /** (Re)lists the runs in results/. */
  async reloadSavedRuns() {
    if (this.state.savedRuns.kind !== "ready") this.update({ savedRuns: { kind: "loading" } });
    try {
      this.update({ savedRuns: { kind: "ready", data: await listSavedRuns() } });
    } catch (err) {
      this.update({ savedRuns: { kind: "error", message: (err as Error).message } });
    }
  }

  /** Loads one saved run's JSON and rebuilds its stats; nothing is processed again. */
  async openSavedRun(key: string) {
    const runs = this.state.savedRuns.kind === "ready" ? this.state.savedRuns.data : [];
    const run = runs.find((r) => savedRunKey(r) === key);
    if (!run) return;
    this.update({ selectedSavedRun: key, savedRun: { kind: "loading" } });
    try {
      const [json, sync, syncAngles] = await Promise.all([
        loadSavedRun(run),
        run.files["-sync.json"] ? loadSavedSync(run) : null,
        // Optional: without it the out-of-sync moments are still listed, just without the joints.
        run.files["-angles.csv"] ? loadSavedAngles(run).catch(() => null) : null,
      ]);
      const { analysis, metricsSaved } = analyzeSavedRun(json);
      if (this.state.selectedSavedRun !== key) return; // another run was picked meanwhile
      this.update({
        savedRun: { kind: "ready", data: {
          run, analysis, metricsSaved, sync: sync ? { kind: "ready", data: sync } : { kind: "missing" }, syncAngles,
        } },
      });
    } catch (err) {
      if (this.state.selectedSavedRun !== key) return;
      this.update({ savedRun: { kind: "error", message: (err as Error).message } });
    }
  }

  /** (Re)reads results/resolution-check/, e.g. after running analysis/resolution_check.py again. */
  async reloadResolutionCheck() {
    this.update({ resolutionCheck: { kind: "loading" } });
    try {
      this.update({ resolutionCheck: { kind: "ready", data: await loadResolutionCheck() } });
    } catch (err) {
      this.update({ resolutionCheck: { kind: "error", message: (err as Error).message } });
    }
  }

  /**
   * Runs the synchronization algorithm on the open saved run and saves its files next to it
   * (<stem>-sync.json, -sync-windows.csv, -sync-frames.csv, -angles.csv). Existing files are never overwritten.
   */
  async computeSavedSync() {
    const view = this.state.savedRun.kind === "ready" ? this.state.savedRun.data : null;
    if (!view) return;
    const key = savedRunKey(view.run);
    const setSync = (sync: SavedRunView["sync"], syncAngles: Angles | null = null) => {
      const current = this.state.savedRun;
      if (current.kind === "ready" && savedRunKey(current.data.run) === key) {
        this.update({ savedRun: { kind: "ready", data: { ...current.data, sync, syncAngles } } });
      }
    };
    setSync({ kind: "loading" });
    try {
      const json = await loadSavedRun(view.run);
      const analysis = analyzeSync(json.frames, json.fps ?? json.sourceVideo?.fps ?? 25);
      const files = syncFiles(analysis, json.frames, {
        model: view.run.model, modelLabel: json.modelLabel, source: json.source, sourcePath: json.sourcePath,
      });
      await saveRunFiles(view.run.model, view.run.stem, files.map((f) => ({ suffix: f.suffix, blob: new Blob([f.text], { type: f.type }) })));
      setSync({ kind: "ready", data: analysis.result }, analysis.angles);
      void this.reloadSavedRuns(); // the list now shows the new files
    } catch (err) {
      setSync({ kind: "error", message: (err as Error).message });
    }
  }

  updateSettings(patch: Partial<Settings>) {
    this.update({ settings: { ...this.state.settings, ...patch } });
    if (patch.backend === "server") void this.checkServer();
  }

  /** Checks that the HPE server is up and has the model (loading it there, so its device is known). */
  async checkServer() {
    this.update({ server: { kind: "checking" } });
    try {
      const health = await checkServer(MODEL.id);
      this.update({
        server: health.modelAvailable
          ? { kind: "ready", device: health.device, text: `Server ready · ${MODEL.label} · ${health.device ?? "device unknown"}` }
          : { kind: "error", text: "The server has no weights: run `npm run models`" },
      });
    } catch (err) {
      this.update({ server: { kind: "error", text: (err as Error).message } });
    }
  }

  // ---------- model ----------

  /** Loads the model (and warms it up). */
  private async loadModel() {
    this.update({ busy: true, modelStatus: { kind: "loading", text: `Loading ${MODEL.label}…` } });
    try {
      this.model = await MODEL.load();
      this.update({ modelStatus: { kind: "ready", text: `${MODEL.label} ready · ${this.model.device}` } });
    } catch (err) {
      console.error(err);
      this.update({ modelStatus: { kind: "error", text: `${MODEL.label} failed to load: ${(err as Error).message}` } });
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
    // busy until the preview is drawn, so Process can't start while the video is still opening
    this.update({ result: null, busy: true, sourceInfo: `Reading ${file.name}…` });
    const info = await readVideoInfo(file);
    this.update({ source: { kind, name: file.name, path, info } });
    if (kind === "image") await this.runImage(file);
    else await this.openVideo(file, info);
    this.update({ busy: false });
  }

  private async openVideo(file: File, info: VideoInfo) {
    const { video, canvas } = this.stageElements;
    this.sourceFile = file;
    video.srcObject = null;
    if (this.sourceVideoUrl) URL.revokeObjectURL(this.sourceVideoUrl);
    this.sourceVideoUrl = URL.createObjectURL(file);
    video.src = this.sourceVideoUrl;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Cannot decode this video"));
    });
    const native = info.frameCount && info.fps ? ` · ${info.frameCount} frames @ ${info.fps} fps` : "";
    this.update({ sourceInfo: `${file.name} · ${video.videoWidth}×${video.videoHeight} · ${video.duration.toFixed(2)} s${native}` });
    // Process at the native rate by default: a higher rate repeats frames, a lower one skips them.
    if (info.fps) this.updateSettings({ fps: clampFps(info.fps) });

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

  private async processCurrentVideo() {
    const { video, canvas } = this.stageElements;
    const { settings } = this.state;
    this.stopRequested = false;
    this.update({ result: null, busy: true, progress: { done: 0, total: 1 } });

    let run: Run, device: string | undefined;
    if (settings.backend === "server") {
      if (!this.sourceFile) throw new Error("No video file to upload");
      const server = await processVideoOnServer({
        file: this.sourceFile,
        fileName: this.sourceFile.name,
        modelId: MODEL.id,
        video,
        canvas,
        fps: clampFps(settings.fps),
        conf: settings.conf,
        exportMp4: settings.exportMp4,
        native: this.state.source?.info,
        shouldStop: () => this.stopRequested,
        onProgress: (progress) => this.showServerProgress(progress),
      });
      run = { ...server.run, backend: { kind: "server", ...server.timing } };
      device = server.device;
    } else {
      run = await processVideo({
        model: this.model!,
        video,
        canvas,
        fps: clampFps(settings.fps),
        conf: settings.conf,
        exportMp4: settings.exportMp4,
        native: this.state.source?.info,
        shouldStop: () => this.stopRequested,
        onProgress: (progress) => this.showVideoProgress(progress),
      });
      run = { ...run, backend: { kind: "browser" } };
    }

    const outcome = this.stopRequested ? "Stopped" : "Done";
    const note = run.mediaError ? ` · ${run.mediaError}` : "";
    this.update({
      progress: null,
      progressText: `${outcome}: ${run.frames.length} frames in ${(run.wallMs / 1000).toFixed(1)} s${note}`,
    });
    await this.finishRun(run, device);
    this.update({ busy: false });
  }

  private showServerProgress({ stage, done, total, elapsedMs }: ServerProgress) {
    const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
    const text = {
      upload: `Uploading to the server · ${mb(done)} / ${mb(total)} MB`,
      queued: "Waiting for the server (another job is running)…",
      server: `Server: frame ${done}/${total} · ${(elapsedMs / 1000).toFixed(0)} s`,
      drawing: `Drawing the annotated video · frame ${done}/${total}`,
    }[stage];
    this.update({ progress: { done, total: Math.max(1, total) }, progressText: text });
  }

  private showVideoProgress({ done, total, elapsedMs, persons }: VideoProgress) {
    const framesPerSecond = done / (elapsedMs / 1000);
    const eta = Math.ceil((total - done) / framesPerSecond);
    this.update({
      progress: { done, total },
      progressText: `Frame ${done}/${total} · ${framesPerSecond.toFixed(1)} frames/s · ETA ${eta} s · ${persons} person(s)`,
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
    this.update({ result: null, busy: true, source: { kind: "webcam", name: "webcam", path: null, info: null } });
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
  /** `device` overrides the browser model's device (server runs). */
  private async finishRun(run: Run, device = this.model!.device) {
    // Expected people = the most common count in the first 2 s, as the sync algorithm counts them (report 3.3).
    const analysis = analyzeRun(run, Math.max(1, countPeople(run.frames)), true);
    const output = buildOutputFiles({ run, spec: MODEL, device, source: this.state.source }, analysis);
    this.update({ result: { run, analysis, output, modelLabel: MODEL.label, device }, saveInfo: "" });

    if (!this.state.settings.autosave || !run.frames.length) return;
    this.update({ saveInfo: "Saving to results/…" });
    try {
      this.update({ saveInfo: `Saved to ${await saveResults(MODEL.id, output.baseName, output.files)}` });
    } catch (err) {
      this.update({ saveInfo: `Not saved (${(err as Error).message}); use the download buttons.` });
    }
  }

  private fail(err: unknown, where: "progressText" | "sourceInfo" = "progressText") {
    console.error(err);
    this.update({ [where]: `Error: ${(err as Error).message}`, busy: false, progress: null });
  }
}

const clampFps = (fps: number) => Math.max(1, Math.min(60, Math.round(fps) || 30));
