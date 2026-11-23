// "Saved results" page: browse every run saved in results/<model>/ and view its annotated video,
// stats, tracking and keypoint table, read back from the saved files (no processing).
import { useMemo, useState } from "react";
import {
  Alert, Anchor, Badge, Button, Card, Code, Group, Loader, Select, Stack, Table, Text, Title,
} from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";
import { savedRunKey, type SavedRunView } from "../app/controller";
import { MODEL } from "../models";
import { SyncSummary, SyncTitle, SyncedVideo } from "./SyncPanel";
import { PlaybackVideo } from "./PlaybackVideo";
import { resultsUrl } from "../api";
import type { SavedRunSummary } from "../types";
import { KeypointTable } from "./KeypointTable";
import { comparisonStats } from "./ResultsPanel";
import { StatGrid, type Stat } from "./StatGrid";
import { TrackingSection } from "./TrackingSection";

const ALL = "__all__";
const MEDIA_SUFFIX = /^-annotated\.(mp4|webm|png)$/;

export function SavedResultsPage() {
  const controller = useController();
  const { savedRuns } = useAppState();

  return (
    <Stack gap="lg" maw={1400}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={2}>Saved results</Title>
          <Text c="dimmed" size="sm" maw={760}>
            Every run saved in <Code>results/&lt;model&gt;/</Code>. Pick one to see its annotated video and stats,
            read from the saved files; nothing is processed again.
          </Text>
        </div>
        <Button variant="default" size="xs" onClick={() => controller.reloadSavedRuns()}
          loading={savedRuns.kind === "loading"}>
          Reload list
        </Button>
      </Group>

      {savedRuns.kind === "loading" && <Group gap="xs"><Loader size="sm" /><Text size="sm">Reading results/…</Text></Group>}
      {savedRuns.kind === "error" && (
        <Alert color="red" title="Cannot list saved results">
          <Text size="sm">{savedRuns.message}</Text>
          <Text size="sm" mt="xs">Saved results are read through the dev server: run <Code>npm run dev</Code>.</Text>
        </Alert>
      )}
      {savedRuns.kind === "ready" && (savedRuns.data.length
        ? <Browser runs={savedRuns.data} />
        : <Text size="sm" c="dimmed">No saved runs yet: process a video on the Pose estimation page with saving on.</Text>)}
    </Stack>
  );
}

function Browser({ runs }: { runs: SavedRunSummary[] }) {
  const controller = useController();
  const { selectedSavedRun, savedRun } = useAppState();
  const sorted = useMemo(() => [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [runs]);

  // Default filter: the video of the newest run (all its models side by side).
  const sources = useMemo(() => countBy(sorted, (r) => r.source), [sorted]);
  const [source, setSource] = useState<string>(sorted[0]?.source ?? ALL);
  // The app runs RTMPose-m; the other models' runs (the model comparison) stay viewable under "All models".
  const [model, setModel] = useState<string>(sorted.some((r) => r.model === MODEL.id) ? MODEL.id : ALL);
  const modelLabel = (id: string) => sorted.find((r) => r.model === id && r.modelLabel)?.modelLabel ?? id;
  const shown = sorted.filter((r) => (source === ALL || r.source === source) && (model === ALL || r.model === model));

  return (
    <Stack gap="lg">
      <Card withBorder padding="md">
        <Stack gap="sm">
          <Group gap="sm" wrap="wrap">
            <Select label="Video" size="xs" w={300} value={source} allowDeselect={false}
              onChange={(v) => setSource(v ?? ALL)}
              data={[{ value: ALL, label: `All videos (${sorted.length})` },
                ...[...sources].map(([name, n]) => ({ value: name, label: `${name} (${n})` }))]} />
            <Select label="Model" size="xs" w={240} value={model} allowDeselect={false}
              onChange={(v) => setModel(v ?? ALL)}
              data={[{ value: ALL, label: "All models" },
                ...[...countBy(sorted, (r) => r.model)].map(([id, n]) => ({ value: id, label: `${modelLabel(id)} (${n})` }))]} />
          </Group>
          <RunTable runs={shown} selected={selectedSavedRun} onSelect={(key) => controller.openSavedRun(key)} />
        </Stack>
      </Card>

      {savedRun.kind === "idle" && <Text size="sm" c="dimmed">Click a run to view it.</Text>}
      {savedRun.kind === "loading" && <Group gap="xs"><Loader size="sm" /><Text size="sm">Loading run…</Text></Group>}
      {savedRun.kind === "error" && <Alert color="red" title="Cannot load this run">{savedRun.message}</Alert>}
      {savedRun.kind === "ready" && <RunDetail view={savedRun.data} />}
    </Stack>
  );
}

function RunTable({ runs, selected, onSelect }: {
  runs: SavedRunSummary[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  if (!runs.length) return <Text size="sm" c="dimmed">No runs match these filters.</Text>;
  return (
    <Table.ScrollContainer minWidth={820}>
      <Table highlightOnHover verticalSpacing={6} style={{ fontVariantNumeric: "tabular-nums" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th>
            <Table.Th>Run</Table.Th>
            <Table.Th>Saved</Table.Th>
            <Table.Th>Frames</Table.Th>
            <Table.Th>FPS</Table.Th>
            <Table.Th>All people found</Table.Th>
            <Table.Th>ms / frame</Table.Th>
            <Table.Th>Device</Table.Th>
            <Table.Th>Video</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {runs.map((run) => {
            const key = savedRunKey(run);
            const s = run.summary;
            return (
              <Table.Tr key={key} onClick={() => onSelect(key)} style={{ cursor: "pointer" }}
                bg={key === selected ? "var(--mantine-primary-color-light)" : undefined}
                aria-selected={key === selected}>
                <Table.Td>{run.modelLabel ?? run.model}</Table.Td>
                <Table.Td><Text size="sm" ff="monospace">{run.stem}</Text></Table.Td>
                <Table.Td>{formatDate(run.createdAt)}</Table.Td>
                <Table.Td>
                  {run.frameCount}
                  {run.processing && !run.processing.completed && <Badge ml={6} size="xs" color="yellow" variant="light">stopped</Badge>}
                </Table.Td>
                <Table.Td>{run.fps ?? "–"}</Table.Td>
                <Table.Td>{run.tracking ? `${(run.tracking.allTrackedRate * 100).toFixed(0)}%` : "–"}</Table.Td>
                <Table.Td>{(s.pre + s.inf + s.post).toFixed(0)}</Table.Td>
                <Table.Td>{run.device}</Table.Td>
                <Table.Td>{mediaPath(run) ? "✓" : "–"}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function RunDetail({ view }: { view: SavedRunView }) {
  const { run, analysis, metricsSaved } = view;
  const media = mediaPath(run);

  return (
    <Card withBorder padding="lg">
      <Stack gap="lg">
        <div>
          <Title order={3}>{run.modelLabel ?? run.model} · <Text span ff="monospace" fz="inherit">{run.stem}</Text></Title>
          <Text size="sm" c="dimmed">{sourceLine(run)}</Text>
        </div>

        {media && view.sync.kind === "ready" && !media.endsWith(".png") && view.sync.data.pairs.length > 0
          ? <SyncedVideo src={resultsUrl(media)} sync={view.sync.data} angles={view.syncAngles} />
          : media && (media.endsWith(".png")
            ? <img src={resultsUrl(media)} alt={`${run.stem} annotated`} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} />
            : <PlaybackVideo src={resultsUrl(media)} style={{ width: "auto", maxWidth: "100%" }} />)}
        {!media && <Text size="sm" c="dimmed">No annotated video was saved for this run.</Text>}

        <Stack gap="xs">
          <SyncTitle />
          <SavedSync view={view} />
        </Stack>

        <StatGrid stats={runStats(run)} />

        <Stack gap="xs">
          <Title order={4}>Comparison metrics</Title>
          {!metricsSaved && (
            <Text size="sm" c="dimmed">This run was saved before metrics were recorded; they are recomputed from its frames.</Text>
          )}
          <StatGrid stats={comparisonStats(analysis.metrics)} />
        </Stack>

        <TrackingSection rows={analysis.trackingRows} summary={analysis.tracking} />

        <Stack gap="xs">
          <Title order={4}>Per-keypoint statistics</Title>
          <KeypointTable stats={analysis.perKeypoint} />
        </Stack>

        <Stack gap={4}>
          <Title order={4}>Files</Title>
          <Group gap="md">
            {Object.entries(run.files).sort().map(([suffix, path]) => (
              <Anchor key={suffix} href={resultsUrl(path)} target="_blank" size="sm" ff="monospace">
                {run.stem}{suffix}
              </Anchor>
            ))}
          </Group>
        </Stack>
      </Stack>
    </Card>
  );
}

/** The run's synchronization: its saved results, or a button that computes and saves them. */
function SavedSync({ view }: { view: SavedRunView }) {
  const controller = useController();
  const { sync } = view;
  if (sync.kind === "ready") {
    return sync.data.pairs.length
      ? <SyncSummary sync={sync.data} />
      : <Text size="sm" c="dimmed">Only {sync.data.personCount} person found in the first 2 s, so there is nothing to compare.</Text>;
  }
  if (sync.kind === "error") return <Alert color="red" title="Synchronization failed">{sync.message}</Alert>;
  return (
    <Group gap="sm">
      <Button size="xs" onClick={() => controller.computeSavedSync()} loading={sync.kind === "loading"}>
        Compute synchronization
      </Button>
      <Text size="sm" c="dimmed">
        Not computed for this run yet. Runs the algorithm on the saved keypoints and saves
        <Code>{view.run.stem}-sync.json</Code>, <Code>-sync-windows.csv</Code>, <Code>-sync-frames.csv</Code> and <Code>-angles.csv</Code> next to them.
      </Text>
    </Group>
  );
}

function runStats(run: SavedRunSummary): Stat[] {
  const s = run.summary;
  const frames = Math.max(1, s.n);
  const totalMs = s.pre + s.inf + s.post;
  return [
    { label: "Device", value: run.device },
    { label: "Resolution", value: `${run.width}×${run.height}` },
    { label: "Frames processed", value: s.n },
    { label: "Frames with a person", value: `${s.withPerson} (${((s.withPerson / frames) * 100).toFixed(0)}%)` },
    { label: "Avg persons / frame", value: (s.persons / frames).toFixed(2) },
    { label: "Avg inference", value: `${s.inf.toFixed(1)} ms` },
    { label: "Avg pre+inf+post", value: `${totalMs.toFixed(1)} ms` },
    { label: "Model FPS (theoretical)", value: (1000 / (totalMs || 1)).toFixed(1) },
    { label: "Pipeline FPS (measured)", value: run.metrics ? run.metrics.pipelineFps.toFixed(1) : "not saved" },
    { label: "Conf threshold", value: run.confThreshold },
  ];
}

/** "poomsae-720reso.mp4 · 720×1280 · 856 frames @ 25 fps · SHA-256 1038eb4a… · 21 Oct 2026, 22:45" */
function sourceLine(run: SavedRunSummary): string {
  const info = run.sourceVideo;
  const parts = [run.sourcePath ?? run.source];
  if (info?.width && info.height) parts.push(`${info.width}×${info.height}`);
  if (info?.frameCount && info.fps) parts.push(`${info.frameCount} frames @ ${info.fps} fps`);
  if (info?.sha256) parts.push(`SHA-256 ${info.sha256.slice(0, 8)}…`);
  parts.push(`processed at ${run.fps ?? "–"} fps`);
  parts.push(`saved ${formatDate(run.createdAt)}`);
  return parts.join(" · ");
}

const mediaPath = (run: SavedRunSummary) =>
  Object.entries(run.files).find(([suffix]) => MEDIA_SUFFIX.test(suffix))?.[1] ?? null;


const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}
