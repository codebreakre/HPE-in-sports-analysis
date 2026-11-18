// Grouped bars: one group per model, one bar per series (resolution). Hovering a group shows
// every series' value for it, so resolutions can be compared directly. Optional min–max whiskers.
import { useMemo, useState } from "react";
import { Box, Group, Paper, Stack, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";

export interface BarSeries {
  key: number;
  label: string;
  color: string;
}

export interface GroupedBarChartProps {
  groups: { id: string; label: string }[];
  series: BarSeries[];
  value: (groupId: string, seriesKey: number) => number | undefined;
  /** Optional [min, max] whisker per bar, e.g. spread over repeated runs */
  range?: (groupId: string, seriesKey: number) => [number, number] | undefined;
  format: (v: number) => string;
  /** Fixed top of the y axis (e.g. 100 for percentages); otherwise from the data */
  max?: number;
  ariaLabel: string;
}

const HEIGHT = 220;
const MARGIN = { left: 40, right: 8, top: 12, bottom: 24 };
const NARROW_BOTTOM = 44; // room for tilted labels when groups are too narrow for straight ones
const NARROW_GROUP_W = 72;
const BAR_GAP = 2; // surface gap between neighbouring bars
const RADIUS = 4;

export function GroupedBarChart({ groups, series, value, range, format, max, ariaLabel }: GroupedBarChartProps) {
  const { ref, width: measuredWidth } = useElementSize();
  const width = measuredWidth || 600;
  const [hovered, setHovered] = useState<number | null>(null);

  const scale = useMemo(() => {
    let top = max ?? 0;
    if (max === undefined) {
      for (const g of groups) for (const s of series) {
        top = Math.max(top, value(g.id, s.key) ?? 0, range?.(g.id, s.key)?.[1] ?? 0);
      }
    }
    return niceScale(top || 1);
  }, [groups, series, value, range, max]);

  const plotW = width - MARGIN.left - MARGIN.right;
  const groupW = plotW / Math.max(1, groups.length);
  const narrow = groupW < NARROW_GROUP_W;
  const plotH = HEIGHT - MARGIN.top - (narrow ? NARROW_BOTTOM : MARGIN.bottom);
  const barW = Math.max(3, Math.min(28, (groupW * 0.72) / series.length - BAR_GAP));
  const clusterW = series.length * barW + (series.length - 1) * BAR_GAP;
  const y = (v: number) => MARGIN.top + plotH - (Math.min(v, scale.max) / scale.max) * plotH;
  const barX = (gi: number, si: number) => MARGIN.left + gi * groupW + (groupW - clusterW) / 2 + si * (barW + BAR_GAP);
  const baseline = y(0);

  const tooltipGroup = hovered === null ? null : groups[hovered];

  return (
    <Box ref={ref} pos="relative">
      <svg className="analysis-chart" viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" height={HEIGHT}
        role="img" aria-label={ariaLabel} style={{ display: "block", overflow: "visible" }}>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)}
              stroke="var(--mantine-color-default-border)" strokeWidth={t === 0 ? 1 : 0.6} />
            <text x={MARGIN.left - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}

        {groups.map((g, gi) => (
          <g key={g.id} opacity={hovered === null || hovered === gi ? 1 : 0.45}>
            {series.map((s, si) => {
              const v = value(g.id, s.key);
              if (v === undefined || !Number.isFinite(v)) return null;
              const x = barX(gi, si);
              const r = range?.(g.id, s.key);
              return (
                <g key={s.key}>
                  <path d={roundedTopBar(x, y(v), barW, baseline - y(v))} fill={s.color} />
                  {r && r[1] > r[0] && (
                    <line x1={x + barW / 2} x2={x + barW / 2} y1={y(r[0])} y2={y(r[1])}
                      stroke="var(--mantine-color-text)" strokeWidth={1.5} />
                  )}
                </g>
              );
            })}
            {narrow ? (
              <text textAnchor="end"
                transform={`translate(${MARGIN.left + gi * groupW + groupW / 2 + 4},${baseline + 12}) rotate(-35)`}>
                {g.label}
              </text>
            ) : (
              <text x={MARGIN.left + gi * groupW + groupW / 2} y={HEIGHT - 6} textAnchor="middle">{g.label}</text>
            )}
          </g>
        ))}

        {/* Hit targets: the whole group column, bigger than the bars */}
        {groups.map((g, gi) => (
          <rect key={g.id} x={MARGIN.left + gi * groupW} y={0} width={groupW} height={HEIGHT} fill="transparent"
            onPointerEnter={() => setHovered(gi)} onPointerLeave={() => setHovered(null)} />
        ))}
      </svg>

      {tooltipGroup && hovered !== null && (
        <Paper shadow="sm" withBorder px="sm" py={6} pos="absolute" top={0}
          style={{
            left: `${Math.min(((MARGIN.left + (hovered + 0.5) * groupW) / width) * 100, 70)}%`,
            transform: "translateX(-50%)", pointerEvents: "none", whiteSpace: "nowrap", zIndex: 2,
          }}>
          <Text size="xs" fw={700}>{tooltipGroup.label}</Text>
          <Stack gap={2}>
            {series.map((s) => {
              const v = value(tooltipGroup.id, s.key);
              const r = range?.(tooltipGroup.id, s.key);
              return (
                <Group key={s.key} gap={6} wrap="nowrap">
                  <Box w={10} h={10} style={{ background: s.color, borderRadius: 2 }} />
                  <Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {s.label}: <b>{v === undefined || !Number.isFinite(v) ? "–" : format(v)}</b>
                    {r && r[1] > r[0] ? ` (runs ${format(r[0])}–${format(r[1])})` : ""}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}

/** A bar with 4px rounded top corners, square at the baseline. */
function roundedTopBar(x: number, top: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(RADIUS, w / 2, h);
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
}

/** Round axis top and ~4 evenly spaced ticks. */
function niceScale(top: number): { max: number; ticks: number[] } {
  const rough = top / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough)!;
  const max = Math.ceil(top / step - 1e-9) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}
