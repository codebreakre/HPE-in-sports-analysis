import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import filesPlugin from "./server/files-plugin.ts";

export default defineConfig({
  plugins: [react(), filesPlugin()],
  // Keep these un-prebundled so their wasm (resolved via import.meta.url) loads correctly.
  optimizeDeps: { exclude: ["@ultralytics/yolo", "onnxruntime-web"] },
  // data/ and results/ change while the app runs; reloading the page would lose a run in progress.
  server: { port: 5173, watch: { ignored: ["**/data/**", "**/results/**"] } },
});
