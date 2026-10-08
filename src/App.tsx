// Page layout: header, controls on the left, video/canvas and results on the right.
import { useEffect } from "react";
import { AppShell, ScrollArea, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useController } from "./app/AppContext";
import { AppHeader } from "./components/AppHeader";
import { ControlPanel } from "./components/ControlPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { Stage } from "./components/Stage";

export function App() {
  const controller = useController();
  const [navOpen, { toggle: toggleNav }] = useDisclosure(false);

  useEffect(() => controller.start(), [controller]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 340, breakpoint: "sm", collapsed: { mobile: !navOpen } }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader navOpen={navOpen} onToggleNav={toggleNav} />
      </AppShell.Header>

      <AppShell.Navbar>
        <ScrollArea p="md">
          <ControlPanel />
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <Stack gap="md">
          <Stage />
          <ResultsPanel />
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
