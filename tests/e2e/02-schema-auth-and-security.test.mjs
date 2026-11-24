import assert from "node:assert/strict";
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

function assertNoSecretKeys(obj, context = "response") {
  const raw = JSON.stringify(obj);
  assert.ok(!raw.includes('"password"'), `Unexpected "password" key in ${context}`);
  assert.ok(!raw.includes('"password_hash"'), `Unexpected "password_hash" key in ${context}`);
}

describe("02 — Schema (#9), Auth (#4-#6), Profile (#7), and Security (#8)", () => {
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
  // Feature 4: User Registration (RF001) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F04-01: POST /auth/register with valid payload returns 201 with user and token", async () => {
    const email = uniqueEmail("reg1");
    const res = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "Ana Silva", email, password: "SenhaForte@2026" }
    });
    assert.equal(res.status, 201);
    assert.equal(typeof res.data?.user?.id, "number");
    assert.equal(res.data?.user?.name, "Ana Silva");
    assert.equal(res.data?.user?.email, email.toLowerCase());
    assert.equal(res.data?.user?.role, "user");
    assert.ok(typeof res.data?.user?.created_at === "string" && res.data.user.created_at.length > 0);
    assert.ok(typeof res.data?.token === "string" && res.data.token.length > 10);
  });

  test("T1-F04-02: Registered user can immediately fetch GET /users/me using returned token", async () => {
    const email = uniqueEmail("reg2");
    const { user, token } = await registerUser(worker.url, {
      name: "Carlos Souza",
      email,
      password: "SenhaForte@2026"
    });
    const me = await requestJson(worker.url, "/users/me", { token });
    assert.equal(me.status, 200);
    assert.equal(me.data?.user?.id, user.id);
    assert.equal(me.data?.user?.name, "Carlos Souza");
    assert.equal(me.data?.user?.email, email.toLowerCase());
  });

  test("T1-F04-03: POST /auth/register response omits password and password_hash", async () => {
    const { res } = await registerUser(worker.url, {
      name: "Sem Vazamento",
      password: "SenhaForte@2026"
    });
    assertNoSecretKeys(res.data, "POST /auth/register");
  });

  test("T1-F04-04: POST /auth/register persists user row in local D1 users table", async () => {
    const email = uniqueEmail("regdb");
    const { user } = await registerUser(worker.url, {
      name: "Persistido D1",
      email,
      password: "SenhaForte@2026"
    });
    const row = sandbox.queryOne(
      "SELECT id, name, email, role FROM users WHERE email = ?",
      [email.toLowerCase()]
    );
    assert.ok(row, "Expected user row in D1 users table");
    assert.equal(row.id, user.id);
    assert.equal(row.name, "Persistido D1");
    assert.equal(row.role, "user");
  });

  test("T1-F04-05: Registration normalizes email case/whitespace and returns expected JSON contract", async () => {
    const rawEmail = `  ${uniqueEmail("NormCase").toUpperCase()}  `;
    const res = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "  Maria   Helena ", email: rawEmail, password: "SenhaForte@2026" }
    });
    assert.equal(res.status, 201);
    assert.ok(res.headers.get("content-type")?.includes("application/json"));
    assert.equal(res.data?.user?.email, rawEmail.trim().toLowerCase());
    assert.equal(res.data?.user?.name, "Maria Helena");
    assert.ok(typeof res.data?.user?.updated_at === "string");
  });

  test("T2-F04-01: Duplicate email on POST /auth/register (exact and case/whitespace variant) returns 409", async () => {
    const email = uniqueEmail("dup");
    await registerUser(worker.url, { name: "Primeiro", email, password: "SenhaForte@2026" });

    const exactDup = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "Segundo", email, password: "SenhaForte@2026" }
    });
    assert.equal(exactDup.status, 409);
    assert.ok(typeof exactDup.data?.error === "string" && exactDup.data.error.length > 0);

    const caseDup = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: { name: "Terceiro", email: `  ${email.toUpperCase()}  `, password: "SenhaForte@2026" }
    });
    assert.equal(caseDup.status, 409);
  });

  test("T2-F04-02: Invalid name (missing, whitespace-only, <2 chars, >120 chars) returns 400", async () => {
    for (const badName of [undefined, "", "   ", "A", "x".repeat(121)]) {
      const res = await requestJson(worker.url, "/auth/register", {
        method: "POST",
        body: { name: badName, email: uniqueEmail("badname"), password: "SenhaForte@2026" }
      });
      assert.equal(res.status, 400, `Expected 400 for name=${JSON.stringify(badName)}, got ${res.status}`);
    }
  });

  test("T2-F04-03: Malformed email addresses return 400 on POST /auth/register", async () => {
    for (const badEmail of ["not-an-email", "a@b", "@domain.com", "user@domain", ""]) {
      const res = await requestJson(worker.url, "/auth/register", {
        method: "POST",
        body: { name: "Email Test", email: badEmail, password: "SenhaForte@2026" }
      });
      assert.equal(res.status, 400, `Expected 400 for email=${badEmail}, got ${res.status}`);
    }
  });

  test("T2-F04-04: Weak or short password returns 400 on POST /auth/register", async () => {
    for (const badPassword of ["", "123", "12345"]) {
      const res = await requestJson(worker.url, "/auth/register", {
        method: "POST",
        body: { name: "Weak Pass", email: uniqueEmail("weak"), password: badPassword }
      });
      assert.equal(res.status, 400, `Expected 400 for weak password=${JSON.stringify(badPassword)}`);
    }
  });

  test("T2-F04-05: Role escalation attempt in POST /auth/register never grants admin role", async () => {
    const email = uniqueEmail("noesc");
    const res = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: {
        name: "Regular User",
        email,
        password: "SenhaForte@2026",
        role: "admin"
      }
    });
    assert.ok(res.status === 201 || res.status === 400, `Expected 201 or 400, got ${res.status}`);
    if (res.status === 201) {
      assert.equal(res.data?.user?.role, "user");
      const row = sandbox.queryOne("SELECT role FROM users WHERE email = ?", [email]);
      assert.equal(row?.role, "user");
    }
  });

  // =========================================================================
  // Feature 5: Password Hashing (RNF004) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F05-01: D1 users.password_hash stores salted PBKDF2-SHA256 hash, never plaintext", async () => {
    const plain = "SenhaForte@2026";
    const email = uniqueEmail("hash1");
    await registerUser(worker.url, { name: "Hash Check", email, password: plain });

    const row = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email]);
    assert.ok(row?.password_hash, "Expected non-empty password_hash in D1");
    assert.notEqual(row.password_hash, plain);
    assert.ok(!row.password_hash.includes(plain), "Hash must not contain plaintext password");
    const hashParts = row.password_hash.split("$").filter(Boolean);
    assert.ok(
      row.password_hash.length >= 32 &&
        /^pbkdf2/i.test(row.password_hash) &&
        hashParts.length >= 3,
      `Expected salted PBKDF2-SHA256 multi-segment hash format, got "${row.password_hash}"`
    );
  });

  test("T1-F05-02: Two users with identical password receive distinct salted password_hash values in D1", async () => {
    const sharedPass = "MesmaSenha@2026";
    const email1 = uniqueEmail("salt1");
    const email2 = uniqueEmail("salt2");
    await registerUser(worker.url, { name: "Salt One", email: email1, password: sharedPass });
    await registerUser(worker.url, { name: "Salt Two", email: email2, password: sharedPass });

    const r1 = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email1]);
    const r2 = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email2]);
    assert.ok(r1?.password_hash && r2?.password_hash);
    assert.notEqual(r1.password_hash, r2.password_hash, "Per-user salts must produce distinct hashes");
  });

  test("T1-F05-03: POST /auth/login verifies password against stored PBKDF2 hash", async () => {
    const email = uniqueEmail("verify");
    await registerUser(worker.url, { name: "Login Hash", email, password: "SenhaForte@2026" });

    const loginOk = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaForte@2026" }
    });
    assert.equal(loginOk.status, 200);
    assert.equal(loginOk.data?.user?.email, email);
    assert.ok(typeof loginOk.data?.token === "string" && loginOk.data.token.length > 0);
  });

  test("T1-F05-04: PUT /users/me password change updates D1 users.password_hash to a new salted hash", async () => {
    const email = uniqueEmail("pwupd");
    const oldPass = "SenhaAntiga@2026";
    const newPass = "SenhaNova@2026";
    const { token } = await registerUser(worker.url, {
      name: "Pw Update",
      email,
      password: oldPass
    });

    const beforeRow = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email]);
    const upd = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      body: {
        name: "Pw Update",
        email,
        current_password: oldPass,
        password: newPass
      }
    });
    assert.equal(upd.status, 200);

    const afterRow = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email]);
    assert.ok(afterRow?.password_hash);
    assert.notEqual(afterRow.password_hash, beforeRow.password_hash);
    assert.notEqual(afterRow.password_hash, newPass);
    assert.ok(!afterRow.password_hash.includes(newPass));
  });

  test("T1-F05-05: No auth/user/report endpoint ever returns password or password_hash in JSON", async () => {
    const email = uniqueEmail("noleak");
    const reg = await registerUser(worker.url, {
      name: "No Leak",
      email,
      password: "SenhaForte@2026"
    });
    assertNoSecretKeys(reg.res.data, "/auth/register");

    const login = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaForte@2026" }
    });
    assert.equal(login.status, 200);
    assertNoSecretKeys(login.data, "/auth/login");

    const me = await requestJson(worker.url, "/users/me", { token: login.data.token });
    assert.equal(me.status, 200);
    assertNoSecretKeys(me.data, "/users/me");

    const reports = await requestJson(worker.url, "/reports", { token: login.data.token });
    assert.equal(reports.status, 200);
    assertNoSecretKeys(reports.data, "/reports");
  });

  test("T2-F05-01: Unicode and special characters in password hash and verify cleanly", async () => {
    const email = uniqueEmail("uni");
    const unicodePass = "Senh@çã0!#🚀2026";
    await registerUser(worker.url, { name: "Unicode Pass", email, password: unicodePass });

    const login = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: unicodePass }
    });
    assert.equal(login.status, 200);
  });

  test("T2-F05-02: Extremely long password (>1024 chars) is rejected cleanly with 400", async () => {
    const res = await requestJson(worker.url, "/auth/register", {
      method: "POST",
      body: {
        name: "Long Pass",
        email: uniqueEmail("longpw"),
        password: "A".repeat(1025)
      }
    });
    assert.equal(res.status, 400);
  });

  test("T2-F05-03: Password differing by 1 character or wrong case fails login with 401", async () => {
    const email = uniqueEmail("casepw");
    await registerUser(worker.url, {
      name: "Case Pw",
      email,
      password: "SenhaForte@2026"
    });

    const wrongCase = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "senhaforte@2026" }
    });
    assert.equal(wrongCase.status, 401);

    const wrongChar = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaForte@2027" }
    });
    assert.equal(wrongChar.status, 401);
  });

  test("T2-F05-04: Non-string password (number, null, object) returns 400 without 500 error", async () => {
    for (const nonStr of [12345678, null, { secret: "abc" }]) {
      const reg = await requestJson(worker.url, "/auth/register", {
        method: "POST",
        body: { name: "Non String", email: uniqueEmail("nonstr"), password: nonStr }
      });
      assert.equal(reg.status, 400);

      const login = await requestJson(worker.url, "/auth/login", {
        method: "POST",
        body: { email: uniqueEmail("nonstr2"), password: nonStr }
      });
      assert.equal(login.status, 400);
    }
  });

  test("T2-F05-05: Direct D1 inspection confirms password_hash is replaced in-place on update", async () => {
    const email = uniqueEmail("replace");
    const oldPass = "Antiga@2026";
    const newPass = "Atualizada@2026";
    const { token } = await registerUser(worker.url, {
      name: "Replace Hash",
      email,
      password: oldPass
    });

    const before = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email]);
    const patchRes = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { current_password: oldPass, password: newPass }
    });
    assert.equal(patchRes.status, 200);

    const after = sandbox.queryOne("SELECT password_hash FROM users WHERE email = ?", [email]);
    assert.notEqual(after.password_hash, before.password_hash);
    assert.ok(!after.password_hash.includes(before.password_hash));
    assert.notEqual(after.password_hash, newPass);
  });

  // =========================================================================
  // Feature 6: User Authentication & Identity (RF003) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F06-01: POST /auth/login returns 200 with matching user and signed token", async () => {
    const email = uniqueEmail("login1");
    await registerUser(worker.url, { name: "Login One", email, password: "SenhaForte@2026" });

    const res = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaForte@2026" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data?.user?.email, email);
    assert.ok(typeof res.data?.token === "string" && res.data.token.includes("."));
  });

  test("T1-F06-02: GET /users/me with Bearer token returns authenticated user identity", async () => {
    const email = uniqueEmail("me1");
    const { user, token } = await registerUser(worker.url, { name: "Me User", email });
    const res = await requestJson(worker.url, "/users/me", { token });
    assert.equal(res.status, 200);
    assert.equal(res.data?.user?.id, user.id);
    assert.equal(res.data?.user?.name, "Me User");
    assert.equal(res.data?.user?.email, email);
  });

  test("T1-F06-03: GET /auth/me alias returns identical user identity payload", async () => {
    const email = uniqueEmail("authme");
    const { token } = await registerUser(worker.url, { name: "Alias User", email });

    const usersMe = await requestJson(worker.url, "/users/me", { token });
    const authMe = await requestJson(worker.url, "/auth/me", { token });
    assert.equal(usersMe.status, 200);
    assert.equal(authMe.status, 200);
    assert.deepEqual(authMe.data?.user, usersMe.data?.user);
  });

  test("T1-F06-04: Token issued on POST /auth/login works across protected routes", async () => {
    const email = uniqueEmail("logintok");
    await registerUser(worker.url, { name: "Multi Route", email, password: "SenhaForte@2026" });
    const login = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaForte@2026" }
    });
    assert.equal(login.status, 200);
    const tok = login.data.token;

    const kwList = await requestJson(worker.url, "/keywords", { token: tok });
    assert.equal(kwList.status, 200);

    const grp = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: tok,
      body: { name: "Grupo Login Test" }
    });
    assert.equal(grp.status, 201);

    const rep = await requestJson(worker.url, "/reports", { token: tok });
    assert.equal(rep.status, 200);
  });

  test("T1-F06-05: Tokens issued for distinct users are distinct and bind to respective identities", async () => {
    const u1 = await registerUser(worker.url, { name: "Identidade A" });
    const u2 = await registerUser(worker.url, { name: "Identidade B" });
    assert.notEqual(u1.token, u2.token);

    const me1 = await requestJson(worker.url, "/users/me", { token: u1.token });
    const me2 = await requestJson(worker.url, "/users/me", { token: u2.token });
    assert.equal(me1.data?.user?.id, u1.user.id);
    assert.equal(me2.data?.user?.id, u2.user.id);
    assert.notEqual(me1.data?.user?.id, me2.data?.user?.id);
  });

  test("T2-F06-01: POST /auth/login with unregistered email returns 401", async () => {
    const res = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email: uniqueEmail("missing"), password: "SenhaForte@2026" }
    });
    assert.equal(res.status, 401);
    assert.ok(typeof res.data?.error === "string" && res.data.error.length > 0);
  });

  test("T2-F06-02: GET /users/me with Basic auth or empty Bearer token returns 401", async () => {
    const basic = await requestJson(worker.url, "/users/me", {
      headers: { authorization: "Basic dXNlcjpwYXNz" }
    });
    assert.equal(basic.status, 401);

    const emptyBearer = await requestJson(worker.url, "/users/me", {
      headers: { authorization: "Bearer " }
    });
    assert.equal(emptyBearer.status, 401);
  });

  test("T2-F06-03: GET /users/me with tampered HMAC signature returns 401", async () => {
    const { token } = await registerUser(worker.url, { name: "Tamper Test" });
    const lastChar = token.slice(-1);
    const flipped = lastChar === "a" ? "b" : "a";
    const tampered = token.slice(0, -1) + flipped;

    const res = await requestJson(worker.url, "/users/me", { token: tampered });
    assert.equal(res.status, 401);
  });

  test("T2-F06-04: GET /users/me with forged or expired token returns 401", async () => {
    const expiredPayload = Buffer.from(
      JSON.stringify({ sub: 1, exp: Math.floor(Date.now() / 1000) - 3600 })
    ).toString("base64url");
    const forgedJwt = `eyJhbGciOiJIUzI1NiJ9.${expiredPayload}.forged_signature`;
    const res1 = await requestJson(worker.url, "/users/me", { token: forgedJwt });
    assert.equal(res1.status, 401);

    const expiredTwoPart = `${expiredPayload}.forged_signature`;
    const res2 = await requestJson(worker.url, "/users/me", { token: expiredTwoPart });
    assert.equal(res2.status, 401);
  });

  test("T2-F06-05: POST /auth/login with missing email or password returns 400", async () => {
    const noPass = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email: uniqueEmail("nopass") }
    });
    assert.equal(noPass.status, 400);

    const noEmail = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { password: "SenhaForte@2026" }
    });
    assert.equal(noEmail.status, 400);
  });

  // =========================================================================
  // Feature 7: Authenticated User Profile Edit (RF002) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F07-01: PUT /users/me updates name and email and returns 200 { user }", async () => {
    const { user, token } = await registerUser(worker.url, { name: "Nome Original" });
    const newEmail = uniqueEmail("putme");
    const res = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      body: { name: "Novo Nome", email: newEmail }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data?.user?.id, user.id);
    assert.equal(res.data?.user?.name, "Novo Nome");
    assert.equal(res.data?.user?.email, newEmail);
  });

  test("T1-F07-02: PATCH /users/me updates only name while preserving existing email", async () => {
    const email = uniqueEmail("patchme");
    const { token } = await registerUser(worker.url, { name: "Antes", email });
    const res = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { name: "Nome Parcial" }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data?.user?.name, "Nome Parcial");
    assert.equal(res.data?.user?.email, email);
  });

  test("T1-F07-03: PUT/PATCH /users/me updates users.updated_at in D1", async () => {
    const email = uniqueEmail("updts");
    const { token } = await registerUser(worker.url, { name: "Antes TS", email });
    const before = sandbox.queryOne(
      "SELECT created_at, updated_at FROM users WHERE email = ?",
      [email]
    );
    await sleep(1100);

    const res = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { name: "Depois TS" }
    });
    assert.equal(res.status, 200);

    const after = sandbox.queryOne(
      "SELECT created_at, updated_at FROM users WHERE email = ?",
      [email]
    );
    assert.equal(after.created_at, before.created_at);
    assert.ok(
      after.updated_at > before.updated_at,
      `Expected updated_at (${after.updated_at}) > created_at (${before.updated_at})`
    );
  });

  test("T1-F07-04: PATCH /users/me with current_password and new password updates login credential", async () => {
    const email = uniqueEmail("pwrot");
    const oldPass = "SenhaInicial@2026";
    const newPass = "SenhaRotacionada@2026";
    const { token } = await registerUser(worker.url, {
      name: "Rotação",
      email,
      password: oldPass
    });

    const patchRes = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { current_password: oldPass, password: newPass }
    });
    assert.equal(patchRes.status, 200);

    const loginNew = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: newPass }
    });
    assert.equal(loginNew.status, 200);
  });

  test("T1-F07-05: GET /users/me reflects profile updates immediately across requests without secret leaks", async () => {
    const { token } = await registerUser(worker.url, { name: "Perfil Inicial" });
    const updatedEmail = uniqueEmail("perfilref");
    const putRes = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      body: { name: "Perfil Atualizado", email: updatedEmail }
    });
    assert.equal(putRes.status, 200);

    const meRes = await requestJson(worker.url, "/users/me", { token });
    assert.equal(meRes.status, 200);
    assert.equal(meRes.data?.user?.name, "Perfil Atualizado");
    assert.equal(meRes.data?.user?.email, updatedEmail);
    assertNoSecretKeys(meRes.data, "GET /users/me after update");
  });

  test("T2-F07-01: PUT /users/me changing email to another user's email returns 409", async () => {
    const emailA = uniqueEmail("profA");
    const emailB = uniqueEmail("profB");
    const userA = await registerUser(worker.url, { name: "Prof A", email: emailA });
    await registerUser(worker.url, { name: "Prof B", email: emailB });

    const conflict = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token: userA.token,
      body: { name: "Prof A", email: emailB }
    });
    assert.equal(conflict.status, 409);
  });

  test("T2-F07-02: PUT and PATCH /users/me without Authorization header return 401", async () => {
    const putUnauth = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      body: { name: "Anon", email: uniqueEmail("anon") }
    });
    assert.equal(putUnauth.status, 401);

    const patchUnauth = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      body: { name: "Anon" }
    });
    assert.equal(patchUnauth.status, 401);
  });

  test("T2-F07-03: PATCH /users/me with empty {} returns 400 and role field never elevates to admin", async () => {
    const { token } = await registerUser(worker.url, { name: "Role Guard" });
    const emptyPatch = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: {}
    });
    assert.equal(emptyPatch.status, 400);

    const roleAttempt = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { role: "admin" }
    });
    assert.ok(roleAttempt.status === 400 || roleAttempt.status === 200);
    if (roleAttempt.status === 200) {
      assert.equal(roleAttempt.data?.user?.role, "user");
    }
  });

  test("T2-F07-04: PATCH /users/me rejects wrong current_password (401/400) and weak new password (400)", async () => {
    const email = uniqueEmail("badpwchg");
    const { token } = await registerUser(worker.url, {
      name: "Bad Pw Change",
      email,
      password: "SenhaCorreta@2026"
    });

    const wrongCur = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { current_password: "SenhaErrada@2026", password: "NovaSenha@2026" }
    });
    assert.ok(wrongCur.status === 401 || wrongCur.status === 400);

    const weakNew = await requestJson(worker.url, "/users/me", {
      method: "PATCH",
      token,
      body: { current_password: "SenhaCorreta@2026", password: "12" }
    });
    assert.equal(weakNew.status, 400);

    const loginStillWorks = await requestJson(worker.url, "/auth/login", {
      method: "POST",
      body: { email, password: "SenhaCorreta@2026" }
    });
    assert.equal(loginStillWorks.status, 200);
  });

  test("T2-F07-05: PUT /users/me normalizes whitespace-padded name and persists cleanly", async () => {
    const { user, token } = await registerUser(worker.url, { name: "Antes Trim" });
    const res = await requestJson(worker.url, "/users/me", {
      method: "PUT",
      token,
      body: { name: "  Maria   Clara  ", email: user.email }
    });
    assert.equal(res.status, 200);
    assert.equal(res.data?.user?.name, "Maria Clara");
  });

  // =========================================================================
  // Feature 8: Route-Level Access Control (RF009) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F08-01: Unauthenticated GET on private routes returns 401", async () => {
    for (const route of ["/users/me", "/groups", "/keywords", "/alerts", "/reports"]) {
      const res = await requestJson(worker.url, route);
      assert.equal(res.status, 401, `Expected 401 on GET ${route}, got ${res.status}`);
    }
  });

  test("T1-F08-02: Unauthenticated mutations on private routes return 401", async () => {
    const checks = [
      ["POST", "/groups", { name: "G" }],
      ["POST", "/keywords", { keyword: "Teste" }],
      ["PUT", "/keywords/1", { keyword: "Teste" }],
      ["PATCH", "/keywords/1", { priority: "alta" }],
      ["DELETE", "/keywords/1", undefined],
      ["POST", "/keywords/1/scan", undefined],
      ["POST", "/alerts", { keyword_id: 1 }]
    ];
    for (const [method, route, body] of checks) {
      const res = await requestJson(worker.url, route, { method, body });
      assert.equal(res.status, 401, `Expected 401 on ${method} ${route}, got ${res.status}`);
    }
  });

  test("T1-F08-03: Authenticated user executes full CRUD on /groups, /keywords, /alerts without INGEST_TOKEN", async () => {
    const { token } = await registerUser(worker.url, { name: "CRUD Owner" });

    const g = await requestJson(worker.url, "/groups", {
      method: "POST",
      token,
      body: { name: "Grupo Sem Ingest" }
    });
    assert.equal(g.status, 201);

    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Sem Ingest"), group_id: g.data.group.id }
    });
    assert.equal(k.status, 201);

    const a = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: k.data.keyword.id, status: "novo", matched_excerpt: "Trecho" }
    });
    assert.equal(a.status, 201);

    const delA = await requestJson(worker.url, `/alerts/${a.data.alert.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(delA.status, 200);

    const delK = await requestJson(worker.url, `/keywords/${k.data.keyword.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(delK.status, 200);

    const delG = await requestJson(worker.url, `/groups/${g.data.group.id}`, {
      method: "DELETE",
      token
    });
    assert.equal(delG.status, 200);
  });

  test("T1-F08-04: User B attempting read/mutation on User A's resources receives 403", async () => {
    const userA = await registerUser(worker.url, { name: "Owner A" });
    const userB = await registerUser(worker.url, { name: "Intruder B" });

    const g = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userA.token,
      body: { name: "Privado A" }
    });
    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("Privado A"), group_id: g.data.group.id }
    });
    const a = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token: userA.token,
      body: { keyword_id: k.data.keyword.id, status: "novo" }
    });

    assert.equal(
      (await requestJson(worker.url, `/keywords/${k.data.keyword.id}`, { token: userB.token })).status,
      403
    );
    assert.equal(
      (await requestJson(worker.url, `/groups/${g.data.group.id}`, { token: userB.token })).status,
      403
    );
    assert.equal(
      (await requestJson(worker.url, `/alerts/${a.data.alert.id}`, { token: userB.token })).status,
      403
    );
  });

  test("T1-F08-05: Public routes (/, /health, /stats, /search) succeed with 200 without Authorization", async () => {
    assert.equal((await requestJson(worker.url, "/")).status, 200);
    assert.equal((await requestJson(worker.url, "/health")).status, 200);
    assert.equal((await requestJson(worker.url, "/stats")).status, 200);
    assert.equal(
      (await requestJson(worker.url, "/search?q=Preg%C3%A3o", { ip: "203.0.113.21" })).status,
      200
    );
  });

  test("T2-F08-01: INGEST_TOKEN cannot authenticate against user CRUD routes (401)", async () => {
    const getRes = await requestJson(worker.url, "/keywords", {
      token: worker.vars.INGEST_TOKEN
    });
    assert.equal(getRes.status, 401);

    const postRes = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      body: { keyword: uniqueKeyword("Admin Token") }
    });
    assert.equal(postRes.status, 401);
  });

  test("T2-F08-02: User Bearer token cannot access /admin/known or /admin/ingest (401)", async () => {
    const { token } = await registerUser(worker.url, { name: "Not Admin" });

    const known = await requestJson(
      worker.url,
      "/admin/known?source_page_url=https://example.com",
      { token }
    );
    assert.equal(known.status, 401);

    const ingest = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token,
      body: {
        source_page_url: "https://example.com/a",
        pdf_url: "https://example.com/a.pdf",
        title: "Nope",
        pages: []
      }
    });
    assert.equal(ingest.status, 401);
  });

  test("T2-F08-03: User B receives 403 on all operations targeting User A's keyword", async () => {
    const userA = await registerUser(worker.url, { name: "KW Owner A" });
    const userB = await registerUser(worker.url, { name: "KW Attacker B" });

    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("Alvo B") }
    });
    assert.equal(k.status, 201);
    const id = k.data.keyword.id;

    assert.equal((await requestJson(worker.url, `/keywords/${id}`, { token: userB.token })).status, 403);
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}`, {
          method: "PUT",
          token: userB.token,
          body: { keyword: uniqueKeyword("Hijack") }
        })
      ).status,
      403
    );
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}`, {
          method: "PATCH",
          token: userB.token,
          body: { priority: "alta" }
        })
      ).status,
      403
    );
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}`, {
          method: "DELETE",
          token: userB.token
        })
      ).status,
      403
    );
    assert.equal(
      (
        await requestJson(worker.url, `/keywords/${id}/scan`, {
          method: "POST",
          token: userB.token
        })
      ).status,
      403
    );
  });

  test("T2-F08-04: User B receives 403 on GET/PUT/DELETE targeting User A's group", async () => {
    const userA = await registerUser(worker.url, { name: "Grp Owner A" });
    const userB = await registerUser(worker.url, { name: "Grp Attacker B" });

    const g = await requestJson(worker.url, "/groups", {
      method: "POST",
      token: userA.token,
      body: { name: "Grupo Alvo" }
    });
    assert.equal(g.status, 201);
    const gid = g.data.group.id;

    assert.equal((await requestJson(worker.url, `/groups/${gid}`, { token: userB.token })).status, 403);
    assert.equal(
      (
        await requestJson(worker.url, `/groups/${gid}`, {
          method: "PUT",
          token: userB.token,
          body: { name: "Grupo Roubado" }
        })
      ).status,
      403
    );
    assert.equal(
      (
        await requestJson(worker.url, `/groups/${gid}`, {
          method: "DELETE",
          token: userB.token
        })
      ).status,
      403
    );
  });

  test("T2-F08-05: User B receives 403 on User A's alert and on creating alert for User A's keyword", async () => {
    const userA = await registerUser(worker.url, { name: "Alert Owner A" });
    const userB = await registerUser(worker.url, { name: "Alert Attacker B" });

    const k = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token: userA.token,
      body: { keyword: uniqueKeyword("Alert Alvo") }
    });
    assert.equal(k.status, 201);
    const a = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token: userA.token,
      body: { keyword_id: k.data.keyword.id, status: "novo" }
    });
    assert.equal(a.status, 201);
    const aid = a.data.alert.id;

    assert.equal((await requestJson(worker.url, `/alerts/${aid}`, { token: userB.token })).status, 403);
    assert.equal(
      (
        await requestJson(worker.url, `/alerts/${aid}`, {
          method: "PUT",
          token: userB.token,
          body: { status: "revisado" }
        })
      ).status,
      403
    );
    assert.equal(
      (
        await requestJson(worker.url, `/alerts/${aid}`, {
          method: "DELETE",
          token: userB.token
        })
      ).status,
      403
    );
    assert.equal(
      (
        await requestJson(worker.url, "/alerts", {
          method: "POST",
          token: userB.token,
          body: { keyword_id: k.data.keyword.id, status: "novo" }
        })
      ).status,
      403
    );
  });

  // =========================================================================
  // Feature 9: Relational Persistent Schema (RNF002, RF008) — Tier 1 & Tier 2
  // =========================================================================

  test("T1-F09-01: Local D1 sqlite_master contains all baseline and new relational tables", async () => {
    const rows = sandbox.queryAll(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
    );
    const names = new Set(rows.map((r) => r.name));
    for (const expected of [
      "sources",
      "documents",
      "pages",
      "pages_fts",
      "visitor_daily",
      "ingest_log",
      "users",
      "keyword_groups",
      "saved_keywords",
      "keyword_alerts"
    ]) {
      assert.ok(names.has(expected), `Missing table ${expected} in D1 sqlite_master`);
    }
  });

  test("T1-F09-02: PRAGMA foreign_key_list verifies relational foreign keys across entities", async () => {
    const groupFks = sandbox.queryAll("PRAGMA foreign_key_list(keyword_groups)");
    assert.ok(groupFks.some((fk) => fk.from === "user_id" && fk.table === "users"));

    const kwFks = sandbox.queryAll("PRAGMA foreign_key_list(saved_keywords)");
    assert.ok(kwFks.some((fk) => fk.from === "user_id" && fk.table === "users"));
    assert.ok(
      kwFks.some(
        (fk) =>
          fk.from === "group_id" &&
          fk.table === "keyword_groups" &&
          fk.on_delete.toUpperCase() === "RESTRICT"
      )
    );

    const alertFks = sandbox.queryAll("PRAGMA foreign_key_list(keyword_alerts)");
    assert.ok(
      alertFks.some(
        (fk) =>
          fk.from === "keyword_id" &&
          fk.table === "saved_keywords" &&
          fk.on_delete.toUpperCase() === "CASCADE"
      )
    );
    assert.ok(
      alertFks.some(
        (fk) =>
          fk.from === "document_id" &&
          fk.table === "documents" &&
          fk.on_delete.toUpperCase() === "SET NULL"
      )
    );
  });

  test("T1-F09-03: seed.dev.sql populates sample documents and pages searchable via /stats and /search", async () => {
    const stats = await requestJson(worker.url, "/stats");
    assert.equal(stats.status, 200);
    assert.ok(stats.data.documents >= 4);
    assert.ok(stats.data.pages >= 9);

    const searchRes = await requestJson(worker.url, "/search?q=Preg%C3%A3o", {
      ip: "203.0.113.22"
    });
    assert.equal(searchRes.status, 200);
    assert.ok(searchRes.data.total >= 4);
  });

  test("T1-F09-04: Re-applying database/schema.sql is idempotent and preserves existing rows", async () => {
    const beforeDocs = sandbox.queryOne("SELECT COUNT(*) AS c FROM documents")?.c;
    await sandbox.executeSqlFile("../database/schema.sql");
    const afterDocs = sandbox.queryOne("SELECT COUNT(*) AS c FROM documents")?.c;
    assert.equal(afterDocs, beforeDocs);
  });

  test("T1-F09-05: FTS5 triggers (pages_ai, pages_ad, pages_au) exist and index newly ingested pages", async () => {
    const triggers = sandbox.queryAll("SELECT name FROM sqlite_master WHERE type = 'trigger'");
    const triggerNames = new Set(triggers.map((t) => t.name));
    assert.ok(triggerNames.has("pages_ai"));
    assert.ok(triggerNames.has("pages_ad"));
    assert.ok(triggerNames.has("pages_au"));

    const marker = "XylofoneMunicipal2026";
    const ingest = await requestJson(worker.url, "/admin/ingest", {
      method: "POST",
      token: worker.vars.INGEST_TOKEN,
      body: {
        source_page_url: "https://telemacoborba.pr.gov.br/e2e/fts-trigger-check",
        pdf_url: "https://telemacoborba.pr.gov.br/e2e/fts-trigger-check.pdf",
        title: "FTS Trigger Doc",
        pages: [{ page_number: 1, text: `Aquisição de ${marker} para escola.` }]
      }
    });
    assert.equal(ingest.status, 201);

    const searchRes = await requestJson(
      worker.url,
      `/search?q=${encodeURIComponent(marker)}`,
      { ip: "203.0.113.23" }
    );
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.data?.total, 1);
  });

  test("T2-F09-01: POST /keywords with non-existent group_id 999999 returns 404 or 400 (never 500)", async () => {
    const { token } = await registerUser(worker.url, { name: "FK Kw" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Bad FK"), group_id: 999999 }
    });
    assert.ok(res.status === 404 || res.status === 400, `Expected 404 or 400, got ${res.status}`);
    assert.notEqual(res.data?.error, "Rota não encontrada.");
    assert.ok(typeof res.data?.error === "string" && !res.data.error.includes("FOREIGN KEY"));
  });

  test("T2-F09-02: POST /alerts with non-existent keyword_id or document_id returns 404 or 400 (never 500)", async () => {
    const { token } = await registerUser(worker.url, { name: "FK Alert" });
    const badKw = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: 999999, status: "novo" }
    });
    assert.ok(badKw.status === 404 || badKw.status === 400, `Expected 404 or 400, got ${badKw.status}`);
    assert.notEqual(badKw.data?.error, "Rota não encontrada.");

    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Valid For Bad Doc") }
    });
    assert.equal(kw.status, 201);
    const badDoc = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, document_id: 999999, status: "novo" }
    });
    assert.ok(badDoc.status === 404 || badDoc.status === 400, `Expected 404 or 400, got ${badDoc.status}`);
  });

  test("T2-F09-03: Relational ON DELETE behavior prevents orphans when keyword is deleted", async () => {
    const { token } = await registerUser(worker.url, { name: "FK Cascade" });
    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Cascade DB") }
    });
    assert.equal(kw.status, 201);
    const kwId = kw.data.keyword.id;

    const alert = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kwId, document_id: 1, status: "novo", matched_excerpt: "Exemplo" }
    });
    assert.equal(alert.status, 201);
    const alertId = alert.data.alert.id;

    const del = await requestJson(worker.url, `/keywords/${kwId}`, {
      method: "DELETE",
      token
    });
    assert.equal(del.status, 200);

    const orphan = sandbox.queryOne("SELECT id FROM keyword_alerts WHERE id = ?", [alertId]);
    assert.equal(orphan, null, "Expected child alert to be removed without leaving orphans");
  });

  test("T2-F09-04: CHECK constraints enforced at API boundary for priority and status enums", async () => {
    const { token } = await registerUser(worker.url, { name: "Enum Check" });
    const badPriority = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Enum Prio"), priority: "urgente" }
    });
    assert.equal(badPriority.status, 400);

    const kw = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Enum Status Target") }
    });
    const badStatus = await requestJson(worker.url, "/alerts", {
      method: "POST",
      token,
      body: { keyword_id: kw.data.keyword.id, status: "desconhecido" }
    });
    assert.equal(badStatus.status, 400);
  });

  test("T2-F09-05: is_active rejects invalid non-boolean/non-01 values with 400", async () => {
    const { token } = await registerUser(worker.url, { name: "Active Check" });
    const res = await requestJson(worker.url, "/keywords", {
      method: "POST",
      token,
      body: { keyword: uniqueKeyword("Active Bad"), is_active: "maybe" }
    });
    assert.equal(res.status, 400);
  });
});
