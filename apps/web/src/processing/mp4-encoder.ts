// Encodes annotated frames into an H.264 MP4 (WebCodecs + mp4-muxer) with exact
// per-frame timestamps, so the output keeps the source timing at any processing speed.
import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export interface Mp4Encoder {
  addFrame(canvas: HTMLCanvasElement, frameIndex: number): Promise<void>;
  finish(): Promise<Blob>;
}

const H264_CODECS = ["avc1.640033", "avc1.640028", "avc1.4d0028", "avc1.42E01F"]; // best first
const MAX_QUEUED_FRAMES = 4;

async function pickEncoderConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig | null> {
  if (!("VideoEncoder" in window)) return null;
  const bitrate = Math.min(20e6, Math.max(2e6, width * height * fps * 0.12));
  for (const codec of H264_CODECS) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps };
    try {
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    } catch { /* try the next codec */ }
  }
  return null;
}

/** Returns null if this browser cannot encode H.264. */
export async function createMp4Encoder(width: number, height: number, fps: number): Promise<Mp4Encoder | null> {
  const config = await pickEncoderConfig(width, height, fps);
  if (!config) return null;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: fps },
    fastStart: "in-memory",
  });
  let error: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (error = e),
  });
  encoder.configure(config);

  const frameCanvas = new OffscreenCanvas(width, height);
  const ctx = frameCanvas.getContext("2d")!;

  return {
    async addFrame(canvas, frameIndex) {
      if (error) return; // reported by finish()
      ctx.drawImage(canvas, 0, 0, width, height);
      const frame = new VideoFrame(frameCanvas, {
        timestamp: Math.round((frameIndex / fps) * 1e6),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: frameIndex % (fps * 2) === 0 }); // a keyframe every 2 s
      frame.close();
      // Don't let unencoded frames pile up in memory.
      while (encoder.encodeQueueSize > MAX_QUEUED_FRAMES) await new Promise((r) => setTimeout(r, 1));
    },

    async finish() {
      if (error) throw error;
      await encoder.flush();
      encoder.close();
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: "video/mp4" });
    },
  };
}
