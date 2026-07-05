import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");

export function resolvePythonExecutable(rootDir, env = process.env) {
  if (env.VISIONOPS_PYTHON?.trim()) {
    return env.VISIONOPS_PYTHON.trim();
  }

  const localVenvPython = path.join(rootDir, ".venv", "bin", "python");
  if (existsSync(localVenvPython)) {
    return localVenvPython;
  }

  return "python3";
}

export function buildServiceDefinitions({ rootDir, pythonExecutable }) {
  return [
    {
      name: "backend-api",
      command: pythonExecutable,
      args: [
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
      ],
      cwd: path.join(rootDir, "backend"),
    },
    {
      name: "backend-worker",
      command: pythonExecutable,
      args: ["-m", "app.worker"],
      cwd: path.join(rootDir, "backend"),
    },
    {
      name: "frontend",
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["run", "dev"],
      cwd: path.join(rootDir, "frontend"),
    },
  ];
}

function startService(service) {
  console.log(`[dev] starting ${service.name}`);
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
    },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[dev] ${service.name} failed to start: ${error.message}`);
  });

  return { ...service, child };
}

function stopService(service, signal = "SIGTERM") {
  if (service.child.exitCode !== null || service.child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32") {
    service.child.kill(signal);
    return;
  }

  try {
    process.kill(-service.child.pid, signal);
  } catch {
    service.child.kill(signal);
  }
}

export function runDev(rootDir = projectRoot) {
  const pythonExecutable = resolvePythonExecutable(rootDir);
  const services = buildServiceDefinitions({ rootDir, pythonExecutable }).map(startService);
  let shuttingDown = false;

  function shutdown(exitCode = 0) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log("[dev] stopping services");
    for (const service of services) {
      stopService(service);
    }
    setTimeout(() => process.exit(exitCode), 300);
  }

  for (const service of services) {
    service.child.on("exit", (code, signal) => {
      if (shuttingDown) {
        return;
      }
      if (code === 0 || signal === "SIGTERM" || signal === "SIGINT") {
        shutdown(0);
        return;
      }
      console.error(`[dev] ${service.name} exited with code ${code ?? signal}`);
      shutdown(code ?? 1);
    });
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDev();
}
