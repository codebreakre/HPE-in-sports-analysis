// Left panel: input, settings and the run buttons (the model, RTMPose-m, is fixed; see models/index.ts).
import type { ReactNode } from "react";
import {
  Button, Checkbox, Divider, FileButton, Group, NumberInput, Progress, SegmentedControl, Select, Slider, Stack, Text, Title,
} from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";
import { controlAvailability, type Backend } from "../app/controller";
import { MODEL } from "../models";

export function ControlPanel() {
  return (
    <Stack gap="lg">
      <InputSection />
      <Divider />
      <BackendSection />
      <Divider />
      <SettingsSection />
      <Divider />
      <RunSection />
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs">
      <Title order={6} tt="uppercase" c="dimmed">{title}</Title>
      {children}
    </Stack>
  );
}

function InputSection() {
  const controller = useController();
  const state = useAppState();
  const can = controlAvailability(state);
  const dataUnavailable = state.dataFiles === null;

  return (
    <Section title="Input">
      <Select
        label="From data/ folder"
        placeholder={dataUnavailable ? "data/ not available (run npm run dev)" : state.dataFiles!.length ? "Choose a file…" : "data/ is empty"}
        data={state.dataFiles ?? []}
        value={state.selectedDataFile}
        onChange={(path) => path && controller.openDataFile(path)}
        searchable
        nothingFoundMessage="No matching file"
        disabled={!can.openInput || dataUnavailable}
      />
      <Group gap="xs" grow>
        <Button variant="default" size="xs" onClick={() => controller.refreshDataList()} disabled={!can.openInput}>
          Refresh list
        </Button>
        <FileButton onChange={(file) => file && controller.openFile(file)} accept="video/*,image/*">
          {(props) => (
            <Button {...props} variant="default" size="xs" disabled={!can.openInput}>
              Other file…
            </Button>
          )}
        </FileButton>
      </Group>
      <Button
        variant={state.webcamOn ? "filled" : "default"}
        color={state.webcamOn ? "red" : undefined}
        onClick={() => controller.toggleWebcam()}
        disabled={!can.toggleWebcam}
      >
        {state.webcamOn ? "Stop webcam" : "Start webcam"}
      </Button>
      {state.sourceInfo && <Text size="sm" c="dimmed">{state.sourceInfo}</Text>}
    </Section>
  );
}

/** Browser or server processing of videos (images and the webcam always run in the browser). */
function BackendSection() {
  const controller = useController();
  const state = useAppState();
  const { backend } = state.settings;
  const { server } = state;
  const color = server.kind === "ready" ? "teal" : server.kind === "error" ? "red" : "dimmed";
  const text = server.kind === "checking" ? "Checking the server…"
    : server.kind === "ready" || server.kind === "error" ? server.text : "";

  return (
    <Section title="Process videos on">
      <SegmentedControl
        fullWidth
        value={backend}
        onChange={(v) => controller.updateSettings({ backend: v as Backend })}
        disabled={state.busy}
        data={[{ label: "This browser", value: "browser" }, { label: "Server", value: "server" }]}
      />
      {backend === "browser" ? (
        <Text size="xs" c="dimmed">{MODEL.label} runs here ({state.modelStatus.kind === "ready" ? state.modelStatus.text.split(" · ").at(-1) : "loading"}).</Text>
      ) : (
        <Stack gap={4}>
          <Text size="xs" c={color}>{text}</Text>
          <Text size="xs" c="dimmed">
            The video is uploaded to the HPE server (<code>npm run server</code>), which returns the keypoints; stats,
            sync and saving happen here as usual. Images and the webcam always run in the browser.
          </Text>
          {server.kind === "error" && (
            <Button variant="default" size="xs" onClick={() => controller.checkServer()}>Check again</Button>
          )}
        </Stack>
      )}
    </Section>
  );
}

function SettingsSection() {
  const controller = useController();
  const { settings } = useAppState();
  const toNumber = (value: number | string) => (typeof value === "number" ? value : Number(value));

  return (
    <Section title="Settings">
      <div>
        <Group justify="space-between">
          <Text size="sm" fw={500}>Confidence threshold</Text>
          <Text size="sm" c="dimmed">{settings.conf.toFixed(2)}</Text>
        </Group>
        <Slider
          aria-label="Confidence threshold"
          min={0.05}
          max={0.95}
          step={0.05}
          value={settings.conf}
          onChange={(conf) => controller.updateSettings({ conf })}
          label={(v) => v.toFixed(2)}
          mt={4}
        />
      </div>
      <NumberInput
        label="Processing FPS (video)"
        description="Frames per second of video to analyze"
        min={1}
        max={60}
        value={settings.fps}
        onChange={(v) => controller.updateSettings({ fps: toNumber(v) })}
      />
      <Checkbox
        label="Export annotated video"
        checked={settings.exportMp4}
        onChange={(e) => controller.updateSettings({ exportMp4: e.currentTarget.checked })}
      />
      <Checkbox
        label={`Save results to results/${MODEL.id}/`}
        checked={settings.autosave}
        onChange={(e) => controller.updateSettings({ autosave: e.currentTarget.checked })}
      />
    </Section>
  );
}

function RunSection() {
  const controller = useController();
  const state = useAppState();
  const can = controlAvailability(state);
  const { progress } = state;

  return (
    <Section title="Run">
      <Group gap="xs" grow>
        <Button onClick={() => controller.runVideo()} disabled={!can.process}>Process video</Button>
        <Button variant="default" color="red" onClick={() => controller.stop()} disabled={!can.stop}>Stop</Button>
      </Group>
      {progress && <Progress value={(progress.done / progress.total) * 100} animated aria-label="Processing progress" />}
      {state.progressText && <Text size="sm" c="dimmed">{state.progressText}</Text>}
    </Section>
  );
}
