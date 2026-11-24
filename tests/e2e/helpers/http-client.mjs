import assert from "node:assert/strict";
import crypto from "node:crypto";

let seq = 0;

/**
 * Sends an HTTP request and parses JSON safely when present.
 */
export async function requestJson(
  baseUrl,
  pathname,
  { method = "GET", body, token, headers = {}, ip } = {}
) {
  const mergedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    mergedHeaders[k.toLowerCase()] = v;
  }

  if (token && !mergedHeaders["authorization"]) {
    mergedHeaders["authorization"] = `Bearer ${token}`;
  }
  if (ip && !mergedHeaders["cf-connecting-ip"]) {
    mergedHeaders["cf-connecting-ip"] = ip;
  }

  let payload;
  if (body !== undefined) {
    if (typeof body === "string") {
      payload = body;
      if (!mergedHeaders["content-type"]) {
        mergedHeaders["content-type"] = "application/json";
      }
    } else {
      payload = JSON.stringify(body);
      if (!mergedHeaders["content-type"]) {
        mergedHeaders["content-type"] = "application/json";
      }
    }
  }

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: mergedHeaders,
    body: payload
  });

  const text = await res.text();
  let data = null;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  return { status: res.status, headers: res.headers, data, text };
}

/**
 * Sends an HTTP request and returns raw text without JSON parsing.
 */
export async function requestText(
  baseUrl,
  pathname,
  { method = "GET", headers = {}, ip } = {}
) {
  const mergedHeaders = {};
  for (const [k, v] of Object.entries(headers)) {
    mergedHeaders[k.toLowerCase()] = v;
  }
  if (ip && !mergedHeaders["cf-connecting-ip"]) {
    mergedHeaders["cf-connecting-ip"] = ip;
  }

  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: mergedHeaders
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/**
 * Registers a user via POST /auth/register and asserts HTTP 201.
 */
export async function registerUser(
  baseUrl,
  { name = "Usuário E2E", email = uniqueEmail(), password = "SenhaForte@2026", ip } = {}
) {
  const res = await requestJson(baseUrl, "/auth/register", {
    method: "POST",
    body: { name, email, password },
    ip
  });
  assert.equal(
    res.status,
    201,
    `Expected POST /auth/register to return 201, got ${res.status}: ${res.text}`
  );
  assert.ok(res.data?.user, "Expected response JSON to contain user");
  assert.ok(
    typeof res.data?.token === "string" && res.data.token.length > 0,
    "Expected response JSON to contain non-empty token"
  );
  return { user: res.data.user, token: res.data.token, res };
}

/**
 * Generates a unique email address for isolated E2E test runs.
 */
export function uniqueEmail(prefix = "e2e") {
  seq += 1;
  const rand = crypto.randomUUID().slice(0, 8);
  return `${prefix}.${seq}.${rand}@example.com`;
}

/**
 * Generates a unique keyword (within 3..100 chars) for isolated E2E test runs.
 */
export function uniqueKeyword(prefix = "E2E Termo") {
  seq += 1;
  const rand = crypto.randomUUID().slice(0, 6);
  return `${prefix} ${seq} ${rand}`;
}
