// Användarhantering för administratörer. Körs på Vercel som en serverfunktion,
// eftersom det krävs service_role-nyckeln för att skapa konton. Den nyckeln
// finns bara som miljövariabel hos Vercel och når aldrig webbläsaren.
// Varje anrop kontrollerar först att den som frågar är inloggad och har rollen admin.
"use strict";

const ROLES = ["admin", "editor", "viewer"];
const URL_ = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const ANON = (process.env.SUPABASE_ANON_KEY || "").trim();
const SERVICE = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
class Fail extends Error { constructor(code, msg) { super(msg); this.code = code; } }

async function sbFetch(path, opt) {
  const r = await fetch(URL_ + path, Object.assign({}, opt, {
    headers: Object.assign({ apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, (opt && opt.headers) || {})
  }));
  const txt = await r.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = { message: txt }; }
  if (!r.ok) {
    const m = (data && (data.msg || data.message || data.error_description || data.error)) || ("Fel " + r.status);
    throw new Fail(r.status === 422 || r.status === 400 ? 400 : 502, String(m));
  }
  return data;
}

async function caller(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw new Fail(401, "Inte inloggad.");
  const r = await fetch(URL_ + "/auth/v1/user", { headers: { apikey: ANON || SERVICE, Authorization: "Bearer " + m[1] } });
  if (!r.ok) throw new Fail(401, "Inloggningen har gått ut. Logga in igen.");
  const u = await r.json();
  const rows = await sbFetch("/rest/v1/members?select=role&user_id=eq." + encodeURIComponent(u.id));
  if (!rows || !rows[0] || rows[0].role !== "admin") throw new Fail(403, "Bara administratörer kan hantera användare.");
  return u;
}

async function listUsers() {
  const members = await sbFetch("/rest/v1/members?select=user_id,email,role,created_at&order=email.asc");
  const au = await sbFetch("/auth/v1/admin/users?per_page=1000");
  const last = {};
  ((au && au.users) || []).forEach(function (u) { last[u.id] = u.last_sign_in_at || null; });
  return members.map(function (x) { return { id: x.user_id, email: x.email, role: x.role, created: x.created_at, last: last[x.user_id] || null }; });
}
async function adminCount() {
  const rows = await sbFetch("/rest/v1/members?select=user_id&role=eq.admin");
  return rows.length;
}
function checkEmail(e) {
  e = String(e || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new Fail(400, "Skriv en giltig e-postadress.");
  return e;
}
function checkPass(p) {
  p = String(p || "");
  if (p.length < 10) throw new Fail(400, "Lösenordet måste vara minst 10 tecken.");
  if (p.length > 100) throw new Fail(400, "Lösenordet är för långt.");
  return p;
}
function checkRole(r) {
  if (ROLES.indexOf(r) < 0) throw new Fail(400, "Okänd roll.");
  return r;
}
function checkId(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) throw new Fail(400, "Ogiltigt användar-id.");
  return String(id);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new Fail(405, "Fel metod.");
    if (!URL_ || !SERVICE) throw new Fail(500, "Servern saknar SUPABASE_SERVICE_ROLE_KEY. Lägg till den i Vercel under Settings, Environment Variables, och gör en ny deploy.");
    const me = await caller(req);
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const act = b.action;

    if (act === "list") return send(res, 200, { users: await listUsers() });

    if (act === "create") {
      const email = checkEmail(b.email), pass = checkPass(b.password), role = checkRole(b.role);
      const u = await sbFetch("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: email, password: pass, email_confirm: true }) });
      try {
        await sbFetch("/rest/v1/members", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ user_id: u.id, email: email, role: role }) });
      } catch (e) {
        await sbFetch("/auth/v1/admin/users/" + u.id, { method: "DELETE" }).catch(function () {});
        throw e;
      }
      return send(res, 200, { users: await listUsers() });
    }

    const id = checkId(b.id);

    if (act === "role") {
      const role = checkRole(b.role);
      if (id === me.id && role !== "admin") throw new Fail(400, "Du kan inte ta bort din egen administratörsroll. Be en annan administratör.");
      await sbFetch("/rest/v1/members?user_id=eq." + id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ role: role }) });
      return send(res, 200, { users: await listUsers() });
    }

    if (act === "password") {
      const pass = checkPass(b.password);
      await sbFetch("/auth/v1/admin/users/" + id, { method: "PUT", body: JSON.stringify({ password: pass }) });
      return send(res, 200, { users: await listUsers() });
    }

    if (act === "remove") {
      if (id === me.id) throw new Fail(400, "Du kan inte ta bort ditt eget konto.");
      const rows = await sbFetch("/rest/v1/members?select=role&user_id=eq." + id);
      if (rows[0] && rows[0].role === "admin" && (await adminCount()) <= 1) throw new Fail(400, "Det måste finnas minst en administratör.");
      // Kort och rader som personen äger går över till administratören som tar bort kontot, så att de inte blir ägarlösa.
      // Det gör inget om migreringen för delning inte är körd än (kolumnen owner saknas då).
      for (const t of ["cards", "docs"]) {
        await sbFetch("/rest/v1/" + t + "?owner=eq." + id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ owner: me.id }) }).catch(function () {});
      }
      // Raderar kontot. Raden i members försvinner med (on delete cascade). Kortens historik ligger kvar.
      await sbFetch("/auth/v1/admin/users/" + id, { method: "DELETE" });
      return send(res, 200, { users: await listUsers() });
    }

    throw new Fail(400, "Okänd åtgärd.");
  } catch (e) {
    send(res, e instanceof Fail ? e.code : 500, { error: e instanceof Fail ? e.message : "Något gick fel på servern." });
  }
};
