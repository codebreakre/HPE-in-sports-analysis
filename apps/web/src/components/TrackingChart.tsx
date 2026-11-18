// Step chart of detected people per frame, with a dashed line at the expected count
// and a hover crosshair + tooltip.
import { useMemo, useState, type PointerEvent } from "react";
import { Box, Paper, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import type { TrackingRow } from "../types";

const HEIGHT = 220;
const MARGIN = { left: 28, right: 12, top: 10, bottom: 26 };
const COLORS = {
  line: "var(--mantine-color-blue-filled)",
  grid: "var(--mantine-color-default-border)",
  reference: "var(--mantine-color-dimmed)",
  surface: "var(--mantine-color-body)",
};

export function TrackingChart({ rows, expected }: { rows: TrackingRow[]; expected: number }) {
  const { ref, width: measuredWidth } = useElementSize();
  const width = measuredWidth || 800;
  const [hovered, setHovered] = useState<number | null>(null);

  const chart = useMemo(() => buildChart(rows, expected, width), [rows, expected, width]);
  const { x, y, right, maxTime } = chart;
  const row = hovered === null ? null : rows[hovered];

  function onPointerMove(e: PointerEvent<SVGRectElement>) {
    const svg = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const svgX = (e.clientX - svg.left) * (width / svg.width);
    const time = ((svgX - MARGIN.left) / (right - MARGIN.left)) * maxTime;
    setHovered(frameIndexAt(rows, time));
  }

  return (
    <Box ref={ref} pos="relative">
      <svg
        className="tracking-chart"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width="100%"
        height={HEIGHT}
        role="img"
        aria-label={`Detected people per frame over time; expected ${expected}`}
        style={{ display: "block", overflow: "visible" }}
      >
        {chart.counts.map((count) => (
          <g key={count}>
            <line x1={MARGIN.left} x2={right} y1={y(count)} y2={y(count)} stroke={COLORS.grid} />
            <text x={MARGIN.left - 8} y={y(count) + 4} textAnchor="end">{count}</text>
          </g>
        ))}
        {chart.timeTicks.map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle">{t.toFixed(maxTime < 10 ? 1 : 0)} s</text>
        ))}

        <line x1={MARGIN.left} x2={right} y1={y(expected)} y2={y(expected)} stroke={COLORS.reference} strokeDasharray="4 4" />
        <text x={right} y={y(expected) - 6} textAnchor="end">expected {expected}</text>
        <path d={chart.path} fill="none" stroke={COLORS.line} strokeWidth={2} strokeLinejoin="round" />

        {row && (
          <>
            <line x1={x(row.time)} x2={x(row.time)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke={COLORS.reference} />
            <circle cx={x(row.time)} cy={y(row.detected)} r={4} fill={COLORS.line} stroke={COLORS.surface} strokeWidth={2} />
          </>
        )}
        <rect
          x={MARGIN.left} y={0} width={right - MARGIN.left} height={HEIGHT} fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
        />
      </svg>

      {row && (
        <Paper
          shadow="sm" withBorder px="sm" py={6} pos="absolute" top={0}
          style={{ left: Math.min((x(row.time) / width) * 100, 75) + "%", pointerEvents: "none", whiteSpace: "nowrap" }}
        >
          <Text size="xs">Frame {row.frame} · {row.time.toFixed(2)} s</Text>
          <Text size="xs">
            <b>{row.tracked} / {expected}</b> tracked{row.detected > expected ? ` (${row.detected} detected)` : ""}
          </Text>
        </Paper>
      )}
    </Box>
  );
}

/** Scales and shapes for the chart. */
function buildChart(rows: TrackingRow[], expected: number, width: number) {
  const right = width - MARGIN.right;
  const maxTime = Math.max(rows.at(-1)!.time, 1e-3);
  const maxCount = Math.max(expected, ...rows.map((r) => r.detected));
  const x = (time: number) => MARGIN.left + (time / maxTime) * (right - MARGIN.left);
  const y = (count: number) => HEIGHT - MARGIN.bottom - (count / maxCount) * (HEIGHT - MARGIN.top - MARGIN.bottom);

  // Step line: a frame's count holds until the next frame.
  let path = `M${x(rows[0].time)},${y(rows[0].detected)}`;
  for (const r of rows.slice(1)) path += `H${x(r.time)}V${y(r.detected)}`;
  path += `H${x(maxTime)}`;

  return {
    x, y, right, maxTime, path,
    counts: Array.from({ length: maxCount + 1 }, (_, i) => i),           // grid line per whole count
    timeTicks: Array.from({ length: 6 }, (_, i) => (maxTime * i) / 5), // six time labels
  };
}

/** The frame showing at `time` (the last one that started at or before it). */
function frameIndexAt(rows: TrackingRow[], time: number): number {
  const next = rows.findIndex((r) => r.time > time);
  if (next === -1) return rows.length - 1;
  return Math.max(0, next - 1);
}
