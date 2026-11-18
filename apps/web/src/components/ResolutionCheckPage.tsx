// "Resolution check" page: the same video at 360p / 480p / 720p through every model, compared on
// tracking, keypoint confidence, speed and how far keypoints move from the 720p result.
// Data: results/resolution-check/*.csv, written by analysis/resolution_check.py.
import { useState, type ReactNode } from "react";
import {
  Alert, Box, Button, Card, Code, Group, Loader, SegmentedControl, SimpleGrid, Stack, Table, Text, Title,
} from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";
import type { ResolutionCheck, ResolutionRow } from "../analysis/resolution-check";
import { GroupedBarChart, type BarSeries } from "./GroupedBarChart";
import { KeypointHeatmap } from "./KeypointHeatmap";
import { StatGrid, type Stat } from "./StatGrid";

export function ResolutionCheckPage() {
  const controller = useController();
  const { resolutionCheck } = useAppState();

  return (
    <Stack gap="lg" maw={1400}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={2}>Resolution check</Title>
          <Text c="dimmed" size="sm" maw={760}>
            Does lowering the video resolution change pose estimation? The same poomsae video (3 people, 30 fps) at
            360p, 480p and 720p, processed with every model. 720p is the reference for keypoint agreement.
          </Text>
        </div>
        <Button variant="default" size="xs" onClick={() => controller.reloadResolutionCheck()}
          loading={resolutionCheck.kind === "loading"}>
          Reload analysis
        </Button>
      </Group>

      {resolutionCheck.kind === "loading" && <Group gap="xs"><Loader size="sm" /><Text size="sm">Loading…</Text></Group>}
      {resolutionCheck.kind === "error" && (
        <Alert color="red" title="No resolution-check analysis found">
          <Text size="sm">{resolutionCheck.message}</Text>
          <Text size="sm" mt="xs">
            Process the three videos in <Code>data/resolution-check-data/</Code> with each model, then run{" "}
            <Code>python analysis/resolution_check.py</Code> and press Reload analysis.
          </Text>
        </Alert>
      )}
      {resolutionCheck.kind === "ready" && <Report data={resolutionCheck.data} />}
    </Stack>
  );
}

function Report({ data }: { data: ResolutionCheck }) {
  const { models, resolutions, reference, rows, keypoints } = data;
  const lower = resolutions.filter((r) => r !== reference);
  const [heatRes, setHeatRes] = useState(String(lower[0] ?? reference));

  const allSeries = resolutions.map((res, i) => seriesFor(res, i, resolutions.length));
  const lowerSeries = allSeries.filter((s) => s.key !== reference);
  const lookup = new Map(rows.map((r) => [`${r.model}|${r.resolution}`, r]));
  const get = (col: keyof ResolutionRow) => (model: string, res: number) => {
    const v = lookup.get(`${model}|${res}`)?.[col];
    return typeof v === "number" ? v : undefined;
  };

  const chart = (title: string, note: ReactNode, col: keyof ResolutionRow, format: (v: number) => string,
    opts: { max?: number; series?: BarSeries[]; range?: boolean } = {}) => (
    <ChartCard title={title} note={note}>
      <GroupedBarChart
        groups={models.map((m) => ({ id: m.id, label: m.label }))}
        series={opts.series ?? allSeries}
        value={get(col)}
        range={opts.range ? (m, r) => {
          const lo = get("inference_ms_min")(m, r), hi = get("inference_ms_max")(m, r);
          return lo !== undefined && hi !== undefined ? [lo, hi] : undefined;
        } : undefined}
        format={format}
        max={opts.max}
        ariaLabel={`${title}, per model and resolution`}
      />
    </ChartCard>
  );

  const pct0 = (v: number) => `${v.toFixed(0)}%`;
  const pct1 = (v: number) => `${v.toFixed(1)}%`;

  return (
    <Stack gap="xl">
      <Stack gap="xs">
        <Legend series={allSeries} />
        <StatGrid stats={headlineStats(data)} />
      </Stack>

      <Section title="Tracking" text="Are the 3 people found in every frame? Counts detections per frame (no identities).">
        {chart("Frames with all 3 people found", null, "all_tracked_pct", pct0, { max: 100 })}
        {chart("People found per frame (mean)", "Capped at 3.", "mean_tracked", (v) => v.toFixed(2), { max: 3 })}
        {chart("Frames with extra (false) detections", "More boxes than people in the frame.",
          "frames_over_detected", (v) => v.toFixed(0))}
      </Section>

      <Section title="Keypoint confidence" text="Confidence means something different per model: compare resolutions within one model, not models with each other.">
        {chart("Visible keypoints (conf ≥ 0.5)", null, "visible_kp_pct", pct0, { max: 100 })}
        {chart("Mean keypoint confidence", null, "mean_kp_conf", (v) => v.toFixed(2), { max: 1 })}
      </Section>

      <Section title="Speed" text="Models resize every frame to a fixed input size, so a bigger video is not more work for the network.">
        {chart("Inference time per frame", "Bar = newest run; line = min–max over repeated runs of the same video. Top-down models include the person detector.",
          "inference_ms", (v) => `${v.toFixed(0)} ms`, { range: true })}
      </Section>

      <Section title={`Agreement with ${reference}p`} text={`Each person is matched to the same person in the ${reference}p run; distance is divided by their box height. Measures consistency, not accuracy (no ground truth).`}>
        {chart(`Keypoints within 5% of ${reference}p (PCK@0.05)`, "Higher = closer to the 720p result.",
          "pck05_vs_720", pct1, { max: 100, series: lowerSeries })}
        {chart(`Mean keypoint shift from ${reference}p`, "% of person box height. Lower = closer.",
          "mean_error_pct_box", (v) => `${v.toFixed(1)}%`, { series: lowerSeries })}
      </Section>

      <Card withBorder padding="lg">
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap">
            <div>
              <Title order={4}>Shift per keypoint</Title>
              <Text size="sm" c="dimmed">Mean distance from the {reference}p keypoint, % of box height.</Text>
            </div>
            <SegmentedControl size="xs" value={heatRes} onChange={setHeatRes}
              data={lower.map((r) => ({ value: String(r), label: `${r}p vs ${reference}p` }))} />
          </Group>
          <KeypointHeatmap rows={keypoints} models={models} resolution={Number(heatRes)} />
        </Stack>
      </Card>

      <Card withBorder padding="lg">
        <Stack gap="sm">
          <Title order={4}>All numbers</Title>
          <SummaryTable rows={rows} models={models} resolutions={resolutions} />
        </Stack>
      </Card>
    </Stack>
  );
}

function seriesFor(res: number, index: number, count: number): BarSeries {
  // Ordinal ramp: lowest resolution lightest (light mode). Three steps defined in styles.css.
  const step = count === 1 ? 3 : Math.round(1 + (index * 2) / (count - 1));
  return { key: res, label: `${res}p`, color: `var(--res-${step})` };
}

/** Headline tiles: averages over the models for each resolution. */
function headlineStats({ rows, resolutions, reference }: ResolutionCheck): Stat[] {
  const mean = (res: number, col: keyof ResolutionRow) => {
    const vals = rows.filter((r) => r.resolution === res).map((r) => r[col] as number).filter(Number.isFinite);
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  };
  const low = Math.min(...resolutions);
  const trackingSpread = Math.max(...[...new Set(rows.map((r) => r.model))].map((m) => {
    const v = rows.filter((r) => r.model === m).map((r) => r.all_tracked_pct);
    return Math.max(...v) - Math.min(...v);
  }));
  const infChange = (mean(low, "inference_ms") / mean(reference, "inference_ms") - 1) * 100;
  const lower = resolutions.filter((r) => r !== reference);
  const perRes = (col: keyof ResolutionRow, unit: string) => lower.map((r) => `${mean(r, col).toFixed(1)}${unit}`).join(" / ");
  const resNames = lower.map((r) => `${r}p`).join(" / ");
  return [
    { label: "Largest change in frames with all people found, any model", value: `${trackingSpread.toFixed(1)} pp` },
    { label: `Keypoints within 5% of ${reference}p, ${resNames} (avg of models)`, value: perRes("pck05_vs_720", "%") },
    { label: `Mean keypoint shift vs ${reference}p, ${resNames} (% of box height)`, value: perRes("mean_error_pct_box", "%") },
    { label: `Inference time, ${low}p vs ${reference}p (avg of models)`, value: `${infChange >= 0 ? "+" : ""}${infChange.toFixed(0)}%` },
  ];
}

function Legend({ series }: { series: BarSeries[] }) {
  return (
    <Group gap="md">
      <Text size="sm" c="dimmed">Input resolution:</Text>
      {series.map((s) => (
        <Group key={s.key} gap={6}>
          <Box w={14} h={14} style={{ background: s.color, borderRadius: 3 }} />
          <Text size="sm">{s.label}</Text>
        </Group>
      ))}
    </Group>
  );
}

function Section({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <Stack gap="sm">
      <div>
        <Title order={3}>{title}</Title>
        <Text size="sm" c="dimmed">{text}</Text>
      </div>
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="md">{children}</SimpleGrid>
    </Stack>
  );
}

function ChartCard({ title, note, children }: { title: string; note: ReactNode; children: ReactNode }) {
  return (
    <Card withBorder padding="md">
      <Text fw={600} size="sm">{title}</Text>
      <Text size="xs" c="dimmed" mb="sm" mih={18}>{note}</Text>
      {children}
    </Card>
  );
}

function SummaryTable({ rows, models, resolutions }: Pick<ResolutionCheck, "rows" | "models" | "resolutions">) {
  const fmt = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "–");
  const ordered = models.flatMap((m) => resolutions.map((res) => rows.find((r) => r.model === m.id && r.resolution === res)))
    .filter((r): r is ResolutionRow => !!r);
  return (
    <Table.ScrollContainer minWidth={980}>
      <Table striped highlightOnHover verticalSpacing={4} fz="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Model</Table.Th><Table.Th>Res.</Table.Th><Table.Th>Frames</Table.Th>
            <Table.Th>All 3 found</Table.Th><Table.Th>People/frame</Table.Th><Table.Th>Extra det.</Table.Th>
            <Table.Th>Visible kp</Table.Th><Table.Th>Mean conf</Table.Th><Table.Th>Inference</Table.Th>
            <Table.Th>PCK@0.05 vs 720p</Table.Th><Table.Th>Shift vs 720p</Table.Th><Table.Th>Device</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {ordered.map((r) => (
            <Table.Tr key={`${r.model}-${r.resolution}`}>
              <Table.Td>{r.label}</Table.Td>
              <Table.Td>{r.width}×{r.height}</Table.Td>
              <Table.Td>{r.frames}</Table.Td>
              <Table.Td>{fmt(r.all_tracked_pct)}%</Table.Td>
              <Table.Td>{fmt(r.mean_tracked, 2)}</Table.Td>
              <Table.Td>{r.frames_over_detected}</Table.Td>
              <Table.Td>{fmt(r.visible_kp_pct)}%</Table.Td>
              <Table.Td>{fmt(r.mean_kp_conf, 3)}</Table.Td>
              <Table.Td>{fmt(r.inference_ms)} ms{r.runs_count > 1 ? ` (${r.runs_count} runs)` : ""}</Table.Td>
              <Table.Td>{Number.isFinite(r.pck05_vs_720) ? `${fmt(r.pck05_vs_720)}%` : "reference"}</Table.Td>
              <Table.Td>{Number.isFinite(r.mean_error_pct_box) ? `${fmt(r.mean_error_pct_box, 2)}%` : "reference"}</Table.Td>
              <Table.Td>{r.device}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
