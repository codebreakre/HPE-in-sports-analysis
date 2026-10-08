import { defineConfig } from "vite";

export default defineConfig({
  // Keep the package un-prebundled so its wasm (resolved via import.meta.url) loads correctly.
  optimizeDeps: { exclude: ["@ultralytics/yolo"] },
  server: { port: 5173 },
});
