// Starts the Python HPE server from npm, on any OS:
//   npm run server:setup   creates apps/server/.venv and installs requirements.txt
//   npm run server         runs uvicorn on 127.0.0.1:8000 (HPE_SERVER_PORT / HPE_SERVER_HOST to change)
// HPE_DEVICE=cpu forces the CPU; HPE_MODEL_DIR points at another weights folder.
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const venv = path.join(dir, ".venv");
const python = process.platform === "win32" ? path.join(venv, "Scripts", "python.exe") : path.join(venv, "bin", "python");
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: dir });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (process.argv[2] === "setup") {
  if (!fs.existsSync(python)) run(process.platform === "win32" ? "python" : "python3", ["-m", "venv", venv]);
  run(python, ["-m", "pip", "install", "--upgrade", "pip"]);
  run(python, ["-m", "pip", "install", "-r", "requirements.txt"]);
  process.exit(0);
}

if (!fs.existsSync(python)) {
  console.error("No Python environment yet: run `npm run server:setup` first.");
  process.exit(1);
}
const host = process.env.HPE_SERVER_HOST ?? "127.0.0.1";
const port = process.env.HPE_SERVER_PORT ?? "8000";
const child = spawn(python, ["-m", "uvicorn", "hpe_server.main:app", "--host", host, "--port", port], { stdio: "inherit", cwd: dir });
child.on("exit", (code) => process.exit(code ?? 0));
