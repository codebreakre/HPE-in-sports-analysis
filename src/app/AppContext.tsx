// Makes the one AppController available to every component.
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { AppController, AppState } from "./controller";

const ControllerContext = createContext<AppController | null>(null);

export function ControllerProvider({ controller, children }: { controller: AppController; children: ReactNode }) {
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

export function useController(): AppController {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error("useController must be used inside <ControllerProvider>");
  return controller;
}

/** The current app state; the component re-renders whenever it changes. */
export function useAppState(): AppState {
  const controller = useController();
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
