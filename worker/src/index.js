const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

function cors(env) {
  return {
    "access-control-allow-origin": env.ALLOWED_ORIGIN || "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization"
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers }
  });
}

function cleanQuery(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim()
    : "";
}

function ftsExpression(query) {
  const tokens = query.match(/[\p{L}\p{N}_-]+/gu) || [];
  const useful = tokens.filter((t) => t.length >= 2).slice(0, 12);
  if (!useful.length) return null;
  return useful.map((t) => '"' + t.replaceAll('"', '""') + '"').join(" AND ");
}

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function authorized(request, env) {
  const expected = env.INGEST_TOKEN || "";
  const raw = request.headers.get("authorization") || "";
  const supplied = raw.startsWith("Bearer ") ? raw.slice(7) : "";
  if (!expected || !supplied) return false;
  const [a, b] = await Promise.all([sha256Hex(expected), sha256Hex(supplied)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function dailyLimit(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const salt = env.RATE_LIMIT_SALT || "development-only";
  const hash = await sha256Hex(ip + "|" + day + "|" + salt);
  const limit = Math.max(1, parseInt(env.DAILY_SEARCH_LIMIT || "30", 10));

  await env.DB.prepare(
    `INSERT INTO visitor_daily (visitor_hash, day, searches, updated_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(visitor_hash, day)
     DO UPDATE SET searches = searches + 1, updated_at = CURRENT_TIMESTAMP`
  ).bind(hash, day).run();

  const row = await env.DB.prepare(
    "SELECT searches FROM visitor_daily WHERE visitor_hash = ? AND day = ?"
  ).bind(hash, day).first();

  const used = row?.searches || 0;
  return { allowed: used <= limit, used, limit, remaining: Math.max(0, limit - used) };
}

async function search(request, env) {
  const q = cleanQuery(new URL(request.url).searchParams.get("q") || "");
  if (q.length < 3 || q.length > 100) {
    return json({ error: "A pesquisa deve ter entre 3 e 100 caracteres." }, 400, cors(env));
  }

  const expression = ftsExpression(q);
  if (!expression) return json({ error: "Termo inválido." }, 400, cors(env));

  const usage = await dailyLimit(request, env);
  if (!usage.allowed) {
    return json(
      { error: "Limite diário de pesquisas atingido.", usage },
      429,
      { ...cors(env), "retry-after": "3600" }
    );
  }

  try {
    const result = await env.DB.prepare(
      `SELECT d.edition, d.title, d.published_at, d.pdf_url,
              d.source_page_url, p.page_number,
              snippet(pages_fts, 0, '<mark>', '</mark>', '…', 28) AS excerpt
       FROM pages_fts
       JOIN pages p ON p.id = pages_fts.rowid
       JOIN documents d ON d.id = p.document_id
       WHERE pages_fts MATCH ?
       ORDER BY d.published_at DESC, p.page_number ASC
       LIMIT 50`
    ).bind(expression).all();

    return json(
      { query: q, total: result.results?.length || 0, results: result.results || [], usage },
      200,
      { ...cors(env), "cache-control": "no-store" }
    );
  } catch {
    return json({ error: "Não foi possível realizar a pesquisa." }, 500, cors(env));
  }
}

async function stats(env) {
  const [docs, pages, latest] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM documents").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM pages").first(),
    env.DB.prepare(
      "SELECT edition, title, published_at, source_page_url FROM documents ORDER BY published_at DESC, id DESC LIMIT 1"
    ).first()
  ]);
  return { documents: docs?.total || 0, pages: pages?.total || 0, latest: latest || null };
}

async function known(request, env) {
  if (!(await authorized(request, env))) return json({ error: "Não autorizado." }, 401);
  const source = new URL(request.url).searchParams.get("source_page_url");
  if (!source || source.length > 2000) return json({ error: "source_page_url inválida." }, 400);
  const row = await env.DB.prepare(
    "SELECT id, sha256, updated_at FROM documents WHERE source_page_url = ?"
  ).bind(source).first();
  return json({ exists: !!row, document: row || null });
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function ingest(request, env) {
  if (!(await authorized(request, env))) return json({ error: "Não autorizado." }, 401);
  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return json({ error: "Content-Type deve ser application/json." }, 415);
  }

  let p;
  try { p = await request.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  const pages = Array.isArray(p?.pages) ? p.pages : [];
  const methods = new Set(["native", "needs_ocr", "ocr", "vision_ai"]);

  if (!isHttpUrl(p?.source_page_url) || !isHttpUrl(p?.pdf_url) ||
      typeof p?.title !== "string" || p.title.length < 1 || p.title.length > 1000 ||
      pages.length > 1000 || !methods.has(p?.extraction_method || "native")) {
    return json({ error: "Payload inválido." }, 400);
  }

  for (const page of pages) {
    if (!Number.isInteger(page.page_number) || page.page_number < 1 ||
        typeof page.text !== "string" || page.text.length > 250000) {
      return json({ error: "Página inválida." }, 400);
    }
  }

  await env.DB.prepare(
    `INSERT INTO documents (
       source_id, source_page_url, pdf_url, edition, title, published_at,
       sha256, page_count, extraction_method, updated_at
     ) VALUES (
       (SELECT id FROM sources WHERE listing_url = ? LIMIT 1),
       ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
     )
     ON CONFLICT(source_page_url) DO UPDATE SET
       pdf_url = excluded.pdf_url,
       edition = excluded.edition,
       title = excluded.title,
       published_at = excluded.published_at,
       sha256 = excluded.sha256,
       page_count = excluded.page_count,
       extraction_method = excluded.extraction_method,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(
    "https://telemacoborba.pr.gov.br/index.php/informacoes/boletim-oficial",
    p.source_page_url, p.pdf_url, p.edition || null, p.title,
    p.published_at || null, p.sha256 || null, pages.length,
    p.extraction_method || "native"
  ).run();

  const doc = await env.DB.prepare(
    "SELECT id FROM documents WHERE source_page_url = ?"
  ).bind(p.source_page_url).first();

  if (!doc?.id) return json({ error: "Falha após ingestão." }, 500);

  const statements = [
    env.DB.prepare("DELETE FROM pages WHERE document_id = ?").bind(doc.id),
    ...pages.map((page) =>
      env.DB.prepare(
        "INSERT INTO pages (document_id, page_number, text) VALUES (?, ?, ?)"
      ).bind(doc.id, page.page_number, page.text)
    )
  ];
  await env.DB.batch(statements);

  await env.DB.prepare(
    "INSERT INTO ingest_log (source_page_url, status, detail) VALUES (?, 'success', ?)"
  ).bind(p.source_page_url, pages.length + " páginas").run();

  return json({ ok: true, document_id: doc.id, pages: pages.length }, 201);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });

    if (request.method === "GET" && path === "/") {
      return json({ name: "Edital Monitor API", version: "0.1.0" }, 200, cors(env));
    }
    if (request.method === "GET" && path === "/health") return json({ ok: true }, 200, cors(env));
    if (request.method === "GET" && path === "/stats") return json(await stats(env), 200, cors(env));
    if (request.method === "GET" && path === "/search") return search(request, env);
    if (request.method === "GET" && path === "/admin/known") return known(request, env);
    if (request.method === "POST" && path === "/admin/ingest") return ingest(request, env);

    return json({ error: "Rota não encontrada." }, 404, cors(env));
  }
};
