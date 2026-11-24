import assert from "node:assert/strict";
import path from "node:path";
import { describe, test, before, after } from "node:test";
import { getFreePort } from "./helpers/ports.mjs";
import { createD1Sandbox } from "./helpers/d1-sandbox.mjs";
import { startWorkerServer } from "./helpers/servers.mjs";
import {
  requestJson,
  requestText,
  registerUser,
  uniqueKeyword
} from "./helpers/http-client.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function parseMethodsHeader(value) {
  return (value || "")
    .split(",")
    .map((m) => m.trim().toUpperCase())
    .filter(Boolean);
}

function assertVaryIncludesOrigin(headers) {
  const vary = (headers.get("vary") || "").toLowerCase();
  assert.ok(
    vary.split(",").map((v) => v.trim()).includes("origin"),
    `Expected Vary header to include Origin, got "${headers.get("vary")}"`
  );
}

describe("01 — Preserved Routes (#18) and Worker CORS Methods Expansion (#3)", () => {
  let sandbox;
  let worker;

  before(async () => {
    sandbox = await createD1Sandbox({ repoRoot: REPO_ROOT, seed: true });
    const port = await getFreePort();
    worker = await startWorkerServer({
      repoRoot: REPO_ROOT,
      persistDir: sandbox.persistDir,
      port
    });
  });

  after(async () => {
    try {
      await worker?.stop();
    } finally {
      await sandbox?.cleanup();
    }
  });

  // =========================================================================
  // Feature 3: Worker CORS Methods Expansion — Tier 1
  // =========================================================================

  test("T1-F03-01: OPTIONS /keywords with Origin http://localhost:3000 returns 204 and full REST methods", async () => {
    const res = await requestText(worker.url, "/keywords", {
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000" }
    });
    assert.equal(res.status, 204);
    assert.equal(res.text, "");
    const methods = parseMethodsHeader(res.headers.get("access-control-allow-methods"));
    for (const expected of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      assert.ok(methods.includes(expected), `Missing ${expected} in ${methods.join(", ")}`);
    }
    assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
  });

  test("T1-F03-02: OPTIONS /keywords/1 DELETE preflight echoes http://127.0.0.1:3000 and Vary: Origin", async () => {
    const res = await requestText(worker.url, "/keywords/1", {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:3000",
        "access-control-request-method": "DELETE"
      }
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "http://127.0.0.1:3000");
    assertVaryIncludesOrigin(res.headers);
    const methods = parseMethodsHeader(res.headers.get("access-control-allow-methods"));
    assert.ok(methods.includes("DELETE"), `Expected DELETE in ${methods.join(", ")}`);
  });

  test("T1-F03-03: OPTIONS /users/me includes content-type and authorization in allow-headers", async () => {
    const res = await requestText(worker.url, "/users/me", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-headers": "content-type, authorization"
      }
    });
    assert.equal(res.status, 204);
    const allowHeaders = (res.headers.get("access-control-allow-headers") || "")
      .split(",")
      .map((h) => h.trim().toLowerCase());
    assert.ok(allowHeaders.includes("content-type"), "Expected content-type in allow-headers");
    assert.ok(allowHeaders.includes("authorization"), "Expected authorization in allow-headers");
  });

  test("T1-F03-04: Actual GET/POST/PUT/PATCH/DELETE responses include access-control-allow-origin for http://localhost:3000", async () => {
    const origin = "http://localhost:3000";

    const statsRes = await requestJson(worker.url, "/stats", {
      headers: { origin }
    });
    assert.equal(statsRes.status, 200);
    assert.equal(statsRes.headers.get("access-control-allow-origin"), origin);

    const { user, token } = await registerUser(worker.url, {
      name: "CORS Tester",
      password: "SenhaForte@2026"
    });
    const loginRes = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      headers: { origin },
      body: { email: user.email, password: "SenhaForte@2026" }
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.headers.get("access-control-allow-origin"), origin);

    const kwRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      headers: { origin },
      body: { keyword: uniqueKeyword("CORS Kw") }
    });
    assert.equal(kwRes.status, 201);
    assert.equal(kwRes.headers.get("access-control-allow-origin"), origin);
    const kwId = kwRes.data.keyword.id;

    const putRes = await requestJson(worker.url, `/keywords/${kwId}`, {
      method: "PUT",
      token,
      headers: { origin },
      body: { keyword: uniqueKeyword("CORS Put"), priority: "alta" }
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.headers.get("access-control-allow-origin"), origin);

    const patchRes = await requestJson(worker.url, `/keywords/${kwId}`, {
      method: "PATCH",
      token,
      headers: { origin },
      body: { priority: "baixa" }
    });
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.headers.get("access-control-allow-origin"), origin);

    const delRes = await requestJson(worker.url, `/keywords/${kwId}`, {
      method: "DELETE",
      token,
      headers: { origin }
    });
    assert.equal(delRes.status, 200);
    assert.equal(delRes.headers.get("access-control-allow-origin"), origin);
  });

  test("T1-F03-05: Error responses (400, 401, 403, 404, 409) from CRUD/auth routes include CORS headers", async () => {
    const origin = "http://localhost:3000";
    const userA = await registerUser(worker.url, { name: "CORS User A" });
    const userB = await registerUser(worker.url, { name: "CORS User B" });

    const term = uniqueKeyword("CORS Dup");
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      headers: { origin },
      body: { keyword: term }
    });
    assert.equal(created.status, 201);
    const kwId = created.data.keyword.id;

    const err400 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      headers: { origin },
      body: { keyword: "ab" }
    });
    assert.equal(err400.status, 400);
    assert.equal(err400.headers.get("access-control-allow-origin"), origin);
    assertVaryIncludesOrigin(err400.headers);

    const err401 = await requestJson(worker.url, "/keywords", {
      headers: { origin }
    });
    assert.equal(err401.status, 401);
    assert.equal(err401.headers.get("access-control-allow-origin"), origin);
    assertVaryIncludesOrigin(err401.headers);

    const err403 = await requestJson(worker.url, `/keywords/${kwId}`, {
      token: userB.token,
      headers: { origin }
    });
    assert.equal(err403.status, 403);
    assert.equal(err403.headers.get("access-control-allow-origin"), origin);
    assertVaryIncludesOrigin(err403.headers);

    const err404 = await requestJson(worker.url, "/keywords/999999", {
      token: userA.token,
      headers: { origin }
    });
    assert.equal(err404.status, 404);
    assert.equal(err404.headers.get("access-control-allow-origin"), origin);
    assertVaryIncludesOrigin(err404.headers);

    const err409 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      headers: { origin },
      body: { keyword: term }
    });
    assert.equal(err409.status, 409);
    assert.equal(err409.headers.get("access-control-allow-origin"), origin);
    assertVaryIncludesOrigin(err409.headers);
  });

  // =========================================================================
  // Feature 3: Worker CORS Methods Expansion — Tier 2
  // =========================================================================

  test("T2-F03-01: OPTIONS /groups/1 with PATCH request method returns 204 with PATCH allowed", async () => {
    const res = await requestText(worker.url, "/groups/1", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PATCH"
      }
    });
    assert.equal(res.status, 204);
    const methods = parseMethodsHeader(res.headers.get("access-control-allow-methods"));
    assert.ok(methods.includes("PATCH"), `Expected PATCH in ${methods.join(", ")}`);
  });

  test("T2-F03-02: OPTIONS /keywords/1 with PUT request method returns 204 with PUT allowed", async () => {
    const res = await requestText(worker.url, "/keywords/1", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "PUT"
      }
    });
    assert.equal(res.status, 204);
    const methods = parseMethodsHeader(res.headers.get("access-control-allow-methods"));
    assert.ok(methods.includes("PUT"), `Expected PUT in ${methods.join(", ")}`);
  });

  test("T2-F03-03: Disallowed origin https://evil.example.com is never echoed or wildcarded", async () => {
    const evilOrigin = "https://evil.example.com";
    const preflight = await requestText(worker.url, "/keywords", {
      method: "OPTIONS",
      headers: { origin: evilOrigin }
    });
    assert.equal(preflight.status, 204);
    const preflightAllow = preflight.headers.get("access-control-allow-origin");
    assert.notEqual(preflightAllow, evilOrigin);
    assert.notEqual(preflightAllow, "*");

    const actual = await requestJson(worker.url, "/stats", {
      headers: { origin: evilOrigin }
    });
    assert.equal(actual.status, 200);
    const actualAllow = actual.headers.get("access-control-allow-origin");
    assert.notEqual(actualAllow, evilOrigin);
    assert.notEqual(actualAllow, "*");
  });

  test("T2-F03-04: Request without Origin header succeeds with Vary: Origin", async () => {
    const res = await requestJson(worker.url, "/stats");
    assert.equal(res.status, 200);
    assertVaryIncludesOrigin(res.headers);
  });

  test("T2-F03-05: OPTIONS /admin/ingest and /admin/known /admin/ingest include consistent CORS headers", async () => {
    const origin = "http://localhost:3000";
    const opt = await requestText(worker.url, "/admin/ingest", {
      method: "OPTIONS",
      headers: { origin }
    });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get("access-control-allow-origin"), origin);
    assertVaryIncludesOrigin(opt.headers);

    const knownRes = await requestJson(
      worker.url,
      "/admin/known?source_page_url=https://example.com/none",
      {
        token: worker.vars.INGEST_TOKEN,
        headers: { origin }
      }
    );
    assert.equal(knownRes.status, 200);
    assert.equal(knownRes.headers.get("access-control-allow-origin"), origin);

    const ingestRes = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      headers: { origin },
      body: {
        source_page_url: "https://telemacoborba.pr.gov.br/e2e/cors-ingest-1",
        pdf_url: "https://telemacoborba.pr.gov.br/e2e/cors-ingest-1.pdf",
        title: "Edição CORS Test",
        pages: [{ page_number: 1, text: "Texto de teste CORS." }]
      }
    });
    assert.equal(ingestRes.status, 201);
    assert.equal(ingestRes.headers.get("access-control-allow-origin"), origin);
  });

  // =========================================================================
  // Feature 18: Preserved Public & Admin Routes — Tier 1
  // =========================================================================

  test("T1-F18-01: GET / returns 200 with Edital Monitor API metadata", async () => {
    const res = await requestJson(worker.url, "/");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { name: "Edital Monitor API", version: "0.1.0" });
  });

  test("T1-F18-02: GET /health returns 200 { ok: true, database: 'ok' }", async () => {
    const res = await requestJson(worker.url, "/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { ok: true, database: "ok" });
  });

  test("T1-F18-03: GET /stats returns 200 with numeric documents/pages counts and latest metadata", async () => {
    const res = await requestJson(worker.url, "/stats");
    assert.equal(res.status, 200);
    assert.equal(typeof res.data?.documents, "number");
    assert.equal(typeof res.data?.pages, "number");
    assert.ok(res.data.documents >= 4, `Expected >= 4 seeded documents, got ${res.data.documents}`);
    assert.ok(res.data.pages >= 9, `Expected >= 9 seeded pages, got ${res.data.pages}`);
    assert.ok(res.data.latest, "Expected latest document metadata");
    assert.equal(typeof res.data.latest.edition, "string");
    assert.equal(typeof res.data.latest.title, "string");
    assert.equal(typeof res.data.latest.published_at, "string");
    assert.equal(typeof res.data.latest.source_page_url, "string");
  });

  test("T1-F18-04: GET /search?q=Pregão and Telêmaco return FTS5 matches with <mark> excerpts and no-store cache", async () => {
    const res1 = await requestJson(worker.url, "/search?q=Preg%C3%A3o", {
      ip: "203.0.113.10"
    });
    assert.equal(res1.status, 200);
    assert.equal(res1.headers.get("cache-control"), "no-store");
    assert.equal(res1.data?.query, "Pregão");
    assert.ok(res1.data?.total >= 4, `Expected >= 4 matches for Pregão, got ${res1.data?.total}`);
    assert.ok(Array.isArray(res1.data?.results) && res1.data.results.length >= 4);
    assert.ok(res1.data.results[0].excerpt.includes("<mark>"), "Expected <mark> in excerpt");
    assert.ok(typeof res1.data.results[0].pdf_url === "string" && res1.data.results[0].pdf_url.startsWith("http"));
    assert.equal(typeof res1.data?.usage?.remaining, "number");

    const res2 = await requestJson(worker.url, "/search?q=Tel%C3%AAmaco", {
      ip: "203.0.113.11"
    });
    assert.equal(res2.status, 200);
    assert.ok(res2.data?.total >= 6, `Expected >= 6 matches for Telêmaco, got ${res2.data?.total}`);
  });

  test("T1-F18-05: GET /admin/known and POST /admin/ingest with INGEST_TOKEN persist and query documents", async () => {
    const sourceUrl = "https://telemacoborba.pr.gov.br/e2e/boletim-9901";
    const knownBefore = await requestJson(
      worker.url,
      `/admin/known?source_page_url=${encodeURIComponent(sourceUrl)}`,
      { token: worker.vars.INGEST_TOKEN }
    );
    assert.equal(knownBefore.status, 200);
    assert.deepEqual(knownBefore.data, { exists: false, document: null });

    const ingestRes = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      body: {
        source_page_url: sourceUrl,
        pdf_url: "https://telemacoborba.pr.gov.br/e2e/boletim-9901.pdf",
        edition: "9901",
        title: "Edição E2E 9901",
        published_at: "2026-11-20",
        sha256: "e2e-sha256-9901",
        extraction_method: "native",
        pages: [
          { page_number: 1, text: "Aviso de contratação de merenda escolar especial." },
          { page_number: 2, text: "Extrato de termo aditivo municipal." }
        ]
      }
    });
    assert.equal(ingestRes.status, 201);
    assert.equal(ingestRes.data?.ok, true);
    assert.equal(typeof ingestRes.data?.document_id, "number");
    assert.equal(ingestRes.data?.pages, 2);

    const knownAfter = await requestJson(
      worker.url,
      `/admin/known?source_page_url=${encodeURIComponent(sourceUrl)}`,
      { token: worker.vars.INGEST_TOKEN }
    );
    assert.equal(knownAfter.status, 200);
    assert.equal(knownAfter.data?.exists, true);
    assert.equal(knownAfter.data?.document?.id, ingestRes.data.document_id);
  });

  // =========================================================================
  // Feature 18: Preserved Public & Admin Routes — Tier 2
  // =========================================================================

  test("T2-F18-01: GET /search with <3 chars or empty query returns 400 validation error", async () => {
    const shortRes = await requestJson(worker.url, "/search?q=ab", { ip: "203.0.113.12" });
    assert.equal(shortRes.status, 400);
    assert.equal(shortRes.data?.error, "A pesquisa deve ter entre 3 e 100 caracteres.");

    const emptyRes = await requestJson(worker.url, "/search?q=", { ip: "203.0.113.12" });
    assert.equal(emptyRes.status, 400);
    assert.equal(emptyRes.data?.error, "A pesquisa deve ter entre 3 e 100 caracteres.");
  });

  test("T2-F18-02: GET /search?q=a+b with tokens shorter than 2 chars returns 400 Termo inválido", async () => {
    const res = await requestJson(worker.url, "/search?q=a+b", { ip: "203.0.113.13" });
    assert.equal(res.status, 400);
    assert.equal(res.data?.error, "Termo inválido.");
  });

  test("T2-F18-03: GET /admin/known and POST /admin/ingest reject missing or wrong INGEST_TOKEN with 401", async () => {
    const knownNoAuth = await requestJson(
      worker.url,
      "/admin/known?source_page_url=https://example.com"
    );
    assert.equal(knownNoAuth.status, 401);
    assert.equal(knownNoAuth.data?.error, "Não autorizado.");

    const knownWrong = await requestJson(
      worker.url,
      "/admin/known?source_page_url=https://example.com",
      { token: "wrong-ingest-token" }
    );
    assert.equal(knownWrong.status, 401);

    const ingestNoAuth = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      body: { title: "X" }
    });
    assert.equal(ingestNoAuth.status, 401);

    const ingestWrong = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: "wrong-ingest-token",
      body: { title: "X" }
    });
    assert.equal(ingestWrong.status, 401);
  });

  test("T2-F18-04: POST /admin/ingest rejects text/plain with 415 and non-HTTP pdf_url with 400", async () => {
    const badCt = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ title: "Teste" })
    });
    assert.equal(badCt.status, 415);

    const badUrl = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      body: {
        source_page_url: "https://telemacoborba.pr.gov.br/e2e/bad-url",
        pdf_url: "ftp://x",
        title: "Bad URL Test",
        pages: []
      }
    });
    assert.equal(badUrl.status, 400);
  });

  test("T2-F18-05: GET /search exceeding DAILY_SEARCH_LIMIT returns 429 with retry-after 3600", async () => {
    const isolatedSandbox = await createD1Sandbox({ repoRoot: REPO_ROOT, seed: true });
    let isolatedWorker;
    try {
      const port = await getFreePort();
      isolatedWorker = await startWorkerServer({
        repoRoot: REPO_ROOT,
        persistDir: isolatedSandbox.persistDir,
        port,
        vars: { DAILY_SEARCH_LIMIT: "3" }
      });

      const ip = "198.51.100.42";
      for (let i = 1; i <= 3; i++) {
        const okRes = await requestJson(isolatedWorker.url, "/search?q=Preg%C3%A3o", { ip });
        assert.equal(okRes.status, 200, `Search #${i} should succeed before limit`);
        assert.equal(okRes.data?.usage?.used, i);
      }

      const limited = await requestJson(isolatedWorker.url, "/search?q=Preg%C3%A3o", { ip });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "3600");
      assert.equal(limited.data?.usage?.remaining, 0);
      assert.ok(typeof limited.data?.error === "string" && limited.data.error.length > 0);
    } finally {
      await isolatedWorker?.stop();
      await isolatedSandbox.cleanup();
    }
  });
});
