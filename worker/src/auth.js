const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer"
};

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BITS = 256;
const TOKEN_TTL_SECONDS = 24 * 60 * 60;
const PUBLIC_USER_COLUMNS = "id, name, email, role, created_at, updated_at";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

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

function normalizeEmail(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().toLowerCase()
    : "";
}

function isValidEmail(email) {
  return (
    typeof email === "string" &&
    email.length >= 3 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function isValidPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 6 &&
    password.length <= 128 &&
    password.trim().length > 0
  );
}

async function readJsonObject(request) {
  const contentType = request.headers.get("content-type") || "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: json({ error: "Content-Type deve ser application/json." }, 415)
    };
  }

  let rawText;
  try {
    rawText = await request.text();
  } catch {
    return {
      ok: false,
      response: json({ error: "JSON inválido." }, 400)
    };
  }

  if (!rawText || !rawText.trim()) {
    return {
      ok: false,
      response: json({ error: "JSON inválido." }, 400)
    };
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      response: json({ error: "JSON inválido." }, 400)
    };
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      ok: false,
      response: json({ error: "O corpo da requisição deve ser um objeto JSON." }, 400)
    };
  }

  return { ok: true, data };
}

function getAuthSecret(env) {
  return env?.AUTH_SECRET || env?.RATE_LIMIT_SALT || "edital-monitor-local-dev-secret";
}

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  if (
    typeof hex !== "string" ||
    hex.length === 0 ||
    hex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(hex)
  ) {
    return null;
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqualBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.byteLength !== b.byteLength) {
    return false;
  }
  if (typeof crypto?.subtle?.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function sha256Bytes(input) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return new Uint8Array(digest);
}

export async function hashPassword(password) {
  if (typeof password !== "string" || password.length === 0 || password.length > 128) {
    throw new TypeError("Senha inválida para hash.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    PBKDF2_KEY_BITS
  );

  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(
    new Uint8Array(derivedBits)
  )}`;
}

export async function verifyPassword(password, storedHash) {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    password.length > 128 ||
    typeof storedHash !== "string"
  ) {
    return false;
  }

  const parts = storedHash.split("$");
  if (parts.length !== 4) return false;

  const [algo, iterStr, saltHex, hashHex] = parts;
  if (algo !== "pbkdf2_sha256") return false;
  if (!/^[1-9]\d*$/.test(iterStr)) return false;

  const iterations = Number(iterStr);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > PBKDF2_ITERATIONS) {
    return false;
  }

  const saltBytes = hexToBytes(saltHex);
  const expectedBytes = hexToBytes(hashHex);
  if (!saltBytes || saltBytes.byteLength !== PBKDF2_SALT_BYTES) return false;
  if (!expectedBytes || expectedBytes.byteLength !== PBKDF2_KEY_BITS / 8) return false;

  try {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations,
        hash: "SHA-256"
      },
      keyMaterial,
      expectedBytes.byteLength * 8
    );

    return constantTimeEqualBytes(new Uint8Array(derivedBits), expectedBytes);
  } catch {
    return false;
  }
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(obj) {
  return base64UrlEncodeBytes(encoder.encode(JSON.stringify(obj)));
}

function base64UrlDecodeBytes(segment) {
  if (
    typeof segment !== "string" ||
    segment.length === 0 ||
    segment.length % 4 === 1 ||
    !/^[A-Za-z0-9_-]+$/.test(segment)
  ) {
    return null;
  }

  const padLength = (4 - (segment.length % 4)) % 4;
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLength);

  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (base64UrlEncodeBytes(bytes) !== segment) return null;
    return bytes;
  } catch {
    return null;
  }
}

function decodeJsonSegment(segment) {
  const bytes = base64UrlDecodeBytes(segment);
  if (!bytes) return null;

  try {
    const jsonText = decoder.decode(bytes);
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages
  );
}

export async function signToken(user, env, ttlSeconds = TOKEN_TTL_SECONDS) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ttlSeconds;
  const headerB64 = base64UrlEncodeJson({ alg: "HS256", typ: "JWT" });
  const payloadB64 = base64UrlEncodeJson({
    sub: user.id,
    email: user.email,
    name: user.name,
    iat,
    exp
  });

  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importHmacKey(getAuthSecret(env), ["sign"]);
  const sigBuffer = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  const sigB64 = base64UrlEncodeBytes(new Uint8Array(sigBuffer));
  return `${signingInput}.${sigB64}`;
}

export async function verifyToken(token, env) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeJsonSegment(headerB64);
  if (!header || header.alg !== "HS256" || (header.typ !== undefined && header.typ !== "JWT")) {
    return null;
  }

  const sigBytes = base64UrlDecodeBytes(sigB64);
  if (!sigBytes || sigBytes.byteLength !== 32) return null;

  try {
    const key = await importHmacKey(getAuthSecret(env), ["verify"]);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      encoder.encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  const payload = decodeJsonSegment(payloadB64);
  if (!payload) return null;
  if (!Number.isInteger(payload.sub) || payload.sub <= 0) return null;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now >= payload.exp) return null;

  return payload;
}

function isUniqueConstraintError(err) {
  const message = String(err?.message || "").toLowerCase();
  return message.includes("unique") || message.includes("constraint");
}

export async function requireAuth(request, env, corsHeaders = {}) {
  const unauth = () => ({
    user: null,
    errorResponse: json(
      { error: "Autenticação necessária. Envie um token Bearer válido." },
      401,
      corsHeaders
    )
  });

  const authHeader = request.headers.get("authorization") || "";
  const match = authHeader.trim().match(/^Bearer\s+(\S+)$/i);
  if (!match) return unauth();

  const token = match[1];
  if (env?.INGEST_TOKEN) {
    const [tokenDigest, ingestDigest] = await Promise.all([
      sha256Bytes(token),
      sha256Bytes(String(env.INGEST_TOKEN))
    ]);
    if (constantTimeEqualBytes(tokenDigest, ingestDigest)) {
      return unauth();
    }
  }

  const payload = await verifyToken(token, env);
  if (!payload) return unauth();

  const row = await env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`
  )
    .bind(payload.sub)
    .first();

  if (!row) return unauth();
  return { user: sanitizeUser(row), errorResponse: null };
}

export async function handleRegister(request, env, corsHeaders = {}) {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const name = cleanQuery(body.name);
  if (name.length < 2 || name.length > 80) {
    return json({ error: "O nome deve ter entre 2 e 80 caracteres." }, 400, corsHeaders);
  }

  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json({ error: "Informe um e-mail válido." }, 400, corsHeaders);
  }

  if (!isValidPassword(body.password)) {
    return json({ error: "A senha deve ter entre 6 e 128 caracteres." }, 400, corsHeaders);
  }

  const existing = await env.DB.prepare(
    "SELECT id FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1"
  )
    .bind(email)
    .first();

  if (existing) {
    return json({ error: "Este e-mail já está cadastrado." }, 409, corsHeaders);
  }

  const passwordHash = await hashPassword(body.password);

  let insertResult;
  try {
    insertResult = await env.DB.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')"
    )
      .bind(name, email, passwordHash)
      .run();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: "Este e-mail já está cadastrado." }, 409, corsHeaders);
    }
    throw err;
  }

  const insertedId = insertResult?.meta?.last_row_id;
  const userRow = insertedId
    ? await env.DB.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`)
        .bind(insertedId)
        .first()
    : await env.DB.prepare(
        `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`
      )
        .bind(email)
        .first();

  if (!userRow) {
    return json({ error: "Não foi possível concluir o cadastro." }, 500, corsHeaders);
  }

  const user = sanitizeUser(userRow);
  const token = await signToken(user, env);
  return json({ user, token }, 201, corsHeaders);
}

export async function handleLogin(request, env, corsHeaders = {}) {
  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) {
    return json({ error: "Informe um e-mail válido." }, 400, corsHeaders);
  }

  if (typeof body.password !== "string" || body.password.length === 0) {
    return json({ error: "Informe a senha." }, 400, corsHeaders);
  }

  const row = await env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLUMNS}, password_hash FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1`
  )
    .bind(email)
    .first();

  if (!row || body.password.length > 128) {
    return json({ error: "E-mail ou senha inválidos." }, 401, corsHeaders);
  }

  const valid = await verifyPassword(body.password, row.password_hash);
  if (!valid) {
    return json({ error: "E-mail ou senha inválidos." }, 401, corsHeaders);
  }

  const user = sanitizeUser(row);
  const token = await signToken(user, env);
  return json({ user, token }, 200, corsHeaders);
}

export async function handleGetMe(request, env, corsHeaders = {}) {
  const auth = await requireAuth(request, env, corsHeaders);
  if (auth.errorResponse) return auth.errorResponse;
  return json({ user: auth.user }, 200, corsHeaders);
}

export async function handleUpdateMe(request, env, corsHeaders = {}) {
  const auth = await requireAuth(request, env, corsHeaders);
  if (auth.errorResponse) return auth.errorResponse;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const hasName = body.name !== undefined;
  const hasEmail = body.email !== undefined;
  const hasPassword = body.password !== undefined;

  if (!hasName && !hasEmail && !hasPassword) {
    return json(
      { error: "Informe ao menos um campo para atualizar (name, email ou password)." },
      400,
      corsHeaders
    );
  }

  const updates = [];
  const params = [];

  if (hasName) {
    const name = cleanQuery(body.name);
    if (name.length < 2 || name.length > 80) {
      return json({ error: "O nome deve ter entre 2 e 80 caracteres." }, 400, corsHeaders);
    }
    updates.push("name = ?");
    params.push(name);
  }

  if (hasEmail) {
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) {
      return json({ error: "Informe um e-mail válido." }, 400, corsHeaders);
    }

    const existing = await env.DB.prepare(
      "SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1"
    )
      .bind(email, auth.user.id)
      .first();

    if (existing) {
      return json({ error: "Este e-mail já está cadastrado." }, 409, corsHeaders);
    }

    updates.push("email = ?");
    params.push(email);
  }

  if (hasPassword) {
    if (!isValidPassword(body.password)) {
      return json({ error: "A senha deve ter entre 6 e 128 caracteres." }, 400, corsHeaders);
    }

    if (body.current_password !== undefined) {
      if (typeof body.current_password !== "string" || body.current_password.length === 0) {
        return json({ error: "Informe a senha atual." }, 400, corsHeaders);
      }

      const currentRow = await env.DB.prepare(
        "SELECT password_hash FROM users WHERE id = ? LIMIT 1"
      )
        .bind(auth.user.id)
        .first();

      const validCurrent = await verifyPassword(body.current_password, currentRow?.password_hash);
      if (!validCurrent) {
        return json({ error: "Senha atual incorreta." }, 401, corsHeaders);
      }
    }

    const passwordHash = await hashPassword(body.password);
    updates.push("password_hash = ?");
    params.push(passwordHash);
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(auth.user.id);

  try {
    await env.DB.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...params)
      .run();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return json({ error: "Este e-mail já está cadastrado." }, 409, corsHeaders);
    }
    throw err;
  }

  const updatedRow = await env.DB.prepare(
    `SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`
  )
    .bind(auth.user.id)
    .first();

  return json({ user: sanitizeUser(updatedRow) }, 200, corsHeaders);
}

export async function handleAuth(request, env, path, corsHeaders = {}) {
  const method = request.method;

  if (method === "POST" && path === "/auth/register") {
    return handleRegister(request, env, corsHeaders);
  }
  if (method === "POST" && path === "/auth/login") {
    return handleLogin(request, env, corsHeaders);
  }
  if (method === "GET" && (path === "/users/me" || path === "/auth/me")) {
    return handleGetMe(request, env, corsHeaders);
  }
  if ((method === "PUT" || method === "PATCH") && path === "/users/me") {
    return handleUpdateMe(request, env, corsHeaders);
  }

  return null;
}
