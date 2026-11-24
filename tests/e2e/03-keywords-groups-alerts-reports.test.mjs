import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test, before, after } from "node:test";
import { getFreePort } from "./helpers/ports.mjs";
import { createD1Sandbox } from "./helpers/d1-sandbox.mjs";
import { startWorkerServer } from "./helpers/servers.mjs";
import {
  requestJson,
  registerUser,
  uniqueEmail,
  uniqueKeyword
} from "./helpers/http-client.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

describe("03 — Keywords (#10,#12,#14,#15), Groups & Alerts (#11,#16), Reports (#13), Validation (#17)", () => {
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
  // Feature 10: Primary Resource saved_keywords (RF004) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F10-01: D1 saved_keywords table has id PK plus >= 5 non-ID attributes", async () => {
    const cols = sandbox.queryAll("PRAGMA table_info(saved_keywords)");
    const colNames = cols.map((c) => c.name);
    assert.ok(colNames.includes("id"), "Missing id PK");
    const nonId = colNames.filter((n) => n !== "id");
    assert.ok(nonId.length >= 5, `Expected >= 5 non-ID columns, got ${nonId.length}`);
    for (const expected of [
      "user_id",
      "group_id",
      "keyword",
      "description",
      "priority",
      "target_section",
      "is_active",
      "last_searched_at",
      "created_at",
      "updated_at"
    ]) {
      assert.ok(colNames.includes(expected), `Missing column ${expected}`);
    }
  });

  test("T1-F10-02: POST /keywords persists all attributes and returns 201 { keyword }", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 Attrs" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo F10" }
    });
    assert.equal(grp.status, 201);

    const kwText = uniqueKeyword("F10 Completo");
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: {
        keyword: kwText,
        group_id: grp.data.group.id,
        description: "Descrição completa",
        priority: "alta",
        target_section: "licitacoes",
        is_active: 1
      }
    });
    assert.equal(res.status, 201);
    const kw = res.data?.keyword;
    assert.equal(typeof kw?.id, "number");
    assert.equal(kw.keyword, kwText);
    assert.equal(kw.group_id, grp.data.group.id);
    assert.equal(kw.description, "Descrição completa");
    assert.equal(kw.priority, "alta");
    assert.equal(kw.target_section, "licitacoes");
    assert.ok(kw.is_active === 1 || kw.is_active === true);
  });

  test("T1-F10-03: POST /keywords applies defaults when optional attributes are omitted", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 Defaults" });
    const kwText = uniqueKeyword("F10 Default");
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });
    assert.equal(res.status, 201);
    const kw = res.data?.keyword;
    assert.equal(kw.priority, "media");
    assert.equal(kw.target_section, "geral");
    assert.equal(kw.description, "");
    assert.ok(kw.is_active === 1 || kw.is_active === true);
  });

  test("T1-F10-04: POST /keywords populates created_at and updated_at timestamps automatically", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 TS" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F10 Timestamp") }
    });
    assert.equal(res.status, 201);
    assert.ok(typeof res.data?.keyword?.created_at === "string" && res.data.keyword.created_at.length > 0);
    assert.ok(typeof res.data?.keyword?.updated_at === "string" && res.data.keyword.updated_at.length > 0);
  });

  test("T1-F10-05: saved_keywords.keyword enforces uniqueness with 409 Conflict", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 Unique" });
    const kwText = uniqueKeyword("F10 Unica");
    const first = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });
    assert.equal(first.status, 201);

    const dup = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });
    assert.equal(dup.status, 409);
  });

  test("T2-F10-01: Lower length boundary 3-char keyword 'ata' returns 201", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 Min3" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "ata" }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.keyword?.keyword, "ata");
  });

  test("T2-F10-02: Upper length boundary 100-char keyword returns 201", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 Max100" });
    const kw100 = "a".repeat(100);
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kw100 }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.keyword?.keyword, kw100);
  });

  test("T2-F10-03: Below lower boundary ('ab' and '   a   ') returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 BelowMin" });
    for (const bad of ["ab", "   a   "]) {
      const res = await requestJson(worker.url, "/keywords", {
        method: "POST",
        token,
        body: { keyword: bad }
      });
      assert.equal(res.status, 400);
    }
  });

  test("T2-F10-04: Above upper boundary (101 chars) returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 AboveMax" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "a".repeat(101) }
    });
    assert.equal(res.status, 400);
  });

  test("T2-F10-05: Oversized description or non-string keyword returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F10 BadTypes" });
    const longDesc = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("DescLong"), description: "d".repeat(2000) }
    });
    assert.equal(longDesc.status, 400);

    for (const badKw of [123, null, { text: "x" }]) {
      const res = await requestJson(worker.url, "/keywords", {
        method: "POST",
        token,
        body: { keyword: badKw }
      });
      assert.equal(res.status, 400);
    }
  });

  // =========================================================================
  // Feature 11: Related Entities >= 2 Beyond User (RF008) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F11-01: keyword_groups is active Entity #1 beyond users via /groups and D1", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 Grp" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Saúde Municipal", description: "Editais de saúde" }
    });
    assert.equal(grp.status, 201);
    const dbRow = sandbox.queryOne("SELECT id, name FROM keyword_groups WHERE id = ?", [
      grp.data.group.id
    ]);
    assert.equal(dbRow?.name, "Saúde Municipal");
  });

  test("T1-F11-02: keyword_alerts is active Entity #2 beyond users via /alerts and D1", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 Alert" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F11 Alerta") }
    });
    const alert = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: {
        keyword_id: kw.data.keyword.id,
        document_id: 1,
        status: "novo",
        matched_excerpt: "Extrato de contrato médico"
      }
    });
    assert.equal(alert.status, 201);
    const dbRow = sandbox.queryOne(
      "SELECT id, keyword_id, document_id, status FROM keyword_alerts WHERE id = ?",
      [alert.data.alert.id]
    );
    assert.equal(dbRow?.keyword_id, kw.data.keyword.id);
    assert.equal(dbRow?.document_id, 1);
  });

  test("T1-F11-03: GET /keywords and GET /keywords/:id reflect relational links to group and alerts", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 Links" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Linkado" }
    });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F11 Link"), group_id: grp.data.group.id }
    });
    const kwId = kw.data.keyword.id;

    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kwId, document_id: 1, status: "novo" }
    });

    const list = await requestJson(worker.url, "/keywords", { token });
    assert.equal(list.status, 200);
    const item = list.data.keywords.find((k) => k.id === kwId);
    assert.equal(item?.group_id, grp.data.group.id);

    const detail = await requestJson(worker.url, `/keywords/${kwId}`, { token });
    assert.equal(detail.status, 200);
    assert.equal(detail.data?.keyword?.group_id, grp.data.group.id);
  });

  test("T1-F11-04: GET /alerts returns relational context with keyword and document linkage", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 AlertCtx" });
    const kwText = uniqueKeyword("F11 Ctx");
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });
    const created = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: {
        keyword_id: kw.data.keyword.id,
        document_id: 1,
        status: "novo",
        matched_excerpt: "Insumos hospitalares"
      }
    });
    assert.equal(created.status, 201);

    const list = await requestJson(worker.url, "/alerts", { token });
    assert.equal(list.status, 200);
    const found = list.data?.alerts?.find((a) => a.id === created.data.alert.id);
    assert.ok(found, "Expected alert in GET /alerts");
    assert.equal(found.keyword_id, kw.data.keyword.id);
    assert.equal(found.document_id, 1);
    assert.equal(found.status, "novo");
    assert.equal(found.matched_excerpt, "Insumos hospitalares");
  });

  test("T1-F11-05: GET /reports aggregates across keyword_groups, saved_keywords, and keyword_alerts", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 Reports" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Relatório" }
    });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: {
        keyword: uniqueKeyword("F11 Rep"),
        group_id: grp.data.group.id,
        priority: "alta"
      }
    });
    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "novo" }
    });

    const rep = await requestJson(worker.url, "/reports", { token });
    assert.equal(rep.status, 200);
    assert.ok(Array.isArray(rep.data?.by_group));
    assert.ok(Array.isArray(rep.data?.by_priority));
    assert.ok(rep.data?.summary && typeof rep.data.summary === "object");
    assert.ok(rep.data.keywords.length >= 1);
    assert.ok(rep.data.alerts.length >= 1);
  });

  test("T2-F11-01: POST /keywords referencing User B's group_id is rejected (403/404)", async () => {
    const userA = await registerUser(worker.url, { name: "F11 Tenant A" });
    const userB = await registerUser(worker.url, { name: "F11 Tenant B" });
    const grpB = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userB.token,
      body: { name: "Grupo B" }
    });

    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("Cross Tenant"), group_id: grpB.data.group.id }
    });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403/404, got ${res.status}`);
  });

  test("T2-F11-02: PUT /keywords/:id attempting to reassign group_id to User B's group is rejected (403/404)", async () => {
    const userA = await registerUser(worker.url, { name: "F11 Reassign A" });
    const userB = await registerUser(worker.url, { name: "F11 Reassign B" });
    const grpB = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userB.token,
      body: { name: "Grupo B2" }
    });
    const kwA = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("Reassign A") }
    });

    const res = await requestJson(worker.url, `/keywords/${kwA.data.keyword.id}`, {
      method: "PUT",
      token: userA.token,
      body: { keyword: kwA.data.keyword.keyword, group_id: grpB.data.group.id }
    });
    assert.ok(res.status === 403 || res.status === 404, `Expected 403/404, got ${res.status}`);
  });

  test("T2-F11-03: POST /groups with duplicate name for the same user returns 409", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 SameUser" });
    const first = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Duplicado Mesmo Usuário" }
    });
    assert.equal(first.status, 201);

    const dup = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Duplicado Mesmo Usuário" }
    });
    assert.equal(dup.status, 409);
  });

  test("T2-F11-04: POST /groups with identical name by a different user succeeds with 201", async () => {
    const userA = await registerUser(worker.url, { name: "F11 GrpA" });
    const userB = await registerUser(worker.url, { name: "F11 GrpB" });

    const gA = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userA.token,
      body: { name: "Editais Compartilhado" }
    });
    assert.equal(gA.status, 201);

    const gB = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userB.token,
      body: { name: "Editais Compartilhado" }
    });
    assert.equal(gB.status, 201);
  });

  test("T2-F11-05: POST /keywords/:id/scan with 0-hit term returns 200 and updates last_searched_at", async () => {
    const { token } = await registerUser(worker.url, { name: "F11 ZeroScan" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "termo-inexistente-xyz" }
    });
    assert.equal(kw.status, 201);
    const id = kw.data.keyword.id;

    const scan = await requestJson(worker.url, `/keywords/${id}/scan`, {
      method: "POST",
      token
    });
    assert.equal(scan.status, 200);
    assert.equal(scan.data?.matched_documents, 0);
    assert.equal(scan.data?.created_alerts, 0);
    assert.deepEqual(scan.data?.alerts, []);

    const after = await requestJson(worker.url, `/keywords/${id}`, { token });
    assert.ok(after.data?.keyword?.last_searched_at, "Expected last_searched_at to be populated");
  });

  // =========================================================================
  // Feature 12: Create Saved Keyword (RF004, RF010) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F12-01: POST /keywords creates 'Pregão Eletrônico' with full attributes and returns 201", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 Create" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: {
        keyword: "Pregão Eletrônico",
        priority: "alta",
        target_section: "licitacoes",
        description: "Editais de compras"
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.keyword?.keyword, "Pregão Eletrônico");
    assert.equal(res.data?.keyword?.priority, "alta");
    assert.equal(res.data?.keyword?.target_section, "licitacoes");
  });

  test("T1-F12-02: POST /keywords with valid owned group_id links keyword.group_id", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 GrpLink" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "F12 Grupo" }
    });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F12 Link"), group_id: grp.data.group.id }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.keyword?.group_id, grp.data.group.id);
  });

  test("T1-F12-03: POST /keywords normalizes whitespace via cleanQuery", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 Clean" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "  Licitação   Pública  " }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.keyword?.keyword, "Licitação Pública");
  });

  test("T1-F12-04: POST /keywords accepts is_active false or 0 and persists inactive state", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 Inactive" });
    const r1 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Inativa Bool"), is_active: false }
    });
    assert.equal(r1.status, 201);
    assert.ok(r1.data.keyword.is_active === 0 || r1.data.keyword.is_active === false);

    const r2 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Inativa Zero"), is_active: 0 }
    });
    assert.equal(r2.status, 201);
    assert.ok(r2.data.keyword.is_active === 0 || r2.data.keyword.is_active === false);
  });

  test("T1-F12-05: Newly created keyword appears immediately in GET /keywords", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 ListAfter" });
    const kwText = uniqueKeyword("F12 Visível");
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });
    assert.equal(created.status, 201);

    const list = await requestJson(worker.url, "/keywords", { token });
    assert.equal(list.status, 200);
    assert.ok(list.data?.keywords?.some((k) => k.id === created.data.keyword.id && k.keyword === kwText));
  });

  test("T2-F12-01: cleanQuery applies NFKC normalization and whitespace collapse on fullwidth chars", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 NFKC" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "  ｊｏãｏ\t\n  ｄａ   ｓｉｌｖａ  " }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.keyword?.keyword, "joão da silva");
  });

  test("T2-F12-02: Duplicate after cleanQuery/NFKC normalization returns 409 Conflict", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 DupNorm" });
    const first = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Pregão" }
    });
    assert.equal(first.status, 201);

    const dupSpaces = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "  Pregão  " }
    });
    assert.equal(dupSpaces.status, 409);

    const dupNfkc = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Ｐｒｅｇãｏ" }
    });
    assert.equal(dupNfkc.status, 409);
  });

  test("T2-F12-03: Duplicate keyword returns 409 JSON { error } in Portuguese, never 500 SQLITE error", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 DupMsg" });
    const kwText = uniqueKeyword("F12 MsgDup");
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });

    const dup = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText }
    });
    assert.equal(dup.status, 409);
    assert.ok(typeof dup.data?.error === "string" && dup.data.error.length > 0);
    assert.ok(!dup.data.error.includes("UNIQUE constraint failed"));
  });

  test("T2-F12-04: SQL injection string in keyword is safely parameterized and leaves table intact", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 SQLi" });
    const payload = "licitação'; DROP TABLE saved_keywords; --";
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: payload }
    });
    assert.ok(res.status === 201 || res.status === 400);

    const tableCheck = sandbox.queryOne(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'saved_keywords'"
    );
    assert.equal(tableCheck?.name, "saved_keywords");
  });

  test("T2-F12-05: Blank or whitespace-only keyword returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F12 Blank" });
    for (const bad of ["", "   ", "\t\n"]) {
      const res = await requestJson(worker.url, "/keywords", {
        method: "POST",
        token,
        body: { keyword: bad }
      });
      assert.equal(res.status, 400);
    }
  });

  // =========================================================================
  // Feature 13: List / Consult & Reports with Filters (RF005) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F13-01: GET /keywords returns 200 { total, keywords } scoped to caller", async () => {
    const userA = await registerUser(worker.url, { name: "F13 Scope A" });
    const userB = await registerUser(worker.url, { name: "F13 Scope B" });

    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("ScopeA") }
    });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userB.token,
      body: { keyword: uniqueKeyword("ScopeB") }
    });

    const listA = await requestJson(worker.url, "/keywords", { token: userA.token });
    assert.equal(listA.status, 200);
    assert.equal(listA.data?.total, 1);
    assert.equal(listA.data?.keywords?.length, 1);
    assert.ok(listA.data.keywords[0].keyword.startsWith("ScopeA"));
  });

  test("T1-F13-02: GET /keywords?q=pregão&priority=alta&active=1 filters accurately", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 Filter1" });
    const matchKw = uniqueKeyword("Pregão Filtro");
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: matchKw, priority: "alta", is_active: 1 }
    });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Pregão Inativo"), priority: "alta", is_active: 0 }
    });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Outro Alta"), priority: "alta", is_active: 1 }
    });

    const res = await requestJson(
      worker.url,
      "/keywords?q=preg%C3%A3o&priority=alta&active=1",
      { token }
    );
    assert.equal(res.status, 200);
    assert.equal(res.data?.total, 1);
    assert.equal(res.data?.keywords?.[0]?.keyword, matchKw);
  });

  test("T1-F13-03: GET /keywords?group_id=&section=&sort=keyword_asc filters and sorts ascending", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 Sort" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "F13 Sort Grp" }
    });
    const gid = grp.data.group.id;

    const kwZ = uniqueKeyword("Zeta Lic");
    const kwA = uniqueKeyword("Alpha Lic");
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwZ, group_id: gid, target_section: "licitacoes" }
    });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwA, group_id: gid, target_section: "licitacoes" }
    });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Outro Sec"), group_id: gid, target_section: "saude" }
    });

    const res = await requestJson(
      worker.url,
      `/keywords?group_id=${gid}&section=licitacoes&sort=keyword_asc`,
      { token }
    );
    assert.equal(res.status, 200);
    assert.equal(res.data?.total, 2);
    assert.equal(res.data?.keywords?.[0]?.keyword, kwA);
    assert.equal(res.data?.keywords?.[1]?.keyword, kwZ);
  });

  test("T1-F13-04: GET /reports returns organized summary, by_group, by_priority, keywords, alerts", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 Rep" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "F13 Rep Grp" }
    });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F13 RepKw"), group_id: grp.data.group.id, priority: "alta" }
    });
    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "novo" }
    });

    const res = await requestJson(worker.url, "/reports", { token });
    assert.equal(res.status, 200);
    assert.ok(res.data?.filters && typeof res.data.filters === "object");
    assert.ok(res.data?.summary && typeof res.data.summary === "object");
    assert.ok(Array.isArray(res.data?.by_group));
    assert.ok(Array.isArray(res.data?.by_priority));
    assert.ok(Array.isArray(res.data?.keywords) && res.data.keywords.length === 1);
    assert.ok(Array.isArray(res.data?.alerts) && res.data.alerts.length === 1);
  });

  test("T1-F13-05: GET /reports applies multi-dimensional filters across summary, keywords, and alerts", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 Multi" });
    const g1 = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "F13 G1" }
    });
    const g2 = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "F13 G2" }
    });

    const kw1Text = uniqueKeyword("Alvo Multi");
    const kw1 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kw1Text, group_id: g1.data.group.id, priority: "alta" }
    });
    const kw2 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Outro Multi"), group_id: g2.data.group.id, priority: "baixa" }
    });

    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw1.data.keyword.id, status: "novo" }
    });
    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw2.data.keyword.id, status: "arquivado" }
    });

    const res = await requestJson(
      worker.url,
      `/reports?group_id=${g1.data.group.id}&priority=alta&status=novo&from=2020-01-01&to=2030-12-31&q=Alvo`,
      { token }
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.keywords.length, 1);
    assert.equal(res.data.keywords[0].keyword, kw1Text);
    assert.equal(res.data.alerts.length, 1);
    assert.equal(res.data.alerts[0].status, "novo");
  });

  test("T2-F13-01: Fresh user with 0 records gets 200 empty arrays and 0 totals across all list/report routes", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 EmptyUser" });

    const kws = await requestJson(worker.url, "/keywords", { token });
    assert.equal(kws.status, 200);
    assert.equal(kws.data?.total, 0);
    assert.deepEqual(kws.data?.keywords, []);

    const grps = await requestJson(worker.url, "/groups", { token });
    assert.equal(grps.status, 200);
    assert.equal(grps.data?.total, 0);
    assert.deepEqual(grps.data?.groups, []);

    const alts = await requestJson(worker.url, "/alerts", { token });
    assert.equal(alts.status, 200);
    assert.equal(alts.data?.total, 0);
    assert.deepEqual(alts.data?.alerts, []);

    const rep = await requestJson(worker.url, "/reports", { token });
    assert.equal(rep.status, 200);
    assert.deepEqual(rep.data?.keywords, []);
    assert.deepEqual(rep.data?.alerts, []);
  });

  test("T2-F13-02: Filters with 0 matches return 200 empty arrays", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 NoMatch" });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F13 Presente"), priority: "baixa" }
    });

    const kwRes = await requestJson(worker.url, "/keywords?q=termo-inexistente-xyz", { token });
    assert.equal(kwRes.status, 200);
    assert.equal(kwRes.data?.total, 0);
    assert.deepEqual(kwRes.data?.keywords, []);

    const repRes = await requestJson(worker.url, "/reports?priority=alta&status=arquivado", {
      token
    });
    assert.equal(repRes.status, 200);
    assert.deepEqual(repRes.data?.keywords, []);
    assert.deepEqual(repRes.data?.alerts, []);
  });

  test("T2-F13-03: Invalid filter params return 400 JSON { error }", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 BadFilter" });
    const badUrls = [
      "/keywords?priority=invalida",
      "/keywords?group_id=abc",
      "/keywords?active=sim",
      "/alerts?status=invalido",
      "/reports?from=not-a-date"
    ];
    for (const url of badUrls) {
      const res = await requestJson(worker.url, url, { token });
      assert.equal(res.status, 400, `Expected 400 for ${url}, got ${res.status}`);
      assert.ok(typeof res.data?.error === "string" && res.data.error.length > 0);
    }
  });

  test("T2-F13-04: SQL wildcard '%' and injection string in ?q= do not leak other users' data", async () => {
    const userA = await registerUser(worker.url, { name: "F13 SQLi A" });
    const userB = await registerUser(worker.url, { name: "F13 SQLi B" });
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("Segredo A") }
    });

    const pct = await requestJson(worker.url, "/keywords?q=%25", { token: userB.token });
    assert.equal(pct.status, 200);
    assert.equal(pct.data?.total, 0);

    const sqli = await requestJson(
      worker.url,
      `/keywords?q=${encodeURIComponent("' OR 1=1 --")}`,
      { token: userB.token }
    );
    assert.equal(sqli.status, 200);
    assert.equal(sqli.data?.total, 0);
  });

  test("T2-F13-05: Inverted date range (from > to) returns 200 empty or 400 cleanly (never 500)", async () => {
    const { token } = await registerUser(worker.url, { name: "F13 DateInv" });
    const res = await requestJson(
      worker.url,
      "/reports?from=2026-12-31&to=2026-01-01",
      { token }
    );
    assert.ok(res.status === 200 || res.status === 400, `Expected 200 or 400, got ${res.status}`);
    if (res.status === 200) {
      assert.deepEqual(res.data?.keywords, []);
      assert.deepEqual(res.data?.alerts, []);
    }
  });

  // =========================================================================
  // Feature 14: Update Saved Keyword (RF006) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F14-01: PUT /keywords/:id updates all fields and returns 200 { keyword }", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 Put" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "F14 Put Grp" }
    });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F14 Antes") }
    });
    const id = created.data.keyword.id;

    const newText = uniqueKeyword("F14 Depois");
    const updated = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PUT",
      token,
      body: {
        keyword: newText,
        group_id: grp.data.group.id,
        description: "Editado via PUT",
        priority: "alta",
        target_section: "educacao",
        is_active: 0
      }
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data?.keyword?.keyword, newText);
    assert.equal(updated.data?.keyword?.group_id, grp.data.group.id);
    assert.equal(updated.data?.keyword?.description, "Editado via PUT");
    assert.equal(updated.data?.keyword?.priority, "alta");
    assert.equal(updated.data?.keyword?.target_section, "educacao");
    assert.ok(updated.data?.keyword?.is_active === 0 || updated.data?.keyword?.is_active === false);
  });

  test("T1-F14-02: PATCH /keywords/:id updates only priority and preserves other fields", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 Patch" });
    const kwText = uniqueKeyword("F14 Partial");
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: {
        keyword: kwText,
        description: "Preservar descrição",
        priority: "alta",
        target_section: "saude"
      }
    });
    const id = created.data.keyword.id;

    const patched = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PATCH",
      token,
      body: { priority: "baixa" }
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.data?.keyword?.priority, "baixa");
    assert.equal(patched.data?.keyword?.keyword, kwText);
    assert.equal(patched.data?.keyword?.description, "Preservar descrição");
    assert.equal(patched.data?.keyword?.target_section, "saude");
  });

  test("T1-F14-03: PUT/PATCH /keywords/:id advances updated_at while preserving created_at", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 TS" });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F14 Timestamp") }
    });
    const before = created.data.keyword;
    await sleep(1100);

    const patched = await requestJson(worker.url, `/keywords/${before.id}`, {
      method: "PATCH",
      token,
      body: { priority: "alta" }
    });
    assert.equal(patched.status, 200);
    const after = patched.data.keyword;
    assert.equal(after.created_at, before.created_at);
    assert.ok(
      after.updated_at > before.updated_at,
      `Expected updated_at (${after.updated_at}) > before (${before.updated_at})`
    );
  });

  test("T1-F14-04: PATCH /keywords/:id moves keyword from null group_id to valid group and between groups", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 MoveGrp" });
    const g1 = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Origem" }
    });
    const g2 = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Destino" }
    });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F14 Sem Grupo") }
    });
    const id = kw.data.keyword.id;
    assert.equal(kw.data.keyword.group_id, null);

    const move1 = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PATCH",
      token,
      body: { group_id: g1.data.group.id }
    });
    assert.equal(move1.status, 200);
    assert.equal(move1.data.keyword.group_id, g1.data.group.id);

    const move2 = await requestJson(worker.url, `/keywords/${id}`, {
      method: "PATCH",
      token,
      body: { group_id: g2.data.group.id }
    });
    assert.equal(move2.status, 200);
    assert.equal(move2.data.keyword.group_id, g2.data.group.id);
  });

  test("T1-F14-05: GET /keywords/:id returns persisted updated values", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 GetAfter" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F14 GetAntes") }
    });
    const id = kw.data.keyword.id;

    await requestJson(worker.url, `/keywords/${id}`, {
      method: "PATCH",
      token,
      body: { description: "Confirmado no GET", priority: "alta" }
    });

    const getRes = await requestJson(worker.url, `/keywords/${id}`, { token });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data?.keyword?.description, "Confirmado no GET");
    assert.equal(getRes.data?.keyword?.priority, "alta");
  });

  test("T2-F14-01: Invalid :id ('abc', '0', '-1', '1.5') on GET/PUT/PATCH /keywords/:id returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 BadId" });
    for (const badId of ["abc", "0", "-1", "1.5"]) {
      assert.equal((await requestJson(worker.url, `/keywords/${badId}`, { token })).status, 400);
      assert.equal(
        (
          await requestJson(worker.url, `/keywords/${badId}`, {
            method: "PUT",
            token,
            body: { keyword: uniqueKeyword("BadIdPut") }
          })
        ).status,
        400
      );
      assert.equal(
        (
          await requestJson(worker.url, `/keywords/${badId}`, {
            method: "PATCH",
            token,
            body: { priority: "alta" }
          })
        ).status,
        400
      );
    }
  });

  test("T2-F14-02: Non-existent positive :id (999999) on GET/PUT/PATCH /keywords/:id returns 404", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 NotFound" });
    assert.equal((await requestJson(worker.url, "/keywords/999999", { token })).status, 404);
    assert.equal(
      (
        await requestJson(worker.url, "/keywords/999999", {
          method: "PUT",
          token,
          body: { keyword: uniqueKeyword("MissingPut") }
        })
      ).status,
      404
    );
    assert.equal(
      (
        await requestJson(worker.url, "/keywords/999999", {
          method: "PATCH",
          token,
          body: { priority: "alta" }
        })
      ).status,
      404
    );
  });

  test("T2-F14-03: Updating keyword to another existing keyword returns 409 Conflict", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 DupUpd" });
    const k1Text = uniqueKeyword("F14 Existente");
    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: k1Text }
    });
    const k2 = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F14 Outro") }
    });

    const dup = await requestJson(worker.url, `/keywords/${k2.data.keyword.id}`, {
      method: "PATCH",
      token,
      body: { keyword: k1Text }
    });
    assert.equal(dup.status, 409);
  });

  test("T2-F14-04: Updating keyword to its own current value (idempotent PUT) returns 200", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 SelfPut" });
    const kwText = uniqueKeyword("F14 Idempotente");
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: kwText, priority: "media" }
    });

    const selfPut = await requestJson(worker.url, `/keywords/${created.data.keyword.id}`, {
      method: "PUT",
      token,
      body: { keyword: kwText, priority: "alta", description: "Atualizado sem conflito" }
    });
    assert.equal(selfPut.status, 200);
    assert.equal(selfPut.data?.keyword?.keyword, kwText);
    assert.equal(selfPut.data?.keyword?.priority, "alta");
  });

  test("T2-F14-05: PUT/PATCH /keywords/:id with invalid length or empty {} returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F14 BadUpd" });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F14 ValUpd") }
    });
    const id = created.data.keyword.id;

    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}`, {
          method: "PATCH",
          token,
          body: { keyword: "ab" }
        })
      ).status,
      400
    );
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}`, {
          method: "PATCH",
          token,
          body: { keyword: "a".repeat(101) }
        })
      ).status,
      400
    );
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}`, {
          method: "PATCH",
          token,
          body: {}
        })
      ).status,
      400
    );
  });

  // =========================================================================
  // Feature 15: Delete Saved Keyword (RF007) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F15-01: DELETE /keywords/:id returns 200 { ok: true, deleted_id }", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 Del" });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F15 Deletar") }
    });
    const id = created.data.keyword.id;

    const del = await requestJson(worker.url, `/keywords/${id}`, {
      method: "DELETE",
      token
    });
    assert.equal(del.status, 200);
    assert.equal(del.data?.ok, true);
    assert.equal(del.data?.deleted_id, id);
  });

  test("T1-F15-02: GET /keywords/:id after deletion returns 404", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 Get404" });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F15 Sumir") }
    });
    const id = created.data.keyword.id;

    await requestJson(worker.url, `/keywords/${id}`, { method: "DELETE", token });
    const after = await requestJson(worker.url, `/keywords/${id}`, { token });
    assert.equal(after.status, 404);
  });

  test("T1-F15-03: DELETE /keywords/:id atomically deletes child keyword_alerts", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 Cascade" });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F15 ComAlerta") }
    });
    const id = created.data.keyword.id;

    await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: id, status: "novo" }
    });

    const del = await requestJson(worker.url, `/keywords/${id}`, {
      method: "DELETE",
      token
    });
    assert.equal(del.status, 200);

    const alertsAfter = await requestJson(worker.url, `/alerts?keyword_id=${id}`, { token });
    assert.equal(alertsAfter.status, 200);
    assert.equal(alertsAfter.data?.total, 0);
  });

  test("T1-F15-04: DELETE /groups/:id on an empty group returns 200 { ok: true, deleted_id }", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 DelGrp" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Vazio" }
    });
    const gid = grp.data.group.id;

    const del = await requestJson(worker.url, `/groups/${gid}`, {
      method: "DELETE",
      token
    });
    assert.equal(del.status, 200);
    assert.equal(del.data?.ok, true);
    assert.equal(del.data?.deleted_id, gid);
  });

  test("T1-F15-05: DELETE /groups/:id with linked saved_keywords returns 409 Conflict and preserves group", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 GrpGuard" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Protegido" }
    });
    const gid = grp.data.group.id;

    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F15 Guard"), group_id: gid }
    });

    const blocked = await requestJson(worker.url, `/groups/${gid}`, {
      method: "DELETE",
      token
    });
    assert.equal(blocked.status, 409);
    assert.ok(typeof blocked.data?.error === "string" && blocked.data.error.length > 0);

    const stillExists = await requestJson(worker.url, `/groups/${gid}`, { token });
    assert.equal(stillExists.status, 200);
  });

  test("T2-F15-01: DELETE /keywords/abc, /0, /-5 return 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 BadDelId" });
    for (const bad of ["abc", "0", "-5"]) {
      const res = await requestJson(worker.url, `/keywords/${bad}`, {
        method: "DELETE",
        token
      });
      assert.equal(res.status, 400);
    }
  });

  test("T2-F15-02: DELETE /keywords/999999 returns 404", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 MissingDel" });
    const res = await requestJson(worker.url, "/keywords/999999", {
      method: "DELETE",
      token
    });
    assert.equal(res.status, 404);
  });

  test("T2-F15-03: Double DELETE /keywords/:id returns 404 on second attempt", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 DoubleDel" });
    const created = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F15 DuplaDel") }
    });
    const id = created.data.keyword.id;

    assert.equal((await requestJson(worker.url, `/keywords/${id}`, { method: "DELETE", token })).status, 200);
    assert.equal((await requestJson(worker.url, `/keywords/${id}`, { method: "DELETE", token })).status, 404);
  });

  test("T2-F15-04: DELETE /groups with invalid IDs returns 400 and non-existent 999999 returns 404", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 BadGrpDel" });
    assert.equal((await requestJson(worker.url, "/groups/abc", { method: "DELETE", token })).status, 400);
    assert.equal((await requestJson(worker.url, "/groups/0", { method: "DELETE", token })).status, 400);
    assert.equal((await requestJson(worker.url, "/groups/999999", { method: "DELETE", token })).status, 404);
  });

  test("T2-F15-05: DELETE /groups/:id returns 409 even when linked keyword has is_active = 0", async () => {
    const { token } = await registerUser(worker.url, { name: "F15 InactiveGuard" });
    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Com Inativa" }
    });
    const gid = grp.data.group.id;

    await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F15 Inativa"), group_id: gid, is_active: 0 }
    });

    const blocked = await requestJson(worker.url, `/groups/${gid}`, {
      method: "DELETE",
      token
    });
    assert.equal(blocked.status, 409);
  });

  // =========================================================================
  // Feature 16: Related Entity CRUD & Scan (RF008) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F16-01: POST /groups creates group with name, description, color and returns 201", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 CreateGrp" });
    const res = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Licitações", description: "Editais de compras", color: "#0b7aa8" }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.group?.name, "Licitações");
    assert.equal(res.data?.group?.description, "Editais de compras");
    assert.equal(res.data?.group?.color, "#0b7aa8");
  });

  test("T1-F16-02: GET /groups, GET /groups/:id, PUT/PATCH /groups/:id persist updates", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 UpdGrp" });
    const created = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Educação Inicial", description: "Desc 1", color: "#112233" }
    });
    const gid = created.data.group.id;

    const list = await requestJson(worker.url, "/groups", { token });
    assert.equal(list.status, 200);
    assert.ok(list.data.groups.some((g) => g.id === gid));

    const put = await requestJson(worker.url, `/groups/${gid}`, {
      method: "PUT",
      token,
      body: { name: "Educação Atualizada", description: "Desc 2", color: "#223344" }
    });
    assert.equal(put.status, 200);
    assert.equal(put.data?.group?.name, "Educação Atualizada");

    const patch = await requestJson(worker.url, `/groups/${gid}`, {
      method: "PATCH",
      token,
      body: { color: "#334455" }
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.data?.group?.color, "#334455");

    const getOne = await requestJson(worker.url, `/groups/${gid}`, { token });
    assert.equal(getOne.status, 200);
    assert.equal(getOne.data?.group?.name, "Educação Atualizada");
    assert.equal(getOne.data?.group?.color, "#334455");
  });

  test("T1-F16-03: POST /keywords/:id/scan matches seeded 'Medicamentos' in pages_fts and creates alerts", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 ScanHit" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Medicamentos" }
    });
    assert.equal(kw.status, 201);
    const id = kw.data.keyword.id;

    const scan = await requestJson(worker.url, `/keywords/${id}/scan`, {
      method: "POST",
      token
    });
    assert.ok(scan.status === 200 || scan.status === 201, `Expected 200/201, got ${scan.status}`);
    assert.equal(scan.data?.keyword_id, id);
    assert.ok(scan.data?.matched_documents >= 1);
    assert.ok(scan.data?.created_alerts >= 1);
    assert.ok(Array.isArray(scan.data?.alerts) && scan.data.alerts.length >= 1);

    const kwAfter = await requestJson(worker.url, `/keywords/${id}`, { token });
    assert.ok(kwAfter.data?.keyword?.last_searched_at);
  });

  test("T1-F16-04: POST /alerts creates manual alert linked to keyword and document", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 PostAlert" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F16 AlertaManual") }
    });

    const res = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: {
        keyword_id: kw.data.keyword.id,
        document_id: 1,
        status: "novo",
        matched_excerpt: "Aviso de licitação",
        notes: "Anotação inicial"
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.data?.alert?.keyword_id, kw.data.keyword.id);
    assert.equal(res.data?.alert?.document_id, 1);
    assert.equal(res.data?.alert?.status, "novo");
    assert.equal(res.data?.alert?.notes, "Anotação inicial");
  });

  test("T1-F16-05: Full /alerts GET, PUT/PATCH status transition, and DELETE lifecycle", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 AlertCrud" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F16 AlertLife") }
    });
    const created = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "novo", notes: "Verificar" }
    });
    const aid = created.data.alert.id;

    const getOne = await requestJson(worker.url, `/alerts/${aid}`, { token });
    assert.equal(getOne.status, 200);

    const patch = await requestJson(worker.url, `/alerts/${aid}`, {
      method: "PATCH",
      token,
      body: { status: "revisado", notes: "Confirmado" }
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.data?.alert?.status, "revisado");
    assert.equal(patch.data?.alert?.notes, "Confirmado");

    const del = await requestJson(worker.url, `/alerts/${aid}`, {
      method: "DELETE",
      token
    });
    assert.equal(del.status, 200);
    assert.equal(del.data?.ok, true);

    assert.equal((await requestJson(worker.url, `/alerts/${aid}`, { token })).status, 404);
  });

  test("T2-F16-01: POST /groups rejects empty name, >80 char name, and invalid hex color with 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 BadGrp" });
    assert.equal(
      (await requestJson(worker.url, "/groups", { method: "POST", token, body: { name: "" } })).status,
      400
    );
    assert.equal(
      (
        await requestJson(worker.url, "/groups", {
          method: "POST",
          token,
          body: { name: "g".repeat(81) }
        })
      ).status,
      400
    );
    assert.equal(
      (
        await requestJson(worker.url, "/groups", {
          method: "POST",
          token,
          body: { name: "Cor Inválida", color: "azul-claro" }
        })
      ).status,
      400
    );
  });

  test("T2-F16-02: PUT/PATCH /groups/:id enforces per-user duplicate name (409) and allows self-name (200)", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 GrpDupUpd" });
    const g1 = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Um" }
    });
    const g2 = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Dois" }
    });

    const dup = await requestJson(worker.url, `/groups/${g2.data.group.id}`, {
      method: "PATCH",
      token,
      body: { name: "Grupo Um" }
    });
    assert.equal(dup.status, 409);

    const selfOk = await requestJson(worker.url, `/groups/${g1.data.group.id}`, {
      method: "PUT",
      token,
      body: { name: "Grupo Um", description: "Atualizado próprio nome" }
    });
    assert.equal(selfOk.status, 200);
  });

  test("T2-F16-03: POST /keywords/:id/scan handles invalid ID (400), missing ID (404), and foreign owner (403)", async () => {
    const userA = await registerUser(worker.url, { name: "F16 Scan A" });
    const userB = await registerUser(worker.url, { name: "F16 Scan B" });
    const kwA = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("F16 ScanOwn") }
    });

    assert.equal(
      (await requestJson(worker.url, "/keywords/abc/scan", { method: "POST", token: userA.token })).status,
      400
    );
    assert.equal(
      (await requestJson(worker.url, "/keywords/999999/scan", { method: "POST", token: userA.token })).status,
      404
    );
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${kwA.data.keyword.id}/scan`, {
          method: "POST",
          token: userB.token
        })
      ).status,
      403
    );
  });

  test("T2-F16-04: Consecutive POST /keywords/:id/scan on unchanged documents is idempotent", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 IdemScan" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "Concurso" }
    });
    assert.equal(kw.status, 201);
    const id = kw.data.keyword.id;

    const first = await requestJson(worker.url, `/keywords/${id}/scan`, {
      method: "POST",
      token
    });
    assert.ok(first.status === 200 || first.status === 201);
    assert.ok(first.data.created_alerts >= 1);

    const second = await requestJson(worker.url, `/keywords/${id}/scan`, {
      method: "POST",
      token
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.created_alerts, 0);
  });

  test("T2-F16-05: /alerts/:id rejects invalid status (400), missing ID (404), and malformed ID (400)", async () => {
    const { token } = await registerUser(worker.url, { name: "F16 BadAlert" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F16 BadAlert") }
    });
    const alert = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "novo" }
    });

    assert.equal(
      (
        await requestJson(worker.url, `/alerts/${alert.data.alert.id}`, {
          method: "PATCH",
          token,
          body: { status: "pendente" }
        })
      ).status,
      400
    );
    assert.equal(
      (await requestJson(worker.url, "/alerts/999999", { method: "DELETE", token })).status,
      404
    );
    assert.equal(
      (await requestJson(worker.url, "/alerts/abc", { method: "DELETE", token })).status,
      400
    );
  });

  // =========================================================================
  // Feature 17: Dual Front-end & Back-end Validation (RF010) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F17-01: Back-end rejects invalid keyword payload with 400 Portuguese { error }", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 KwErr" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "x" }
    });
    assert.equal(res.status, 400);
    assert.ok(typeof res.data?.error === "string" && res.data.error.length > 0);
  });

  test("T1-F17-02: Back-end rejects invalid email and short password with 400 Portuguese { error }", async () => {
    const badEmail = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "Teste", email: "invalido", password: "SenhaForte@2026" }
    });
    assert.equal(badEmail.status, 400);
    assert.ok(typeof badEmail.data?.error === "string" && badEmail.data.error.length > 0);

    const badPass = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "Teste", email: uniqueEmail("f17"), password: "12" }
    });
    assert.equal(badPass.status, 400);
    assert.ok(typeof badPass.data?.error === "string" && badPass.data.error.length > 0);
  });

  test("T1-F17-03: Back-end rejects invalid enums (priority='urgente', status='desconhecido') with 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 Enums" });
    const badPrio = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F17 Prio"), priority: "urgente" }
    });
    assert.equal(badPrio.status, 400);

    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F17 Ok") }
    });
    const badStat = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "desconhecido" }
    });
    assert.equal(badStat.status, 400);
  });

  test("T1-F17-04: Front-end validation attributes (when frontend/ exists) & back-end error contract", async () => {
    const frontendSrc = path.join(REPO_ROOT, "frontend", "src");
    if (fs.existsSync(frontendSrc)) {
      const files = walkFiles(frontendSrc).filter((f) => /\.(js|jsx|ts|tsx)$/.test(f));
      const combined = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
      assert.ok(
        /required/i.test(combined) &&
          /(minLength|minlength)/i.test(combined) &&
          /(maxLength|maxlength)/i.test(combined) &&
          /type\s*=\s*["']email["']/i.test(combined),
        "Expected frontend/src form inputs to declare required, minLength, maxLength, and type='email'"
      );
    }

    const { token } = await registerUser(worker.url, { name: "F17 Dual" });
    const badGrp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "A" }
    });
    assert.equal(badGrp.status, 400);
    assert.ok(typeof badGrp.data?.error === "string" && badGrp.data.error.length > 0);
  });

  test("T1-F17-05: Back-end rejects non-existent group_id or keyword_id FK with 404/400 (never 500)", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 FkRef" });
    const badKw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F17 Fk"), group_id: 888888 }
    });
    assert.ok(badKw.status === 404 || badKw.status === 400);
    assert.notEqual(badKw.data?.error, "Rota não encontrada.");

    const badAlert = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: 888888, status: "novo" }
    });
    assert.ok(badAlert.status === 404 || badAlert.status === 400);
    assert.notEqual(badAlert.data?.error, "Rota não encontrada.");
  });

  test("T2-F17-01: Direct API call bypassing front-end validation with 2-char keyword returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 Bypass" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: "xy" }
    });
    assert.equal(res.status, 400);
  });

  test("T2-F17-02: API error JSON never leaks stack traces or SQLITE_ERROR", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 CleanErr" });
    const res = await requestJson(worker.url, "/keywords/not-an-id", { token });
    assert.equal(res.status, 400);
    assert.ok(typeof res.data?.error === "string" && res.data.error.length > 0);
    assert.ok(!res.text.includes("SQLITE_"));
    assert.ok(!res.text.includes("at async"));
  });

  test("T2-F17-03: XSS payload in description/notes is stored as literal JSON string with application/json", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 XSS" });
    const xss = "<img src=x onerror=alert(1)>";
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F17 XSS"), description: xss }
    });
    assert.equal(kw.status, 201);
    assert.ok(kw.headers.get("content-type")?.includes("application/json"));
    assert.equal(kw.data?.keyword?.description, xss);

    const alert = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "novo", notes: xss }
    });
    assert.equal(alert.status, 201);
    assert.equal(alert.data?.alert?.notes, xss);
  });

  test("T2-F17-04: Invalid non-numeric group_id 'abc' in POST /keywords returns 400", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 BadGrpId" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F17 GrpStr"), group_id: "abc" }
    });
    assert.equal(res.status, 400);
  });

  test("T2-F17-05: Oversized payload (>100KB) or null JSON fields are rejected cleanly (400/413, never 500)", async () => {
    const { token } = await registerUser(worker.url, { name: "F17 Oversize" });
    const huge = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("F17 Huge"), description: "x".repeat(120 * 1024) }
    });
    assert.ok(huge.status === 400 || huge.status === 413, `Expected 400/413, got ${huge.status}`);

    const nullBody = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: "null"
    });
    assert.equal(nullBody.status, 400);
  });
});
