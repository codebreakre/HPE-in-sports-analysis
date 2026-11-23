// Synchronization results (report 2.6, display stage): the annotated video with the scores of the
// moment shown beside it while it plays, the score timeline under it, the out-of-sync moments
// (click to jump there), and the whole-video summary.
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Box, Button, Code, Group, Paper, Progress, SimpleGrid, Slider, Stack, Table, Text, Title } from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";
import {
  DEFAULT_EPISODE_SETTINGS, MIN_LATE_SEC, behindJointName, episodeJoints, findEpisodes, jointLabel, lagText, partLagText,
  type Angles, type BodyPart, type EpisodeSettings, type JointBreakdown, type SyncEpisode, type SyncResult, type SyncWindow,
} from "../sync/index.ts";
import { StatGrid, type Stat } from "./StatGrid";
import { SyncTimeline, fmt, nearestStep, pairColor } from "./SyncTimeline";
import { PlaybackVideo } from "./PlaybackVideo";

const PART_LABELS: Record<BodyPart, string> = { arms: "Arms", legs: "Legs", torso: "Torso" };
const PARTS = Object.keys(PART_LABELS) as BodyPart[];

/**
 * The annotated video, the live scores of the current window, the timeline (click to seek) and the
 * out-of-sync moments. `angles` (from the run or its -angles.csv) adds which limbs and joints were late.
 */
export function SyncedVideo({ src, sync, angles }: { src: string; sync: SyncResult; angles: Angles | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Follow the playhead: every presented frame while playing, plus seeks and pauses.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    let handle = 0;
    const read = () => setTime(v.currentTime);
    const onFrame = () => { read(); handle = v.requestVideoFrameCallback(onFrame); };
    const hasFrameCallback = "requestVideoFrameCallback" in v;
    if (hasFrameCallback) handle = v.requestVideoFrameCallback(onFrame);
    const onMeta = () => setDuration(v.duration);
    const events = ["seeked", "pause", "timeupdate"] as const;
    events.forEach((e) => v.addEventListener(e, read));
    v.addEventListener("loadedmetadata", onMeta);
    return () => {
      if (hasFrameCallback) v.cancelVideoFrameCallback(handle);
      events.forEach((e) => v.removeEventListener(e, read));
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [src]);

  const k = nearestStep(sync.timeline, time);
  const step = k >= 0 ? sync.timeline[k] : null;
  // Window k of every pair belongs to timeline step k (pairs are stored one after another).
  const windows = k >= 0 ? sync.pairs.map((_, p) => sync.windows[p * sync.timeline.length + k]).filter(Boolean) : [];
  const { lateSec } = useAppState().settings;
  const settings = useMemo(() => ({ ...DEFAULT_EPISODE_SETTINGS, lagSec: lateSec }), [lateSec]);
  const episodes = useMemo(() => findEpisodes(sync, angles, settings), [sync, angles, settings]);
  const seek = (t: number) => { if (video.current) video.current.currentTime = t; };

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <PlaybackVideo ref={video} src={src} />
        <LiveScores sync={sync} step={step} windows={windows} />
      </SimpleGrid>
      <SyncTimeline sync={sync} episodes={episodes} time={time} duration={duration || sync.frameCount / sync.fps} onSeek={seek} />
      <EpisodeList sync={sync} angles={angles} episodes={episodes} settings={settings} time={time} onSeek={seek} />
    </Stack>
  );
}

/** Scores of the window under the playhead: group, each pair (with body parts and lag), each person. */
function LiveScores({ sync, step, windows }: { sync: SyncResult; step: SyncResult["timeline"][number] | null; windows: SyncWindow[] }) {
  if (!step) return <Text size="sm" c="dimmed">No windows: the video is too short or no pairs were found.</Text>;
  const persons = Array.from({ length: sync.personCount }, (_, i) => i + 1).map((person) => {
    const own = windows.filter((w) => w.pair.includes(person) && w.score !== null).map((w) => w.score!);
    return { person, score: own.length ? own.reduce((a, b) => a + b, 0) / own.length : null };
  });
  const scored = persons.filter((p) => p.score !== null);
  const lowest = sync.personCount >= 3 && scored.length ? scored.reduce((a, b) => (b.score! < a.score! ? b : a)).person : null;

  return (
    <Stack gap="sm">
      <div>
        <Text size="xs" c="dimmed">Group synchronization now · window {step.startTime.toFixed(1)}–{step.endTime.toFixed(1)} s</Text>
        <Text fz={44} fw={700} lh={1.1} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(step.group)}</Text>
      </div>
      {windows.map((w) => <PairNow key={w.pair.join("-")} w={w} index={sync.pairs.findIndex((p) => p.pair.join() === w.pair.join())} rhoMin={sync.config.rhoMin} />)}
      {sync.personCount >= 2 && (
        <Group gap="xs">
          {persons.map((p) => (
            <Badge key={p.person} variant={p.person === lowest ? "filled" : "light"} color={p.person === lowest ? "orange" : "gray"} size="lg" tt="none">
              Person {p.person}: {fmt(p.score)}{p.person === lowest ? " · least in sync" : ""}
            </Badge>
          ))}
        </Group>
      )}
    </Stack>
  );
}

function PairNow({ w, index, rhoMin }: { w: SyncWindow; index: number; rhoMin: number }) {
  const lagKnown = w.lagSec !== null && w.rhoMax !== null && w.rhoMax >= rhoMin;
  return (
    <Paper withBorder p="xs">
      <Group justify="space-between" wrap="nowrap" mb={4}>
        <Group gap={8} wrap="nowrap">
          <Box w={10} h={10} style={{ background: pairColor(index), borderRadius: 2 }} />
          <Text size="sm" fw={600}>Pair {w.pair.join("–")}</Text>
          {w.mode === "mirror" && <Badge size="xs" variant="light">mirror</Badge>}
        </Group>
        <Text size="sm" fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(w.score)}</Text>
      </Group>
      <SimpleGrid cols={3} spacing="xs">
        {PARTS.map((part) => (
          <div key={part}>
            <Group justify="space-between" gap={4}>
              <Text size="xs" c="dimmed">{PART_LABELS[part]}</Text>
              <Text size="xs" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(w.parts[part])}</Text>
            </Group>
            <Progress value={w.parts[part] ?? 0} size="sm" aria-label={`${PART_LABELS[part]} ${fmt(w.parts[part])}`} />
          </div>
        ))}
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt={4}>
        Lag: {lagKnown ? lagText(w.pair, w.lagSec!) : `not reliable (ρ ${fmt(w.rhoMax, 2)} < ${rhoMin})`}
      </Text>
    </Paper>
  );
}

/** Stretches where a pair did clearly worse than it usually does, each with a button to jump there. */
function EpisodeList({ sync, angles, episodes, settings, time, onSeek }: {
  sync: SyncResult; angles: Angles | null; episodes: SyncEpisode[]; settings: EpisodeSettings; time: number; onSeek: (t: number) => void;
}) {
  const controller = useController();
  if (!sync.pairs.length) return null;
  return (
    <Stack gap={6}>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <div style={{ flex: "1 1 320px" }}>
          <Title order={5}>Out-of-sync moments</Title>
          <Text size="xs" c="dimmed">
            Where a pair was clearly less in sync than it usually is in this video: someone fell behind (and with which limb
            and joints), or moved differently. Also marked as bars under the timeline.
          </Text>
        </div>
        <div style={{ width: 220 }}>
          <Group justify="space-between">
            <Text size="xs" fw={500}>Late from</Text>
            <Text size="xs" c="dimmed">{settings.lagSec.toFixed(2)} s (default {DEFAULT_EPISODE_SETTINGS.lagSec.toFixed(2)})</Text>
          </Group>
          {/* 0.04 s steps = one frame at 25 fps; below MIN_LATE_SEC the lag can't be told from noise */}
          <Slider thumbLabel="Late from (seconds)" size="sm" min={MIN_LATE_SEC} max={1} step={0.04} value={settings.lagSec}
            label={(v) => `${v.toFixed(2)} s`} onChange={(lateSec) => controller.updateSettings({ lateSec })} mt={4} />
        </div>
      </Group>
      {episodes.length === 0 && <Text size="sm" c="dimmed">None: every pair stayed close to its usual level.</Text>}
      {episodes.map((e, i) => (
        <EpisodeRow key={i} e={e} joints={angles ? episodeJoints(e, angles, sync.config.minStdDeg, settings) : null}
          now={time >= e.startTime && time <= e.endTime} onSeek={onSeek} />
      ))}
    </Stack>
  );
}

function EpisodeRow({ e, joints, now, onSeek }: {
  e: SyncEpisode; joints: JointBreakdown[] | null; now: boolean; onSeek: (t: number) => void;
}) {
  const headline = e.lateParts.length
    ? e.lateParts.map((p) => partLagText(e, p)).join("; ")
    : e.lagSec !== null
      ? `${lagText(e.pair, e.lagSec)}${e.lagReliable ? "" : " (uncertain)"}`
      : "moving differently (no clear lag)";
  const late = joints?.filter((j) => j.status === "late") ?? [];
  const different = joints?.filter((j) => j.status === "different") ?? [];
  const named = (j: JointBreakdown) => jointLabel(j.joint) + (j.jointB !== j.joint ? ` / ${jointLabel(j.jointB)}` : "");
  return (
    <Paper withBorder px="sm" py={6} style={now ? { borderColor: pairColor(e.pairIndex) } : undefined}>
      <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={10} wrap="nowrap">
            <Box w={10} h={10} style={{ background: pairColor(e.pairIndex), borderRadius: 2, flex: "none" }} />
            <Text size="sm" fw={600} style={{ fontVariantNumeric: "tabular-nums", flex: "none" }}>{e.startTime.toFixed(1)}–{e.endTime.toFixed(1)} s</Text>
            <Text size="sm" style={{ flex: "none" }}>Pair {e.pair.join("–")}</Text>
            <Text size="sm" truncate>{capitalize(headline)}</Text>
            <Text size="sm" c="dimmed" style={{ flex: "none" }}>· lowest score {fmt(e.minScore)}</Text>
          </Group>
          {(late.length > 0 || different.length > 0) && (
            <Text size="xs" c="dimmed" pl={20}>
              {late.length > 0 && <>Late joints: {late.map((j) => (
                <span key={j.joint} title={`Shifting it by ${Math.abs(j.lagSec!).toFixed(2)} s removes ${j.gainDeg?.toFixed(1)}° of angle difference`}>
                  {jointLabel(behindJointName(j))}
                </span>
              )).reduce<React.ReactNode[]>((acc, el, k) => (k ? [...acc, ", ", el] : [el]), [])}</>}
              {late.length > 0 && different.length > 0 && " · "}
              {different.length > 0 && <>Angle differs more than usual: {different.map((j) =>
                `${named(j)} (+${Math.round(j.diffDeg! - j.usualDiffDeg!)}°)`).join(", ")}</>}
            </Text>
          )}
        </Stack>
        <Button size="compact-xs" variant={now ? "filled" : "light"} onClick={() => onSeek(e.startTime)} style={{ flex: "none" }}>Jump</Button>
      </Group>
    </Paper>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Whole-video results: group and per-person scores, the pair table, and the settings used. */
export function SyncSummary({ sync }: { sync: SyncResult }) {
  const c = sync.config;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const stats: Stat[] = [
    { label: "Group synchronization (0-100)", value: fmt(sync.group.score, 1) },
    { label: "People (from the first 2 s)", value: sync.personCount },
    { label: "Least in sync", value: sync.group.mostDeviating ? `Person ${sync.group.mostDeviating}` : "–" },
    { label: `Frames with exactly ${sync.personCount} detected`, value: pct(sync.assignment.framesExact / Math.max(1, sync.frameCount)) },
    { label: c.hopSec ? "Windows per pair" : "Windows per pair (one per frame)", value: sync.timeline.length },
  ];

  return (
    <Stack gap="sm">
      <StatGrid stats={stats} />
      {sync.pairs.length > 0 && (
        <Table.ScrollContainer minWidth={760}>
          <Table striped verticalSpacing={4} style={{ fontVariantNumeric: "tabular-nums" }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Pair</Table.Th><Table.Th>Score</Table.Th><Table.Th>Pose</Table.Th><Table.Th>Correlation</Table.Th>
                <Table.Th>Lag score</Table.Th><Table.Th>Lag (whole video)</Table.Th><Table.Th>Mirror windows</Table.Th>
                {PARTS.map((p) => <Table.Th key={p}>{PART_LABELS[p]}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sync.pairs.map((p, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap"><Box w={10} h={10} style={{ background: pairColor(i), borderRadius: 2 }} />{p.pair.join("–")}</Group>
                  </Table.Td>
                  <Table.Td fw={700}>{fmt(p.score, 1)}</Table.Td>
                  <Table.Td>{fmt(p.pose && p.pose * 100, 1)}</Table.Td>
                  <Table.Td>{fmt(p.corr && p.corr * 100, 1)}</Table.Td>
                  <Table.Td>{fmt(p.lag && p.lag * 100, 1)}</Table.Td>
                  <Table.Td>{p.lagSec === null ? "–" : `${p.lagSec > 0 ? "+" : ""}${p.lagSec.toFixed(2)} s (ρ ${fmt(p.rhoMax, 2)}${p.lagReliable ? "" : ", unreliable"})`}</Table.Td>
                  <Table.Td>{pct(p.mirrorShare)}</Table.Td>
                  {PARTS.map((part) => <Table.Td key={part}>{fmt(p.parts[part], 1)}</Table.Td>)}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="xs" c="dimmed">
        Per person (S<sub>i</sub>): {sync.persons.map((p) => `${p.person}: ${fmt(p.score, 1)} (missing ${pct(p.missingFrameRate)} of frames, ${pct(p.interpolatedRate)} of values interpolated)`).join(" · ")}
      </Text>
      <Text size="xs" c="dimmed">
        Lag: + means the second person of the pair moves later. Settings ({sync.algorithm}): window <Code>{c.windowSec} s</Code>{" "}
        {c.hopSec ? <>every <Code>{c.hopSec} s</Code></> : "centred on every frame"},{" "}
        {c.partWeights && <> joint weights <Code>{c.jointWeightPreset}: arms {c.partWeights.arms} / legs {c.partWeights.legs} / torso {c.partWeights.torso}</Code>,{" "}</>}
        τ<sub>max</sub> <Code>{c.tauMaxSec} s</Code>, ρ<sub>min</sub> <Code>{c.rhoMin}</Code>, weights <Code>{c.weights.map((w) => w.toFixed(2)).join(" / ")}</Code>,
        confidence ≥ <Code>{c.confThreshold}</Code>, smoothing <Code>{c.smooth ? `${c.smoothWindowSec} s` : "off"}</Code>, mirror <Code>{c.mirror}{c.mirrorMargin !== undefined && c.mirror === "auto" ? ` (switch at +${c.mirrorMargin})` : ""}</Code>.
      </Text>
    </Stack>
  );
}

/** Section title used by both result pages. */
export function SyncTitle() {
  return <Title order={4}>Synchronization</Title>;
}
