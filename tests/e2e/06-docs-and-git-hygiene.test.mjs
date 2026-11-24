import { describe, it as test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createD1Sandbox } from "./helpers/d1-sandbox.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  }).trim();
}

function collectJsFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".wrangler") {
      continue;
    }
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.isFile() && /\.(js|mjs|cjs|ts|tsx|jsx)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe("06 API Documentation & Git Hygiene (Features #21, #22)", () => {
  // Feature 21 — Tier 1
  test("T1-F21-01: README.md documents all preserved and new REST endpoints", () => {
    const readme = readRepoFile("README.md");
    const requiredRoutes = [
      "/auth/register",
      "/auth/login",
      "/users/me",
      "/groups",
      "/keywords",
      "/alerts",
      "/reports",
      "/health",
      "/stats",
      "/search",
      "/admin/known",
      "/admin/ingest"
    ];

    for (const route of requiredRoutes) {
      assert.ok(
        readme.includes(route),
        `Expected README.md to document endpoint '${route}'`
      );
    }
    assert.match(
      readme,
      /\/keywords\/(?::id|\{id\}|<id>)\/scan/,
      "Expected README.md to document /keywords/:id/scan"
    );
    assert.match(
      readme,
      /(?:`\/`|\bGET\s+`?\/`?)/,
      "Expected README.md to document root route GET /"
    );
  });

  test("T1-F21-02: README.md lists HTTP methods, parameters, and required headers", () => {
    const readme = readRepoFile("README.md");
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      assert.ok(
        new RegExp(`\\b${method}\\b`).test(readme),
        `Expected README.md to document HTTP method ${method}`
      );
    }
    assert.match(readme, /Authorization/i, "Expected Authorization header in README.md");
    assert.match(readme, /Bearer\s+/i, "Expected Bearer token scheme in README.md");
    assert.match(readme, /Content-Type/i, "Expected Content-Type header in README.md");
    assert.match(readme, /application\/json/i, "Expected application/json in README.md");
    assert.match(readme, /\?q=|group_id|priority/, "Expected query/filter parameters in README.md");
  });

  test("T1-F21-03: README.md includes concrete JSON request and response examples", () => {
    const readme = readRepoFile("README.md");
    const jsonBlocks = [...readme.matchAll(/```json\s*([\s\S]*?)```/gi)];
    assert.ok(
      jsonBlocks.length >= 2,
      `Expected at least 2 \`\`\`json example blocks (request + response) in README.md, found ${jsonBlocks.length}`
    );

    const joined = jsonBlocks.map((m) => m[1]).join("\n");
    assert.match(joined, /"keyword"/, "Expected JSON examples to include keyword payload/response");
    assert.match(joined, /"email"/, "Expected JSON examples to include auth/user email");
  });

  test("T1-F21-04: README.md documents all expected HTTP status codes", () => {
    const readme = readRepoFile("README.md");
    const expectedCodes = ["200", "201", "204", "400", "401", "403", "404", "409", "415", "429", "503"];
    for (const code of expectedCodes) {
      assert.ok(
        new RegExp(`\\b${code}\\b`).test(readme),
        `Expected README.md to document HTTP status code ${code}`
      );
    }
  });

  test("T1-F21-05: README.md includes local run commands (D1, Worker, Next.js) and no real secrets", () => {
    const readme = readRepoFile("README.md");
    assert.match(readme, /wrangler\s+d1\s+execute/i, "Expected D1 execute command in README.md");
    assert.match(readme, /wrangler\s+dev|npm\s+run\s+dev/i, "Expected local Worker run command in README.md");
    assert.match(readme, /frontend/i, "Expected frontend/Next.js local run instructions in README.md");
    assert.match(readme, /next|3000/i, "Expected Next.js dev command or port 3000 in README.md");
    assert.doesNotMatch(
      readme,
      /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,})/,
      "README.md must not contain real API keys or tokens"
    );
  });

  // Feature 21 — Tier 2
  test("T2-F21-01: README.md contains no leaked .env/.dev.vars secrets or hardcoded 32+ char token values", () => {
    const readme = readRepoFile("README.md");
    assert.doesNotMatch(
      readme,
      /(?:INGEST_TOKEN|RATE_LIMIT_SALT|AUTH_SECRET|JWT_SECRET)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{24,}["']?/,
      "README.md must only use placeholder tokens, never real secret values"
    );
    assert.doesNotMatch(
      readme,
      /Bearer\s+[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{10,}/,
      "README.md must not contain real signed Bearer tokens"
    );
  });

  test("T2-F21-02: Every REST route implemented in worker/src/ is listed in README.md", () => {
    const readme = readRepoFile("README.md");
    const workerSrcDir = path.join(repoRoot, "worker", "src");
    const workerFiles = collectJsFiles(workerSrcDir);
    assert.ok(workerFiles.length >= 1, "Expected worker/src/ JS files to exist");

    const source = workerFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    const staticRoutes = [
      "/health",
      "/stats",
      "/search",
      "/admin/known",
      "/admin/ingest"
    ];
    for (const route of staticRoutes) {
      if (source.includes(`"${route}"`) || source.includes(`'${route}'`)) {
        assert.ok(readme.includes(route), `Implemented route ${route} missing from README.md`);
      }
    }

    const newRoutes = [
      "/auth/register",
      "/auth/login",
      "/users/me",
      "/groups",
      "/keywords",
      "/alerts",
      "/reports"
    ];
    for (const route of newRoutes) {
      assert.ok(readme.includes(route), `Contract route ${route} missing from README.md`);
    }
  });

  test("T2-F21-03: Documented HTTP status codes (200, 201, 400, 401, 403, 404, 409) appear with explanation context", () => {
    const readme = readRepoFile("README.md");
    const coreCodes = ["200", "201", "400", "401", "403", "404", "409"];
    for (const code of coreCodes) {
      const lineRegex = new RegExp(`^.*\\b${code}\\b.*[A-Za-zÀ-ÿ]{4,}.*$`, "m");
      assert.match(
        readme,
        lineRegex,
        `Expected status code ${code} in README.md to have descriptive explanation text`
      );
    }
  });

  test("T2-F21-04: Local setup commands in README.md reference valid repository paths", () => {
    const readme = readRepoFile("README.md");
    const expectedPaths = ["database/schema.sql", "worker", "frontend"];
    for (const rel of expectedPaths) {
      assert.ok(readme.includes(rel), `Expected README.md to reference '${rel}'`);
      assert.ok(
        fs.existsSync(path.join(repoRoot, rel)),
        `Expected referenced path '${rel}' to exist in repository`
      );
    }
  });

  test("T2-F21-05: README.md preserves original edital-monitor Telemaco Borba context and limitations", () => {
    const readme = readRepoFile("README.md");
    assert.match(readme, /Telêmaco Borba/i, "Expected Telêmaco Borba context preserved in README.md");
    assert.match(readme, /Boletim Oficial/i, "Expected Boletim Oficial context preserved in README.md");
    assert.match(readme, /Limitações/i, "Expected Limitações section preserved in README.md");
    assert.match(readme, /AGENTS\.md/, "Expected AGENTS.md reference preserved in README.md");
  });

  // Feature 22 — Tier 1
  test("T1-F22-01: Git branch is feat/crud-palavras-chave and main branch remains untouched", () => {
    const currentBranch = runGit(["branch", "--show-current"]);
    assert.equal(currentBranch, "feat/crud-palavras-chave");

    const mainSha = runGit(["rev-parse", "main"]);
    const mergeBase = runGit(["merge-base", "main", "HEAD"]);
    assert.equal(
      mergeBase,
      mainSha,
      "Expected feat/crud-palavras-chave to branch cleanly from untouched main"
    );

    let originMainSha = null;
    try {
      originMainSha = runGit(["rev-parse", "origin/main"]);
    } catch {
      originMainSha = null;
    }
    if (originMainSha) {
      assert.equal(mainSha, originMainSha, "Expected local main to equal origin/main");
    }
  });

  test("T1-F22-02: site/ and collector/ remain unmodified relative to main", () => {
    const diff = runGit(["diff", "main", "--", "site/", "collector/"]);
    assert.equal(diff, "", `Expected zero diff vs main in site/ and collector/, got:\n${diff}`);

    const untracked = runGit(["ls-files", "--others", "--exclude-standard", "--", "site/", "collector/"]);
    assert.equal(untracked, "", `Expected zero untracked files in site/ and collector/, got:\n${untracked}`);
  });

  test("T1-F22-03: .gitignore ignores .next/, frontend/node_modules/, .env, .dev.vars, .wrangler/", () => {
    const gitignore = readRepoFile(".gitignore");
    const requiredPatterns = [".next/", "frontend/node_modules/", ".env", ".dev.vars", ".wrangler/"];
    for (const pattern of requiredPatterns) {
      assert.ok(
        gitignore.includes(pattern),
        `Expected .gitignore to include '${pattern}'`
      );
    }

    const ignoredTargets = [
      ".env",
      "worker/.dev.vars",
      "worker/.wrangler/state",
      "frontend/.next/cache",
      "frontend/node_modules/next/package.json"
    ];
    for (const target of ignoredTargets) {
      let exitCode = 1;
      try {
        execFileSync("git", ["check-ignore", "-q", target], {
          cwd: repoRoot,
          windowsHide: true
        });
        exitCode = 0;
      } catch (err) {
        exitCode = err.status ?? 1;
      }
      assert.equal(exitCode, 0, `Expected '${target}' to be ignored by git check-ignore`);
    }
  });

  test("T1-F22-04: worker/ and frontend/ have zero committed secret files or build artifacts", () => {
    const trackedFiles = runGit(["ls-files", "--", "worker/", "frontend/"]).split(/\r?\n/).filter(Boolean);
    const forbidden = trackedFiles.filter((filePath) => {
      const normalized = filePath.replace(/\\/g, "/");
      if (normalized.endsWith(".env.example") || normalized.endsWith(".dev.vars.example")) {
        return false;
      }
      return (
        /(^|\/)\.env($|\.)/.test(normalized) ||
        /(^|\/)\.dev\.vars($|\.)/.test(normalized) ||
        normalized.includes("/.next/") ||
        normalized.includes("/node_modules/") ||
        normalized.includes("/.wrangler/")
      );
    });
    assert.deepEqual(forbidden, [], `Found forbidden tracked secret/build files: ${forbidden.join(", ")}`);
  });

  test("T1-F22-05: README.md has no broken relative markdown links or production deploy credentials", () => {
    const readme = readRepoFile("README.md");
    const linkMatches = [...readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
    for (const match of linkMatches) {
      const target = match[1].trim();
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      const cleanTarget = target.split("#")[0];
      if (!cleanTarget) continue;
      const resolved = path.resolve(repoRoot, cleanTarget);
      assert.ok(
        fs.existsSync(resolved),
        `Broken relative markdown link in README.md: '${target}' -> ${resolved}`
      );
    }
    assert.doesNotMatch(
      readme,
      /CLOUDFLARE_API_TOKEN\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/,
      "README.md must not contain production Cloudflare credentials"
    );
  });

  // Feature 22 — Tier 2
  test("T2-F22-01: git status shows no untracked .next/, node_modules/, .wrangler/, .env, or .dev.vars", () => {
    const statusOutput = runGit(["status", "--porcelain", "-uall"]);
    const lines = statusOutput ? statusOutput.split(/\r?\n/) : [];
    const badEntries = lines.filter((line) =>
      /(\.next\/|node_modules\/|\.wrangler\/|\.dev\.vars|\.env($|\.local))/.test(line)
    );
    assert.deepEqual(badEntries, [], `Found untracked/modified artifact or secret entries: ${badEntries.join("; ")}`);
  });

  test("T2-F22-02: worker/wrangler.jsonc preserves production settings without inline secrets", () => {
    const raw = readRepoFile("worker/wrangler.jsonc");
    const config = JSON.parse(raw);
    assert.equal(config.workers_dev, false);
    assert.equal(config.preview_urls, false);
    assert.ok(Array.isArray(config.d1_databases) && config.d1_databases.length >= 1);
    assert.equal(config.d1_databases[0].database_name, "edital-monitor");
    assert.equal(config.d1_databases[0].database_id, "7cfcb301-6c96-4290-9f70-c23fdf416262");

    const vars = config.vars || {};
    for (const secretKey of ["INGEST_TOKEN", "RATE_LIMIT_SALT", "AUTH_SECRET", "JWT_SECRET"]) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(vars, secretKey),
        false,
        `Secret '${secretKey}' must not be hardcoded in wrangler.jsonc vars`
      );
    }
  });

  test("T2-F22-03: Local D1 persistence survives across separate process/DB invocations", async () => {
    const sandbox = await createD1Sandbox({ repoRoot, seed: true });
    try {
      const email = "persist.check@example.com";
      const tmpSqlName = `e2e-persist-${Date.now()}.sql`;
      const tmpSqlPath = path.join(sandbox.persistDir, tmpSqlName);
      fs.writeFileSync(
        tmpSqlPath,
        `INSERT INTO users (name, email, password_hash) VALUES ('Persist Test', '${email}', 'pbkdf2$100000$salt$hash');\n`,
        "utf8"
      );

      await sandbox.executeSqlFile(tmpSqlPath);

      // Re-open SQLite in a completely separate DatabaseSync instance
      const db2 = new DatabaseSync(sandbox.dbPath, { readOnly: true });
      try {
        const row = db2
          .prepare("SELECT name, email, password_hash FROM users WHERE email = ?")
          .get(email);
        assert.ok(row, "Expected inserted user row to persist across invocations");
        assert.equal(row.name, "Persist Test");
        assert.equal(row.email, email);
      } finally {
        db2.close();
      }
    } finally {
      await sandbox.cleanup();
    }
  });

  test("T2-F22-04: Repository scripts and E2E test suite do not target main mutation or wrangler deploy", () => {
    const workerPkg = JSON.parse(readRepoFile("worker/package.json"));
    const devScript = workerPkg.scripts?.dev || "";
    assert.doesNotMatch(devScript, /deploy/, "worker dev script must not run wrangler deploy");

    const mainSha = runGit(["rev-parse", "main"]);
    const headSha = runGit(["rev-parse", "HEAD"]);
    assert.ok(mainSha.length === 40 && headSha.length === 40);
    const currentBranch = runGit(["branch", "--show-current"]);
    assert.notEqual(currentBranch, "main");
  });

  test("T2-F22-05: site/index.html and site/assets/js/search.js remain byte-for-byte identical to main", () => {
    for (const file of ["site/index.html", "site/assets/js/search.js"]) {
      const diff = runGit(["diff", "main", "--", file]);
      assert.equal(diff, "", `Expected '${file}' to have zero diff vs main`);
      const workingBytes = fs.readFileSync(path.join(repoRoot, file));
      const mainBytes = execFileSync("git", ["show", `main:${file}`], {
        cwd: repoRoot,
        windowsHide: true
      });
      assert.equal(
        Buffer.compare(workingBytes, mainBytes),
        0,
        `Expected '${file}' to be byte-for-byte identical to main`
      );
    }
  });
});
