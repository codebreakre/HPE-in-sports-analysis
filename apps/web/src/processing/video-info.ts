// Facts about the input file itself, saved with every run so results can be tied to the exact
// video: size, SHA-256 (same hash = same file), and for MP4/MOV the native frame count, frame
// rate, duration and codec read from the container header (moov box). No decoding needed.
import type { VideoInfo } from "../types";

export async function readVideoInfo(file: File): Promise<VideoInfo> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return {
    fileName: file.name,
    fileSize: file.size,
    sha256: [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    lastModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    ...readMp4Track(new DataView(buffer)),
  };
}

type TrackInfo = Pick<VideoInfo, "codec" | "width" | "height" | "durationSec" | "frameCount" | "fps" | "variableFrameRate">;

const UNKNOWN: TrackInfo = {
  codec: null, width: null, height: null, durationSec: null, frameCount: null, fps: null, variableFrameRate: null,
};

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "mvex", "moof", "traf"]);
const TRACK_BOXES = new Set(["tkhd", "mdhd", "hdlr", "stsd", "stsz", "stts"]);

/** Boxes found while walking the file: per-track headers, plus fragment tables (fragmented MP4). */
interface Mp4Boxes {
  tracks: Record<string, DataView>[];
  /** trex: track ID → default sample duration */
  trex: Map<number, number>;
  /** One entry per traf: its track, and the duration of every sample in its truns */
  fragments: { trackId: number; durations: number[] }[];
}

/**
 * The first video track of an MP4/MOV; all fields null if the file isn't one.
 * Handles plain files (sample tables in stbl) and fragmented ones (samples in moof/traf/trun).
 */
export function readMp4Track(view: DataView): TrackInfo {
  const boxes: Mp4Boxes = { tracks: [], trex: new Map(), fragments: [] };
  try {
    walk(view, 0, view.byteLength, null, boxes);
  } catch {
    return UNKNOWN; // not an MP4, or a broken one
  }
  const track = boxes.tracks.find((t) => t.hdlr && fourcc(t.hdlr, 8) === "vide");
  if (!track?.mdhd) return UNKNOWN;

  const { timescale } = mdhd(track.mdhd);
  let deltas = track.stts ? sttsDeltas(track.stts) : [];
  let frameCount = track.stsz ? track.stsz.getUint32(8) : 0; // sample_count (one sample = one frame)
  let duration = mdhd(track.mdhd).duration;
  const trackId = track.tkhd ? tkhdTrackId(track.tkhd) : null;
  const fragments = boxes.fragments.filter((f) => f.trackId === trackId);
  if (fragments.length) {
    const durations = fragments.flatMap((f) => f.durations);
    frameCount += durations.length;
    duration = Math.max(duration, durations.reduce((s, d) => s + d, 0));
    deltas = [...new Set(durations)];
  }
  const durationSec = timescale && duration ? duration / timescale : null;
  const [width, height] = track.tkhd ? tkhdSize(track.tkhd) : [null, null];
  return {
    codec: track.stsd ? fourcc(track.stsd, 12) : null,
    width,
    height,
    durationSec: durationSec === null ? null : round(durationSec, 4),
    frameCount: frameCount || null,
    fps: frameCount && durationSec ? round(frameCount / durationSec, 3) : null,
    variableFrameRate: deltas.length ? new Set(deltas).size > 1 : null,
  };
}

function walk(view: DataView, start: number, end: number, track: Record<string, DataView> | null, boxes: Mp4Boxes) {
  for (let pos = start; pos + 8 <= end;) {
    let size = view.getUint32(pos);
    const type = fourcc(view, pos + 4);
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) throw new Error("Bad MP4 box");
    const body = new DataView(view.buffer, view.byteOffset + pos + header, size - header);
    if (type === "trak") {
      const t: Record<string, DataView> = {};
      boxes.tracks.push(t);
      walk(view, pos + header, pos + size, t, boxes);
    } else if (type === "traf") {
      boxes.fragments.push(traf(body, boxes.trex));
    } else if (type === "trex") {
      boxes.trex.set(body.getUint32(4), body.getUint32(12));
    } else if (CONTAINERS.has(type)) {
      walk(view, pos + header, pos + size, track, boxes);
    } else if (track && TRACK_BOXES.has(type)) {
      track[type] = body;
    }
    pos += size;
  }
}

/** One track fragment: tfhd gives the track and default duration, each trun lists its samples. */
function traf(view: DataView, trex: Map<number, number>) {
  let trackId = -1;
  let defaultDuration = 0;
  const durations: number[] = [];
  for (let pos = 0; pos + 8 <= view.byteLength;) {
    const size = view.getUint32(pos);
    const type = fourcc(view, pos + 4);
    if (size < 8 || pos + size > view.byteLength) throw new Error("Bad MP4 box");
    const flags = view.getUint32(pos + 8) & 0xffffff;
    if (type === "tfhd") {
      trackId = view.getUint32(pos + 12);
      defaultDuration = trex.get(trackId) ?? 0;
      let at = pos + 16;
      if (flags & 0x01) at += 8; // base-data-offset
      if (flags & 0x02) at += 4; // sample-description-index
      if (flags & 0x08) defaultDuration = view.getUint32(at); // default-sample-duration
    } else if (type === "trun") {
      const count = view.getUint32(pos + 12);
      let at = pos + 16;
      if (flags & 0x01) at += 4; // data-offset
      if (flags & 0x04) at += 4; // first-sample-flags
      const fields = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f).length;
      for (let i = 0; i < count; i++) {
        durations.push(flags & 0x100 ? view.getUint32(at) : defaultDuration);
        at += fields * 4;
      }
    }
    pos += size;
  }
  return { trackId, durations };
}

function mdhd(box: DataView) {
  return box.getUint8(0) === 1
    ? { timescale: box.getUint32(20), duration: Number(box.getBigUint64(24)) }
    : { timescale: box.getUint32(12), duration: box.getUint32(16) };
}

function tkhdTrackId(box: DataView): number {
  return box.getUint32(box.getUint8(0) === 1 ? 20 : 12);
}

/** Display width/height: the last two 16.16 fixed-point fields of tkhd. */
function tkhdSize(box: DataView): [number, number] {
  const at = box.byteLength - 8;
  return [box.getUint32(at) / 65536, box.getUint32(at + 4) / 65536];
}

/** Distinct sample durations in stts; more than one means variable frame rate. */
function sttsDeltas(box: DataView): number[] {
  const entries = box.getUint32(4);
  return Array.from({ length: entries }, (_, i) => box.getUint32(8 + i * 8 + 4));
}

const fourcc = (view: DataView, at: number) =>
  String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
