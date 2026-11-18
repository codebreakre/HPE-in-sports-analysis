import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import filesPlugin from "./dev-server/files-plugin.ts";

/** The Python HPE server (apps/server, `npm run server`); the app reaches it through /server-api. */
const HPE_SERVER = process.env.HPE_SERVER_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), filesPlugin()],
  // Keep these un-prebundled so their wasm (resolved via import.meta.url) loads correctly.
  optimizeDeps: { exclude: ["@ultralytics/yolo", "onnxruntime-web"] },
  // data/ and results/ change while the app runs; reloading the page would lose a run in progress.
  server: {
    port: 5173,
    watch: { ignored: ["**/data/**", "**/results/**"] },
    proxy: { "/server-api": { target: HPE_SERVER, rewrite: (p) => p.replace(/^\/server-api/, "") } },
  },
  preview: { proxy: { "/server-api": { target: HPE_SERVER, rewrite: (p) => p.replace(/^\/server-api/, "") } } },
});
