// Synchronization score over time: the group score (thick, text color) and one line per pair,
// a cursor at the video's current time, a hover tooltip, and click-to-seek. Under the time axis,
// one row per pair marks its out-of-sync moments (click a bar to jump to its start).
import { useMemo, useState, type MouseEvent } from "react";
import { Box, Group, Paper, Text } from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import type { SyncEpisode, SyncResult } from "../sync/index.ts";

const HEIGHT = 200;
const MARGIN = { left: 32, right: 12, top: 10, bottom: 26 };
/** Height and spacing of the per-pair rows of out-of-sync bars under the time axis */
const STRIP = 6;
const STRIP_GAP = 4;
const GRID = "var(--mantine-color-default-border)";
const CURSOR = "var(--mantine-color-dimmed)";
const GROUP = "var(--mantine-color-text)";
export const pairColor = (i: number) => `var(--pair-${(i % 8) + 1})`;

export function SyncTimeline({ sync, episodes = [], time, duration, onSeek }: {
  sync: SyncResult;
  episodes?: SyncEpisode[];
  /** Current video time (s), drawn as the cursor */
  time: number | null;
  duration: number;
  onSeek?: (time: number) => void;
}) {
  const { ref, width: measured } = useElementSize();
  const width = measured || 800;
  const [hover, setHover] = useState<number | null>(null);
  const steps = sync.timeline;
  const right = width - MARGIN.right;
  const maxTime = Math.max(duration, steps.at(-1)?.endTime ?? 0, 1e-3);
  const x = (t: number) => MARGIN.left + (t / maxTime) * (right - MARGIN.left);
  const y = (score: number) => HEIGHT - MARGIN.bottom - (score / 100) * (HEIGHT - MARGIN.top - MARGIN.bottom);

  const paths = useMemo(() => {
    const line = (pick: (k: number) => number | null) => {
      let d = "";
      let pen = false;
      steps.forEach((s, k) => {
        const v = pick(k);
        if (v === null) { pen = false; return; }
        d += `${pen ? "L" : "M"}${x(s.centerTime).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return d;
    };
    return { group: line((k) => steps[k].group), pairs: sync.pairs.map((_, p) => line((k) => steps[k].pairs[p])) };
  }, [steps, sync.pairs, width, maxTime]); // x and y depend only on width and maxTime

  const timeAt = (e: MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const svgX = (e.clientX - box.left) * (width / box.width);
    return Math.min(maxTime, Math.max(0, ((svgX - MARGIN.left) / (right - MARGIN.left)) * maxTime));
  };
  const stepNear = (t: number) => nearestStep(steps, t);
  const hovered = hover === null ? null : steps[hover];
  const stripTop = (pairIndex: number) => HEIGHT + 2 + pairIndex * (STRIP + STRIP_GAP);
  const totalHeight = episodes.length ? stripTop(sync.pairs.length) : HEIGHT;

  return (
    <Box ref={ref} pos="relative">
      <Group gap="md" mb={4}>
        <LegendItem color={GROUP} label="Group" thick />
        {sync.pairs.map((p, i) => <LegendItem key={i} color={pairColor(i)} label={`Pair ${p.pair.join("–")}`} />)}
        {episodes.length > 0 && <Text size="xs" c="dimmed">Bars under the axis: out-of-sync moments</Text>}
      </Group>
      <svg className="sync-chart" viewBox={`0 0 ${width} ${totalHeight}`} width="100%" height={totalHeight} role="img"
        aria-label="Synchronization score over time, group and per pair" style={{ display: "block", overflow: "visible" }}>
        {[0, 25, 50, 75, 100].map((v) => (
          <g key={v}>
            <line x1={MARGIN.left} x2={right} y1={y(v)} y2={y(v)} stroke={GRID} />
            <text x={MARGIN.left - 8} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        {Array.from({ length: 6 }, (_, i) => (maxTime * i) / 5).map((t) => (
          <text key={t} x={x(t)} y={HEIGHT - 6} textAnchor="middle">{t.toFixed(0)} s</text>
        ))}
        {paths.pairs.map((d, i) => <path key={i} d={d} fill="none" stroke={pairColor(i)} strokeWidth={1.5} strokeLinejoin="round" />)}
        <path d={paths.group} fill="none" stroke={GROUP} strokeWidth={2.5} strokeLinejoin="round" />
        {time !== null && <line x1={x(time)} x2={x(time)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke={CURSOR} strokeWidth={1.5} />}
        {hovered && <line x1={x(hovered.centerTime)} x2={x(hovered.centerTime)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke={CURSOR} strokeDasharray="3 3" />}
        <rect x={MARGIN.left} y={0} width={right - MARGIN.left} height={HEIGHT} fill="transparent"
          style={{ cursor: onSeek ? "pointer" : undefined }}
          onPointerMove={(e) => setHover(stepNear(timeAt(e)))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => onSeek?.(timeAt(e))} />
        {episodes.map((e, i) => (
          <rect key={i} x={x(e.startTime)} y={stripTop(e.pairIndex)} width={Math.max(3, x(e.endTime) - x(e.startTime))} height={STRIP} rx={2}
            fill={pairColor(e.pairIndex)} style={{ cursor: onSeek ? "pointer" : undefined }} onClick={() => onSeek?.(e.startTime)}>
            <title>{`Pair ${e.pair.join("–")}: ${e.startTime.toFixed(1)}–${e.endTime.toFixed(1)} s`}</title>
          </rect>
        ))}
      </svg>
      {hovered && (
        <Paper shadow="sm" withBorder px="sm" py={6} pos="absolute" top={24}
          style={{ left: Math.min((x(hovered.centerTime) / width) * 100, 72) + "%", pointerEvents: "none", whiteSpace: "nowrap" }}>
          <Text size="xs">{hovered.startTime.toFixed(1)}–{hovered.endTime.toFixed(1)} s</Text>
          <Text size="xs"><b>Group {fmt(hovered.group)}</b></Text>
          {sync.pairs.map((p, i) => (
            <Text size="xs" key={i}>Pair {p.pair.join("–")}: {fmt(hovered.pairs[i])}</Text>
          ))}
        </Paper>
      )}
    </Box>
  );
}

function LegendItem({ color, label, thick = false }: { color: string; label: string; thick?: boolean }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={16} h={thick ? 3 : 2} style={{ background: color, borderRadius: 2 }} />
      <Text size="xs" c="dimmed">{label}</Text>
    </Group>
  );
}

/** Index of the window whose centre is nearest to `time` (-1 when there are none). */
export function nearestStep(steps: SyncResult["timeline"], time: number): number {
  let best = -1, bestDist = Infinity;
  steps.forEach((s, k) => {
    const d = Math.abs(s.centerTime - time);
    if (d < bestDist) { best = k; bestDist = d; }
  });
  return best;
}

export const fmt = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "–" : v.toFixed(digits));
