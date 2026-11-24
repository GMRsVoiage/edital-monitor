import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

function runWrangler(repoRoot, args) {
  const workerDir = path.join(repoRoot, "worker");
  const wranglerBin = path.join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js");

  const useDirectNode = fs.existsSync(wranglerBin);
  const command = useDirectNode
    ? process.execPath
    : process.platform === "win32"
      ? "cmd.exe"
      : "npx";
  const commandArgs = useDirectNode
    ? [wranglerBin, ...args]
    : process.platform === "win32"
      ? ["/d", "/c", "npx", "--no-install", "wrangler", ...args]
      : ["--no-install", "wrangler", ...args];

  return new Promise((resolve, reject) => {
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
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `wrangler ${args.join(" ")} exited with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
          )
        );
      }
    });
  });
}

function findD1SqliteFile(persistDir) {
  const d1Dir = path.join(persistDir, "v3", "d1", "miniflare-D1DatabaseObject");
  if (!fs.existsSync(d1Dir)) {
    throw new Error(`D1 state directory not found: ${d1Dir}`);
  }
  const entries = fs.readdirSync(d1Dir, { withFileTypes: true });
  const match = entries.find(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith(".sqlite") &&
      entry.name !== "metadata.sqlite"
  );
  if (!match) {
    throw new Error(
      `No D1 database *.sqlite (excluding metadata.sqlite) found in ${d1Dir}. Entries: ${entries.map((e) => e.name).join(", ")}`
    );
  }
  return path.join(d1Dir, match.name);
}

async function removeDirWithRetry(targetDir, retries = 10, delayMs = 150) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await fs.promises.rm(targetDir, { recursive: true, force: true });
      return;
    } catch (err) {
      const transient = err && (err.code === "EBUSY" || err.code === "EPERM" || err.code === "ENOTEMPTY");
      if (!transient || attempt === retries) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/**
 * Provisions an isolated local D1 SQLite sandbox using schema.sql (and seed.dev.sql).
 * @param {{ repoRoot: string, seed?: boolean }} options
 */
export async function createD1Sandbox({ repoRoot, seed = true }) {
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), "edital-e2e-"));

  try {
    await runWrangler(repoRoot, [
      "d1",
      "execute",
      "edital-monitor",
      "--local",
      "--persist-to",
      persistDir,
      "--file=../database/schema.sql"
    ]);

    if (seed) {
      const seedPath = path.join(repoRoot, "database", "seed.dev.sql");
      if (!fs.existsSync(seedPath)) {
        throw new Error(`Expected seed file not found: ${seedPath}`);
      }
      await runWrangler(repoRoot, [
        "d1",
        "execute",
        "edital-monitor",
        "--local",
        "--persist-to",
        persistDir,
        "--file=../database/seed.dev.sql"
      ]);
    }

    const dbPath = findD1SqliteFile(persistDir);

    function queryAll(sql, params = []) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const stmt = db.prepare(sql);
        return stmt.all(...params);
      } finally {
        db.close();
      }
    }

    function queryOne(sql, params = []) {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      try {
        const stmt = db.prepare(sql);
        return stmt.get(...params) ?? null;
      } finally {
        db.close();
      }
    }

    async function executeSqlFile(relativeToWorkerPath) {
      await runWrangler(repoRoot, [
        "d1",
        "execute",
        "edital-monitor",
        "--local",
        "--persist-to",
        persistDir,
        `--file=${relativeToWorkerPath}`
      ]);
    }

    async function cleanup() {
      await removeDirWithRetry(persistDir);
    }

    return { persistDir, dbPath, queryAll, queryOne, executeSqlFile, cleanup };
  } catch (err) {
    await removeDirWithRetry(persistDir).catch(() => {});
    throw err;
  }
}
