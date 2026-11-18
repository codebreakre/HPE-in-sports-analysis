// Title, page navigation, model status and light/dark toggle.
import {
  ActionIcon, Badge, Burger, Group, Loader, SegmentedControl, Title, Tooltip, useComputedColorScheme, useMantineColorScheme,
} from "@mantine/core";
import { useAppState, useController } from "../app/AppContext";
import type { Page } from "../app/controller";

const PAGES: { value: Page; label: string }[] = [
  { value: "pose", label: "Pose estimation" },
  { value: "saved", label: "Saved results" },
  { value: "resolution", label: "Resolution check" },
];

const STATUS_COLORS = { loading: "gray", ready: "green", error: "red" } as const;

export function AppHeader({ navOpen, onToggleNav }: { navOpen: boolean; onToggleNav: () => void }) {
  const controller = useController();
  const { modelStatus, page } = useAppState();
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("light");

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap" miw={0}>
        {page === "pose" && (
          <Burger opened={navOpen} onClick={onToggleNav} hiddenFrom="sm" size="sm" aria-label="Toggle controls" />
        )}
        <Title order={4} visibleFrom="lg">Human Pose Estimation</Title>
        <SegmentedControl
          aria-label="Page"
          size="xs"
          data={PAGES}
          value={page}
          onChange={(value) => controller.setPage(value as Page)}
        />
        <Tooltip label={modelStatus.text} multiline maw={400}>
          <Badge
            color={STATUS_COLORS[modelStatus.kind]}
            variant="light"
            tt="none"
            size="lg"
            maw={360}
            visibleFrom="md"
            leftSection={modelStatus.kind === "loading" ? <Loader size={12} color="gray" /> : null}
          >
            {modelStatus.text}
          </Badge>
        </Tooltip>
      </Group>

      <ActionIcon
        variant="default"
        size="lg"
        onClick={() => setColorScheme(colorScheme === "dark" ? "light" : "dark")}
        aria-label="Toggle light/dark mode"
      >
        {colorScheme === "dark" ? "☀" : "☾"}
      </ActionIcon>
    </Group>
  );
}
