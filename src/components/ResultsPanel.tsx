// Results of the latest run: stats, downloads, people tracking, annotated video, keypoint table.
import { useEffect, useState } from "react";
import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { useAppState } from "../app/AppContext";
import type { RunView } from "../app/controller";
import type { OutputFile, OutputKind } from "../types";
import { KeypointTable } from "./KeypointTable";
import { StatGrid, type Stat } from "./StatGrid";
import { TrackingSection } from "./TrackingSection";

export function ResultsPanel() {
  const { result, saveInfo } = useAppState();
  if (!result) return null;
  const { analysis, output } = result;

  return (
    <Card withBorder padding="lg">
      <Stack gap="lg">
        <div>
          <Title order={3}>Results</Title>
          {saveInfo && <Text size="sm" c="dimmed">{saveInfo}</Text>}
        </div>
        <StatGrid stats={runStats(result)} />
        <Downloads baseName={output.baseName} files={output.files} />
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

const DOWNLOAD_LABELS: Record<OutputKind, string> = {
  json: "JSON",
  poseCsv: "Pose CSV",
  trackingCsv: "Tracking CSV",
  media: "Annotated video",
};

/** Download buttons for each output file, plus a player for the annotated video. */
function Downloads({ baseName, files }: { baseName: string; files: OutputFile[] }) {
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
      {videoIndex >= 0 && (
        <video src={urls[videoIndex]} controls playsInline style={{ maxWidth: "100%", maxHeight: "60vh", borderRadius: 8, background: "black" }} />
      )}
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
