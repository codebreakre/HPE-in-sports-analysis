// Results of the latest run: stats, downloads, annotated video (with live synchronization scores),
// synchronization summary, people tracking, keypoint table.
import { useEffect, useState } from "react";
import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useAppState } from "../app/AppContext";
import type { RunView } from "../app/controller";
import type { OutputFile, OutputKind, RunMetrics } from "../types";
import type { Angles, SyncResult } from "../sync/index.ts";
import { SyncSummary, SyncTitle, SyncedVideo } from "./SyncPanel";
import { PlaybackVideo } from "./PlaybackVideo";
import { KeypointTable } from "./KeypointTable";
import { StatGrid, type Stat } from "./StatGrid";
import { TrackingSection } from "./TrackingSection";

export function ResultsPanel() {
  const { result, saveInfo } = useAppState();
  if (!result) return null;
  const { analysis, output } = result;
  const sync = analysis.sync?.result ?? null;

  return (
    <Card withBorder padding="lg">
      <Stack gap="lg">
        <div>
          <Title order={3}>Results</Title>
          {saveInfo && <Text size="sm" c="dimmed">{saveInfo}</Text>}
        </div>
        <StatGrid stats={runStats(result)} />
        <Stack gap="xs">
          <Title order={4}>Comparison metrics</Title>
          <Text size="sm" c="dimmed">Saved to the JSON <code>metrics</code> block and <code>-metrics.csv</code>. Jitter and limb CV: lower is steadier.</Text>
          <StatGrid stats={comparisonStats(analysis.metrics)} />
        </Stack>
        <Downloads baseName={output.baseName} files={output.files} sync={sync?.pairs.length ? sync : null} angles={analysis.sync?.angles ?? null} />
        {sync && (
          <Stack gap="xs">
            <SyncTitle />
            {sync.pairs.length
              ? <SyncSummary sync={sync} />
              : <Text size="sm" c="dimmed">Only {sync.personCount} person found in the first 2 s, so there is nothing to compare.</Text>}
          </Stack>
        )}
        <TrackingSection rows={analysis.trackingRows} summary={analysis.tracking} />
        <Stack gap="xs">
          <Title order={4}>Per-keypoint statistics</Title>
          <KeypointTable stats={analysis.perKeypoint} />
        </Stack>
      </Stack>
    </Card>
  );
}

function runStats({ run, analysis, modelLabel, device }: RunView): Stat[] {
  const s = analysis.summary;
  const frames = Math.max(1, s.n);
  const totalMs = s.pre + s.inf + s.post;
  return [
    { label: "Model", value: modelLabel },
    { label: "Device", value: device },
    { label: "Resolution", value: `${run.width}×${run.height}` },
    { label: "Frames processed", value: s.n },
    { label: "Frames with a person", value: `${s.withPerson} (${((s.withPerson / frames) * 100).toFixed(0)}%)` },
    { label: "Avg persons / frame", value: (s.persons / frames).toFixed(2) },
    { label: "Avg inference", value: `${s.inf.toFixed(1)} ms` },
    { label: "Avg pre+inf+post", value: `${totalMs.toFixed(1)} ms` },
    { label: "Model FPS (theoretical)", value: (1000 / (totalMs || 1)).toFixed(1) },
    { label: "Pipeline FPS (measured)", value: (s.n / (run.wallMs / 1000)).toFixed(1) },
  ];
}

export function comparisonStats(m: RunMetrics): Stat[] {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return [
    { label: "Total ms / frame (p95)", value: `${m.meanTotalMs.toFixed(1)} (${m.p95TotalMs.toFixed(1)})` },
    { label: "Frames missing people", value: pct(m.missedFrameRate) },
    { label: "Frames over-detected", value: pct(m.overDetectedRate) },
    { label: "Tracks (long tracks)", value: `${m.trackCount} (${m.longTrackCount})` },
    { label: "Keypoints conf < 0.3", value: pct(m.lowConfRate) },
    { label: "Jitter, % box height", value: m.jitterPct.toFixed(2) },
    { label: "Jitter median", value: m.jitterMedianPct.toFixed(2) },
    { label: "Limb length CV", value: `${m.limbCvPct.toFixed(1)}%` },
  ];
}

const DOWNLOAD_LABELS: Record<OutputKind, string> = {
  json: "JSON",
  poseCsv: "Pose CSV",
  trackingCsv: "Tracking CSV",
  metricsCsv: "Metrics CSV",
  keypointMetricsCsv: "Keypoint metrics CSV",
  syncJson: "Sync JSON",
  syncWindowsCsv: "Sync windows CSV",
  syncFramesCsv: "Sync per-frame CSV",
  anglesCsv: "Angles CSV",
  media: "Annotated video",
};

/** Download buttons for each output file, plus a player for the annotated video. */
function Downloads({ baseName, files, sync, angles }: { baseName: string; files: OutputFile[]; sync: SyncResult | null; angles: Angles | null }) {
  const urls = useObjectUrls(files);
  if (urls.length !== files.length) return null;
  const videoIndex = files.findIndex((f) => f.kind === "media" && f.blob.type.startsWith("video/"));

  return (
    <Stack gap="sm">
      <Group gap="xs">
        {files.map((file, i) => (
          <Button key={file.kind} component="a" href={urls[i]} download={baseName + file.suffix} variant="default" size="xs">
            {file.kind === "media" && file.blob.type.startsWith("image/") ? "Annotated image" : DOWNLOAD_LABELS[file.kind]}
          </Button>
        ))}
      </Group>
      {videoIndex >= 0 && (sync
        ? <SyncedVideo src={urls[videoIndex]} sync={sync} angles={angles} />
        : <PlaybackVideo src={urls[videoIndex]} style={{ width: "auto", maxWidth: "100%", maxHeight: "60vh" }} />)}
    </Stack>
  );
}

/** Object URLs for the blobs, revoked when the files change or the component unmounts. */
function useObjectUrls(files: OutputFile[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const created = files.map((f) => URL.createObjectURL(f.blob));
    setUrls(created);
    return () => created.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  return urls;
}
