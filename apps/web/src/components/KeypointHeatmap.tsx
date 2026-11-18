// Heatmap: models × 17 keypoints, cell = how far that keypoint moved from the 720p result
// (% of person box height). Binned one-hue scale, value printed in each cell, hover for details.
import { useState } from "react";
import { Box, Group, Paper, ScrollArea, Text } from "@mantine/core";
import { KEYPOINT_NAMES } from "../keypoints";
import type { KeypointErrorRow } from "../analysis/resolution-check";

/** Upper bounds of the colour bins (% of box height); the last bin is open-ended. */
const BINS = [1, 2, 4, 8];
const CELL_W = 46;
const CELL_H = 30;
const LABEL_W = 92;
const HEADER_H = 64;
const RIGHT_PAD = 48; // the last rotated column label leans past the grid

const binOf = (v: number) => { const i = BINS.findIndex((b) => v < b); return i === -1 ? BINS.length : i; };

export function KeypointHeatmap({ rows, models, resolution }: {
  rows: KeypointErrorRow[];
  models: { id: string; label: string }[];
  resolution: number;
}) {
  const [hovered, setHovered] = useState<{ model: string; keypoint: string; v: number; pck: number } | null>(null);
  const cell = new Map(rows.filter((r) => r.resolution === resolution).map((r) => [`${r.model}|${r.keypoint}`, r]));
  const width = LABEL_W + KEYPOINT_NAMES.length * CELL_W + RIGHT_PAD;
  const height = HEADER_H + models.length * CELL_H;

  return (
    <Box>
      <ScrollArea type="auto" offsetScrollbars>
        <Box pos="relative" w={width}>
          <svg className="analysis-chart" width={width} height={height} role="img"
            aria-label={`Keypoint shift at ${resolution}p compared with 720p, per model and keypoint`}>
            {KEYPOINT_NAMES.map((name, j) => (
              <text key={name} transform={`translate(${LABEL_W + j * CELL_W + CELL_W / 2},${HEADER_H - 6}) rotate(-40)`}>
                {name.replace("_", " ")}
              </text>
            ))}
            {models.map((m, i) => (
              <g key={m.id}>
                <text x={LABEL_W - 8} y={HEADER_H + i * CELL_H + CELL_H / 2 + 4} textAnchor="end">{m.label}</text>
                {KEYPOINT_NAMES.map((name, j) => {
                  const r = cell.get(`${m.id}|${name}`);
                  if (!r || !Number.isFinite(r.mean_error_pct_box)) return null;
                  const bin = binOf(r.mean_error_pct_box);
                  const x = LABEL_W + j * CELL_W;
                  const y = HEADER_H + i * CELL_H;
                  return (
                    <g key={name}
                      onPointerEnter={() => setHovered({ model: m.label, keypoint: name, v: r.mean_error_pct_box, pck: r.pck05_vs_720 })}
                      onPointerLeave={() => setHovered(null)}>
                      <rect x={x + 1} y={y + 1} width={CELL_W - 2} height={CELL_H - 2} rx={3} fill={`var(--seq-${bin})`} />
                      <text x={x + CELL_W / 2} y={y + CELL_H / 2 + 4} textAnchor="middle"
                        style={{ fill: `var(--seq-ink-${bin})`, fontSize: 10 }}>
                        {r.mean_error_pct_box.toFixed(1)}
                      </text>
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
          {hovered && (
            <Paper shadow="sm" withBorder px="sm" py={6} pos="absolute" top={0} left={LABEL_W}
              style={{ pointerEvents: "none", whiteSpace: "nowrap" }}>
              <Text size="xs" fw={700}>{hovered.model} · {hovered.keypoint.replace("_", " ")} · {resolution}p</Text>
              <Text size="xs">Mean shift: <b>{hovered.v.toFixed(2)}%</b> of box height</Text>
              <Text size="xs">Within 5% of 720p: <b>{hovered.pck.toFixed(1)}%</b> of frames</Text>
            </Paper>
          )}
        </Box>
      </ScrollArea>
      <Group gap="sm" mt="xs">
        <Text size="xs" c="dimmed">Mean shift, % of box height:</Text>
        {[...BINS, Infinity].map((upper, k) => (
          <Group key={k} gap={4} wrap="nowrap">
            <Box w={14} h={12} style={{ background: `var(--seq-${k})`, borderRadius: 2, border: "1px solid var(--mantine-color-default-border)" }} />
            <Text size="xs" c="dimmed">{k === 0 ? `< ${upper}` : upper === Infinity ? `≥ ${BINS.at(-1)}` : `${BINS[k - 1]}–${upper}`}</Text>
          </Group>
        ))}
      </Group>
    </Box>
  );
}
