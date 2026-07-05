import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildServiceDefinitions, resolvePythonExecutable } from "./dev.mjs";

test("buildServiceDefinitions starts the API, worker, and frontend", () => {
  const rootDir = "/repo";
  const services = buildServiceDefinitions({
    rootDir,
    pythonExecutable: "/repo/.venv/bin/python",
  });

  assert.deepEqual(
    services.map((service) => service.name),
    ["backend-api", "backend-worker", "frontend"]
  );
  assert.deepEqual(services[0].command, "/repo/.venv/bin/python");
  assert.deepEqual(services[0].args, [
    "-m",
    "uvicorn",
    "app.main:app",
    "--reload",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ]);
  assert.deepEqual(services[0].cwd, path.join(rootDir, "backend"));
  assert.deepEqual(services[1].command, "/repo/.venv/bin/python");
  assert.deepEqual(services[1].args, ["-m", "app.worker"]);
  assert.deepEqual(services[1].cwd, path.join(rootDir, "backend"));
  assert.deepEqual(services[2].command, "npm");
  assert.deepEqual(services[2].args, ["run", "dev"]);
  assert.deepEqual(services[2].cwd, path.join(rootDir, "frontend"));
});

test("resolvePythonExecutable prefers VISIONOPS_PYTHON, then root .venv", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "visionops-dev-"));
  try {
    await mkdir(path.join(rootDir, ".venv", "bin"), { recursive: true });
    await writeFile(path.join(rootDir, ".venv", "bin", "python"), "");

    assert.equal(
      resolvePythonExecutable(rootDir, { VISIONOPS_PYTHON: "/custom/python" }),
      "/custom/python"
    );
    assert.equal(
      resolvePythonExecutable(rootDir, {}),
      path.join(rootDir, ".venv", "bin", "python")
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
