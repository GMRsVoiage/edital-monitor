import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import {
  ApiError,
  TOKEN_STORAGE_KEY,
  buildQueryString,
  cleanQuery,
  clearToken,
  createAlert,
  createGroup,
  createKeyword,
  deleteAlert,
  deleteGroup,
  deleteKeyword,
  fetchAlerts,
  fetchCurrentUser,
  fetchGroups,
  fetchKeywords,
  fetchReports,
  fetchStats,
  getApiBaseUrl,
  getToken,
  loginUser,
  logoutUser,
  patchKeyword,
  registerUser,
  request,
  scanKeyword,
  searchBulletins,
  setToken,
  updateAlert,
  updateCurrentUser,
  updateGroup,
  updateKeyword
} from "../src/lib/api.js";
import {
  formatDatePtBr,
  isHttpUrl,
  parseSafeExcerpt,
  validateAlertInput,
  validateGroupInput,
  validateKeywordInput,
  validateLoginInput,
  validateProfileInput,
  validateRegisterInput,
  validateSearchQuery
} from "../src/lib/validation.js";

describe("validation.js — cleanQuery, RF010 boundaries, XSS & URL safety", () => {
  it("normalizes NFKC and collapses whitespace in cleanQuery", () => {
    assert.equal(cleanQuery("  ｊｏãｏ   ｓｉｌｖａ  "), "joão silva");
    assert.equal(cleanQuery("\t\n pregão \r\n eletrônico "), "pregão eletrônico");
    assert.equal(cleanQuery(null), "");
    assert.equal(cleanQuery(123), "");
  });

  it("enforces 3..100 character boundaries and token check in validateSearchQuery", () => {
    assert.equal(validateSearchQuery("ab").valid, false);
    assert.equal(validateSearchQuery("  ab  ").valid, false);
    assert.equal(validateSearchQuery("...").valid, false);

    const minOk = validateSearchQuery("abc");
    assert.equal(minOk.valid, true);
    assert.equal(minOk.value, "abc");

    const maxOk = validateSearchQuery("a".repeat(100));
    assert.equal(maxOk.valid, true);

    const tooLong = validateSearchQuery("a".repeat(101));
    assert.equal(tooLong.valid, false);
  });

  it("validates saved keyword boundaries and enums (RF010)", () => {
    assert.equal(validateKeywordInput({ keyword: "ab" }).valid, false);
    assert.equal(validateKeywordInput({ keyword: "a".repeat(101) }).valid, false);
    assert.equal(validateKeywordInput({ keyword: "pregão", priority: "urgente" }).valid, false);
    assert.equal(
      validateKeywordInput({ keyword: "pregão", description: "x".repeat(501) }).valid,
      false
    );
    assert.equal(validateKeywordInput({ keyword: "pregão", group_id: "0" }).valid, false);

    const valid = validateKeywordInput({
      keyword: "  Pregão   Eletrônico ",
      priority: "alta",
      group_id: "2",
      target_section: "licitacoes",
      description: "Monitorar editais",
      is_active: true
    });
    assert.equal(valid.valid, true);
    assert.deepEqual(valid.value, {
      keyword: "Pregão Eletrônico",
      priority: "alta",
      group_id: 2,
      target_section: "licitacoes",
      description: "Monitorar editais",
      is_active: 1
    });
  });

  it("validates register, login, profile, group, and alert inputs", () => {
    assert.equal(
      validateRegisterInput({ name: "A", email: "a@b.com", password: "secret" }).valid,
      false
    );
    assert.equal(
      validateRegisterInput({ name: "x".repeat(81), email: "a@b.com", password: "secret" }).valid,
      false
    );
    assert.equal(
      validateRegisterInput({ name: "Ana", email: "invalid", password: "secret" }).valid,
      false
    );
    assert.equal(
      validateRegisterInput({ name: "Ana", email: "ana@ex.com", password: "123" }).valid,
      false
    );
    assert.equal(
      validateRegisterInput({ name: "Ana", email: "ana@ex.com", password: "      " }).valid,
      false
    );
    assert.equal(
      validateRegisterInput({ name: "Ana", email: "ANA@EX.COM", password: "secret" }).value.email,
      "ana@ex.com"
    );
    assert.equal(
      validateRegisterInput({
        name: "Ana",
        email: "  ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ  ",
        password: "secret"
      }).value.email,
      "ana@example.com"
    );

    assert.equal(validateLoginInput({ email: "ana@ex.com", password: "" }).valid, false);
    assert.equal(validateLoginInput({ email: "ana@ex.com", password: "x" }).valid, true);
    assert.equal(
      validateLoginInput({ email: "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ", password: "x" }).value.email,
      "ana@example.com"
    );

    assert.equal(validateProfileInput({}).valid, false);
    assert.equal(validateProfileInput({ password: "newpassword" }).valid, false);
    assert.equal(
      validateProfileInput({ password: "newpassword", current_password: "   " }).valid,
      false
    );
    assert.equal(
      validateProfileInput({ email: "ａｎａ＠ｅｘａｍｐｌｅ．ｃｏｍ" }).value.email,
      "ana@example.com"
    );
    assert.equal(
      validateProfileInput({ current_password: "old", password: "newpassword" }).valid,
      true
    );

    assert.equal(validateKeywordInput({ keyword: "pregão", is_active: "false" }).value.is_active, 0);

    assert.equal(validateGroupInput({ name: "A", color: "#0b7aa8" }).valid, false);
    assert.equal(validateGroupInput({ name: "Compras", color: "red" }).valid, false);
    assert.equal(validateGroupInput({ name: "Compras", color: "#0b7aa8" }).valid, true);

    assert.equal(
      validateAlertInput({ keyword_id: 1, status: "invalido" }, { requireKeywordId: true }).valid,
      false
    );
    assert.equal(
      validateAlertInput({ keyword_id: 1, status: "revisado", notes: "ok" }, { requireKeywordId: true })
        .valid,
      true
    );
  });

  it("strips XSS vectors in parseSafeExcerpt while keeping <mark> segments", () => {
    const safe = parseSafeExcerpt("Edital <mark>2026</mark> publicado.");
    assert.deepEqual(safe, [
      { text: "Edital ", mark: false },
      { text: "2026", mark: true },
      { text: " publicado.", mark: false }
    ]);

    const hostile = parseSafeExcerpt(
      '<script>alert(1)</script>Texto <mark><img src=x onerror=alert(1)>Licitação</mark><svg onload=alert(1)> fim'
    );
    const serialized = JSON.stringify(hostile);
    assert.equal(serialized.includes("<script"), false);
    assert.equal(serialized.includes("<img"), false);
    assert.equal(serialized.includes("onerror"), false);
    assert.equal(serialized.includes("<svg"), false);
    assert.deepEqual(hostile, [
      { text: "Texto ", mark: false },
      { text: "Licitação", mark: true },
      { text: " fim", mark: false }
    ]);

    assert.deepEqual(parseSafeExcerpt("<mark>a <mark>b</mark> c</mark>"), [
      { text: "a b c", mark: true }
    ]);
    assert.deepEqual(parseSafeExcerpt("antes <mark>meio"), [
      { text: "antes meio", mark: false }
    ]);
  });

  it("enforces HTTP/HTTPS in isHttpUrl and formats pt-BR dates", () => {
    assert.equal(isHttpUrl("https://telemacoborba.pr.gov.br/boletim.pdf"), true);
    assert.equal(isHttpUrl("http://127.0.0.1:8787/doc.pdf"), true);
    assert.equal(isHttpUrl("javascript:alert(1)"), false);
    assert.equal(isHttpUrl("data:text/html,<script>alert(1)</script>"), false);
    assert.equal(isHttpUrl(""), false);

    assert.equal(formatDatePtBr("2026-11-23"), "23/11/2026");
    assert.equal(formatDatePtBr(""), "Data não identificada");
  });
});

describe("api.js — REST client contract against mock HTTP server", () => {
  let server;
  let originalApiUrl;
  const requests = [];

  before(async () => {
    originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
    server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let jsonBody = null;
        if (rawBody) {
          try {
            jsonBody = JSON.parse(rawBody);
          } catch {
            jsonBody = rawBody;
          }
        }
        requests.push({
          method: req.method,
          pathname: url.pathname,
          search: url.search,
          auth: req.headers.authorization || null,
          contentType: req.headers["content-type"] || null,
          body: jsonBody
        });

        const send = (status, payload, extraHeaders = {}) => {
          res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            ...extraHeaders
          });
          res.end(JSON.stringify(payload));
        };

        if (req.method === "GET" && url.pathname === "/stats") {
          return send(200, { documents: 10, pages: 120, latest: { edition: "2400", published_at: "2026-11-20" } });
        }
        if (req.method === "GET" && url.pathname === "/search") {
          if (url.searchParams.get("q") === "rate-limit") {
            return send(
              429,
              { error: "Limite diário de pesquisas atingido.", usage: { allowed: false, used: 30, limit: 30, remaining: 0 } },
              { "retry-after": "3600" }
            );
          }
          return send(200, { query: url.searchParams.get("q"), total: 1, results: [], usage: { remaining: 29, limit: 30 } });
        }
        if (req.method === "POST" && url.pathname === "/auth/register") {
          if (jsonBody?.email === "dup@ex.com") return send(409, { error: "E-mail já cadastrado." });
          return send(201, { user: { id: 1, name: jsonBody.name, email: jsonBody.email }, token: "tok-reg" });
        }
        if (req.method === "POST" && url.pathname === "/auth/login") {
          if (jsonBody?.password === "wrong") return send(401, { error: "Credenciais inválidas." });
          return send(200, { user: { id: 1, name: "Ana", email: jsonBody.email }, token: "tok-login" });
        }
        if (url.pathname === "/users/me") {
          if (!req.headers.authorization) return send(401, { error: "Não autorizado." });
          if (req.method === "GET") return send(200, { user: { id: 1, name: "Ana" } });
          if (req.method === "PUT" || req.method === "PATCH") {
            return send(200, { user: { id: 1, name: jsonBody?.name || "Ana" } });
          }
        }
        if (url.pathname === "/groups") {
          if (req.method === "GET") return send(200, { total: 1, groups: [{ id: 1, name: "Editais" }] });
          if (req.method === "POST") return send(201, { group: { id: 2, ...jsonBody } });
        }
        if (url.pathname === "/groups/1") {
          if (req.method === "PUT") return send(200, { group: { id: 1, ...jsonBody } });
          if (req.method === "DELETE") return send(409, { error: "Grupo possui palavras-chave vinculadas." });
        }
        if (url.pathname === "/keywords") {
          if (req.method === "GET") return send(200, { total: 1, keywords: [{ id: 5, keyword: "pregão" }] });
          if (req.method === "POST") return send(201, { keyword: { id: 6, ...jsonBody } });
        }
        if (url.pathname === "/keywords/6") {
          if (req.method === "PUT") return send(200, { keyword: { id: 6, ...jsonBody } });
          if (req.method === "PATCH") return send(200, { keyword: { id: 6, ...jsonBody } });
          if (req.method === "DELETE") return send(200, { ok: true, deleted_id: 6 });
        }
        if (req.method === "POST" && url.pathname === "/keywords/6/scan") {
          return send(201, { keyword_id: 6, matched_documents: 2, created_alerts: 1, alerts: [] });
        }
        if (url.pathname === "/alerts") {
          if (req.method === "GET") return send(200, { total: 1, alerts: [{ id: 9, status: "novo" }] });
          if (req.method === "POST") return send(201, { alert: { id: 10, ...jsonBody } });
        }
        if (url.pathname === "/alerts/10") {
          if (req.method === "PATCH") return send(200, { alert: { id: 10, ...jsonBody } });
          if (req.method === "DELETE") return send(200, { ok: true, deleted_id: 10 });
        }
        if (req.method === "GET" && url.pathname === "/reports") {
          return send(200, { summary: { total_keywords: 1 }, by_group: [], by_priority: [], keywords: [], alerts: [] });
        }
        if (url.pathname === "/forbidden") {
          return send(403, { error: "Sem permissão." });
        }
        if (url.pathname === "/bad") {
          return send(400, { error: "Requisição inválida." });
        }
        return send(404, { error: "Rota não encontrada." });
      });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${port}/`;
  });

  after(async () => {
    if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
    await new Promise((resolve) => server.close(resolve));
  });

  it("works in SSR/Node without window and strips trailing slashes", () => {
    assert.equal(getToken(), null);
    assert.equal(getApiBaseUrl().endsWith("/"), false);
  });

  it("manages token storage when window.localStorage is present", () => {
    const store = new Map();
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");
    const prevWindow = globalThis.window;

    globalThis.window = {
      localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, val) => store.set(key, String(val)),
        removeItem: (key) => store.delete(key)
      }
    };

    try {
      assert.equal(getToken(), null);
      setToken("jwt-123");
      assert.equal(store.get(TOKEN_STORAGE_KEY), "jwt-123");
      assert.equal(getToken(), "jwt-123");

      clearToken();
      assert.equal(getToken(), null);

      setToken("jwt-456");
      assert.equal(getToken(), "jwt-456");
      logoutUser();
      assert.equal(getToken(), null);
    } finally {
      if (hadWindow) {
        globalThis.window = prevWindow;
      } else {
        delete globalThis.window;
      }
    }
  });

  it("builds query strings skipping empty values and handling active flags", () => {
    assert.equal(
      buildQueryString({ q: " pregão ", group_id: "", active: true, priority: null }),
      "?q=preg%C3%A3o&active=1"
    );
    assert.equal(buildQueryString({ active: false }), "?active=0");
    assert.equal(buildQueryString({ active: "all", q: "   " }), "");
  });

  it("executes GET, POST, PUT, PATCH, DELETE across all exported REST endpoints", async () => {
    const stats = await fetchStats();
    assert.equal(stats.documents, 10);

    const search = await searchBulletins("  ｐｒｅｇãｏ  ");
    assert.equal(search.query, "pregão");

    const reg = await registerUser({ name: "Ana", email: "ANA@EX.COM", password: "secret" });
    assert.equal(reg.token, "tok-reg");

    const login = await loginUser({ email: "ana@ex.com", password: "secret" });
    assert.equal(login.token, "tok-login");

    const me = await fetchCurrentUser("tok-login");
    assert.equal(me.user.name, "Ana");

    const mePut = await updateCurrentUser({ name: "Ana Silva" }, { token: "tok-login", method: "PUT" });
    assert.equal(mePut.user.name, "Ana Silva");

    const groups = await fetchGroups({ q: "Ed" }, { token: "tok-login" });
    assert.equal(groups.total, 1);

    const createdGrp = await createGroup({ name: "Saúde" }, { token: "tok-login" });
    assert.equal(createdGrp.group.id, 2);

    const updatedGrp = await updateGroup(1, { name: "Editais TB" }, { token: "tok-login" });
    assert.equal(updatedGrp.group.name, "Editais TB");

    const kwList = await fetchKeywords({ active: true, priority: "alta" }, { token: "tok-login" });
    assert.equal(kwList.total, 1);

    const createdKw = await createKeyword(
      { keyword: "  Pregão  ", priority: "alta", group_id: "" },
      { token: "tok-login" }
    );
    assert.equal(createdKw.keyword.id, 6);

    await updateKeyword(
      6,
      { keyword: "Pregão 2026", priority: "media", group_id: "", is_active: "false" },
      { token: "tok-login" }
    );
    const putKwReq = requests.findLast((r) => r.method === "PUT" && r.pathname === "/keywords/6");
    assert.equal(putKwReq?.body?.group_id, null);
    assert.equal(putKwReq?.body?.is_active, 0);

    await patchKeyword(6, { is_active: false }, { token: "tok-login" });
    const scanRes = await scanKeyword(6, { token: "tok-login" });
    assert.equal(scanRes.created_alerts, 1);
    const delKw = await deleteKeyword(6, { token: "tok-login" });
    assert.equal(delKw.ok, true);

    await fetchAlerts({ status: "novo" }, { token: "tok-login" });
    await createAlert({ keyword_id: 6, status: "novo" }, { token: "tok-login" });
    await updateAlert(10, { status: "revisado", notes: "Verificado" }, { token: "tok-login" });
    await deleteAlert(10, { token: "tok-login" });

    const rep = await fetchReports({ priority: "alta", active: 1 }, { token: "tok-login" });
    assert.equal(rep.summary.total_keywords, 1);

    const methodsSeen = new Set(requests.map((r) => r.method));
    for (const verb of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      assert.ok(methodsSeen.has(verb), `Expected HTTP ${verb} call`);
    }
    const lastAuth = requests.find((r) => r.pathname === "/reports")?.auth;
    assert.equal(lastAuth, "Bearer tok-login");
  });

  it("surfaces ApiError with HTTP status and details for 400/401/403/404/409/429", async () => {
    await assert.rejects(
      () => request("/bad"),
      (err) => err instanceof ApiError && err.status === 400 && err.message === "Requisição inválida."
    );
    await assert.rejects(
      () => request("/forbidden"),
      (err) => err instanceof ApiError && err.status === 403 && err.message === "Sem permissão."
    );
    await assert.rejects(
      () => fetchCurrentUser(),
      (err) => err instanceof ApiError && err.status === 401
    );
    await assert.rejects(
      () => loginUser({ email: "ana@ex.com", password: "wrong" }),
      (err) => err instanceof ApiError && err.status === 401 && err.message === "Credenciais inválidas."
    );
    await assert.rejects(
      () => deleteGroup(1, { token: "tok-login" }),
      (err) => err instanceof ApiError && err.status === 409 && err.message.includes("vinculadas")
    );
    await assert.rejects(
      () => searchBulletins("rate-limit"),
      (err) =>
        err instanceof ApiError &&
        err.status === 429 &&
        err.details?.usage?.remaining === 0 &&
        err.details?.retryAfter === "3600"
    );
    await assert.rejects(
      () => deleteKeyword(999, { token: "tok-login" }),
      (err) => err instanceof ApiError && err.status === 404
    );
  });
});
