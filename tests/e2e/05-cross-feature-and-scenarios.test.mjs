import { describe, it as test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runGit(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true
  }).trim();
}

async function ingestSyntheticDocument(workerUrl, ingestToken, {
  edition,
  title,
  published_at = "2026-11-20",
  text
}) {
  const slug = `${edition}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const source_page_url = `https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/${slug}`;
  const pdf_url = `https://telemacoborba.pr.gov.br/arquivos/boletim-${slug}.pdf`;
  const res = await requestJson(workerUrl, "/admin/ingest", {
    method: "POST",
    token: ingestToken,
    body: {
      source_page_url,
      pdf_url,
      edition,
      title,
      published_at,
      sha256: `sha256-${slug}`,
      extraction_method: "native",
      pages: [{ page_number: 1, text }]
    }
  });
  assert.equal(
    res.status,
    201,
    `Expected POST /admin/ingest to return 201, got ${res.status}: ${res.text}`
  );
  return { document_id: res.data.document_id, source_page_url, pdf_url };
}

describe("05 Cross-Feature Combinations (Tier 3) & Real-World Scenarios (Tier 4)", () => {
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
        DAILY_SEARCH_LIMIT: "5"
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
  // TIER 3: Cross-Feature Pairwise & Multi-Step Chains (T3-01 .. T3-24)
  // =========================================================================
  test("T3-01: Register -> verify salted PBKDF2 hash in D1 -> login -> GET /users/me", async () => {
    const email = uniqueEmail("t3-01");
    const password = "SenhaT301@2026";
    const { user } = await registerUser(worker.url, { name: "Ana Teste", email, password });

    const dbUser = sandbox.queryOne("SELECT id, email, password_hash FROM users WHERE id = ?", [user.id]);
    assert.ok(dbUser);
    assert.notEqual(dbUser.password_hash, password);
    assert.equal(dbUser.password_hash.includes(password), false);

    const loginRes = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password }
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.user.email, email);
    assert.equal(loginRes.data.user.password_hash, undefined);

    const meRes = await requestJson(worker.url, "/users/me", { token: loginRes.data.token });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.id, user.id);
    assert.equal(meRes.data.user.name, "Ana Teste");
  });

  test("T3-02: Register -> PUT /users/me (name, email, password) -> old password 401 -> new password 200", async () => {
    const email1 = uniqueEmail("t3-02a");
    const email2 = uniqueEmail("t3-02b");
    const pass1 = "SenhaAntiga@2026";
    const pass2 = "SenhaNova@2026";
    const { token } = await registerUser(worker.url, { name: "Carlos Inicial", email: email1, password: pass1 });

    const putRes = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      body: {
        name: "Carlos Atualizado",
        email: email2,
        current_password: pass1,
        password: pass2
      }
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.data.user.name, "Carlos Atualizado");
    assert.equal(putRes.data.user.email, email2);

    const failLogin = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email: email2, password: pass1 }
    });
    assert.equal(failLogin.status, 401);

    const okLogin = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email: email2, password: pass2 }
    });
    assert.equal(okLogin.status, 200);

    const meRes = await requestJson(worker.url, "/users/me", { token: okLogin.data.token });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data.user.name, "Carlos Atualizado");
    assert.equal(meRes.data.user.email, email2);
  });

  test("T3-03: User A PATCH /users/me with User B email returns 409 without mutating User A", async () => {
    const emailA = uniqueEmail("t3-03a");
    const emailB = uniqueEmail("t3-03b");
    const userA = await registerUser(worker.url, { name: "Original A", email: emailA });
    await registerUser(worker.url, { name: "Original B", email: emailB });

    const conflictRes = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token: userA.token,
      body: { name: "Mutated A", email: emailB }
    });
    assert.equal(conflictRes.status, 409);

    const meA = await requestJson(worker.url, "/users/me", { token: userA.token });
    assert.equal(meA.status, 200);
    assert.equal(meA.data.user.name, "Original A");
    assert.equal(meA.data.user.email, emailA);
  });

  test("T3-04: Login -> POST /groups -> POST /keywords linked to group -> GET /keywords/:id & /groups/:id reflect linkage", async () => {
    const email = uniqueEmail("t3-04");
    await registerUser(worker.url, { email, password: "SenhaForte@2026" });
    const login = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaForte@2026" }
    });
    assert.equal(login.status, 200);
    const token = login.data.token;

    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Licitações T304", description: "Compras públicas", color: "#0b7aa8" }
    });
    assert.equal(grp.status, 201);
    const gid = grp.data.group.id;

    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Pregão T304"), group_id: gid, priority: "alta" }
    });
    assert.equal(kw.status, 201);
    const kid = kw.data.keyword.id;

    const getKw = await requestJson(worker.url, `/keywords/${kid}`, { token });
    assert.equal(getKw.status, 200);
    assert.equal(getKw.data.keyword.group_id, gid);

    const getGrp = await requestJson(worker.url, `/groups/${gid}`, { token });
    assert.equal(getGrp.status, 200);
    assert.equal(getGrp.data.group.id, gid);
  });

  test("T3-05: Create keyword matching seeded pages -> POST /keywords/:id/scan creates alerts & updates last_searched_at", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-05") });
    const createRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Telêmaco Borba", priority: "alta" }
    });
    assert.equal(createRes.status, 201);
    const kid = createRes.data.keyword.id;

    try {
      const scanRes = await requestJson(worker.url, `/keywords/${kid}/scan`, {
        method: "POST",
        token
      });
      assert.ok(scanRes.status === 200 || scanRes.status === 201);
      assert.equal(scanRes.data.keyword_id, kid);
      assert.ok(scanRes.data.matched_documents >= 1);
      assert.ok(scanRes.data.created_alerts >= 1);

      const kwAfter = await requestJson(worker.url, `/keywords/${kid}`, { token });
      assert.equal(kwAfter.status, 200);
      assert.ok(kwAfter.data.keyword.last_searched_at, "Expected last_searched_at to be populated after scan");

      const alertsRes = await requestJson(worker.url, `/alerts?keyword_id=${kid}`, { token });
      assert.equal(alertsRes.status, 200);
      assert.ok(alertsRes.data.total >= 1);

      const repRes = await requestJson(worker.url, "/reports", { token });
      assert.equal(repRes.status, 200);
      assert.ok(repRes.data.summary.total_alerts >= 1);
    } finally {
      await requestJson(worker.url, `/keywords/${kid}`, { method: "DELETE", token });
    }
  });

  test("T3-06: Scan creates 'novo' alert -> PATCH /alerts/:id to 'revisado' -> GET /reports?status= filters accurately", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-06") });
    const createRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Medicamentos" }
    });
    assert.equal(createRes.status, 201);
    const kid = createRes.data.keyword.id;

    try {
      const scanRes = await requestJson(worker.url, `/keywords/${kid}/scan`, { method: "POST", token });
      assert.ok(scanRes.status === 200 || scanRes.status === 201);
      assert.ok(scanRes.data.alerts.length >= 1);
      const alertId = scanRes.data.alerts[0].id;

      const patchRes = await requestJson(worker.url, `/alerts/${alertId}`, {
        method: "PATCH",
        token,
        body: { status: "revisado", notes: "Confirmado no PDF" }
      });
      assert.equal(patchRes.status, 200);
      assert.equal(patchRes.data.alert.status, "revisado");
      assert.equal(patchRes.data.alert.notes, "Confirmado no PDF");

      const revRep = await requestJson(worker.url, "/reports?status=revisado", { token });
      assert.equal(revRep.status, 200);
      assert.ok(revRep.data.alerts.some((a) => a.id === alertId));

      const novoRep = await requestJson(worker.url, "/reports?status=novo", { token });
      assert.equal(novoRep.status, 200);
      assert.equal(novoRep.data.alerts.some((a) => a.id === alertId), false);
    } finally {
      await requestJson(worker.url, `/keywords/${kid}`, { method: "DELETE", token });
    }
  });

  test("T3-07: PATCH /keywords/:id priority & is_active updates GET /keywords filters, /reports by_priority, and updated_at", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-07") });
    const kwText = uniqueKeyword("T307-Prio");
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText, priority: "baixa", is_active: 1 }
    });
    assert.equal(created.status, 201);
    const beforeKw = created.data.keyword;

    await sleep(1100);

    const patched = await requestJson(worker.url, `/keywords/${beforeKw.id}`, {
      method: "PATCH",
      token,
      body: { priority: "alta", is_active: 0 }
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data.keyword.priority, "alta");
    assert.ok(patched.data.keyword.is_active === 0 || patched.data.keyword.is_active === false);
    assert.ok(
      patched.data.keyword.updated_at > beforeKw.updated_at,
      `Expected updated_at (${patched.data.keyword.updated_at}) > created (${beforeKw.updated_at})`
    );

    const filtered = await requestJson(worker.url, "/keywords?priority=alta&active=0", { token });
    assert.equal(filtered.status, 200);
    assert.ok(filtered.data.keywords.some((k) => k.id === beforeKw.id));

    const rep = await requestJson(worker.url, "/reports?priority=alta&active=0", { token });
    assert.equal(rep.status, 200);
    assert.ok(rep.data.keywords.some((k) => k.id === beforeKw.id));
  });

  test("T3-08: Delete-guard & cascade lifecycle: 409 group delete -> delete keyword (cascades alerts) -> 200 group delete", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-08") });
    const g = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Cascade T308" }
    });
    assert.equal(g.status, 201);
    const gid = g.data.group.id;

    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T308-Cascade"), group_id: gid }
    });
    assert.equal(k.status, 201);
    const kid = k.data.keyword.id;

    const a = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kid, status: "novo", matched_excerpt: "Trecho teste" }
    });
    assert.equal(a.status, 201);

    const guardRes = await requestJson(worker.url, `/groups/${gid}`, { method: "DELETE", token });
    assert.equal(guardRes.status, 409);

    const delKw = await requestJson(worker.url, `/keywords/${kid}`, { method: "DELETE", token });
    assert.equal(delKw.status, 200);

    const alertsAfter = await requestJson(worker.url, `/alerts?keyword_id=${kid}`, { token });
    assert.equal(alertsAfter.status, 200);
    assert.equal(alertsAfter.data.total, 0);

    const delGrp = await requestJson(worker.url, `/groups/${gid}`, { method: "DELETE", token });
    assert.equal(delGrp.status, 200);
  });

  test("T3-09: POST /admin/ingest -> POST /keywords/:id/scan discovers newly ingested edition in alerts & /stats & /reports", async () => {
    const tag = `t309-${Date.now().toString(36)}`;
    const statsBefore = await requestJson(worker.url, "/stats");
    assert.equal(statsBefore.status, 200);

    const ingested = await ingestSyntheticDocument(worker.url, worker.vars.INGEST_TOKEN, {
      edition: "2601",
      title: "Edição 2601 - Dispensa",
      text: `BOLETIM OFICIAL TELÊMACO BORBA. AVISO DE DISPENSA DE LICITAÇÃO ${tag} PARA MANUTENÇÃO.`
    });

    const statsAfter = await requestJson(worker.url, "/stats");
    assert.equal(statsAfter.data.documents, statsBefore.data.documents + 1);

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-09") });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: `Dispensa ${tag}` }
    });
    assert.equal(kw.status, 201);
    const kid = kw.data.keyword.id;

    const scan = await requestJson(worker.url, `/keywords/${kid}/scan`, { method: "POST", token });
    assert.ok(scan.status === 200 || scan.status === 201);
    assert.ok(scan.data.created_alerts >= 1);
    assert.ok(scan.data.alerts.some((a) => a.document_id === ingested.document_id));

    const rep = await requestJson(worker.url, "/reports", { token });
    assert.equal(rep.status, 200);
    assert.ok(rep.data.alerts.some((a) => a.document_id === ingested.document_id));
  });

  test("T3-10: Public search -> register -> save keyword -> click-to-search GET /search decrements usage.remaining", async () => {
    const ip = "198.51.100.21";
    const s1 = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip });
    assert.equal(s1.status, 200);
    const rem1 = s1.data.usage.remaining;

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-10") });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "pregão" }
    });
    assert.equal(kw.status, 201);

    try {
      const s2 = await requestJson(
        worker.url,
        `/search?q=${encodeURIComponent(kw.data.keyword.keyword)}`,
        { ip }
      );
      assert.equal(s2.status, 200);
      assert.ok(s2.data.total >= 1);
      assert.equal(s2.data.usage.remaining, rem1 - 1);
    } finally {
      await requestJson(worker.url, `/keywords/${kw.data.keyword.id}`, { method: "DELETE", token });
    }
  });

  test("T3-11: Cross-user isolation matrix: User B receives 403 on User A resources and 0 leaked items in /reports", async () => {
    const userA = await registerUser(worker.url, { email: uniqueEmail("t3-11a") });
    const userB = await registerUser(worker.url, { email: uniqueEmail("t3-11b") });

    const gA = (await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userA.token,
      body: { name: "Privado A" }
    })).data.group;
    const kA = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("PrivadoA"), group_id: gA.id }
    })).data.keyword;
    const aA = (await requestJson(worker.url, "/alerts", {
      method: "POST",
      token: userA.token,
      body: { keyword_id: kA.id, status: "novo", matched_excerpt: "Confidencial A" }
    })).data.alert;

    for (const [method, endpoint] of [
      ["GET", `/groups/${gA.id}`],
      ["PUT", `/groups/${gA.id}`],
      ["DELETE", `/groups/${gA.id}`],
      ["GET", `/keywords/${kA.id}`],
      ["PATCH", `/keywords/${kA.id}`],
      ["DELETE", `/keywords/${kA.id}`],
      ["POST", `/keywords/${kA.id}/scan`],
      ["GET", `/alerts/${aA.id}`],
      ["PATCH", `/alerts/${aA.id}`],
      ["DELETE", `/alerts/${aA.id}`]
    ]) {
      const res = await requestJson(worker.url, endpoint, {
        method,
        token: userB.token,
        body: method === "PUT" || method === "PATCH" ? { name: "Hijack", priority: "alta", status: "revisado" } : undefined
      });
      assert.equal(res.status, 403, `Expected 403 for User B ${method} ${endpoint}, got ${res.status}`);
    }

    const repB = await requestJson(worker.url, "/reports", { token: userB.token });
    assert.equal(repB.status, 200);
    assert.equal(repB.data.keywords.length, 0);
    assert.equal(repB.data.alerts.length, 0);
  });

  test("T3-12: INGEST_TOKEN boundary matrix: User token vs INGEST_TOKEN separation", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-12") });

    for (const route of ["/keywords", "/groups", "/alerts", "/reports"]) {
      const okUser = await requestJson(worker.url, route, { token });
      assert.equal(okUser.status, 200);

      const badIngest = await requestJson(worker.url, route, { token: worker.vars.INGEST_TOKEN });
      assert.equal(badIngest.status, 401);
    }

    const adminUser = await requestJson(
      worker.url,
      "/admin/known?source_page_url=https://example.com",
      { token }
    );
    assert.equal(adminUser.status, 401);

    const adminOk = await requestJson(
      worker.url,
      "/admin/known?source_page_url=https://example.com",
      { token: worker.vars.INGEST_TOKEN }
    );
    assert.equal(adminOk.status, 200);
  });

  test("T3-13: Browser CORS preflight (PUT, PATCH, DELETE) + actual authenticated mutations include CORS headers", async () => {
    const origin = "http://localhost:3000";
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-13") });
    const kw = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("CORS-Flow") }
    })).data.keyword;
    const al = (await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.id, status: "novo" }
    })).data.alert;

    for (const reqMethod of ["PUT", "PATCH", "DELETE"]) {
      const pre = await requestText(worker.url, `/keywords/${kw.id}`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": reqMethod,
          "access-control-request-headers": "content-type, authorization"
        }
      });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get("access-control-allow-origin"), origin);
      assert.ok((pre.headers.get("access-control-allow-methods") || "").includes(reqMethod));
    }

    const putUser = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      headers: { origin },
      body: { name: "CORS User" }
    });
    assert.equal(putUser.status, 200);
    assert.equal(putUser.headers.get("access-control-allow-origin"), origin);

    const patchKw = await requestJson(worker.url, `/keywords/${kw.id}`, {
      method: "PATCH",
      token,
      headers: { origin },
      body: { priority: "alta" }
    });
    assert.equal(patchKw.status, 200);
    assert.equal(patchKw.headers.get("access-control-allow-origin"), origin);

    const delAlert = await requestJson(worker.url, `/alerts/${al.id}`, {
      method: "DELETE",
      token,
      headers: { origin }
    });
    assert.equal(delAlert.status, 200);
    assert.equal(delAlert.headers.get("access-control-allow-origin"), origin);
  });

  test("T3-14: cleanQuery normalization across POST, PUT, and duplicate 409 conflict", async () => {
    const tag = Date.now().toString(36);
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-14") });

    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: `  Portaria   Municipal ${tag}  ` }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.keyword.keyword, `Portaria Municipal ${tag}`);

    const updated = await requestJson(worker.url, `/keywords/${created.data.keyword.id}`, {
      method: "PUT",
      token,
      body: { keyword: `  ｐｏｒｔａｒｉａ  ${tag}  ` }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.keyword.keyword, `portaria ${tag}`);

    const dup = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: `portaria ${tag}` }
    });
    assert.equal(dup.status, 409);
  });

  test("T3-15: Next.js SSR pages align navigation & REST endpoint targets with live Worker API", async () => {
    for (const route of ["/", "/login", "/cadastro", "/perfil", "/grupos", "/relatorios"]) {
      const page = await requestText(nextServer.url, route);
      assert.equal(page.status, 200);
      assert.doesNotMatch(page.text, /Application error|__next_error__/i);
    }

    const apiJs = fs.readFileSync(path.join(repoRoot, "frontend", "src", "lib", "api.js"), "utf8");
    for (const endpoint of ["/auth/register", "/auth/login", "/users/me", "/groups", "/keywords", "/alerts", "/reports", "/search", "/stats"]) {
      assert.ok(apiJs.includes(endpoint), `Expected api.js to integrate ${endpoint}`);
    }
  });

  test("T3-16: Next.js / DOM contract matches live Worker /stats and /search?q=...", async () => {
    const home = await requestText(nextServer.url, "/");
    assert.equal(home.status, 200);
    for (const id of ["stat-documents", "stat-pages", "stat-latest", "search-form", "search-input", "results"]) {
      assert.match(home.text, new RegExp(`id=["']${id}["']`));
    }

    const stats = await requestJson(worker.url, "/stats");
    assert.equal(stats.status, 200);
    assert.ok(stats.data.documents >= 4);
    assert.ok(stats.data.pages >= 9);

    const search = await requestJson(worker.url, "/search?q=Sa%C3%BAde", { ip: "198.51.100.22" });
    assert.equal(search.status, 200);
    assert.ok(search.data.total >= 1);
  });

  test("T3-17: Reassigning keyword group_id transfers 409 delete-guard from G1 to G2", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-17") });
    const g1 = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "G1" } })).data.group;
    const g2 = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "G2" } })).data.group;
    const k1 = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T317-Move"), group_id: g1.id }
    })).data.keyword;

    assert.equal((await requestJson(worker.url, `/groups/${g1.id}`, { method: "DELETE", token })).status, 409);

    const moved = await requestJson(worker.url, `/keywords/${k1.id}`, {
      method: "PATCH",
      token,
      body: { group_id: g2.id }
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.keyword.group_id, g2.id);

    assert.equal((await requestJson(worker.url, `/groups/${g1.id}`, { method: "DELETE", token })).status, 200);
    assert.equal((await requestJson(worker.url, `/groups/${g2.id}`, { method: "DELETE", token })).status, 409);
  });

  test("T3-18: Multi-filter report intersection across groups, priorities, active flags, and alert statuses", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-18") });
    const g1 = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "Grupo A" } })).data.group;
    const g2 = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "Grupo B" } })).data.group;

    const kMatch = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T318-Match"), group_id: g1.id, priority: "alta", is_active: 1 }
    })).data.keyword;
    const kInactive = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T318-Off"), group_id: g1.id, priority: "alta", is_active: 0 }
    })).data.keyword;
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T318-Other"), group_id: g2.id, priority: "baixa", is_active: 1 }
    });

    const aNovo = (await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kMatch.id, status: "novo", matched_excerpt: "Match novo" }
    })).data.alert;
    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kInactive.id, status: "revisado", matched_excerpt: "Outro" }
    });

    const rep = await requestJson(
      worker.url,
      `/reports?group_id=${g1.id}&priority=alta&active=1&status=novo`,
      { token }
    );
    assert.equal(rep.status, 200);
    assert.deepEqual(rep.data.keywords.map((k) => k.id), [kMatch.id]);
    assert.deepEqual(rep.data.alerts.map((a) => a.id), [aNovo.id]);
    assert.ok(rep.data.summary);
    assert.ok(Array.isArray(rep.data.by_group));
    assert.ok(Array.isArray(rep.data.by_priority));
  });

  test("T3-19: Document ingestion -> alert linked to document_id -> GET /alerts/:id & FK enforcement", async () => {
    const ingested = await ingestSyntheticDocument(worker.url, worker.vars.INGEST_TOKEN, {
      edition: "2602",
      title: "Edição 2602 - Retenção",
      text: "BOLETIM OFICIAL TELÊMACO BORBA. EDITAL DE CHAMAMENTO CULTURAL."
    });

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-19") });
    const kw = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Cultural T319") }
    })).data.keyword;

    const al = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: {
        keyword_id: kw.id,
        document_id: ingested.document_id,
        status: "novo",
        matched_excerpt: "CHAMAMENTO CULTURAL"
      }
    });
    assert.equal(al.status, 201);

    const getAl = await requestJson(worker.url, `/alerts/${al.data.alert.id}`, { token });
    assert.equal(getAl.status, 200);
    assert.equal(getAl.data.alert.document_id, ingested.document_id);

    const badFk = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.id, document_id: 999999, status: "novo" }
    });
    assert.ok(badFk.status === 400 || badFk.status === 404, `Expected 400/404 for bad document_id, got ${badFk.status}`);
  });

  test("T3-20: Existing Bearer token remains valid after PUT /users/me name & email update", async () => {
    const email1 = uniqueEmail("t3-20a");
    const email2 = uniqueEmail("t3-20b");
    const pass = "SenhaT320@2026";
    const { token } = await registerUser(worker.url, { name: "Antes", email: email1, password: pass });

    const updated = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      body: { name: "Depois", email: email2 }
    });
    assert.equal(updated.status, 200);

    const me = await requestJson(worker.url, "/users/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, "Depois");
    assert.equal(me.data.user.email, email2);

    const relogin = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email: email2, password: pass }
    });
    assert.equal(relogin.status, 200);
  });

  test("T3-21: Search 429 quota exhaustion does not block CRUD, /reports, /health, or /stats", async () => {
    const ip = "198.51.100.248";
    for (let i = 0; i < 5; i++) {
      const r = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip });
      assert.equal(r.status, 200);
    }
    const limited = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "3600");

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-21"), ip });
    assert.equal((await requestJson(worker.url, "/health", { ip })).status, 200);
    assert.equal((await requestJson(worker.url, "/stats", { ip })).status, 200);
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      ip,
      body: { keyword: uniqueKeyword("PostQuota") }
    });
    assert.equal(kw.status, 201);
    assert.equal((await requestJson(worker.url, "/reports", { token, ip })).status, 200);
  });

  test("T3-22: Direct local D1 SQLite queries match REST /reports 1:1 after sequential operations", async () => {
    const { user, token } = await registerUser(worker.url, { email: uniqueEmail("t3-22") });
    const g = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "D1Sync" } })).data.group;
    const k = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T322-D1"), group_id: g.id }
    })).data.keyword;
    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: k.id, status: "novo", matched_excerpt: "Sync check" }
    });

    const rep = await requestJson(worker.url, "/reports", { token });
    assert.equal(rep.status, 200);

    const dbGroups = sandbox.queryOne("SELECT COUNT(*) AS c FROM keyword_groups WHERE user_id = ?", [user.id]);
    const dbKeywords = sandbox.queryOne("SELECT COUNT(*) AS c FROM saved_keywords WHERE user_id = ?", [user.id]);
    const dbAlerts = sandbox.queryOne("SELECT COUNT(*) AS c FROM keyword_alerts WHERE user_id = ?", [user.id]);

    assert.equal(rep.data.by_group.length, dbGroups.c);
    assert.equal(rep.data.keywords.length, dbKeywords.c);
    assert.equal(rep.data.alerts.length, dbAlerts.c);
  });

  test("T3-23: Boundary cascade across CRUD: 400 leaves total unchanged -> 201 increments -> 400 PATCH preserves -> 200 PATCH -> 200 DELETE", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t3-23") });
    const initial = await requestJson(worker.url, "/keywords", { token });
    assert.equal(initial.data.total, 0);

    const badPost = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "ab" }
    });
    assert.equal(badPost.status, 400);
    assert.equal((await requestJson(worker.url, "/keywords", { token })).data.total, 0);

    const goodPost = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T323-Valid") }
    });
    assert.equal(goodPost.status, 201);
    const created = goodPost.data.keyword;
    assert.equal((await requestJson(worker.url, "/keywords", { token })).data.total, 1);

    const badPatch = await requestJson(worker.url, `/keywords/${created.id}`, {
      method: "PATCH",
      token,
      body: { priority: "invalida" }
    });
    assert.equal(badPatch.status, 400);
    const stillSame = await requestJson(worker.url, `/keywords/${created.id}`, { token });
    assert.equal(stillSame.data.keyword.priority, created.priority);

    await sleep(1100);
    const goodPatch = await requestJson(worker.url, `/keywords/${created.id}`, {
      method: "PATCH",
      token,
      body: { priority: "alta" }
    });
    assert.equal(goodPatch.status, 200);
    assert.ok(goodPatch.data.keyword.updated_at > created.updated_at);

    const del = await requestJson(worker.url, `/keywords/${created.id}`, { method: "DELETE", token });
    assert.equal(del.status, 200);
    assert.equal((await requestJson(worker.url, "/keywords", { token })).data.total, 0);
  });

  test("T3-24: Repository branch, layout, and README route coverage stay consistent", () => {
    assert.equal(runGit(["branch", "--show-current"]), "feat/crud-palavras-chave");
    assert.equal(runGit(["merge-base", "main", "HEAD"]), runGit(["rev-parse", "main"]));

    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    for (const route of ["/auth/register", "/auth/login", "/users/me", "/groups", "/keywords", "/alerts", "/reports"]) {
      assert.ok(readme.includes(route), `README.md missing ${route}`);
    }
    assert.ok(fs.existsSync(path.join(repoRoot, "frontend", "src", "lib", "api.js")));
    assert.ok(fs.existsSync(path.join(repoRoot, "worker", "src", "index.js")));
  });

  // =========================================================================
  // TIER 4: Real-World Municipal Edital Monitoring Scenarios (T4-01 .. T4-12)
  // =========================================================================
  test("T4-01: Citizen Name Monitoring ('João da Silva') — 0 hits pre-ingest -> register -> save -> ingest -> search & scan alerts", async () => {
    const ip = "198.51.100.101";
    const page = await requestText(nextServer.url, "/");
    assert.equal(page.status, 200);
    assert.match(page.text, /id=["']saved-keywords-section["']/);

    // Baseline seed has 0 hits for "João da Silva"
    const preSearch = await requestJson(worker.url, "/search?q=Jo%C3%A3o+da+Silva", { ip });
    assert.equal(preSearch.status, 200);
    assert.equal(preSearch.data.total, 0);

    const { token } = await registerUser(worker.url, {
      name: "João da Silva",
      email: uniqueEmail("t4-01")
    });

    const saved = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "João da Silva", priority: "alta", target_section: "pessoal" }
    });
    assert.equal(saved.status, 201);
    const kid = saved.data.keyword.id;

    try {
      await ingestSyntheticDocument(worker.url, worker.vars.INGEST_TOKEN, {
        edition: "2610",
        title: "Edição 2610 - Pessoal",
        text: "PORTARIA Nº 901/2026. Fica nomeado João da Silva para o cargo efetivo no município de Telêmaco Borba."
      });

      const postSearch = await requestJson(
        worker.url,
        `/search?q=${encodeURIComponent(saved.data.keyword.keyword)}`,
        { ip }
      );
      assert.equal(postSearch.status, 200);
      assert.ok(postSearch.data.total >= 1);
      assert.match(postSearch.data.results[0].excerpt, /<mark>/i);

      const scan = await requestJson(worker.url, `/keywords/${kid}/scan`, { method: "POST", token });
      assert.ok(scan.status === 200 || scan.status === 201);
      assert.ok(scan.data.created_alerts >= 1);

      const reports = await requestJson(worker.url, "/reports", { token });
      assert.equal(reports.status, 200);
      assert.ok(reports.data.alerts.some((a) => a.keyword_id === kid));
    } finally {
      await requestJson(worker.url, `/keywords/${kid}`, { method: "DELETE", token });
    }
  });

  test("T4-02: Procurement Analyst — High-Priority Bidding Watchlist ('Pregão Eletrônico' & 'Dispensa')", async () => {
    await ingestSyntheticDocument(worker.url, worker.vars.INGEST_TOKEN, {
      edition: "2611",
      title: "Edição 2611 - Dispensa",
      text: "EXTRATO DE DISPENSA DE LICITAÇÃO Nº 077/2026. Aquisição emergencial de insumos."
    });

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-02") });
    const gLic = (await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Licitações", color: "#0b7aa8" }
    })).data.group;
    const gCon = (await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Contratos", color: "#198754" }
    })).data.group;

    const kPregao = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: {
        keyword: "Pregão Eletrônico",
        group_id: gLic.id,
        priority: "alta",
        target_section: "licitacoes"
      }
    })).data.keyword;
    const kDispensa = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: {
        keyword: "Dispensa",
        group_id: gCon.id,
        priority: "media",
        target_section: "contratos"
      }
    })).data.keyword;

    try {
      const scan1 = await requestJson(worker.url, `/keywords/${kPregao.id}/scan`, { method: "POST", token });
      const scan2 = await requestJson(worker.url, `/keywords/${kDispensa.id}/scan`, { method: "POST", token });
      assert.ok(scan1.data.created_alerts >= 1);
      assert.ok(scan2.data.created_alerts >= 1);

      const rep = await requestJson(
        worker.url,
        `/reports?priority=alta&group_id=${gLic.id}`,
        { token }
      );
      assert.equal(rep.status, 200);
      assert.deepEqual(rep.data.keywords.map((k) => k.id), [kPregao.id]);
      assert.ok(rep.data.by_group.some((bg) => bg.group_id === gLic.id || bg.name === "Licitações"));
      assert.ok(rep.data.by_priority.some((bp) => bp.priority === "alta"));
    } finally {
      await requestJson(worker.url, `/keywords/${kPregao.id}`, { method: "DELETE", token });
      await requestJson(worker.url, `/keywords/${kDispensa.id}`, { method: "DELETE", token });
    }
  });

  test("T4-03: HR / Concurso Candidate — Full Edit & Alert Triage ('Nomeação')", async () => {
    await ingestSyntheticDocument(worker.url, worker.vars.INGEST_TOKEN, {
      edition: "2612",
      title: "Edição 2612 - Nomeações",
      text: "DECRETO DE NOMEAÇÃO Nº 304/2026. Nomeação de candidatos aprovados em concurso público."
    });

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-03") });
    const kNom = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Nomeação", priority: "alta", target_section: "concursos" }
    })).data.keyword;

    try {
      const scan = await requestJson(worker.url, `/keywords/${kNom.id}/scan`, { method: "POST", token });
      assert.ok(scan.data.alerts.length >= 1);
      const alertId = scan.data.alerts[0].id;

      const triage = await requestJson(worker.url, `/alerts/${alertId}`, {
        method: "PATCH",
        token,
        body: { status: "revisado", notes: "Convocação verificada" }
      });
      assert.equal(triage.status, 200);
      assert.equal(triage.data.alert.status, "revisado");

      await sleep(1100);
      const putKw = await requestJson(worker.url, `/keywords/${kNom.id}`, {
        method: "PUT",
        token,
        body: {
          keyword: "Nomeação",
          priority: "baixa",
          target_section: "concursos",
          description: "Monitoramento pausado após revisão",
          is_active: 0
        }
      });
      assert.equal(putKw.status, 200);
      assert.ok(putKw.data.keyword.updated_at > kNom.updated_at);

      const rep = await requestJson(worker.url, "/reports?active=0&status=revisado", { token });
      assert.equal(rep.status, 200);
      assert.ok(rep.data.keywords.some((k) => k.id === kNom.id));
      assert.ok(rep.data.alerts.some((a) => a.id === alertId));
    } finally {
      await requestJson(worker.url, `/keywords/${kNom.id}`, { method: "DELETE", token });
    }
  });

  test("T4-04: Multi-Tenant Academic Demo (User A vs User B shared group names & strict isolation)", async () => {
    const [uA, uB] = await Promise.all([
      registerUser(worker.url, { name: "Cidadão A", email: uniqueEmail("t4-04a") }),
      registerUser(worker.url, { name: "Jornalista B", email: uniqueEmail("t4-04b") })
    ]);

    const gA = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: uA.token,
      body: { name: "Editais" }
    });
    const gB = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: uB.token,
      body: { name: "Editais" }
    });
    assert.equal(gA.status, 201);
    assert.equal(gB.status, 201);

    const kA = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: uA.token,
      body: { keyword: uniqueKeyword("TenantA"), group_id: gA.data.group.id }
    })).data.keyword;
    const kB = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: uB.token,
      body: { keyword: uniqueKeyword("TenantB"), group_id: gB.data.group.id }
    })).data.keyword;

    assert.equal((await requestJson(worker.url, `/keywords/${kB.id}`, { token: uA.token })).status, 403);
    assert.equal((await requestJson(worker.url, `/keywords/${kA.id}`, { method: "DELETE", token: uB.token })).status, 403);

    const repA = await requestJson(worker.url, "/reports", { token: uA.token });
    const repB = await requestJson(worker.url, "/reports", { token: uB.token });
    assert.equal(repA.data.keywords.some((k) => k.id === kB.id), false);
    assert.equal(repB.data.keywords.some((k) => k.id === kA.id), false);
  });

  test("T4-05: Collector Ingestion -> Alert Discovery Pipeline ('merenda escolar')", async () => {
    const tag = `t405-${Date.now().toString(36)}`;
    const slug = `2613-${tag}`;
    const sourceUrl = `https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial/${slug}`;

    const knownBefore = await requestJson(
      worker.url,
      `/admin/known?source_page_url=${encodeURIComponent(sourceUrl)}`,
      { token: worker.vars.INGEST_TOKEN }
    );
    assert.equal(knownBefore.status, 200);
    assert.equal(knownBefore.data.exists, false);

    const statsBefore = (await requestJson(worker.url, "/stats")).data;
    const ingestRes = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      body: {
        source_page_url: sourceUrl,
        pdf_url: `https://telemacoborba.pr.gov.br/arquivos/${slug}.pdf`,
        edition: "2613",
        title: `Edição 2613 - Merenda ${tag}`,
        published_at: "2026-11-22",
        extraction_method: "native",
        pages: [
          { page_number: 1, text: `LICITAÇÃO PARA MERENDA ESCOLAR ${tag} NO MUNICÍPIO.` }
        ]
      }
    });
    assert.equal(ingestRes.status, 201);

    const statsAfter = (await requestJson(worker.url, "/stats")).data;
    assert.equal(statsAfter.documents, statsBefore.documents + 1);

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-05") });
    const kw = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: `merenda escolar ${tag}` }
    })).data.keyword;

    const scan = await requestJson(worker.url, `/keywords/${kw.id}/scan`, { method: "POST", token });
    assert.ok(scan.data.created_alerts >= 1);
    assert.ok(scan.data.alerts.some((a) => a.document_id === ingestRes.data.document_id));

    const rep = await requestJson(worker.url, "/reports", { token });
    assert.ok(rep.data.alerts.some((a) => a.document_id === ingestRes.data.document_id));
  });

  test("T4-06: Group Reorganization & Relational Integrity Guard (409 -> move/delete -> 200)", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-06") });
    const gSaude = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "Saúde" } })).data.group;
    const gEdu = (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "Educação" } })).data.group;

    const k1 = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T406-Keep"), group_id: gSaude.id }
    })).data.keyword;
    const k2 = (await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("T406-Drop"), group_id: gSaude.id }
    })).data.keyword;
    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: k2.id, status: "novo", matched_excerpt: "Alerta para remover" }
    });

    assert.equal((await requestJson(worker.url, `/groups/${gSaude.id}`, { method: "DELETE", token })).status, 409);

    assert.equal(
      (await requestJson(worker.url, `/keywords/${k1.id}`, { method: "PATCH", token, body: { group_id: gEdu.id } })).status,
      200
    );
    assert.equal((await requestJson(worker.url, `/keywords/${k2.id}`, { method: "DELETE", token })).status, 200);
    assert.equal((await requestJson(worker.url, `/alerts?keyword_id=${k2.id}`, { token })).data.total, 0);

    const delSaude = await requestJson(worker.url, `/groups/${gSaude.id}`, { method: "DELETE", token });
    assert.equal(delSaude.status, 200);
  });

  test("T4-07: User Profile & Credential Security Audit (D1 PBKDF2 + password rotation + zero leaks)", async () => {
    const email1 = uniqueEmail("t4-07a");
    const email2 = uniqueEmail("t4-07b");
    const pass1 = "InicialAudit@2026";
    const pass2 = "RotacionadaAudit@2026";
    const reg = await registerUser(worker.url, { name: "Auditor", email: email1, password: pass1 });

    const dbRow1 = sandbox.queryOne("SELECT password_hash FROM users WHERE id = ?", [reg.user.id]);
    assert.notEqual(dbRow1.password_hash, pass1);
    assert.equal(reg.res.data.user.password_hash, undefined);

    const rot = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token: reg.token,
      body: { name: "Auditor Atualizado", email: email2, current_password: pass1, password: pass2 }
    });
    assert.equal(rot.status, 200);
    assert.equal(rot.data.user.password, undefined);
    assert.equal(rot.data.user.password_hash, undefined);

    const dbRow2 = sandbox.queryOne("SELECT password_hash FROM users WHERE id = ?", [reg.user.id]);
    assert.notEqual(dbRow2.password_hash, dbRow1.password_hash);
    assert.notEqual(dbRow2.password_hash, pass2);

    assert.equal(
      (await requestJson(worker.url, "/auth/login", { method: "POST", body: { email: email2, password: pass1 } })).status,
      401
    );
    const okLogin = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email: email2, password: pass2 }
    });
    assert.equal(okLogin.status, 200);
    assert.equal(okLogin.data.user.password_hash, undefined);
    assert.equal((await requestJson(worker.url, "/users/me", { token: okLogin.data.token })).data.user.email, email2);
  });

  test("T4-08: Next.js SSR & Preserved Edital-Monitor UX Parity across all routes and Worker endpoints", async () => {
    for (const route of ["/", "/login", "/cadastro", "/perfil", "/grupos", "/relatorios"]) {
      const res = await requestText(nextServer.url, route);
      assert.equal(res.status, 200);
      assert.match(res.text, /aero-canvas/);
    }
    const home = await requestText(nextServer.url, "/");
    for (const id of ["search-form", "search-input", "search-submit", "stat-documents", "stat-pages", "stat-latest", "feedback", "results"]) {
      assert.match(home.text, new RegExp(`id=["']${id}["']`));
    }

    assert.equal((await requestJson(worker.url, "/")).status, 200);
    assert.equal((await requestJson(worker.url, "/health")).data.ok, true);
    assert.ok((await requestJson(worker.url, "/stats")).data.documents >= 4);
    assert.ok((await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: "198.51.100.108" })).data.total >= 1);
  });

  test("T4-09: Quota Exhaustion (429) & Graceful Isolation for authenticated CRUD", async () => {
    const quotaIp = "198.51.100.249";
    for (let i = 0; i < 5; i++) {
      assert.equal((await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: quotaIp })).status, 200);
    }
    const blocked = await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: quotaIp });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("retry-after"), "3600");

    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-09"), ip: quotaIp });
    const g = await requestJson(worker.url, "/groups", { method: "POST", token, ip: quotaIp, body: { name: "Isolado" } });
    assert.equal(g.status, 201);
    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      ip: quotaIp,
      body: { keyword: uniqueKeyword("T409-CRUD"), group_id: g.data.group.id }
    });
    assert.equal(k.status, 201);
    assert.equal((await requestJson(worker.url, "/reports", { token, ip: quotaIp })).status, 200);
    assert.equal((await requestJson(worker.url, "/health", { ip: quotaIp })).status, 200);
    assert.equal((await requestJson(worker.url, "/stats", { ip: quotaIp })).status, 200);
  });

  test("T4-10: Hostile Input, Validation (400/409/415) & Clean Recovery Workflow", async () => {
    const tag = Date.now().toString(36);
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-10") });

    assert.equal(
      (await requestJson(worker.url, "/keywords", { method: "POST", token, body: "{broken" })).status,
      400
    );
    assert.equal(
      (await requestJson(worker.url, "/keywords", {
        method: "POST",
        token,
        headers: { "content-type": "text/plain" },
        body: "{}"
      })).status,
      415
    );
    assert.equal(
      (await requestJson(worker.url, "/keywords", { method: "POST", token, body: { keyword: "ab" } })).status,
      400
    );
    assert.equal(
      (await requestJson(worker.url, "/keywords", { method: "POST", token, body: { keyword: "x".repeat(101) } })).status,
      400
    );
    const badFk = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("BadGroup"), group_id: 999999 }
    });
    assert.ok(badFk.status === 400 || badFk.status === 404);
    assert.equal((await requestJson(worker.url, "/keywords/abc", { token })).status, 400);

    const baseKw = `Pregão ${tag}`;
    assert.equal(
      (await requestJson(worker.url, "/keywords", { method: "POST", token, body: { keyword: baseKw } })).status,
      201
    );
    assert.equal(
      (await requestJson(worker.url, "/keywords", { method: "POST", token, body: { keyword: `  ${baseKw}  ` } })).status,
      409
    );

    const recovered = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: `  Pregão   Municipal ${tag}  ` }
    });
    assert.equal(recovered.status, 201);
    assert.equal(recovered.data.keyword.keyword, `Pregão Municipal ${tag}`);
  });

  test("T4-11: Fresh User Empty-State & Onboarding Journey", async () => {
    const { token } = await registerUser(worker.url, { email: uniqueEmail("t4-11") });

    const gEmpty = await requestJson(worker.url, "/groups", { token });
    const kEmpty = await requestJson(worker.url, "/keywords", { token });
    const aEmpty = await requestJson(worker.url, "/alerts", { token });
    const rEmpty = await requestJson(worker.url, "/reports", { token });

    assert.equal(gEmpty.status, 200);
    assert.deepEqual(gEmpty.data.groups, []);
    assert.equal(kEmpty.status, 200);
    assert.deepEqual(kEmpty.data.keywords, []);
    assert.equal(aEmpty.status, 200);
    assert.deepEqual(aEmpty.data.alerts, []);
    assert.equal(rEmpty.status, 200);
    assert.deepEqual(rEmpty.data.keywords, []);
    assert.deepEqual(rEmpty.data.alerts, []);

    const g1 = await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "Primeiro Grupo" } });
    assert.equal(g1.status, 201);
    const k1 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Primeiro Termo"), group_id: g1.data.group.id }
    });
    assert.equal(k1.status, 201);

    const rAfter = await requestJson(worker.url, "/reports", { token });
    assert.equal(rAfter.status, 200);
    assert.equal(rAfter.data.keywords.length, 1);
  });

  test("T4-12: Academic Delivery, Git Hygiene, API Docs & Full Stack End-to-End Audit", async () => {
    assert.equal(runGit(["branch", "--show-current"]), "feat/crud-palavras-chave");
    assert.equal(runGit(["diff", "main", "--", "site/", "collector/"]), "");

    const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
    for (const pattern of [".next/", "frontend/node_modules/", ".env", ".dev.vars", ".wrangler/"]) {
      assert.ok(gitignore.includes(pattern), `Missing ${pattern} in .gitignore`);
    }

    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    for (const token of ["/auth/register", "/auth/login", "/users/me", "/groups", "/keywords", "/alerts", "/reports", "200", "201", "401", "409"]) {
      assert.ok(readme.includes(token), `README.md missing '${token}'`);
    }

    const health = await requestJson(worker.url, "/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.ok, true);

    const home = await requestText(nextServer.url, "/");
    assert.equal(home.status, 200);
  });
});
