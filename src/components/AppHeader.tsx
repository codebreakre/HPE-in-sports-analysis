// Title, model status and light/dark toggle.
import { ActionIcon, Badge, Burger, Group, Loader, Title, Tooltip, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { useAppState } from "../app/AppContext";

const STATUS_COLORS = { loading: "gray", ready: "green", error: "red" } as const;

export function AppHeader({ navOpen, onToggleNav }: { navOpen: boolean; onToggleNav: () => void }) {
  const { modelStatus } = useAppState();
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme("light");

  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Burger opened={navOpen} onClick={onToggleNav} hiddenFrom="sm" size="sm" aria-label="Toggle controls" />
        <Title order={4} visibleFrom="xs">Human Pose Estimation</Title>
        <Tooltip label={modelStatus.text} multiline maw={400}>
          <Badge
            color={STATUS_COLORS[modelStatus.kind]}
            variant="light"
            tt="none"
            size="lg"
            maw={360}
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
