// A <video> with a playback-speed bar under it (0.1× … 2×), for watching movements slowly.
// The speed is an app setting (Settings.playbackSpeed), so it stays when another run or video is
// opened; a change made in the browser's own video menu is reflected in the bar.
import { useEffect, useImperativeHandle, useRef, type CSSProperties, type Ref } from "react";
import { Group, SegmentedControl, Text } from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";

const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2];

export function PlaybackVideo({ src, ref, style }: {
  src: string;
  /** The underlying <video> element (e.g. to read currentTime or seek) */
  ref?: Ref<HTMLVideoElement>;
  style?: CSSProperties;
}) {
  const controller = useController();
  const speed = useAppState().settings.playbackSpeed;
  const video = useRef<HTMLVideoElement>(null);
  // The element is mounted before the handle is read, so it is never null here. A new src remounts
  // the <video> (key), so the handle is renewed with it.
  useImperativeHandle(ref, () => video.current!, [src]);

  // A new source resets the rate to the default, so set both.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.defaultPlaybackRate = speed;
    v.playbackRate = speed;
  }, [speed, src]);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onRate = () => { if (v.playbackRate !== speed) controller.updateSettings({ playbackSpeed: v.playbackRate }); };
    v.addEventListener("ratechange", onRate);
    return () => v.removeEventListener("ratechange", onRate);
  }, [controller, speed, src]);

  const options = SPEEDS.includes(speed) ? SPEEDS : [...SPEEDS, speed].sort((a, b) => a - b);
  return (
    <div style={{ minWidth: 0 }}>
      <video ref={video} key={src} src={src} controls playsInline preload="metadata"
        style={{ width: "100%", maxHeight: "70vh", borderRadius: 8, background: "black", display: "block", ...style }} />
      <Group gap="xs" mt={6} wrap="nowrap">
        <Text size="xs" c="dimmed">Speed</Text>
        <SegmentedControl
          size="xs"
          value={String(speed)}
          onChange={(v) => controller.updateSettings({ playbackSpeed: Number(v) })}
          data={options.map((s) => ({ label: `${s}×`, value: String(s) }))}
          aria-label="Playback speed"
        />
      </Group>
    </div>
  );
}
