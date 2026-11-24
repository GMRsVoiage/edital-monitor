import { cleanQuery } from "./validation.js";

export { cleanQuery };

export const DEFAULT_API_URL = "http://127.0.0.1:8787";
export const TOKEN_STORAGE_KEY = "edital_monitor_token";

export function getApiBaseUrl() {
  let metaUrl = "";
  if (typeof document !== "undefined") {
    try {
      const meta = document.querySelector('meta[name="edital-api-url"]');
      metaUrl = meta?.getAttribute("content") || "";
    } catch {
      metaUrl = "";
    }
  }
  const envUrl =
    typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL
      : "";
  const raw = (metaUrl && metaUrl.trim()) || envUrl || DEFAULT_API_URL;
  const cleaned = String(raw).trim().replace(/\/+$/, "");
  return cleaned || DEFAULT_API_URL;
}

export const API_BASE_URL = getApiBaseUrl();

export function getToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, String(token));
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota or restricted-mode errors
  }
}

export function clearToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage access errors
  }
}

export function logoutUser() {
  clearToken();
}

export class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function defaultStatusMessage(status) {
  switch (status) {
    case 400:
      return "Dados inválidos. Verifique os campos informados.";
    case 401:
      return "Autenticação necessária ou credenciais inválidas.";
    case 403:
      return "Você não tem permissão para acessar este recurso.";
    case 404:
      return "Registro não encontrado.";
    case 409:
      return "Conflito de dados: registro duplicado ou vinculado a outros itens.";
    case 415:
      return "Formato de requisição não suportado.";
    case 429:
      return "Limite diário de pesquisas atingido.";
    case 500:
    case 502:
    case 503:
    case 504:
      return "Serviço temporariamente indisponível.";
    default:
      return `Erro na requisição (HTTP ${status}).`;
  }
}

export function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(params || {})) {
    if (rawValue === undefined || rawValue === null) continue;
    if (key === "active") {
      if (rawValue === "" || rawValue === "all") continue;
      if (rawValue === true || rawValue === 1 || rawValue === "1") {
        searchParams.set("active", "1");
      } else if (rawValue === false || rawValue === 0 || rawValue === "0") {
        searchParams.set("active", "0");
      } else {
        searchParams.set("active", String(rawValue));
      }
      continue;
    }
    const str = typeof rawValue === "string" ? rawValue.trim() : String(rawValue);
    if (str === "") continue;
    searchParams.set(key, str);
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

function encodeId(id) {
  return encodeURIComponent(String(id ?? "").trim());
}

function normalizeKeywordPayload(
  payload = {},
  { partial = false, allowNullEmptyGroup = partial } = {}
) {
  const body = {};
  if (!partial || payload.keyword !== undefined) {
    body.keyword = cleanQuery(payload.keyword);
  }
  if (!partial || payload.description !== undefined) {
    body.description =
      typeof payload.description === "string" ? payload.description.trim() : "";
  }
  if (!partial || payload.priority !== undefined) {
    if (payload.priority !== undefined) {
      body.priority = String(payload.priority).trim().toLowerCase();
    }
  }
  if (!partial || payload.target_section !== undefined) {
    if (payload.target_section !== undefined) {
      body.target_section = cleanQuery(payload.target_section) || "geral";
    }
  }
  if (!partial || payload.group_id !== undefined) {
    if (payload.group_id === "" || payload.group_id === null || payload.group_id === undefined) {
      if (payload.group_id === null || (allowNullEmptyGroup && payload.group_id === "")) {
        body.group_id = null;
      }
    } else {
      const numericGroupId = Number(payload.group_id);
      body.group_id = Number.isNaN(numericGroupId) ? payload.group_id : numericGroupId;
    }
  }
  if (!partial || payload.is_active !== undefined) {
    if (payload.is_active !== undefined) {
      const activeStr =
        typeof payload.is_active === "string" ? payload.is_active.trim().toLowerCase() : null;
      body.is_active =
        payload.is_active === false ||
        payload.is_active === 0 ||
        activeStr === "0" ||
        activeStr === "false"
          ? 0
          : 1;
    }
  }
  return body;
}

export async function request(path, options = {}) {
  const baseUrl = getApiBaseUrl();
  const method = options.method || "GET";
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");

  const token = options.token !== undefined ? options.token : getToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let body;
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: options.signal
    });
  } catch (err) {
    throw new ApiError(0, "Não foi possível conectar à API no momento.", {
      cause: err?.message || "Network error"
    });
  }

  const text = await response.text();
  let parsed = null;
  if (text && text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!response.ok) {
    const message =
      (parsed && typeof parsed === "object" && (parsed.error || parsed.message)) ||
      defaultStatusMessage(response.status);
    const retryAfter = response.headers.get("retry-after");
    const details =
      parsed && typeof parsed === "object"
        ? { ...parsed, ...(retryAfter ? { retryAfter } : {}) }
        : retryAfter
          ? { retryAfter }
          : null;
    throw new ApiError(response.status, message, details);
  }

  return parsed;
}

export async function fetchStats(options = {}) {
  return request("/stats", options);
}

export async function searchBulletins(query, options = {}) {
  const q = cleanQuery(query);
  const qs = buildQueryString({ q });
  return request(`/search${qs}`, options);
}

export async function registerUser({ name, email, password }, options = {}) {
  const data = await request("/auth/register", {
    ...options,
    method: "POST",
    token: null,
    body: {
      name: cleanQuery(name),
      email: String(email ?? "").normalize("NFKC").trim().toLowerCase(),
      password: String(password ?? "")
    }
  });
  if (data?.token) {
    setToken(data.token);
  }
  return data;
}

export async function loginUser({ email, password }, options = {}) {
  const data = await request("/auth/login", {
    ...options,
    method: "POST",
    token: null,
    body: {
      email: String(email ?? "").normalize("NFKC").trim().toLowerCase(),
      password: String(password ?? "")
    }
  });
  if (data?.token) {
    setToken(data.token);
  }
  return data;
}

export async function fetchCurrentUser(tokenOrOptions) {
  const options =
    typeof tokenOrOptions === "string"
      ? { token: tokenOrOptions }
      : tokenOrOptions && typeof tokenOrOptions === "object"
        ? tokenOrOptions
        : {};
  return request("/users/me", options);
}

export async function updateCurrentUser(payload = {}, options = {}) {
  const method = options.method === "PUT" ? "PUT" : "PATCH";
  return request("/users/me", {
    ...options,
    method,
    body: payload
  });
}

export async function fetchGroups(filters = {}, options = {}) {
  const qs = buildQueryString(filters);
  return request(`/groups${qs}`, options);
}

export async function createGroup(payload = {}, options = {}) {
  return request("/groups", {
    ...options,
    method: "POST",
    body: payload
  });
}

export async function updateGroup(id, payload = {}, options = {}) {
  const method = options.method === "PATCH" ? "PATCH" : "PUT";
  return request(`/groups/${encodeId(id)}`, {
    ...options,
    method,
    body: payload
  });
}

export async function deleteGroup(id, options = {}) {
  return request(`/groups/${encodeId(id)}`, {
    ...options,
    method: "DELETE"
  });
}

export async function fetchKeywords(filters = {}, options = {}) {
  const qs = buildQueryString(filters);
  return request(`/keywords${qs}`, options);
}

export async function createKeyword(payload = {}, options = {}) {
  return request("/keywords", {
    ...options,
    method: "POST",
    body: normalizeKeywordPayload(payload, { partial: false })
  });
}

export async function updateKeyword(id, payload = {}, options = {}) {
  return request(`/keywords/${encodeId(id)}`, {
    ...options,
    method: "PUT",
    body: normalizeKeywordPayload(payload, { partial: false, allowNullEmptyGroup: true })
  });
}

export async function patchKeyword(id, payload = {}, options = {}) {
  return request(`/keywords/${encodeId(id)}`, {
    ...options,
    method: "PATCH",
    body: normalizeKeywordPayload(payload, { partial: true })
  });
}

export async function deleteKeyword(id, options = {}) {
  return request(`/keywords/${encodeId(id)}`, {
    ...options,
    method: "DELETE"
  });
}

export async function scanKeyword(id, options = {}) {
  return request(`/keywords/${encodeId(id)}/scan`, {
    ...options,
    method: "POST",
    body: {}
  });
}

export async function fetchAlerts(filters = {}, options = {}) {
  const qs = buildQueryString(filters);
  return request(`/alerts${qs}`, options);
}

export async function createAlert(payload = {}, options = {}) {
  return request("/alerts", {
    ...options,
    method: "POST",
    body: payload
  });
}

export async function updateAlert(id, payload = {}, options = {}) {
  const method = options.method === "PUT" ? "PUT" : "PATCH";
  return request(`/alerts/${encodeId(id)}`, {
    ...options,
    method,
    body: payload
  });
}

export async function deleteAlert(id, options = {}) {
  return request(`/alerts/${encodeId(id)}`, {
    ...options,
    method: "DELETE"
  });
}

export async function fetchReports(filters = {}, options = {}) {
  const qs = buildQueryString(filters);
  return request(`/reports${qs}`, options);
}
