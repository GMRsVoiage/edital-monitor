import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const NEXT_LOCK_PATH = path.join(os.tmpdir(), "edital-e2e-next.lock");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

async function acquireNextLock(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(NEXT_LOCK_PATH, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          fs.unlinkSync(NEXT_LOCK_PATH);
        } catch {
          // ignore if already removed
        }
      };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      try {
        const raw = fs.readFileSync(NEXT_LOCK_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.pid && !isPidAlive(parsed.pid)) {
          fs.unlinkSync(NEXT_LOCK_PATH);
          continue;
        }
      } catch {
        // ignore transient read/parse race
      }
      await sleep(250);
    }
  }
  throw new Error(`Timed out waiting for Next.js lockfile (${NEXT_LOCK_PATH})`);
}

/**
 * Terminates a spawned child process and all of its descendants.
 * @param {import("node:child_process").ChildProcess | null | undefined} child
 */
export async function killProcessTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const pid = child.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true
      });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    const waitStart = Date.now();
    while (child.exitCode === null && child.signalCode === null && Date.now() - waitStart < 3000) {
      await sleep(100);
    }
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
  }

  const exitDeadline = Date.now() + 3000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < exitDeadline) {
    await sleep(50);
  }
}

async function pollHttpReady(url, { timeoutMs, isHealthy, child, getLogs }) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Server process exited prematurely (code=${child.exitCode}) before ${url} became ready.\n${getLogs()}`
      );
    }

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (isHealthy(res.status)) {
        return;
      }
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${url}. Last error: ${lastError?.message || lastError}\n${getLogs()}`
  );
}

/**
 * Starts an isolated local Wrangler Worker server bound to 127.0.0.1:<port>.
 * @param {{ repoRoot: string, persistDir: string, port: number, vars?: Record<string, string> }} options
 */
export async function startWorkerServer({ repoRoot, persistDir, port, vars = {} }) {
  const mergedVars = {
    INGEST_TOKEN: "e2e-ingest-token-secret",
    RATE_LIMIT_SALT: "e2e-rate-salt",
    AUTH_SECRET: "e2e-auth-hmac-secret",
    ALLOWED_ORIGIN: "http://localhost:3000,http://127.0.0.1:3000",
    DAILY_SEARCH_LIMIT: "100",
    ...vars
  };

  const workerDir = path.join(repoRoot, "worker");
  const wranglerBin = path.join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js");

  const wranglerArgs = [
    "dev",
    "--local",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persistDir,
    "--show-interactive-dev-session=false"
  ];

  for (const [key, value] of Object.entries(mergedVars)) {
    wranglerArgs.push("--var", `${key}:${value}`);
  }

  const useDirectNode = fs.existsSync(wranglerBin);
  const command = useDirectNode
    ? process.execPath
    : process.platform === "win32"
      ? "cmd.exe"
      : "npx";
  const commandArgs = useDirectNode
    ? [wranglerBin, ...wranglerArgs]
    : process.platform === "win32"
      ? ["/d", "/c", "npx", "--no-install", "wrangler", ...wranglerArgs]
      : ["--no-install", "wrangler", ...wranglerArgs];

  const child = spawn(command, commandArgs, {
    cwd: workerDir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const url = `http://127.0.0.1:${port}`;
  const getLogs = () => `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;

  try {
    await pollHttpReady(`${url}/health`, {
      timeoutMs: 45000,
      isHealthy: (status) => status === 200,
      child,
      getLogs
    });
  } catch (err) {
    await killProcessTree(child).catch(() => {});
    throw err;
  }

  return {
    url,
    port,
    vars: mergedVars,
    async stop() {
      await killProcessTree(child);
    }
  };
}

/**
 * Starts an isolated Next.js dev server bound to 127.0.0.1:<port>, protected by an OS-temp lockfile.
 * @param {{ repoRoot: string, apiUrl: string, port: number }} options
 */
export async function startNextServer({ repoRoot, apiUrl, port }) {
  const releaseLock = await acquireNextLock();
  const frontendDir = path.join(repoRoot, "frontend");
  const nextBin = path.join(frontendDir, "node_modules", "next", "dist", "bin", "next");

  const nextArgs = ["dev", "--hostname", "127.0.0.1", "--port", String(port)];
  const useDirectNode = fs.existsSync(nextBin);
  const command = useDirectNode
    ? process.execPath
    : process.platform === "win32"
      ? "cmd.exe"
      : "npx";
  const commandArgs = useDirectNode
    ? [nextBin, ...nextArgs]
    : process.platform === "win32"
      ? ["/d", "/c", "npx", "--no-install", "next", ...nextArgs]
      : ["--no-install", "next", ...nextArgs];

  let child;
  let stdout = "";
  let stderr = "";

  try {
    child = spawn(command, commandArgs, {
      cwd: frontendDir,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: apiUrl,
        NEXT_TELEMETRY_DISABLED: "1"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    const url = `http://127.0.0.1:${port}`;
    const getLogs = () => `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;

    await pollHttpReady(`${url}/`, {
      timeoutMs: 60000,
      isHealthy: (status) => status < 500,
      child,
      getLogs
    });

    return {
      url,
      port,
      async stop() {
        try {
          await killProcessTree(child);
        } finally {
          releaseLock();
        }
      }
    };
  } catch (err) {
    try {
      await killProcessTree(child);
    } finally {
      releaseLock();
    }
    throw err;
  }
}
