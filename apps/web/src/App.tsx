// Page layout: header with page navigation. "Pose estimation": controls on the left, video/canvas
// and results on the right. "Saved results": runs read back from results/. "Resolution check": the
// saved resolution comparison charts.
import { useEffect } from "react";
import { AppShell, Box, ScrollArea, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useAppState, useController } from "./app/AppContext";
import { AppHeader } from "./components/AppHeader";
import { ControlPanel } from "./components/ControlPanel";
import { ResolutionCheckPage } from "./components/ResolutionCheckPage";
import { ResultsPanel } from "./components/ResultsPanel";
import { SavedResultsPage } from "./components/SavedResultsPage";
import { Stage } from "./components/Stage";

export function App() {
  const controller = useController();
  const { page } = useAppState();
  const [navOpen, { toggle: toggleNav }] = useDisclosure(false);

  useEffect(() => controller.start(), [controller]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 340, breakpoint: "sm", collapsed: { mobile: !navOpen || page !== "pose", desktop: page !== "pose" } }}
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
        {/* Kept mounted while hidden: the controller draws on the stage and runs keep going. */}
        <Box display={page === "pose" ? undefined : "none"}>
          <Stack gap="md">
            <Stage />
            <ResultsPanel />
          </Stack>
        </Box>
        {page === "saved" && <SavedResultsPage />}
        {page === "resolution" && <ResolutionCheckPage />}
      </AppShell.Main>
    </AppShell>
  );
}
