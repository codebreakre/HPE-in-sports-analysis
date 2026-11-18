// "People tracked over time": summary tiles and the step chart.
import { Stack, Title } from "@mantine/core";
import type { TrackingRow, TrackingSummary } from "../types";
import { StatGrid, type Stat } from "./StatGrid";
import { TrackingChart } from "./TrackingChart";

export function TrackingSection({ rows, summary }: { rows: TrackingRow[]; summary: TrackingSummary }) {
  const expected = summary.expectedPersons;
  return (
    <Stack gap="sm">
      <Title order={4}>People tracked over time (out of {expected})</Title>
      <StatGrid stats={trackingStats(rows.length, summary)} />
      {rows.length > 1 && <TrackingChart rows={rows} expected={expected} />}
    </Stack>
  );
}

function trackingStats(frameCount: number, summary: TrackingSummary): Stat[] {
  const expected = summary.expectedPersons;
  const pct = (count: number) => `${((count / Math.max(1, frameCount)) * 100).toFixed(1)}%`;

  // One tile per partial count: "Frames with 2 tracked", "… 1 …", "… 0 …"
  const partial: Stat[] = [];
  for (let k = expected - 1; k >= 0; k--) {
    const count = summary.trackedHistogram[k];
    partial.push({ label: `Frames with ${k} tracked`, value: `${count} (${pct(count)})` });
  }

  return [
    { label: `Frames with all ${expected} tracked`, value: pct(summary.framesAllTracked) },
    { label: "Avg people tracked / frame", value: `${summary.meanTracked.toFixed(2)} / ${expected}` },
    { label: "Avg tracking rate", value: `${(summary.meanTrackedRate * 100).toFixed(1)}%` },
    ...partial,
    { label: `Frames with > ${expected} detected`, value: summary.framesOverDetected },
  ];
}
