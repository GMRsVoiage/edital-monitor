import { describe, it as test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getFreePort } from "./helpers/ports.mjs";
import { createD1Sandbox } from "./helpers/d1-sandbox.mjs";
import { startWorkerServer, startNextServer } from "./helpers/servers.mjs";
import {
  requestJson,
  requestText,
  registerUser,
  uniqueEmail,
  uniqueKeyword
} from "./helpers/http-client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const frontendSrcDir = path.join(repoRoot, "frontend", "src");

function collectFrontendFiles(dirPath = frontendSrcDir) {
  if (!fs.existsSync(dirPath)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFrontendFiles(full));
    } else if (entry.isFile() && /\.(js|jsx|mjs|ts|tsx|css)$/.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

function readAllFrontendSource(subPath = "") {
  const target = subPath ? path.join(frontendSrcDir, subPath) : frontendSrcDir;
  const files = collectFrontendFiles(target);
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

function extractStylesheetHrefs(html) {
  const matches = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)];
  const reverseMatches = [...html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi)];
  return [...new Set([...matches.map((m) => m[1]), ...reverseMatches.map((m) => m[1])])];
}

function extractScriptSrcs(html) {
  return [...new Set([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]))];
}

async function fetchRenderedChunksText(baseUrl, html) {
  const srcs = extractScriptSrcs(html).filter((s) => s.startsWith("/_next/static/"));
  const chunks = [];
  for (const src of srcs.slice(0, 20)) {
    const res = await requestText(baseUrl, src);
    if (res.status === 200) chunks.push(res.text);
  }
  return chunks.join("\n");
}

function installLocalStorageShim() {
  const hadOriginalStorage = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const originalStorage = globalThis.localStorage;
  const hadOriginalWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const originalWindow = globalThis.window;
  const store = new Map();
  const storageShim = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => {
      store.set(String(k), String(v));
    },
    removeItem: (k) => {
      store.delete(String(k));
    },
    clear: () => {
      store.clear();
    }
  };
  globalThis.localStorage = storageShim;
  globalThis.window = globalThis;
  return () => {
    if (hadOriginalWindow) globalThis.window = originalWindow;
    else delete globalThis.window;
    if (hadOriginalStorage) globalThis.localStorage = originalStorage;
    else delete globalThis.localStorage;
  };
}

async function loadFrontendApiModule(apiUrl) {
  const apiPath = path.join(frontendSrcDir, "lib", "api.js");
  assert.ok(fs.existsSync(apiPath), "Expected frontend/src/lib/api.js to exist");
  const prevApiUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = apiUrl;
  const restoreStorage = installLocalStorageShim();
  const bust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const mod = await import(`${pathToFileURL(apiPath).href}?t=${bust}`);
    const restore = () => {
      restoreStorage();
      if (prevApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = prevApiUrl;
    };
    return { mod, restore };
  } catch (err) {
    restoreStorage();
    if (prevApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prevApiUrl;
    throw err;
  }
}

async function loadFrontendValidationModule() {
  const valPath = path.join(frontendSrcDir, "lib", "validation.js");
  assert.ok(fs.existsSync(valPath), "Expected frontend/src/lib/validation.js to exist");
  const bust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return import(`${pathToFileURL(valPath).href}?t=${bust}`);
}

describe("04 Next.js Frontend & Strict REST Separation (Features #1, #2, #19, #20)", () => {
  let sandbox;
  let worker;
  let nextServer;

  before(async () => {
    sandbox = await createD1Sandbox({ repoRoot, seed: true });
    const workerPort = await getFreePort();
    const nextPort = await getFreePort();

    worker = await startWorkerServer({
      repoRoot,
      persistDir: sandbox.persistDir,
      port: workerPort,
      vars: {
        ALLOWED_ORIGIN: `http://localhost:3000,http://127.0.0.1:3000,http://localhost:${nextPort},http://127.0.0.1:${nextPort}`,
        DAILY_SEARCH_LIMIT: "10"
      }
    });

    nextServer = await startNextServer({
      repoRoot,
      apiUrl: worker.url,
      port: nextPort
    });
  });

  after(async () => {
    if (nextServer) await nextServer.stop();
    if (worker) await worker.stop();
    if (sandbox) await sandbox.cleanup();
  });

  // =========================================================================
  // Feature 1: Next.js Web Application (T1-F01-01..05, T2-F01-01..05)
  // =========================================================================
  test("T1-F01-01: GET / returns 200 HTML with pt-BR, Edital Monitor, search form and saved-keywords section", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/i);
    assert.match(res.text, /<html[^>]*lang=["']pt-BR["']/i);
    assert.match(res.text, /Edital Monitor/i);
    for (const id of ["search-form", "search-input", "search-submit", "saved-keywords-section"]) {
      assert.match(
        res.text,
        new RegExp(`id=["']${id}["']`),
        `Expected / SSR HTML to contain #${id}`
      );
    }
  });

  test("T1-F01-02: GET / HTML and CSS include AquaWave / Frutiger Aero visual classes", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    const hrefs = extractStylesheetHrefs(res.text);
    let cssText = "";
    for (const href of hrefs) {
      const cssRes = await requestText(nextServer.url, href);
      if (cssRes.status === 200) cssText += "\n" + cssRes.text;
    }
    const combined = res.text + "\n" + cssText;
    for (const cls of [
      "aero-canvas",
      "site-header",
      "aero-capsule-nav",
      "hero-panel",
      "status-grid",
      "site-footer"
    ]) {
      assert.ok(
        combined.includes(cls),
        `Expected AquaWave class '.${cls}' in Next.js HTML/CSS`
      );
    }
  });

  test("T1-F01-03: GET /login and /cadastro return 200 with email/password and name/email/password forms", async () => {
    const loginRes = await requestText(nextServer.url, "/login");
    assert.equal(loginRes.status, 200);
    assert.match(loginRes.headers.get("content-type") || "", /text\/html/i);
    assert.match(loginRes.text, /<form/i);
    assert.match(loginRes.text, /type=["']email["']/i);
    assert.match(loginRes.text, /type=["']password["']/i);

    const regRes = await requestText(nextServer.url, "/cadastro");
    assert.equal(regRes.status, 200);
    assert.match(regRes.headers.get("content-type") || "", /text\/html/i);
    assert.match(regRes.text, /<form/i);
    assert.match(regRes.text, /name=["']?name["']?|id=["'][^"']*name|nome/i);
    assert.match(regRes.text, /type=["']email["']/i);
    assert.match(regRes.text, /type=["']password["']/i);
  });

  test("T1-F01-04: GET /perfil, /grupos, /relatorios return 200 SSR HTML without Next.js error boundary", async () => {
    for (const route of ["/perfil", "/grupos", "/relatorios"]) {
      const res = await requestText(nextServer.url, route);
      assert.equal(res.status, 200, `Expected ${route} to return 200`);
      assert.match(res.headers.get("content-type") || "", /text\/html/i);
      assert.doesNotMatch(res.text, /Application error/i, `Unexpected Application error on ${route}`);
      assert.doesNotMatch(res.text, /__next_error__/i, `Unexpected __next_error__ on ${route}`);
      assert.doesNotMatch(res.text, /Internal Server Error/i, `Unexpected 500 text on ${route}`);
    }
  });

  test("T1-F01-05: Preserved search and stats DOM IDs on / are present in rendered HTML", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    const preservedIds = [
      "search-error",
      "stat-documents",
      "stat-pages",
      "stat-latest",
      "stat-latest-meta",
      "feedback",
      "results"
    ];
    for (const id of preservedIds) {
      assert.match(
        res.text,
        new RegExp(`id=["']${id}["']`),
        `Expected preserved DOM id #${id} on /`
      );
    }
  });

  test("T2-F01-01: GET /rota-inexistente returns 404 HTML (never 500)", async () => {
    const res = await requestText(nextServer.url, "/rota-inexistente-e2e");
    assert.equal(res.status, 404);
    assert.match(res.headers.get("content-type") || "", /text\/html/i);
  });

  test("T2-F01-02: SSR GET on /perfil, /grupos, /relatorios succeeds without browser localStorage/window", async () => {
    for (const route of ["/perfil", "/grupos", "/relatorios"]) {
      const res = await requestText(nextServer.url, route);
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.text, /localStorage is not defined/i);
      assert.doesNotMatch(res.text, /window is not defined/i);
      assert.doesNotMatch(res.text, /ReferenceError/i);
    }
  });

  test("T2-F01-04: Stylesheet links referenced in / HTML resolve with HTTP 200 and AquaWave tokens", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    const hrefs = extractStylesheetHrefs(res.text);
    assert.ok(hrefs.length >= 1, "Expected at least one <link rel='stylesheet'> in / HTML");

    let combinedCss = "";
    for (const href of hrefs) {
      const cssRes = await requestText(nextServer.url, href);
      assert.equal(cssRes.status, 200, `Expected stylesheet ${href} to return 200`);
      combinedCss += "\n" + cssRes.text;
    }
    assert.match(combinedCss, /--aero-/, "Expected AquaWave --aero-* CSS tokens in loaded stylesheet");
  });

  test("T2-F01-05: SSR GET /?q=<script>alert(1)</script> escapes XSS payload cleanly", async () => {
    const res = await requestText(nextServer.url, "/?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    assert.equal(res.status, 200);
    assert.equal(
      res.text.includes("<script>alert(1)</script>"),
      false,
      "Raw unescaped <script>alert(1)</script> must never appear in SSR HTML"
    );
  });

  // =========================================================================
  // Feature 2: REST API & Front/Back Separation (T1-F02-01..05, T2-F02-01..05)
  // =========================================================================
  test("T1-F02-01: frontend/src/lib/api.js uses NEXT_PUBLIC_API_URL and frontend has zero DB/INGEST_TOKEN coupling", () => {
    const apiPath = path.join(frontendSrcDir, "lib", "api.js");
    assert.ok(fs.existsSync(apiPath), "Expected frontend/src/lib/api.js to exist");
    const apiSource = fs.readFileSync(apiPath, "utf8");
    assert.match(apiSource, /NEXT_PUBLIC_API_URL/, "api.js must read NEXT_PUBLIC_API_URL");
    assert.match(apiSource, /127\.0\.0\.1:8787|localhost:8787/, "api.js must default to local Worker URL");
    assert.match(apiSource, /\bfetch\s*\(/, "api.js must use fetch()");

    const allFrontendSource = readAllFrontendSource();
    for (const forbidden of ["node:sqlite", "better-sqlite3", "sqlite3", "D1Database", "INGEST_TOKEN"]) {
      assert.equal(
        allFrontendSource.includes(forbidden),
        false,
        `Frontend source must not reference '${forbidden}'`
      );
    }
  });

  test("T1-F02-02: JSON endpoints return application/json, nosniff, and no-referrer security headers", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f02-02") });
    const checks = [
      await requestJson(worker.url, "/"),
      await requestJson(worker.url, "/health"),
      await requestJson(worker.url, "/stats"),
      await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: "198.51.100.10" }),
      await requestJson(worker.url, "/keywords", { token })
    ];

    for (const res of checks) {
      assert.equal(res.status, 200);
      assert.match(
        res.headers.get("content-type") || "",
        /^application\/json;\s*charset=utf-8/i
      );
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    }
  });

  test("T1-F02-03: POST /keywords persists in D1 across requests and frontend/src/lib/api.js executes live REST calls", async () => {
    const kwText = uniqueKeyword("F02-Persist");
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f02-03") });

    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText, priority: "alta", description: "Teste persistência" }
    });
    assert.equal(created.status, 201);
    const id = created.data?.keyword?.id;
    assert.ok(Number.isInteger(id) && id > 0);

    const listed = await requestJson(worker.url, "/keywords", { token });
    assert.equal(listed.status, 200);
    assert.ok(listed.data.keywords.some((k) => k.id === id && k.keyword === kwText));

    const dbRow = sandbox.queryOne("SELECT id, keyword, priority FROM saved_keywords WHERE id = ?", [id]);
    assert.ok(dbRow, "Expected keyword persisted in local D1 SQLite");
    assert.equal(dbRow.keyword, kwText);

    // Mandatorily load and execute real frontend/src/lib/api.js & validation.js against live Worker
    const loaded = await loadFrontendApiModule(worker.url);
    const valMod = await loadFrontendValidationModule();
    try {
      const { mod } = loaded;
      for (const fnName of [
        "fetchStats",
        "searchBulletins",
        "setToken",
        "getToken",
        "clearToken",
        "registerUser",
        "loginUser",
        "fetchCurrentUser",
        "updateCurrentUser",
        "createGroup",
        "fetchGroups",
        "updateGroup",
        "deleteGroup",
        "createKeyword",
        "fetchKeywords",
        "updateKeyword",
        "patchKeyword",
        "deleteKeyword",
        "scanKeyword",
        "createAlert",
        "fetchAlerts",
        "updateAlert",
        "deleteAlert",
        "fetchReports"
      ]) {
        assert.equal(typeof mod[fnName], "function", `Expected api.js export '${fnName}' to be a function`);
      }

      const valCheck = valMod.validateKeywordInput({ keyword: "  Pregão   Eletrônico  " });
      assert.equal(valCheck.valid, true);
      assert.equal(valCheck.value.keyword, "Pregão Eletrônico");

      const statsData = await mod.fetchStats();
      assert.equal(typeof statsData?.documents, "number");
      assert.equal(typeof statsData?.pages, "number");

      const searchData = await mod.searchBulletins("Pregão", {
        headers: { "cf-connecting-ip": "198.51.100.16" }
      });
      assert.ok(searchData.total >= 1);

      // Verify window + localStorage token persistence using TOKEN_STORAGE_KEY
      mod.setToken(token);
      assert.equal(mod.getToken(), token);
      assert.equal(globalThis.localStorage.getItem(mod.TOKEN_STORAGE_KEY), token);

      const apiListFromToken = await mod.fetchKeywords();
      assert.ok(
        Array.isArray(apiListFromToken?.keywords) &&
          apiListFromToken.keywords.some((k) => k.id === id && k.keyword === kwText)
      );

      mod.clearToken();
      assert.equal(mod.getToken(), null);

      // Exercise registerUser, loginUser, fetchCurrentUser, and full keyword CRUD via api.js
      const apiEmail = uniqueEmail("f02-api");
      const apiPass = "SenhaForte@2026";
      const regRes = await mod.registerUser({ name: "API Client User", email: apiEmail, password: apiPass });
      assert.ok(regRes?.token);
      assert.equal(mod.getToken(), regRes.token);

      mod.clearToken();
      assert.equal(mod.getToken(), null);
      const loginRes = await mod.loginUser({ email: apiEmail, password: apiPass });
      assert.ok(loginRes?.token);
      assert.equal(mod.getToken(), loginRes.token);

      const meRes = await mod.fetchCurrentUser();
      assert.equal(meRes?.user?.email, apiEmail);

      const apiKw = uniqueKeyword("F02-ApiMod");
      const apiKwUpdated = uniqueKeyword("F02-ApiMod-Upd");
      const createdApi = await mod.createKeyword({
        keyword: apiKw,
        priority: "alta",
        description: "Criada via api.js"
      });
      const apiKwId = createdApi?.keyword?.id;
      assert.ok(Number.isInteger(apiKwId) && apiKwId > 0);

      const putApi = await mod.updateKeyword(apiKwId, {
        keyword: apiKwUpdated,
        priority: "media",
        target_section: "licitacoes",
        description: "Atualizada via PUT api.js",
        is_active: 1
      });
      assert.equal(putApi?.keyword?.keyword, apiKwUpdated);

      const patchApi = await mod.patchKeyword(apiKwId, { priority: "baixa" });
      assert.equal(patchApi?.keyword?.priority, "baixa");

      const dbApiRow = sandbox.queryOne("SELECT keyword, priority FROM saved_keywords WHERE id = ?", [apiKwId]);
      assert.equal(dbApiRow?.keyword, apiKwUpdated);
      assert.equal(dbApiRow?.priority, "baixa");

      const delApi = await mod.deleteKeyword(apiKwId);
      assert.equal(delApi?.ok, true);
      assert.equal(sandbox.queryOne("SELECT id FROM saved_keywords WHERE id = ?", [apiKwId]), null);
    } finally {
      loaded.restore();
    }
  });

  test("T1-F02-04: PUT, PATCH, and DELETE mutations reflect immediately in GET and local D1 SQLite", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f02-04") });
    const kw1 = uniqueKeyword("F02-Mutate");
    const kw2 = uniqueKeyword("F02-Mutated");

    const postRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kw1, priority: "media" }
    });
    assert.equal(postRes.status, 201);
    const id = postRes.data.keyword.id;

    const putRes = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PUT",
      token,
      body: { keyword: kw2, priority: "alta", target_section: "licitacoes", description: "Atualizado PUT", is_active: 1 }
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.data.keyword.keyword, kw2);

    const patchRes = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PATCH",
      token,
      body: { priority: "baixa" }
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.data.keyword.priority, "baixa");

    const dbAfterUpdate = sandbox.queryOne("SELECT keyword, priority FROM saved_keywords WHERE id = ?", [id]);
    assert.equal(dbAfterUpdate.keyword, kw2);
    assert.equal(dbAfterUpdate.priority, "baixa");

    const delRes = await requestJson(worker.url, `/keywords/${id}`, {
      method: "DELETE",
      token
    });
    assert.equal(delRes.status, 200);

    const getAfterDel = await requestJson(worker.url, `/keywords/${id}`, { token });
    assert.equal(getAfterDel.status, 404);
    assert.equal(sandbox.queryOne("SELECT id FROM saved_keywords WHERE id = ?", [id]), null);
  });

  test("T1-F02-05: Next.js / stats elements match Worker /stats seeded D1 counts", async () => {
    const statsRes = await requestJson(worker.url, "/stats");
    assert.equal(statsRes.status, 200);
    const dbDocs = sandbox.queryOne("SELECT COUNT(*) AS total FROM documents");
    const dbPages = sandbox.queryOne("SELECT COUNT(*) AS total FROM pages");
    assert.equal(statsRes.data.documents, dbDocs.total);
    assert.equal(statsRes.data.pages, dbPages.total);

    const pageRes = await requestText(nextServer.url, "/");
    assert.equal(pageRes.status, 200);
    assert.match(pageRes.text, /id=["']stat-documents["']/);
    assert.match(pageRes.text, /id=["']stat-pages["']/);
    assert.match(pageRes.text, /id=["']stat-latest["']/);

    const frontendSrc = readAllFrontendSource();
    assert.match(frontendSrc, /\/stats/, "Frontend must fetch stats from Worker /stats endpoint");
  });

  test("T2-F02-01: Unknown Worker routes return 404 JSON error", async () => {
    const r1 = await requestJson(worker.url, "/nao-existe");
    assert.equal(r1.status, 404);
    assert.equal(typeof r1.data?.error, "string");
    assert.ok(r1.data.error.length > 0);

    const r2 = await requestJson(worker.url, "/keywords/extra/unknown", { method: "POST", body: {} });
    assert.equal(r2.status, 404);
    assert.equal(typeof r2.data?.error, "string");
  });

  test("T2-F02-02: Unsupported HTTP method on valid path returns 404 or 405 JSON (never 500)", async () => {
    const r1 = await requestJson(worker.url, "/stats", { method: "DELETE" });
    assert.ok(r1.status === 404 || r1.status === 405, `Expected 404/405, got ${r1.status}`);
    assert.equal(typeof r1.data?.error, "string");

    const r2 = await requestJson(worker.url, "/health", { method: "PUT", body: {} });
    assert.ok(r2.status === 404 || r2.status === 405, `Expected 404/405, got ${r2.status}`);
    assert.equal(typeof r2.data?.error, "string");
  });

  test("T2-F02-03: POST /keywords with Content-Type: text/plain returns 415 JSON error", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f02-415") });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ keyword: uniqueKeyword("Plain") })
    });
    assert.equal(res.status, 415);
    assert.equal(typeof res.data?.error, "string");
  });

  test("T2-F02-04: Malformed JSON body on POST /auth/register and POST /keywords returns 400 JSON error", async () => {
    const r1 = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{ "email": "bad@example.com", '
    });
    assert.equal(r1.status, 400);
    assert.equal(typeof r1.data?.error, "string");

    const { token } = await registerUser(worker.url, { email: uniqueEmail("f02-badjson") });
    const r2 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      headers: { "content-type": "application/json" },
      body: '{ "keyword": '
    });
    assert.equal(r2.status, 400);
    assert.equal(typeof r2.data?.error, "string");
  });

  test("T2-F02-05: POST /keywords with empty body, JSON array, or primitive returns 400 JSON error", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f02-shape") });
    for (const badBody of ["", "[]", '"string"']) {
      const res = await requestJson(worker.url, "/keywords", {
        method: "POST",
        token,
        headers: { "content-type": "application/json" },
        body: badBody
      });
      assert.equal(res.status, 400, `Expected 400 for body ${badBody}, got ${res.status}`);
      assert.equal(typeof res.data?.error, "string");
    }
  });

  // =========================================================================
  // Feature 19: Saved Keywords Integration with Search (T1-F19-01..05, T2-F19-01..05)
  // =========================================================================
  test("T1-F19-01: Next.js / renders #saved-keywords-section and exposes keyword UI controls", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    assert.match(res.text, /id=["']saved-keywords-section["']/);

    const chunks = await fetchRenderedChunksText(nextServer.url, res.text);
    const combined = res.text + "\n" + chunks + "\n" + readAllFrontendSource();
    for (const id of ["keyword-form", "saved-keywords-list", "save-current-search-btn"]) {
      assert.ok(
        combined.includes(id),
        `Expected saved-keywords control '#${id}' in Next.js / page or components`
      );
    }
  });

  test("T1-F19-02: Next.js / preserves #search-form, #search-input, #search-submit, #feedback, #results wired to /search", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    for (const id of ["search-form", "search-input", "search-submit", "feedback", "results"]) {
      assert.match(res.text, new RegExp(`id=["']${id}["']`));
    }

    const searchRes = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: "198.51.100.11" });
    assert.equal(searchRes.status, 200);
    assert.ok(searchRes.data.total >= 1);
    assert.match(searchRes.data.results[0].excerpt, /<mark>/i);
  });

  test("T1-F19-03: Saved keyword selection wires search input population and triggers GET /search?q=...", async () => {
    const uiSrc = readAllFrontendSource("app") + "\n" + readAllFrontendSource("components");
    const apiSrc = readAllFrontendSource("lib");
    assert.match(uiSrc, /id=["']search-input["']|search-input/, "Frontend UI must render #search-input");
    assert.match(uiSrc, /saved-keywords-list/, "Frontend UI must render #saved-keywords-list");
    assert.match(uiSrc, /searchBulletins/, "Frontend UI must call searchBulletins()");
    assert.match(
      uiSrc,
      /handleKeywordClick|onClick.*keyword/is,
      "Frontend UI must wire saved-keyword click handler to populate search and trigger query"
    );
    assert.match(apiSrc, /\/search/, "api.js must target /search endpoint");
    assert.match(apiSrc, /buildQueryString|URLSearchParams|encodeURIComponent/, "api.js must parameterize ?q=");

    const loaded = await loadFrontendApiModule(worker.url);
    const valMod = await loadFrontendValidationModule();
    try {
      const { mod } = loaded;
      assert.equal(mod.buildQueryString({ q: "Pregão" }), "?q=Preg%C3%A3o");
      const qCheck = valMod.validateSearchQuery("  Pregão  ");
      assert.equal(qCheck.valid, true);
      assert.equal(qCheck.value, "Pregão");

      const liveSearch = await mod.searchBulletins("Pregão", {
        headers: { "cf-connecting-ip": "198.51.100.12" }
      });
      assert.ok(liveSearch.total >= 1);
      assert.ok(Array.isArray(liveSearch.results) && liveSearch.results.length >= 1);
      assert.match(liveSearch.results[0].excerpt, /<mark>/i);

      const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-03") });
      const term = `Pregão ${Date.now().toString(36)}`;
      const createRes = await mod.createKeyword({ keyword: term }, { token });
      assert.equal(createRes.keyword?.keyword, term);

      const listRes = await mod.fetchKeywords({}, { token });
      assert.ok(listRes.keywords.some((k) => k.keyword === term));

      const seededSearch = await mod.searchBulletins("Pregão Saúde", {
        headers: { "cf-connecting-ip": "198.51.100.17" }
      });
      assert.ok(seededSearch.total >= 1);
    } finally {
      loaded.restore();
    }
  });

  test("T1-F19-04: #save-current-search-btn flow saves current search term via POST /keywords", async () => {
    const frontendSrc = readAllFrontendSource();
    assert.match(frontendSrc, /save-current-search-btn/);
    assert.match(frontendSrc, /\/keywords/);

    const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-04") });
    const searchTerm = `Saúde ${Date.now().toString(36)}`;
    const searchRes = await requestJson(
      worker.url,
      `/search?q=${encodeURIComponent("Saúde")}`,
      { ip: "198.51.100.13" }
    );
    assert.equal(searchRes.status, 200);

    const saveRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: searchTerm }
    });
    assert.equal(saveRes.status, 201);
    assert.equal(saveRes.data.keyword.keyword, searchTerm);
  });

  test("T1-F19-05: Frontend provides edit/delete controls and feedback states matching PUT/PATCH/DELETE /keywords/:id", async () => {
    const frontendSrc = readAllFrontendSource();
    assert.match(frontendSrc, /PUT|PATCH/);
    assert.match(frontendSrc, /DELETE/);
    assert.match(frontendSrc, /feedback/);

    const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-05") });
    const kw = uniqueKeyword("F19-EditDel");
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kw }
    });
    assert.equal(created.status, 201);
    const id = created.data.keyword.id;

    const patched = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PATCH",
      token,
      body: { priority: "alta" }
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.keyword.priority, "alta");

    const deleted = await requestJson(worker.url, `/keywords/${id}`, {
      method: "DELETE",
      token
    });
    assert.equal(deleted.status, 200);
  });

  test("T2-F19-01: Saving search term < 3 chars is blocked by client constraints and API 400 validation", async () => {
    const frontendSrc = readAllFrontendSource();
    assert.match(frontendSrc, /minLength|minlength|length\s*<\s*3/, "Frontend must enforce >= 3 char rule");

    const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-short") });
    for (const bad of ["ab", "  a "]) {
      const res = await requestJson(worker.url, "/keywords", {
        method: "POST",
        token,
        body: { keyword: bad }
      });
      assert.equal(res.status, 400);
      assert.equal(typeof res.data?.error, "string");
    }
  });

  test("T2-F19-02: Unauthenticated / allows public GET /search while prompting login in #saved-keywords-section", async () => {
    const pageRes = await requestText(nextServer.url, "/");
    assert.equal(pageRes.status, 200);
    assert.match(pageRes.text, /id=["']saved-keywords-section["']/);
    assert.match(pageRes.text, /\/login|entrar|login/i);

    const searchRes = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: "198.51.100.14" });
    assert.equal(searchRes.status, 200);

    const unauthPost = await requestJson(worker.url, "/keywords", {
      method: "POST",
      body: { keyword: uniqueKeyword("Unauth") }
    });
    assert.equal(unauthPost.status, 401);
  });

  test("T2-F19-03: Accented/spaced saved keyword is URL-encoded cleanly for GET /search?q=...", async () => {
    const apiSource = fs.readFileSync(path.join(frontendSrcDir, "lib", "api.js"), "utf8");
    assert.match(apiSource, /encodeURIComponent|URLSearchParams/, "api.js must URL-encode search queries");

    const term = "Educação Pública";
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-encode") });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Educação Pública") }
    });
    assert.equal(created.status, 201);

    const searchRes = await requestJson(
      worker.url,
      `/search?q=${encodeURIComponent(term)}`,
      { ip: "198.51.100.15" }
    );
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.data.query, term);
  });

  test("T2-F19-04: Empty saved keywords list returns 200 [] and frontend renders empty-state UI", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-empty") });
    const listRes = await requestJson(worker.url, "/keywords", { token });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.data.total, 0);
    assert.deepEqual(listRes.data.keywords, []);

    const frontendSrc = readAllFrontendSource();
    assert.match(
      frontendSrc,
      /Nenhuma palavra-chave|nenhuma palavra|vazia|sem palavras/i,
      "Frontend must handle empty saved-keywords state cleanly"
    );
  });

  test("T2-F19-05: Search 429 or 400 error does not disrupt saved keywords list or API availability", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f19-429") });
    const kw = uniqueKeyword("PreservedAfter429");
    const createRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kw }
    });
    assert.equal(createRes.status, 201);

    const quotaIp = "198.51.100.40";
    for (let i = 0; i < 10; i++) {
      const r = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: quotaIp });
      assert.equal(r.status, 200);
    }
    const overLimit = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: quotaIp });
    assert.equal(overLimit.status, 429);
    assert.equal(overLimit.headers.get("retry-after"), "3600");

    const listAfter = await requestJson(worker.url, "/keywords", { token });
    assert.equal(listAfter.status, 200);
    assert.ok(listAfter.data.keywords.some((k) => k.keyword === kw));
  });

  // =========================================================================
  // Feature 20: User Screens & Filtered Reports UI (T1-F20-01..05, T2-F20-01..05)
  // =========================================================================
  test("T1-F20-01: Navigation bar (.aero-capsule-nav) includes links to /, /grupos, /relatorios, and auth/profile routes", async () => {
    const res = await requestText(nextServer.url, "/");
    assert.equal(res.status, 200);
    assert.match(res.text, /class=["'][^"']*aero-capsule-nav[^"']*["']/);

    const navAndSource = res.text + "\n" + readAllFrontendSource("components");
    for (const route of ["/grupos", "/relatorios", "/login", "/cadastro", "/perfil"]) {
      assert.ok(
        navAndSource.includes(`"${route}"`) || navAndSource.includes(`'${route}'`) || res.text.includes(`href="${route}"`),
        `Expected navigation to include link to ${route}`
      );
    }
  });

  test("T1-F20-02: /grupos renders group & alert management controls and /groups + /alerts REST endpoints work", async () => {
    const pageRes = await requestText(nextServer.url, "/grupos");
    assert.equal(pageRes.status, 200);
    const gruposUiSource = readAllFrontendSource("app/grupos") + "\n" + readAllFrontendSource("components");
    for (const apiFn of [
      "fetchGroups",
      "createGroup",
      "updateGroup",
      "deleteGroup",
      "fetchAlerts",
      "createAlert",
      "updateAlert",
      "deleteAlert"
    ]) {
      assert.ok(
        gruposUiSource.includes(apiFn),
        `Expected /grupos UI or components to use '${apiFn}'`
      );
    }
    assert.match(gruposUiSource, /group-name|Grupos/i);
    assert.match(gruposUiSource, /alert-keyword|Alertas/i);

    const apiSource = readAllFrontendSource("lib");
    assert.match(apiSource, /\/groups/);
    assert.match(apiSource, /\/alerts/);

    const loaded = await loadFrontendApiModule(worker.url);
    const valMod = await loadFrontendValidationModule();
    try {
      const { mod } = loaded;
      assert.equal(valMod.validateGroupInput({ name: "Licitações F20", color: "#0b7aa8" }).valid, true);
      assert.equal(valMod.validateGroupInput({ name: "AB", color: "invalid" }).valid, false);

      const { token } = await registerUser(worker.url, { email: uniqueEmail("f20-02") });
      const g = await mod.createGroup(
        { name: "Licitações F20", description: "Editais", color: "#0b7aa8" },
        { token }
      );
      assert.ok(Number.isInteger(g?.group?.id));
      const gid = g.group.id;

      const grpList = await mod.fetchGroups({}, { token });
      assert.ok(grpList.groups.some((item) => item.id === gid));

      const updGrp = await mod.updateGroup(gid, { name: "Licitações F20 Editado" }, { token });
      assert.equal(updGrp.group.name, "Licitações F20 Editado");

      const kw = await mod.createKeyword({ keyword: uniqueKeyword("F20-Alert"), group_id: gid }, { token });
      const al = await mod.createAlert(
        { keyword_id: kw.keyword.id, status: "novo", notes: "Triagem F20" },
        { token }
      );
      assert.ok(Number.isInteger(al?.alert?.id));

      const alList = await mod.fetchAlerts({ keyword_id: kw.keyword.id }, { token });
      assert.ok(alList.alerts.some((item) => item.id === al.alert.id));

      const updAl = await mod.updateAlert(al.alert.id, { status: "revisado" }, { token });
      assert.equal(updAl.alert.status, "revisado");

      await mod.deleteAlert(al.alert.id, { token });
      await mod.deleteKeyword(kw.keyword.id, { token });
      const delGrp = await mod.deleteGroup(gid, { token });
      assert.equal(delGrp.ok, true);
    } finally {
      loaded.restore();
    }
  });

  test("T1-F20-03: /relatorios renders organized report views matching GET /reports contract", async () => {
    const pageRes = await requestText(nextServer.url, "/relatorios");
    assert.equal(pageRes.status, 200);
    const relUiSource = readAllFrontendSource("app/relatorios") + "\n" + readAllFrontendSource("components");
    assert.match(relUiSource, /fetchReports/);
    assert.match(relUiSource, /by_group/);
    assert.match(relUiSource, /by_priority/);
    assert.match(relUiSource, /summary/);

    const apiSource = readAllFrontendSource("lib");
    assert.match(apiSource, /\/reports/);

    const loaded = await loadFrontendApiModule(worker.url);
    try {
      const { mod } = loaded;
      const { token } = await registerUser(worker.url, { email: uniqueEmail("f20-03") });
      const repData = await mod.fetchReports({}, { token });
      assert.ok(repData.summary);
      assert.ok(Array.isArray(repData.by_group));
      assert.ok(Array.isArray(repData.by_priority));
      assert.ok(Array.isArray(repData.keywords));
      assert.ok(Array.isArray(repData.alerts));
    } finally {
      loaded.restore();
    }
  });

  test("T1-F20-04: /relatorios exposes filter inputs (q, group_id, priority, active, status, date range) wired to GET /reports", async () => {
    const relUiSource = readAllFrontendSource("app/relatorios") + "\n" + readAllFrontendSource("components");
    assert.match(relUiSource, /fetchReports/, "Expected /relatorios UI to invoke fetchReports");
    for (const filterParam of ["q", "group_id", "priority", "active", "status", "from", "to"]) {
      assert.ok(
        relUiSource.includes(filterParam),
        `Expected /relatorios UI or components to bind filter '${filterParam}'`
      );
    }
    const apiSource = readAllFrontendSource("lib");
    assert.match(apiSource, /\/reports/);

    const loaded = await loadFrontendApiModule(worker.url);
    try {
      const { mod } = loaded;
      const { token } = await registerUser(worker.url, { email: uniqueEmail("f20-04") });
      const repData = await mod.fetchReports({ priority: "alta", active: 1, status: "novo" }, { token });
      assert.equal(repData.filters.priority, "alta");
    } finally {
      loaded.restore();
    }
  });

  test("T1-F20-05: /perfil renders profile view/edit controls wired to GET & PUT/PATCH /users/me", async () => {
    const pageRes = await requestText(nextServer.url, "/perfil");
    assert.equal(pageRes.status, 200);
    const perfilUiSource = readAllFrontendSource("app/perfil") + "\n" + readAllFrontendSource("components");
    assert.match(perfilUiSource, /updateCurrentUser/, "Expected /perfil UI to call updateCurrentUser");
    assert.match(perfilUiSource, /fetchCurrentUser/, "Expected auth/profile UI to call fetchCurrentUser");
    for (const fieldName of ["name", "email", "password"]) {
      assert.ok(
        perfilUiSource.includes(fieldName),
        `Expected /perfil UI to include '${fieldName}' profile edit control`
      );
    }

    const apiSource = readAllFrontendSource("lib");
    assert.match(apiSource, /\/users\/me/);

    const loaded = await loadFrontendApiModule(worker.url);
    try {
      const { mod } = loaded;
      const { token } = await registerUser(worker.url, { email: uniqueEmail("f20-05") });
      const meBefore = await mod.fetchCurrentUser({ token });
      assert.ok(meBefore?.user?.id);

      const patchData = await mod.updateCurrentUser({ name: "Perfil Atualizado" }, { token });
      assert.equal(patchData.user.name, "Perfil Atualizado");
    } finally {
      loaded.restore();
    }
  });

  test("T2-F20-01: Unauthenticated visits to /perfil, /grupos, /relatorios show auth prompt gracefully without 500", async () => {
    for (const route of ["/perfil", "/grupos", "/relatorios"]) {
      const res = await requestText(nextServer.url, route);
      assert.equal(res.status, 200);
      assert.doesNotMatch(res.text, /Application error|__next_error__/i);
    }
    const frontendSrc = readAllFrontendSource();
    assert.match(frontendSrc, /\/login/);

    for (const apiRoute of ["/users/me", "/groups", "/reports"]) {
      const apiRes = await requestJson(worker.url, apiRoute);
      assert.equal(apiRes.status, 401);
    }
  });

  test("T2-F20-02: Empty filter results on /reports return 200 empty lists and UI renders empty state", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f20-empty") });
    const repRes = await requestJson(worker.url, "/reports?q=termo-inexistente-xyz-e2e", { token });
    assert.equal(repRes.status, 200);
    assert.deepEqual(repRes.data.keywords, []);
    assert.deepEqual(repRes.data.alerts, []);

    const relSource = readAllFrontendSource("app/relatorios") + "\n" + readAllFrontendSource("components");
    assert.match(relSource, /fetchReports/);
    assert.match(relSource, /empty-state|nenhum|vazio|sem /i);
  });

  test("T2-F20-03: /cadastro (409) and /login (401) surface API error responses cleanly", async () => {
    const email = uniqueEmail("f20-err");
    await registerUser(worker.url, { email, password: "SenhaForte@2026" });

    const dup = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "Outro", email, password: "SenhaForte@2026" }
    });
    assert.equal(dup.status, 409);
    assert.equal(typeof dup.data?.error, "string");

    const badLogin = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "WrongPassword123" }
    });
    assert.equal(badLogin.status, 401);
    assert.equal(typeof badLogin.data?.error, "string");

    const componentsSrc = readAllFrontendSource("components");
    const loginSrc = readAllFrontendSource("app/login") + "\n" + componentsSrc;
    const cadastroSrc = readAllFrontendSource("app/cadastro") + "\n" + componentsSrc;
    assert.match(loginSrc, /loginUser/);
    assert.match(loginSrc, /FeedbackBanner|setFeedback/);
    assert.match(loginSrc, /state:\s*["']error["']|err\?\.message/i);
    assert.match(cadastroSrc, /registerUser/);
    assert.match(cadastroSrc, /FeedbackBanner|setFeedback/);
    assert.match(cadastroSrc, /state:\s*["']error["']|err\?\.message/i);
  });

  test("T2-F20-04: /grupos handles 409 conflict when deleting a group with linked keywords", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("f20-409") });
    const g = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Ocupado" }
    });
    assert.equal(g.status, 201);
    const gid = g.data.group.id;

    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Linked"), group_id: gid }
    });
    assert.equal(k.status, 201);

    const delGroup = await requestJson(worker.url, `/groups/${gid}`, {
      method: "DELETE",
      token
    });
    assert.equal(delGroup.status, 409);
    assert.equal(typeof delGroup.data?.error, "string");

    const gruposSrc = readAllFrontendSource("app/grupos") + "\n" + readAllFrontendSource("components");
    assert.match(gruposSrc, /deleteGroup/);
    assert.match(gruposSrc, /409|vinculad|conflit/i);
    assert.match(gruposSrc, /FeedbackBanner|setGroupFeedback/);
    assert.match(gruposSrc, /error|erro/i);
  });

  test("T2-F20-05: All 6 Next.js application routes resolve with HTTP 200 (zero dead links)", async () => {
    for (const route of ["/", "/login", "/cadastro", "/perfil", "/grupos", "/relatorios"]) {
      const res = await requestText(nextServer.url, route);
      assert.equal(res.status, 200, `Expected route ${route} to return HTTP 200`);
    }
  });
});

describe("04 Next.js SSR Resilience when Worker is Unreachable (T2-F01-03)", () => {
  let resilientNext;

  before(async () => {
    const closedPort = await getFreePort();
    const nextPort = await getFreePort();
    resilientNext = await startNextServer({
      repoRoot,
      apiUrl: `http://127.0.0.1:${closedPort}`,
      port: nextPort
    });
  });

  after(async () => {
    if (resilientNext) await resilientNext.stop();
  });

  test("T2-F01-03: GET / returns 200 SSR HTML even when Worker API is unreachable", async () => {
    const res = await requestText(resilientNext.url, "/");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/i);
    assert.doesNotMatch(res.text, /Application error|__next_error__/i);
    assert.match(res.text, /id=["']search-form["']/);
  });
});
