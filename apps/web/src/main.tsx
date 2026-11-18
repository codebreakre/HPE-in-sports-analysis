// Entry point: Mantine setup + the one AppController shared by all components.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "./styles.css";
import { App } from "./App";
import { ControllerProvider } from "./app/AppContext";
import { AppController } from "./app/controller";
import { theme } from "./theme";

const controller = new AppController();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ControllerProvider controller={controller}>
        <App />
      </ControllerProvider>
    </MantineProvider>
  </StrictMode>,
);
