import {
  cleanQuery,
  ftsExpression,
  json,
  parsePositiveId,
  readJsonObject,
  requireAuth
} from "./index.js";

const MAX_JSON_BYTES = 100 * 1024;
const PRIORITIES = new Set(["alta", "media", "baixa"]);
const ALERT_STATUSES = new Set(["novo", "revisado", "arquivado"]);
const REPORT_TYPES = new Set([
  "all",
  "summary",
  "by_group",
  "by_priority",
  "keywords",
  "alerts"
]);
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const KEYWORD_SORT_SQL = {
  recent: "k.updated_at DESC, k.id DESC",
  updated_desc: "k.updated_at DESC, k.id DESC",
  created_desc: "k.created_at DESC, k.id DESC",
  created_asc: "k.created_at ASC, k.id ASC",
  keyword: "LOWER(k.keyword) ASC, k.id ASC",
  keyword_asc: "LOWER(k.keyword) ASC, k.id ASC",
  keyword_desc: "LOWER(k.keyword) DESC, k.id DESC",
  priority:
    "CASE k.priority WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END ASC, k.updated_at DESC, k.id DESC",
  priority_desc:
    "CASE k.priority WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END ASC, k.updated_at DESC, k.id DESC"
};

const GROUP_SELECT_SQL = `
  SELECT g.id, g.user_id, g.name, g.description, g.color, g.created_at, g.updated_at,
         COUNT(k.id) AS keyword_count
  FROM keyword_groups g
  LEFT JOIN saved_keywords k ON k.group_id = g.id AND k.user_id = g.user_id
`;

const KEYWORD_SELECT_SQL = `
  SELECT k.id, k.user_id, k.group_id, k.keyword, k.description, k.priority,
         k.target_section, k.is_active, k.last_searched_at, k.created_at, k.updated_at,
         g.name AS group_name, g.color AS group_color,
         COUNT(a.id) AS alert_count
  FROM saved_keywords k
  LEFT JOIN keyword_groups g ON g.id = k.group_id
  LEFT JOIN keyword_alerts a ON a.keyword_id = k.id
`;

const ALERT_SELECT_SQL = `
  SELECT a.id, a.user_id, a.keyword_id, a.document_id, a.status,
         a.matched_excerpt, a.notes, a.created_at, a.updated_at,
         k.keyword AS keyword, k.priority AS keyword_priority,
         d.edition AS document_edition, d.title AS document_title,
         d.published_at AS document_published_at, d.pdf_url AS pdf_url,
         d.source_page_url AS document_source_page_url
  FROM keyword_alerts a
  JOIN saved_keywords k ON k.id = a.keyword_id
  LEFT JOIN documents d ON d.id = a.document_id
`;

function foldText(value) {
  return cleanQuery(value).toLocaleLowerCase("pt-BR");
}

function attachCorsHeaders(response, corsHeaders = {}) {
  const entries = Object.entries(corsHeaders || {});
  if (entries.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [key, value] of entries) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function isConstraintError(err) {
  const message = String(err?.message || "").toLowerCase();
  return (
    message.includes("unique") ||
    message.includes("constraint") ||
    message.includes("foreign key")
  );
}

function isForeignKeyError(err) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("foreign key");
}

function isValidDateYmd(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function parseActiveFilter(raw) {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, value: null };
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return { ok: true, value: 1 };
  }
  if (normalized === "0" || normalized === "false") {
    return { ok: true, value: 0 };
  }
  return { ok: false, value: null };
}

function parseActiveBody(raw) {
  if (raw === 1 || raw === true || raw === "1") return 1;
  if (raw === 0 || raw === false || raw === "0") return 0;
  return null;
}

function decodeSegment(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

async function readBoundedJsonObject(request, corsHeaders = {}) {
  const contentType = request.headers.get("content-type") || "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    const result = await readJsonObject(request);
    if (!result.ok) {
      return {
        ok: false,
        response: attachCorsHeaders(result.response, corsHeaders)
      };
    }
    return result;
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) {
      return {
        ok: false,
        response: json(
          { error: "O corpo da requisição excede o limite de 100 KB." },
          413,
          corsHeaders
        )
      };
    }
  }

  if (typeof request.clone === "function") {
    try {
      const clonedText = await request.clone().text();
      if (new TextEncoder().encode(clonedText).byteLength > MAX_JSON_BYTES) {
        return {
          ok: false,
          response: json(
            { error: "O corpo da requisição excede o limite de 100 KB." },
            413,
            corsHeaders
          )
        };
      }
    } catch {
      return {
        ok: false,
        response: json({ error: "JSON inválido." }, 400, corsHeaders)
      };
    }
  }

  const result = await readJsonObject(request);
  if (!result.ok) {
    return {
      ok: false,
      response: attachCorsHeaders(result.response, corsHeaders)
    };
  }
  return result;
}

function methodNotAllowed(allowedMethods, corsHeaders = {}) {
  return json(
    { error: "Método não permitido." },
    405,
    { ...corsHeaders, allow: allowedMethods.join(", ") }
  );
}

async function fetchGroupById(db, id) {
  return db
    .prepare(`${GROUP_SELECT_SQL} WHERE g.id = ? GROUP BY g.id LIMIT 1`)
    .bind(id)
    .first();
}

async function fetchKeywordById(db, id) {
  return db
    .prepare(`${KEYWORD_SELECT_SQL} WHERE k.id = ? GROUP BY k.id LIMIT 1`)
    .bind(id)
    .first();
}

async function fetchAlertById(db, id) {
  return db
    .prepare(`${ALERT_SELECT_SQL} WHERE a.id = ? LIMIT 1`)
    .bind(id)
    .first();
}

async function validateOwnedGroupReference(db, rawGroupId, userId, corsHeaders = {}) {
  if (rawGroupId === undefined || rawGroupId === null || rawGroupId === "") {
    return { ok: true, groupId: null };
  }
  const groupId = parsePositiveId(rawGroupId);
  if (!groupId) {
    return {
      ok: false,
      response: json({ error: "group_id inválido." }, 400, corsHeaders)
    };
  }
  const groupRow = await db
    .prepare("SELECT id, user_id FROM keyword_groups WHERE id = ? LIMIT 1")
    .bind(groupId)
    .first();
  if (!groupRow) {
    return {
      ok: false,
      response: json({ error: "Grupo não encontrado." }, 404, corsHeaders)
    };
  }
  if (groupRow.user_id !== userId) {
    return {
      ok: false,
      response: json(
        { error: "Você não tem permissão para vincular este grupo." },
        403,
        corsHeaders
      )
    };
  }
  return { ok: true, groupId };
}

async function validateOwnedKeywordReference(db, rawKeywordId, userId, corsHeaders = {}) {
  const keywordId = parsePositiveId(rawKeywordId);
  if (!keywordId) {
    return {
      ok: false,
      response: json({ error: "keyword_id inválido." }, 400, corsHeaders)
    };
  }
  const keywordRow = await db
    .prepare("SELECT id, user_id FROM saved_keywords WHERE id = ? LIMIT 1")
    .bind(keywordId)
    .first();
  if (!keywordRow) {
    return {
      ok: false,
      response: json({ error: "Palavra-chave não encontrada." }, 404, corsHeaders)
    };
  }
  if (keywordRow.user_id !== userId) {
    return {
      ok: false,
      response: json(
        { error: "Você não tem permissão para acessar esta palavra-chave." },
        403,
        corsHeaders
      )
    };
  }
  return { ok: true, keywordId };
}

async function validateDocumentReference(db, rawDocumentId, corsHeaders = {}) {
  if (rawDocumentId === undefined || rawDocumentId === null || rawDocumentId === "") {
    return { ok: true, documentId: null };
  }
  const documentId = parsePositiveId(rawDocumentId);
  if (!documentId) {
    return {
      ok: false,
      response: json({ error: "document_id inválido." }, 400, corsHeaders)
    };
  }
  const docRow = await db
    .prepare("SELECT id FROM documents WHERE id = ? LIMIT 1")
    .bind(documentId)
    .first();
  if (!docRow) {
    return {
      ok: false,
      response: json({ error: "Documento não encontrado." }, 404, corsHeaders)
    };
  }
  return { ok: true, documentId };
}

export async function handleGroupsCollection(request, env, authUser, corsHeaders = {}) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const q = cleanQuery(url.searchParams.get("q") || "");

    const sql = `
      ${GROUP_SELECT_SQL}
      WHERE g.user_id = ?
      GROUP BY g.id
      ORDER BY LOWER(g.name) ASC, g.id ASC
    `;
    const result = await env.DB.prepare(sql).bind(authUser.id).all();
    let groups = result.results || [];
    if (q) {
      const foldedQ = foldText(q);
      groups = groups.filter(
        (row) =>
          foldText(row.name).includes(foldedQ) ||
          foldText(row.description).includes(foldedQ)
      );
    }
    return json({ total: groups.length, groups }, 200, corsHeaders);
  }

  if (request.method === "POST") {
    const parsed = await readBoundedJsonObject(request, corsHeaders);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    if (typeof body.name !== "string") {
      return json(
        { error: "O nome do grupo deve ter entre 2 e 80 caracteres." },
        400,
        corsHeaders
      );
    }
    const name = cleanQuery(body.name);
    if (name.length < 2 || name.length > 80) {
      return json(
        { error: "O nome do grupo deve ter entre 2 e 80 caracteres." },
        400,
        corsHeaders
      );
    }

    let description = "";
    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== "string") {
        return json(
          { error: "A descrição do grupo deve ser um texto válido." },
          400,
          corsHeaders
        );
      }
      description = body.description.trim();
      if (description.length > 500) {
        return json(
          { error: "A descrição do grupo deve ter no máximo 500 caracteres." },
          400,
          corsHeaders
        );
      }
    }

    let color = "#0b7aa8";
    if (body.color !== undefined && body.color !== null && body.color !== "") {
      if (typeof body.color !== "string") {
        return json(
          { error: "A cor do grupo deve estar no formato hexadecimal (#RRGGBB)." },
          400,
          corsHeaders
        );
      }
      const trimmedColor = body.color.trim();
      if (!HEX_COLOR_RE.test(trimmedColor)) {
        return json(
          { error: "A cor do grupo deve estar no formato hexadecimal (#RRGGBB)." },
          400,
          corsHeaders
        );
      }
      color = trimmedColor;
    }

    const foldedName = foldText(name);
    const existingGroups = await env.DB.prepare(
      "SELECT id, name FROM keyword_groups WHERE user_id = ?"
    )
      .bind(authUser.id)
      .all();
    const dup = (existingGroups.results || []).find(
      (row) => foldText(row.name) === foldedName
    );
    if (dup) {
      return json({ error: "Já existe um grupo com este nome." }, 409, corsHeaders);
    }

    let insertResult;
    try {
      insertResult = await env.DB.prepare(
        "INSERT INTO keyword_groups (user_id, name, description, color) VALUES (?, ?, ?, ?)"
      )
        .bind(authUser.id, name, description, color)
        .run();
    } catch (err) {
      if (isConstraintError(err)) {
        return json({ error: "Já existe um grupo com este nome." }, 409, corsHeaders);
      }
      throw err;
    }

    const insertedId = insertResult?.meta?.last_row_id;
    const group = insertedId
      ? await fetchGroupById(env.DB, insertedId)
      : await env.DB.prepare(
          `${GROUP_SELECT_SQL} WHERE g.user_id = ? AND g.name = ? GROUP BY g.id LIMIT 1`
        )
          .bind(authUser.id, name)
          .first();

    return json({ group }, 201, corsHeaders);
  }

  return methodNotAllowed(["GET", "POST"], corsHeaders);
}

export async function handleGroupItem(request, env, idRaw, authUser, corsHeaders = {}) {
  const id = parsePositiveId(idRaw);
  if (!id) {
    return json({ error: "ID de grupo inválido." }, 400, corsHeaders);
  }

  const existing = await fetchGroupById(env.DB, id);
  if (!existing) {
    return json({ error: "Grupo não encontrado." }, 404, corsHeaders);
  }
  if (existing.user_id !== authUser.id) {
    return json(
      { error: "Você não tem permissão para acessar este grupo." },
      403,
      corsHeaders
    );
  }

  if (request.method === "GET") {
    return json({ group: existing }, 200, corsHeaders);
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const parsed = await readBoundedJsonObject(request, corsHeaders);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    const isPut = request.method === "PUT";
    const hasName = body.name !== undefined;
    const hasDescription = body.description !== undefined;
    const hasColor = body.color !== undefined;

    if (isPut && !hasName) {
      return json(
        { error: "O nome do grupo é obrigatório." },
        400,
        corsHeaders
      );
    }

    if (!isPut && !hasName && !hasDescription && !hasColor) {
      return json(
        { error: "Informe ao menos um campo para atualizar o grupo." },
        400,
        corsHeaders
      );
    }

    let nextName = existing.name;
    if (hasName) {
      if (typeof body.name !== "string") {
        return json(
          { error: "O nome do grupo deve ter entre 2 e 80 caracteres." },
          400,
          corsHeaders
        );
      }
      const cleaned = cleanQuery(body.name);
      if (cleaned.length < 2 || cleaned.length > 80) {
        return json(
          { error: "O nome do grupo deve ter entre 2 e 80 caracteres." },
          400,
          corsHeaders
        );
      }
      nextName = cleaned;
    }

    let nextDescription = existing.description;
    if (hasDescription) {
      if (body.description === null) {
        nextDescription = "";
      } else if (typeof body.description !== "string") {
        return json(
          { error: "A descrição do grupo deve ser um texto válido." },
          400,
          corsHeaders
        );
      } else {
        const trimmedDesc = body.description.trim();
        if (trimmedDesc.length > 500) {
          return json(
            { error: "A descrição do grupo deve ter no máximo 500 caracteres." },
            400,
            corsHeaders
          );
        }
        nextDescription = trimmedDesc;
      }
    }

    let nextColor = existing.color;
    if (hasColor) {
      if (typeof body.color !== "string") {
        return json(
          { error: "A cor do grupo deve estar no formato hexadecimal (#RRGGBB)." },
          400,
          corsHeaders
        );
      }
      const trimmedColor = body.color.trim();
      if (!HEX_COLOR_RE.test(trimmedColor)) {
        return json(
          { error: "A cor do grupo deve estar no formato hexadecimal (#RRGGBB)." },
          400,
          corsHeaders
        );
      }
      nextColor = trimmedColor;
    }

    if (hasName) {
      const foldedNextName = foldText(nextName);
      const existingGroups = await env.DB.prepare(
        "SELECT id, name FROM keyword_groups WHERE user_id = ? AND id != ?"
      )
        .bind(authUser.id, id)
        .all();
      const dup = (existingGroups.results || []).find(
        (row) => foldText(row.name) === foldedNextName
      );
      if (dup) {
        return json({ error: "Já existe um grupo com este nome." }, 409, corsHeaders);
      }
    }

    try {
      await env.DB.prepare(
        `UPDATE keyword_groups
         SET name = ?, description = ?, color = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      )
        .bind(nextName, nextDescription, nextColor, id, authUser.id)
        .run();
    } catch (err) {
      if (isConstraintError(err)) {
        return json({ error: "Já existe um grupo com este nome." }, 409, corsHeaders);
      }
      throw err;
    }

    const updated = await fetchGroupById(env.DB, id);
    return json({ group: updated }, 200, corsHeaders);
  }

  if (request.method === "DELETE") {
    const linked = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM saved_keywords WHERE group_id = ?"
    )
      .bind(id)
      .first();

    if (Number(linked?.total || 0) > 0) {
      return json(
        {
          error:
            "Não é possível excluir o grupo pois existem palavras-chave vinculadas a ele."
        },
        409,
        corsHeaders
      );
    }

    try {
      await env.DB.prepare("DELETE FROM keyword_groups WHERE id = ? AND user_id = ?")
        .bind(id, authUser.id)
        .run();
    } catch (err) {
      if (isForeignKeyError(err) || isConstraintError(err)) {
        return json(
          {
            error:
              "Não é possível excluir o grupo pois existem palavras-chave vinculadas a ele."
          },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    return json({ ok: true, deleted_id: id }, 200, corsHeaders);
  }

  return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"], corsHeaders);
}

export async function handleKeywordsCollection(request, env, authUser, corsHeaders = {}) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const q = cleanQuery(url.searchParams.get("q") || "");
    const rawGroupId = url.searchParams.get("group_id");
    const rawPriority = url.searchParams.get("priority");
    const rawActive = url.searchParams.get("active");
    const rawSection = url.searchParams.get("section");
    const rawFrom = url.searchParams.get("from");
    const rawTo = url.searchParams.get("to");
    const rawSort = url.searchParams.get("sort");

    const conditions = ["k.user_id = ?"];
    const params = [authUser.id];

    if (rawGroupId !== null && rawGroupId !== "") {
      const groupId = parsePositiveId(rawGroupId);
      if (!groupId) {
        return json({ error: "Parâmetro group_id inválido." }, 400, corsHeaders);
      }
      conditions.push("k.group_id = ?");
      params.push(groupId);
    }

    if (rawPriority !== null && rawPriority !== "") {
      const priority = rawPriority.trim().toLowerCase();
      if (!PRIORITIES.has(priority)) {
        return json(
          { error: "Prioridade inválida. Use alta, media ou baixa." },
          400,
          corsHeaders
        );
      }
      conditions.push("k.priority = ?");
      params.push(priority);
    }

    const activeParsed = parseActiveFilter(rawActive);
    if (!activeParsed.ok) {
      return json(
        { error: "Parâmetro active inválido. Use 1, 0, true ou false." },
        400,
        corsHeaders
      );
    }
    if (activeParsed.value !== null) {
      conditions.push("k.is_active = ?");
      params.push(activeParsed.value);
    }

    let sectionFilter = null;
    if (rawSection !== null && rawSection !== "") {
      const section = cleanQuery(rawSection);
      if (section.length > 80) {
        return json(
          { error: "Parâmetro section deve ter no máximo 80 caracteres." },
          400,
          corsHeaders
        );
      }
      sectionFilter = section;
    }

    if (rawFrom !== null && rawFrom !== "") {
      const fromDate = rawFrom.trim();
      if (!isValidDateYmd(fromDate)) {
        return json(
          { error: "Data inicial (from) inválida. Use YYYY-MM-DD." },
          400,
          corsHeaders
        );
      }
      conditions.push("k.created_at >= ?");
      params.push(`${fromDate} 00:00:00`);
    }

    if (rawTo !== null && rawTo !== "") {
      const toDate = rawTo.trim();
      if (!isValidDateYmd(toDate)) {
        return json(
          { error: "Data final (to) inválida. Use YYYY-MM-DD." },
          400,
          corsHeaders
        );
      }
      conditions.push("k.created_at <= ?");
      params.push(`${toDate} 23:59:59`);
    }

    let orderBySql = KEYWORD_SORT_SQL.updated_desc;
    if (rawSort !== null && rawSort !== "") {
      const sortKey = rawSort.trim().toLowerCase();
      if (!Object.hasOwn(KEYWORD_SORT_SQL, sortKey)) {
        return json({ error: "Parâmetro sort inválido." }, 400, corsHeaders);
      }
      orderBySql = KEYWORD_SORT_SQL[sortKey];
    }

    const sql = `
      ${KEYWORD_SELECT_SQL}
      WHERE ${conditions.join(" AND ")}
      GROUP BY k.id
      ORDER BY ${orderBySql}
    `;
    const result = await env.DB.prepare(sql).bind(...params).all();
    let keywords = result.results || [];
    if (sectionFilter !== null) {
      const foldedSection = foldText(sectionFilter);
      keywords = keywords.filter(
        (row) => foldText(row.target_section) === foldedSection
      );
    }
    if (q) {
      const foldedQ = foldText(q);
      keywords = keywords.filter(
        (row) =>
          foldText(row.keyword).includes(foldedQ) ||
          foldText(row.description).includes(foldedQ)
      );
    }
    return json({ total: keywords.length, keywords }, 200, corsHeaders);
  }

  if (request.method === "POST") {
    const parsed = await readBoundedJsonObject(request, corsHeaders);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    if (typeof body.keyword !== "string") {
      return json(
        { error: "A palavra-chave deve ter entre 3 e 100 caracteres." },
        400,
        corsHeaders
      );
    }
    const keyword = cleanQuery(body.keyword);
    if (keyword.length < 3 || keyword.length > 100) {
      return json(
        { error: "A palavra-chave deve ter entre 3 e 100 caracteres." },
        400,
        corsHeaders
      );
    }

    let priority = "media";
    if (body.priority !== undefined && body.priority !== null && body.priority !== "") {
      if (typeof body.priority !== "string") {
        return json(
          { error: "Prioridade inválida. Use alta, media ou baixa." },
          400,
          corsHeaders
        );
      }
      const p = body.priority.trim().toLowerCase();
      if (!PRIORITIES.has(p)) {
        return json(
          { error: "Prioridade inválida. Use alta, media ou baixa." },
          400,
          corsHeaders
        );
      }
      priority = p;
    }

    let targetSection = "geral";
    if (body.target_section !== undefined && body.target_section !== null) {
      if (typeof body.target_section !== "string") {
        return json(
          { error: "A seção de destino deve ser um texto válido." },
          400,
          corsHeaders
        );
      }
      const cleanedSection = cleanQuery(body.target_section);
      if (cleanedSection.length < 1 || cleanedSection.length > 80) {
        return json(
          { error: "A seção de destino deve ter entre 1 e 80 caracteres." },
          400,
          corsHeaders
        );
      }
      targetSection = cleanedSection;
    }

    let description = "";
    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== "string") {
        return json(
          { error: "A descrição deve ser um texto válido." },
          400,
          corsHeaders
        );
      }
      description = body.description.trim();
      if (description.length > 500) {
        return json(
          { error: "A descrição deve ter no máximo 500 caracteres." },
          400,
          corsHeaders
        );
      }
    }

    let isActive = 1;
    if (body.is_active !== undefined) {
      const parsedActive = parseActiveBody(body.is_active);
      if (parsedActive === null) {
        return json(
          { error: "O campo is_active deve ser 0, 1 ou booleano." },
          400,
          corsHeaders
        );
      }
      isActive = parsedActive;
    }

    const groupCheck = await validateOwnedGroupReference(
      env.DB,
      body.group_id,
      authUser.id,
      corsHeaders
    );
    if (!groupCheck.ok) return groupCheck.response;

    const foldedKeyword = foldText(keyword);
    const existingKeywords = await env.DB.prepare(
      "SELECT id, keyword FROM saved_keywords"
    ).all();
    const dup = (existingKeywords.results || []).find(
      (row) => foldText(row.keyword) === foldedKeyword
    );
    if (dup) {
      return json(
        { error: "Esta palavra-chave já está cadastrada." },
        409,
        corsHeaders
      );
    }

    let insertResult;
    try {
      insertResult = await env.DB.prepare(
        `INSERT INTO saved_keywords
         (user_id, group_id, keyword, description, priority, target_section, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          authUser.id,
          groupCheck.groupId,
          keyword,
          description,
          priority,
          targetSection,
          isActive
        )
        .run();
    } catch (err) {
      if (isConstraintError(err)) {
        return json(
          { error: "Esta palavra-chave já está cadastrada." },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    const insertedId = insertResult?.meta?.last_row_id;
    const created = insertedId
      ? await fetchKeywordById(env.DB, insertedId)
      : await env.DB.prepare(
          `${KEYWORD_SELECT_SQL} WHERE k.keyword = ? GROUP BY k.id LIMIT 1`
        )
          .bind(keyword)
          .first();

    return json({ keyword: created }, 201, corsHeaders);
  }

  return methodNotAllowed(["GET", "POST"], corsHeaders);
}

export async function handleKeywordItem(request, env, idRaw, authUser, corsHeaders = {}) {
  const id = parsePositiveId(idRaw);
  if (!id) {
    return json({ error: "ID de palavra-chave inválido." }, 400, corsHeaders);
  }

  const existing = await fetchKeywordById(env.DB, id);
  if (!existing) {
    return json({ error: "Palavra-chave não encontrada." }, 404, corsHeaders);
  }
  if (existing.user_id !== authUser.id) {
    return json(
      { error: "Você não tem permissão para acessar esta palavra-chave." },
      403,
      corsHeaders
    );
  }

  if (request.method === "GET") {
    return json({ keyword: existing }, 200, corsHeaders);
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const parsed = await readBoundedJsonObject(request, corsHeaders);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    const isPut = request.method === "PUT";
    const hasKeyword = body.keyword !== undefined;
    const hasGroupId = body.group_id !== undefined;
    const hasDescription = body.description !== undefined;
    const hasPriority = body.priority !== undefined;
    const hasSection = body.target_section !== undefined;
    const hasActive = body.is_active !== undefined;

    if (isPut && !hasKeyword) {
      return json(
        { error: "A palavra-chave é obrigatória." },
        400,
        corsHeaders
      );
    }

    if (
      !isPut &&
      !hasKeyword &&
      !hasGroupId &&
      !hasDescription &&
      !hasPriority &&
      !hasSection &&
      !hasActive
    ) {
      return json(
        { error: "Informe ao menos um campo para atualizar a palavra-chave." },
        400,
        corsHeaders
      );
    }

    let nextKeyword = existing.keyword;
    if (hasKeyword) {
      if (typeof body.keyword !== "string") {
        return json(
          { error: "A palavra-chave deve ter entre 3 e 100 caracteres." },
          400,
          corsHeaders
        );
      }
      const cleaned = cleanQuery(body.keyword);
      if (cleaned.length < 3 || cleaned.length > 100) {
        return json(
          { error: "A palavra-chave deve ter entre 3 e 100 caracteres." },
          400,
          corsHeaders
        );
      }
      nextKeyword = cleaned;
    }

    let nextGroupId = existing.group_id;
    if (hasGroupId) {
      const groupCheck = await validateOwnedGroupReference(
        env.DB,
        body.group_id,
        authUser.id,
        corsHeaders
      );
      if (!groupCheck.ok) return groupCheck.response;
      nextGroupId = groupCheck.groupId;
    }

    let nextDescription = existing.description;
    if (hasDescription) {
      if (body.description === null) {
        nextDescription = "";
      } else if (typeof body.description !== "string") {
        return json(
          { error: "A descrição deve ser um texto válido." },
          400,
          corsHeaders
        );
      } else {
        const trimmedDesc = body.description.trim();
        if (trimmedDesc.length > 500) {
          return json(
            { error: "A descrição deve ter no máximo 500 caracteres." },
            400,
            corsHeaders
          );
        }
        nextDescription = trimmedDesc;
      }
    }

    let nextPriority = existing.priority;
    if (hasPriority) {
      if (typeof body.priority !== "string") {
        return json(
          { error: "Prioridade inválida. Use alta, media ou baixa." },
          400,
          corsHeaders
        );
      }
      const p = body.priority.trim().toLowerCase();
      if (!PRIORITIES.has(p)) {
        return json(
          { error: "Prioridade inválida. Use alta, media ou baixa." },
          400,
          corsHeaders
        );
      }
      nextPriority = p;
    }

    let nextSection = existing.target_section;
    if (hasSection) {
      if (typeof body.target_section !== "string") {
        return json(
          { error: "A seção de destino deve ser um texto válido." },
          400,
          corsHeaders
        );
      }
      const cleanedSection = cleanQuery(body.target_section);
      if (cleanedSection.length < 1 || cleanedSection.length > 80) {
        return json(
          { error: "A seção de destino deve ter entre 1 e 80 caracteres." },
          400,
          corsHeaders
        );
      }
      nextSection = cleanedSection;
    }

    let nextActive = existing.is_active;
    if (hasActive) {
      const parsedActive = parseActiveBody(body.is_active);
      if (parsedActive === null) {
        return json(
          { error: "O campo is_active deve ser 0, 1 ou booleano." },
          400,
          corsHeaders
        );
      }
      nextActive = parsedActive;
    }

    if (hasKeyword) {
      const foldedNextKeyword = foldText(nextKeyword);
      const existingKeywords = await env.DB.prepare(
        "SELECT id, keyword FROM saved_keywords WHERE id != ?"
      )
        .bind(id)
        .all();
      const dup = (existingKeywords.results || []).find(
        (row) => foldText(row.keyword) === foldedNextKeyword
      );
      if (dup) {
        return json(
          { error: "Esta palavra-chave já está cadastrada." },
          409,
          corsHeaders
        );
      }
    }

    try {
      await env.DB.prepare(
        `UPDATE saved_keywords
         SET group_id = ?, keyword = ?, description = ?, priority = ?,
             target_section = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      )
        .bind(
          nextGroupId,
          nextKeyword,
          nextDescription,
          nextPriority,
          nextSection,
          nextActive,
          id,
          authUser.id
        )
        .run();
    } catch (err) {
      if (isConstraintError(err)) {
        return json(
          { error: "Esta palavra-chave já está cadastrada." },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    const updated = await fetchKeywordById(env.DB, id);
    return json({ keyword: updated }, 200, corsHeaders);
  }

  if (request.method === "DELETE") {
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM keyword_alerts WHERE keyword_id = ? AND user_id = ?").bind(
          id,
          authUser.id
        ),
        env.DB.prepare("DELETE FROM saved_keywords WHERE id = ? AND user_id = ?").bind(
          id,
          authUser.id
        )
      ]);
    } catch (err) {
      if (isConstraintError(err)) {
        return json(
          {
            error:
              "Não é possível excluir a palavra-chave por restrição de integridade."
          },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    return json({ ok: true, deleted_id: id }, 200, corsHeaders);
  }

  return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"], corsHeaders);
}

export async function handleKeywordScan(request, env, idRaw, authUser, corsHeaders = {}) {
  if (request.method !== "POST") {
    return methodNotAllowed(["POST"], corsHeaders);
  }

  const id = parsePositiveId(idRaw);
  if (!id) {
    return json({ error: "ID de palavra-chave inválido." }, 400, corsHeaders);
  }

  const kw = await env.DB.prepare(
    "SELECT id, user_id, keyword FROM saved_keywords WHERE id = ? LIMIT 1"
  )
    .bind(id)
    .first();

  if (!kw) {
    return json({ error: "Palavra-chave não encontrada." }, 404, corsHeaders);
  }
  if (kw.user_id !== authUser.id) {
    return json(
      { error: "Você não tem permissão para varrer esta palavra-chave." },
      403,
      corsHeaders
    );
  }

  const expression = ftsExpression(cleanQuery(kw.keyword));
  if (!expression) {
    await env.DB.prepare(
      "UPDATE saved_keywords SET last_searched_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
    )
      .bind(id, authUser.id)
      .run();

    return json(
      {
        keyword_id: id,
        matched_documents: 0,
        created_alerts: 0,
        alerts: []
      },
      200,
      corsHeaders
    );
  }

  const matchesRes = await env.DB.prepare(
    `SELECT d.id AS document_id, p.page_number,
            snippet(pages_fts, 0, '<mark>', '</mark>', '…', 28) AS excerpt
     FROM pages_fts
     JOIN pages p ON p.id = pages_fts.rowid
     JOIN documents d ON d.id = p.document_id
     WHERE pages_fts MATCH ?
     ORDER BY d.published_at DESC, d.id DESC, p.page_number ASC
     LIMIT 500`
  )
    .bind(expression)
    .all();

  const uniqueDocs = new Map();
  for (const row of matchesRes.results || []) {
    if (!uniqueDocs.has(row.document_id)) {
      uniqueDocs.set(row.document_id, {
        document_id: row.document_id,
        excerpt: String(row.excerpt || "").slice(0, 1000)
      });
    }
  }

  const matchedDocuments = uniqueDocs.size;

  const existingAlertsRes = await env.DB.prepare(
    "SELECT document_id FROM keyword_alerts WHERE keyword_id = ? AND document_id IS NOT NULL"
  )
    .bind(id)
    .all();

  const existingDocIds = new Set(
    (existingAlertsRes.results || []).map((row) => row.document_id)
  );

  const newDocs = [];
  for (const [docId, info] of uniqueDocs.entries()) {
    if (!existingDocIds.has(docId)) {
      newDocs.push(info);
    }
  }

  const batchStmts = [];
  for (let i = 0; i < newDocs.length; i += 14) {
    const chunk = newDocs.slice(i, i + 14);
    const placeholders = chunk.map(() => "(?, ?, ?, 'novo', ?, '')").join(", ");
    const values = [];
    for (const item of chunk) {
      values.push(authUser.id, id, item.document_id, item.excerpt);
    }
    batchStmts.push(
      env.DB.prepare(
        `INSERT INTO keyword_alerts
         (user_id, keyword_id, document_id, status, matched_excerpt, notes)
         VALUES ${placeholders}`
      ).bind(...values)
    );
  }

  batchStmts.push(
    env.DB.prepare(
      "UPDATE saved_keywords SET last_searched_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
    ).bind(id, authUser.id)
  );

  await env.DB.batch(batchStmts);

  if (newDocs.length === 0) {
    return json(
      {
        keyword_id: id,
        matched_documents: matchedDocuments,
        created_alerts: 0,
        alerts: []
      },
      200,
      corsHeaders
    );
  }

  const newDocIdSet = new Set(newDocs.map((d) => d.document_id));
  const alertsRes = await env.DB.prepare(
    `${ALERT_SELECT_SQL}
     WHERE a.keyword_id = ? AND a.user_id = ?
     ORDER BY a.created_at DESC, a.id DESC`
  )
    .bind(id, authUser.id)
    .all();

  const createdAlerts = (alertsRes.results || []).filter((a) =>
    newDocIdSet.has(a.document_id)
  );

  return json(
    {
      keyword_id: id,
      matched_documents: matchedDocuments,
      created_alerts: createdAlerts.length,
      alerts: createdAlerts
    },
    createdAlerts.length > 0 ? 201 : 200,
    corsHeaders
  );
}

export async function handleAlertsCollection(request, env, authUser, corsHeaders = {}) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const rawKeywordId = url.searchParams.get("keyword_id");
    const rawStatus = url.searchParams.get("status");
    const q = cleanQuery(url.searchParams.get("q") || "");

    const conditions = ["a.user_id = ?"];
    const params = [authUser.id];

    if (rawKeywordId !== null && rawKeywordId !== "") {
      const keywordId = parsePositiveId(rawKeywordId);
      if (!keywordId) {
        return json({ error: "Parâmetro keyword_id inválido." }, 400, corsHeaders);
      }
      conditions.push("a.keyword_id = ?");
      params.push(keywordId);
    }

    if (rawStatus !== null && rawStatus !== "") {
      const status = rawStatus.trim().toLowerCase();
      if (!ALERT_STATUSES.has(status)) {
        return json(
          { error: "Status inválido. Use novo, revisado ou arquivado." },
          400,
          corsHeaders
        );
      }
      conditions.push("a.status = ?");
      params.push(status);
    }

    const sql = `
      ${ALERT_SELECT_SQL}
      WHERE ${conditions.join(" AND ")}
      ORDER BY a.created_at DESC, a.id DESC
    `;
    const result = await env.DB.prepare(sql).bind(...params).all();
    let alerts = result.results || [];
    if (q) {
      const foldedQ = foldText(q);
      alerts = alerts.filter(
        (row) =>
          foldText(row.matched_excerpt).includes(foldedQ) ||
          foldText(row.notes).includes(foldedQ) ||
          foldText(row.keyword).includes(foldedQ) ||
          foldText(row.document_title).includes(foldedQ)
      );
    }
    return json({ total: alerts.length, alerts }, 200, corsHeaders);
  }

  if (request.method === "POST") {
    const parsed = await readBoundedJsonObject(request, corsHeaders);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    const kwCheck = await validateOwnedKeywordReference(
      env.DB,
      body.keyword_id,
      authUser.id,
      corsHeaders
    );
    if (!kwCheck.ok) return kwCheck.response;

    const docCheck = await validateDocumentReference(
      env.DB,
      body.document_id,
      corsHeaders
    );
    if (!docCheck.ok) return docCheck.response;

    let status = "novo";
    if (body.status !== undefined && body.status !== null && body.status !== "") {
      if (typeof body.status !== "string") {
        return json(
          { error: "Status inválido. Use novo, revisado ou arquivado." },
          400,
          corsHeaders
        );
      }
      const normalizedStatus = body.status.trim().toLowerCase();
      if (!ALERT_STATUSES.has(normalizedStatus)) {
        return json(
          { error: "Status inválido. Use novo, revisado ou arquivado." },
          400,
          corsHeaders
        );
      }
      status = normalizedStatus;
    }

    let matchedExcerpt = "";
    if (body.matched_excerpt !== undefined && body.matched_excerpt !== null) {
      if (typeof body.matched_excerpt !== "string") {
        return json(
          { error: "O trecho encontrado deve ser um texto válido." },
          400,
          corsHeaders
        );
      }
      matchedExcerpt = body.matched_excerpt.trim();
      if (matchedExcerpt.length > 1000) {
        return json(
          { error: "O trecho encontrado deve ter no máximo 1000 caracteres." },
          400,
          corsHeaders
        );
      }
    }

    let notes = "";
    if (body.notes !== undefined && body.notes !== null) {
      if (typeof body.notes !== "string") {
        return json(
          { error: "As observações devem ser um texto válido." },
          400,
          corsHeaders
        );
      }
      notes = body.notes.trim();
      if (notes.length > 1000) {
        return json(
          { error: "As observações devem ter no máximo 1000 caracteres." },
          400,
          corsHeaders
        );
      }
    }

    let insertResult;
    try {
      insertResult = await env.DB.prepare(
        `INSERT INTO keyword_alerts
         (user_id, keyword_id, document_id, status, matched_excerpt, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(
          authUser.id,
          kwCheck.keywordId,
          docCheck.documentId,
          status,
          matchedExcerpt,
          notes
        )
        .run();
    } catch (err) {
      if (isForeignKeyError(err)) {
        return json(
          { error: "Palavra-chave ou documento referenciado não encontrado." },
          404,
          corsHeaders
        );
      }
      if (isConstraintError(err)) {
        return json(
          { error: "Não foi possível criar o alerta por restrição de integridade." },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    const insertedId = insertResult?.meta?.last_row_id;
    const alert = insertedId
      ? await fetchAlertById(env.DB, insertedId)
      : await env.DB.prepare(
          `${ALERT_SELECT_SQL} WHERE a.user_id = ? AND a.keyword_id = ? ORDER BY a.id DESC LIMIT 1`
        )
          .bind(authUser.id, kwCheck.keywordId)
          .first();

    return json({ alert }, 201, corsHeaders);
  }

  return methodNotAllowed(["GET", "POST"], corsHeaders);
}

export async function handleAlertItem(request, env, idRaw, authUser, corsHeaders = {}) {
  const id = parsePositiveId(idRaw);
  if (!id) {
    return json({ error: "ID de alerta inválido." }, 400, corsHeaders);
  }

  const existing = await fetchAlertById(env.DB, id);
  if (!existing) {
    return json({ error: "Alerta não encontrado." }, 404, corsHeaders);
  }
  if (existing.user_id !== authUser.id) {
    return json(
      { error: "Você não tem permissão para acessar este alerta." },
      403,
      corsHeaders
    );
  }

  if (request.method === "GET") {
    return json({ alert: existing }, 200, corsHeaders);
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const parsed = await readBoundedJsonObject(request, corsHeaders);
    if (!parsed.ok) return parsed.response;

    const body = parsed.data;
    const hasStatus = body.status !== undefined;
    const hasNotes = body.notes !== undefined;
    const hasExcerpt = body.matched_excerpt !== undefined;
    const hasDocId = body.document_id !== undefined;

    if (!hasStatus && !hasNotes && !hasExcerpt && !hasDocId) {
      return json(
        { error: "Informe ao menos um campo para atualizar o alerta." },
        400,
        corsHeaders
      );
    }

    let nextStatus = existing.status;
    if (hasStatus) {
      if (typeof body.status !== "string") {
        return json(
          { error: "Status inválido. Use novo, revisado ou arquivado." },
          400,
          corsHeaders
        );
      }
      const normalizedStatus = body.status.trim().toLowerCase();
      if (!ALERT_STATUSES.has(normalizedStatus)) {
        return json(
          { error: "Status inválido. Use novo, revisado ou arquivado." },
          400,
          corsHeaders
        );
      }
      nextStatus = normalizedStatus;
    }

    let nextNotes = existing.notes;
    if (hasNotes) {
      if (body.notes === null) {
        nextNotes = "";
      } else if (typeof body.notes !== "string") {
        return json(
          { error: "As observações devem ser um texto válido." },
          400,
          corsHeaders
        );
      } else {
        const trimmedNotes = body.notes.trim();
        if (trimmedNotes.length > 1000) {
          return json(
            { error: "As observações devem ter no máximo 1000 caracteres." },
            400,
            corsHeaders
          );
        }
        nextNotes = trimmedNotes;
      }
    }

    let nextExcerpt = existing.matched_excerpt;
    if (hasExcerpt) {
      if (body.matched_excerpt === null) {
        nextExcerpt = "";
      } else if (typeof body.matched_excerpt !== "string") {
        return json(
          { error: "O trecho encontrado deve ser um texto válido." },
          400,
          corsHeaders
        );
      } else {
        const trimmedExcerpt = body.matched_excerpt.trim();
        if (trimmedExcerpt.length > 1000) {
          return json(
            { error: "O trecho encontrado deve ter no máximo 1000 caracteres." },
            400,
            corsHeaders
          );
        }
        nextExcerpt = trimmedExcerpt;
      }
    }

    let nextDocId = existing.document_id;
    if (hasDocId) {
      const docCheck = await validateDocumentReference(
        env.DB,
        body.document_id,
        corsHeaders
      );
      if (!docCheck.ok) return docCheck.response;
      nextDocId = docCheck.documentId;
    }

    try {
      await env.DB.prepare(
        `UPDATE keyword_alerts
         SET document_id = ?, status = ?, matched_excerpt = ?, notes = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      )
        .bind(nextDocId, nextStatus, nextExcerpt, nextNotes, id, authUser.id)
        .run();
    } catch (err) {
      if (isForeignKeyError(err)) {
        return json(
          { error: "Documento referenciado não encontrado." },
          404,
          corsHeaders
        );
      }
      if (isConstraintError(err)) {
        return json(
          { error: "Não foi possível atualizar o alerta por restrição de integridade." },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    const updated = await fetchAlertById(env.DB, id);
    return json({ alert: updated }, 200, corsHeaders);
  }

  if (request.method === "DELETE") {
    try {
      await env.DB.prepare("DELETE FROM keyword_alerts WHERE id = ? AND user_id = ?")
        .bind(id, authUser.id)
        .run();
    } catch (err) {
      if (isConstraintError(err)) {
        return json(
          { error: "Não foi possível excluir o alerta por restrição de integridade." },
          409,
          corsHeaders
        );
      }
      throw err;
    }

    return json({ ok: true, deleted_id: id }, 200, corsHeaders);
  }

  return methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"], corsHeaders);
}

export async function handleReports(request, env, authUser, corsHeaders = {}) {
  if (request.method !== "GET") {
    return methodNotAllowed(["GET"], corsHeaders);
  }

  const url = new URL(request.url);
  const q = cleanQuery(url.searchParams.get("q") || "");
  const rawGroupId = url.searchParams.get("group_id");
  const rawPriority = url.searchParams.get("priority");
  const rawActive = url.searchParams.get("active");
  const rawStatus = url.searchParams.get("status");
  const rawFrom = url.searchParams.get("from");
  const rawTo = url.searchParams.get("to");
  const rawType = url.searchParams.get("type");

  let groupId = null;
  if (rawGroupId !== null && rawGroupId !== "") {
    groupId = parsePositiveId(rawGroupId);
    if (!groupId) {
      return json({ error: "Parâmetro group_id inválido." }, 400, corsHeaders);
    }
  }

  let priority = null;
  if (rawPriority !== null && rawPriority !== "") {
    const p = rawPriority.trim().toLowerCase();
    if (!PRIORITIES.has(p)) {
      return json(
        { error: "Prioridade inválida. Use alta, media ou baixa." },
        400,
        corsHeaders
      );
    }
    priority = p;
  }

  const activeParsed = parseActiveFilter(rawActive);
  if (!activeParsed.ok) {
    return json(
      { error: "Parâmetro active inválido. Use 1, 0, true ou false." },
      400,
      corsHeaders
    );
  }
  const active = activeParsed.value;

  let status = null;
  if (rawStatus !== null && rawStatus !== "") {
    const s = rawStatus.trim().toLowerCase();
    if (!ALERT_STATUSES.has(s)) {
      return json(
        { error: "Status inválido. Use novo, revisado ou arquivado." },
        400,
        corsHeaders
      );
    }
    status = s;
  }

  let from = null;
  if (rawFrom !== null && rawFrom !== "") {
    const f = rawFrom.trim();
    if (!isValidDateYmd(f)) {
      return json(
        { error: "Data inicial (from) inválida. Use YYYY-MM-DD." },
        400,
        corsHeaders
      );
    }
    from = f;
  }

  let to = null;
  if (rawTo !== null && rawTo !== "") {
    const t = rawTo.trim();
    if (!isValidDateYmd(t)) {
      return json(
        { error: "Data final (to) inválida. Use YYYY-MM-DD." },
        400,
        corsHeaders
      );
    }
    to = t;
  }

  let typeParam = null;
  if (rawType !== null && rawType !== "") {
    const tp = rawType.trim().toLowerCase();
    if (!REPORT_TYPES.has(tp)) {
      return json({ error: "Parâmetro type inválido." }, 400, corsHeaders);
    }
    typeParam = tp;
  }

  const kwWhere = ["k.user_id = ?"];
  const kwWhereParams = [authUser.id];
  if (groupId !== null) {
    kwWhere.push("k.group_id = ?");
    kwWhereParams.push(groupId);
  }
  if (priority !== null) {
    kwWhere.push("k.priority = ?");
    kwWhereParams.push(priority);
  }
  if (active !== null) {
    kwWhere.push("k.is_active = ?");
    kwWhereParams.push(active);
  }
  if (from !== null) {
    kwWhere.push("k.created_at >= ?");
    kwWhereParams.push(`${from} 00:00:00`);
  }
  if (to !== null) {
    kwWhere.push("k.created_at <= ?");
    kwWhereParams.push(`${to} 23:59:59`);
  }

  const alertJoinExtras = [];
  const alertJoinParams = [];
  if (status !== null) {
    alertJoinExtras.push("a.status = ?");
    alertJoinParams.push(status);
  }
  if (from !== null) {
    alertJoinExtras.push("a.created_at >= ?");
    alertJoinParams.push(`${from} 00:00:00`);
  }
  if (to !== null) {
    alertJoinExtras.push("a.created_at <= ?");
    alertJoinParams.push(`${to} 23:59:59`);
  }
  const alertJoinClause = alertJoinExtras.length
    ? `AND ${alertJoinExtras.join(" AND ")}`
    : "";

  const keywordsSql = `
    SELECT k.id, k.user_id, k.group_id, k.keyword, k.description, k.priority,
           k.target_section, k.is_active, k.last_searched_at, k.created_at, k.updated_at,
           g.name AS group_name, g.color AS group_color,
           COUNT(a.id) AS alert_count
    FROM saved_keywords k
    LEFT JOIN keyword_groups g ON g.id = k.group_id
    LEFT JOIN keyword_alerts a ON a.keyword_id = k.id ${alertJoinClause}
    WHERE ${kwWhere.join(" AND ")}
    GROUP BY k.id
    ORDER BY k.updated_at DESC, k.id DESC
  `;
  const keywordsParams = [...alertJoinParams, ...kwWhereParams];

  const alWhere = ["a.user_id = ?"];
  const alWhereParams = [authUser.id];
  if (groupId !== null) {
    alWhere.push("k.group_id = ?");
    alWhereParams.push(groupId);
  }
  if (priority !== null) {
    alWhere.push("k.priority = ?");
    alWhereParams.push(priority);
  }
  if (active !== null) {
    alWhere.push("k.is_active = ?");
    alWhereParams.push(active);
  }
  if (status !== null) {
    alWhere.push("a.status = ?");
    alWhereParams.push(status);
  }
  if (from !== null) {
    alWhere.push("a.created_at >= ?");
    alWhereParams.push(`${from} 00:00:00`);
  }
  if (to !== null) {
    alWhere.push("a.created_at <= ?");
    alWhereParams.push(`${to} 23:59:59`);
  }

  const alertsSql = `
    SELECT a.id, a.user_id, a.keyword_id, a.document_id, a.status,
           a.matched_excerpt, a.notes, a.created_at, a.updated_at,
           k.keyword AS keyword, k.priority AS keyword_priority,
           k.description AS _keyword_description,
           d.edition AS document_edition, d.title AS document_title,
           d.published_at AS document_published_at, d.pdf_url AS pdf_url,
           d.source_page_url AS document_source_page_url
    FROM keyword_alerts a
    JOIN saved_keywords k ON k.id = a.keyword_id
    LEFT JOIN documents d ON d.id = a.document_id
    WHERE ${alWhere.join(" AND ")}
    ORDER BY a.created_at DESC, a.id DESC
  `;

  const grpKwExtras = [];
  const grpKwParams = [];
  if (priority !== null) {
    grpKwExtras.push("k.priority = ?");
    grpKwParams.push(priority);
  }
  if (active !== null) {
    grpKwExtras.push("k.is_active = ?");
    grpKwParams.push(active);
  }
  if (from !== null) {
    grpKwExtras.push("k.created_at >= ?");
    grpKwParams.push(`${from} 00:00:00`);
  }
  if (to !== null) {
    grpKwExtras.push("k.created_at <= ?");
    grpKwParams.push(`${to} 23:59:59`);
  }
  const grpKwJoinClause = grpKwExtras.length
    ? `AND ${grpKwExtras.join(" AND ")}`
    : "";

  const grpWhere = ["g.user_id = ?"];
  const grpWhereParams = [authUser.id];
  if (groupId !== null) {
    grpWhere.push("g.id = ?");
    grpWhereParams.push(groupId);
  }

  const byGroupSql = `
    SELECT g.id AS group_id, g.name AS group_name, g.color,
           COUNT(DISTINCT k.id) AS keyword_count,
           COUNT(a.id) AS alert_count
    FROM keyword_groups g
    LEFT JOIN saved_keywords k ON k.group_id = g.id AND k.user_id = g.user_id ${grpKwJoinClause}
    LEFT JOIN keyword_alerts a ON a.keyword_id = k.id ${alertJoinClause}
    WHERE ${grpWhere.join(" AND ")}
    GROUP BY g.id
    ORDER BY LOWER(g.name) ASC, g.id ASC
  `;
  const byGroupParams = [...grpKwParams, ...alertJoinParams, ...grpWhereParams];

  const byPrioritySql = `
    SELECT k.priority,
           COUNT(DISTINCT k.id) AS keyword_count,
           COUNT(a.id) AS alert_count
    FROM saved_keywords k
    LEFT JOIN keyword_alerts a ON a.keyword_id = k.id ${alertJoinClause}
    WHERE ${kwWhere.join(" AND ")}
    GROUP BY k.priority
    ORDER BY CASE k.priority WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END ASC
  `;
  const byPriorityParams = [...alertJoinParams, ...kwWhereParams];

  const totalGroupsSql =
    "SELECT COUNT(*) AS total_groups FROM keyword_groups WHERE user_id = ?";

  const [kwRes, alRes, grpRes, prioRes, totalGrpRes] = await env.DB.batch([
    env.DB.prepare(keywordsSql).bind(...keywordsParams),
    env.DB.prepare(alertsSql).bind(...alWhereParams),
    env.DB.prepare(byGroupSql).bind(...byGroupParams),
    env.DB.prepare(byPrioritySql).bind(...byPriorityParams),
    env.DB.prepare(totalGroupsSql).bind(authUser.id)
  ]);

  const rawKeywords = kwRes.results || [];
  const rawAlerts = alRes.results || [];

  let keywords = rawKeywords;
  let filteredAlerts = rawAlerts;
  let byGroup;
  let byPriority;

  if (q) {
    const foldedQ = foldText(q);
    keywords = rawKeywords.filter(
      (row) =>
        foldText(row.keyword).includes(foldedQ) ||
        foldText(row.description).includes(foldedQ)
    );
    filteredAlerts = rawAlerts.filter(
      (row) =>
        foldText(row.keyword).includes(foldedQ) ||
        foldText(row._keyword_description).includes(foldedQ) ||
        foldText(row.matched_excerpt).includes(foldedQ) ||
        foldText(row.notes).includes(foldedQ)
    );

    const groupStats = new Map();
    const priorityStats = new Map();
    for (const kw of keywords) {
      const kwAlerts = Number(kw.alert_count || 0);
      if (kw.group_id !== null && kw.group_id !== undefined) {
        const gEntry = groupStats.get(kw.group_id) || {
          keyword_count: 0,
          alert_count: 0
        };
        gEntry.keyword_count += 1;
        gEntry.alert_count += kwAlerts;
        groupStats.set(kw.group_id, gEntry);
      }

      const pEntry = priorityStats.get(kw.priority) || {
        keyword_count: 0,
        alert_count: 0
      };
      pEntry.keyword_count += 1;
      pEntry.alert_count += kwAlerts;
      priorityStats.set(kw.priority, pEntry);
    }

    byGroup = (grpRes.results || []).map((row) => {
      const stats = groupStats.get(row.group_id) || {
        keyword_count: 0,
        alert_count: 0
      };
      return {
        group_id: row.group_id,
        group_name: row.group_name,
        name: row.group_name,
        color: row.color,
        keyword_count: stats.keyword_count,
        total_keywords: stats.keyword_count,
        alert_count: stats.alert_count
      };
    });

    byPriority = [];
    for (const p of ["alta", "media", "baixa"]) {
      const stats = priorityStats.get(p);
      if (stats) {
        byPriority.push({
          priority: p,
          keyword_count: stats.keyword_count,
          total: stats.keyword_count,
          alert_count: stats.alert_count
        });
      }
    }
  } else {
    byGroup = (grpRes.results || []).map((row) => ({
      group_id: row.group_id,
      group_name: row.group_name,
      name: row.group_name,
      color: row.color,
      keyword_count: Number(row.keyword_count || 0),
      total_keywords: Number(row.keyword_count || 0),
      alert_count: Number(row.alert_count || 0)
    }));
    byPriority = (prioRes.results || []).map((row) => ({
      priority: row.priority,
      keyword_count: Number(row.keyword_count || 0),
      total: Number(row.keyword_count || 0),
      alert_count: Number(row.alert_count || 0)
    }));
  }

  const alerts = filteredAlerts.map(({ _keyword_description, ...rest }) => rest);

  const summary = {
    total_keywords: keywords.length,
    active_keywords: keywords.filter((k) => Number(k.is_active) === 1).length,
    inactive_keywords: keywords.filter((k) => Number(k.is_active) === 0).length,
    total_groups: Number(totalGrpRes.results?.[0]?.total_groups || 0),
    total_alerts: alerts.length,
    new_alerts: alerts.filter((a) => a.status === "novo").length,
    reviewed_alerts: alerts.filter((a) => a.status === "revisado").length,
    archived_alerts: alerts.filter((a) => a.status === "arquivado").length
  };

  const filters = {
    q: q || null,
    group_id: groupId,
    priority,
    active,
    status,
    from,
    to
  };
  if (typeParam !== null) {
    filters.type = typeParam;
  }

  return json(
    {
      filters,
      summary,
      by_group: byGroup,
      by_priority: byPriority,
      keywords,
      alerts
    },
    200,
    corsHeaders
  );
}

export async function handleCrud(request, env, path, corsHeaders = {}) {
  let handler = null;
  let allowedMethods = null;

  if (path === "/groups") {
    allowedMethods = ["GET", "POST"];
    handler = (authUser) => handleGroupsCollection(request, env, authUser, corsHeaders);
  } else {
    const groupMatch = /^\/groups\/([^/]+)$/.exec(path);
    if (groupMatch) {
      const idRaw = decodeSegment(groupMatch[1]);
      allowedMethods = ["GET", "PUT", "PATCH", "DELETE"];
      handler = (authUser) => handleGroupItem(request, env, idRaw, authUser, corsHeaders);
    }
  }

  if (!handler && path === "/keywords") {
    allowedMethods = ["GET", "POST"];
    handler = (authUser) => handleKeywordsCollection(request, env, authUser, corsHeaders);
  }

  if (!handler) {
    const scanMatch = /^\/keywords\/([^/]+)\/scan$/.exec(path);
    if (scanMatch) {
      const idRaw = decodeSegment(scanMatch[1]);
      allowedMethods = ["POST"];
      handler = (authUser) => handleKeywordScan(request, env, idRaw, authUser, corsHeaders);
    }
  }

  if (!handler) {
    const keywordMatch = /^\/keywords\/([^/]+)$/.exec(path);
    if (keywordMatch) {
      const idRaw = decodeSegment(keywordMatch[1]);
      allowedMethods = ["GET", "PUT", "PATCH", "DELETE"];
      handler = (authUser) => handleKeywordItem(request, env, idRaw, authUser, corsHeaders);
    }
  }

  if (!handler && path === "/alerts") {
    allowedMethods = ["GET", "POST"];
    handler = (authUser) => handleAlertsCollection(request, env, authUser, corsHeaders);
  }

  if (!handler) {
    const alertMatch = /^\/alerts\/([^/]+)$/.exec(path);
    if (alertMatch) {
      const idRaw = decodeSegment(alertMatch[1]);
      allowedMethods = ["GET", "PUT", "PATCH", "DELETE"];
      handler = (authUser) => handleAlertItem(request, env, idRaw, authUser, corsHeaders);
    }
  }

  if (!handler && path === "/reports") {
    allowedMethods = ["GET"];
    handler = (authUser) => handleReports(request, env, authUser, corsHeaders);
  }

  if (!handler) {
    return null;
  }

  const auth = await requireAuth(request, env, corsHeaders);
  if (auth.errorResponse) return auth.errorResponse;

  if (!allowedMethods.includes(request.method)) {
    return methodNotAllowed(allowedMethods, corsHeaders);
  }

  return handler(auth.user);
}
