/* Projekttavla: tavla, tidsplan, dokumentationsrader och ändringslogg.
   Två backends med samma gränssnitt: Supabase (inloggning + delad databas)
   och ett demoläge i minnet när ingen databas är kopplad eller ?demo anges. */
(function () {
  "use strict";

  var COLS = [
    { id: "vantar", t: "Väntar", s: "På svar, avrop eller tidplan", c: "var(--vantar)" },
    { id: "planera", t: "Planera in", s: "Offererat eller avropat, ej startat", c: "var(--planera)" },
    { id: "redo", t: "Redo att utföra", s: "Beställt eller levererat", c: "var(--redo)" },
    { id: "pagar", t: "Pågår", s: "Arbete pågår i fält", c: "var(--pagar)" },
    { id: "besikt", t: "Rest och dokumentation", s: "OK i fält, återstår besiktning eller papper", c: "var(--besikt)" },
    { id: "klar", t: "Klar", s: "Färdigt och överlämnat", c: "var(--klar)" },
    { id: "akut", t: "Akut", s: "Kräver åtgärd nu", c: "var(--akut)" }
  ];
  var COLIDS = COLS.map(function (c) { return c.id; });
  var CHIPCLS = ["late", "soon", "info"];
  var ROLES = { admin: "Administratör", editor: "Redigerare", viewer: "Läsare" };
  var MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  var IDRE = /^[A-Za-z0-9_-]{1,60}$/;

  var cfg = window.APP_CONFIG || {};
  var DEMO = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) || /[?&]demo(&|=|$)/.test(location.search);

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m];
    });
  }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function newId(prefix) {
    var r = "";
    try { r = crypto.randomUUID().replace(/-/g, "").slice(0, 10); } catch (e) { r = String(Date.now()) + Math.floor(Math.random() * 1000); }
    return prefix + r;
  }

  /* ---------- Datum ---------- */
  function dateStr(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ""; }
  function dayOf(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
  }
  function dateOfDay(n) { return new Date(n * 864e5); }
  function isoOfDay(n) { var d = dateOfDay(n); return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()); }
  function todayDay() { var t = new Date(); return Math.round(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) / 864e5); }
  function fmtDay(n) {
    var d = dateOfDay(n), y = d.getUTCFullYear();
    return d.getUTCDate() + "/" + (d.getUTCMonth() + 1) + (y !== new Date().getFullYear() ? " " + y : "");
  }
  function isoWeek(n) {
    var d = dateOfDay(n);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  }
  function hasDates(c) { return dayOf(c.start) !== null || dayOf(c.end) !== null; }
  function dateText(c) {
    var p = [], s = dayOf(c.start), e = dayOf(c.end);
    if (s !== null) p.push("Start " + fmtDay(s));
    if (e !== null) p.push("Slutbesiktning " + fmtDay(e));
    return esc(p.join(" · "));
  }
  function fmtStamp(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.getDate() + " " + MONTHS[d.getMonth()] + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  }

  /* ---------- Rader <-> objekt ---------- */
  function strList(v, max) {
    return Array.isArray(v) ? v.filter(function (s) { return typeof s === "string" && s; }).map(function (s) { return s.slice(0, 500); }).slice(0, max || 50) : [];
  }
  function fromRow(r) {
    return {
      id: r.id, col: r.col, pos: r.pos || 0, name: r.name, client: r.client || "",
      tags: r.tags || [], chip: r.chip_text ? [r.chip_cls || "info", r.chip_text] : null,
      lage: r.lage || "", next: r.next || "", notes: r.notes || [],
      start: r.start_date || "", end: r.end_date || "", tech: r.tech || "",
      deleted: !!r.deleted, rev: r.rev, updated: r.updated_at || "",
      tplan: Array.isArray(r.tidplan) ? r.tidplan : ("tidplan" in r ? [] : undefined),
      pay: r.betalplan || ("betalplan" in r ? null : undefined)
    };
  }
  function toRow(c) {
    var r = {
      id: c.id, col: c.col, pos: c.pos || 0, name: c.name, client: c.client || "",
      tags: c.tags || [], chip_cls: c.chip ? c.chip[0] : null, chip_text: c.chip ? c.chip[1] : null,
      lage: c.lage || "", next: c.next || "", notes: c.notes || [],
      start_date: c.start || null, end_date: c.end || null, tech: c.tech || "", deleted: !!c.deleted
    };
    // Tid- och betalplan skickas bara med när de finns, så att appen även fungerar innan databasen har kolumnerna.
    if (c.tplan !== undefined) r.tidplan = c.tplan;
    if (c.pay !== undefined) r.betalplan = c.pay;
    return r;
  }
  function docFromRow(r) {
    return { id: r.id, project: r.project, body: r.body || "", done: !!r.done, pos: r.pos || 0, deleted: !!r.deleted, rev: r.rev };
  }
  function docToRow(d) {
    return { id: d.id, project: d.project, body: d.body || "", done: !!d.done, pos: d.pos || 0, deleted: !!d.deleted };
  }
  function patchRow(patch) {
    var m = { start: "start_date", end: "end_date" }, o = {}, k;
    for (k in patch) o[m[k] || k] = patch[k];
    return o;
  }

  function conflictError() {
    var e = new Error("Någon annan har ändrat det här under tiden. Dina ändringar sparades inte.");
    e.conflict = true;
    return e;
  }

  /* ---------- Backend: Supabase ---------- */
  function makeSb() {
    var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    var B = { mode: "supabase" };

    function chk(r) { if (r.error) throw r.error; return r.data; }

    B.start = async function () {
      var r = await sb.auth.getSession();
      var s = r.data && r.data.session;
      if (!s) return null;
      var m = chk(await sb.from("members").select("role").eq("user_id", s.user.id).maybeSingle());
      return { email: s.user.email, role: m ? m.role : null };
    };
    B.signIn = async function (email, pw) {
      var r = await sb.auth.signInWithPassword({ email: email, password: pw });
      if (r.error) throw r.error;
    };
    B.signOut = function () { return sb.auth.signOut(); };
    B.onSignedOut = function (cb) {
      sb.auth.onAuthStateChange(function (ev) { if (ev === "SIGNED_OUT") cb(); });
    };
    B.load = async function () {
      var a = chk(await sb.from("cards").select("*").order("pos", { ascending: true }).order("name", { ascending: true }));
      var b = chk(await sb.from("docs").select("*").order("pos", { ascending: true }));
      return { cards: a.map(fromRow), docs: b.map(docFromRow) };
    };
    B.insertCard = async function (card) {
      return fromRow(chk(await sb.from("cards").insert(toRow(card)).select().single()));
    };
    B.saveCard = async function (card, expectedRev) {
      var row = toRow(card);
      delete row.id; delete row.pos;
      var data = chk(await sb.from("cards").update(row).eq("id", card.id).eq("rev", expectedRev).select());
      if (!data.length) throw conflictError();
      return fromRow(data[0]);
    };
    B.patchCard = async function (id, patch) {
      return fromRow(chk(await sb.from("cards").update(patchRow(patch)).eq("id", id).select().single()));
    };
    B.insertDoc = async function (doc) {
      return docFromRow(chk(await sb.from("docs").insert(docToRow(doc)).select().single()));
    };
    B.patchDoc = async function (id, patch) {
      return docFromRow(chk(await sb.from("docs").update(patch).eq("id", id).select().single()));
    };
    B.activity = async function () {
      return chk(await sb.from("activity").select("*").order("id", { ascending: false }).limit(60));
    };
    B.importAll = async function (cards, docs) {
      var i, rows;
      rows = cards.map(toRow);
      for (i = 0; i < rows.length; i += 100) chk(await sb.from("cards").upsert(rows.slice(i, i + 100), { onConflict: "id" }));
      rows = docs.map(docToRow);
      for (i = 0; i < rows.length; i += 100) chk(await sb.from("docs").upsert(rows.slice(i, i + 100), { onConflict: "id" }));
    };
    B.subscribe = function (cb) {
      sb.channel("tavla")
        .on("postgres_changes", { event: "*", schema: "public", table: "cards" }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, cb)
        .subscribe();
    };
    return B;
  }

  /* ---------- Backend: demo i minnet ---------- */
  function makeDemo() {
    var t = todayDay(), cards = [], docs = [], log = [], seq = 0, signedIn = false;
    function mk(id, col, name, client, tags, chip, lage, next, notes, s, e, tech) {
      cards.push({ id: id, col: col, pos: ++seq, name: name, client: client, tags: tags, chip: chip, lage: lage, next: next, notes: notes,
        start: s === null ? "" : isoOfDay(t + s), end: e === null ? "" : isoOfDay(t + e), tech: tech, deleted: false, rev: 1 });
    }
    mk("d1", "akut", "Exempel Kv. Alfa", "Kund A", ["Brandlarm"], ["late", "Klart för två veckor sedan"], "Slutfasen är klar. Intyg återstår.", "Signera protokoll.", [], -40, -14, "Anna Exempel");
    mk("d2", "akut", "Exempel Skolan", "Kund B", ["CCTV"], null, "Kameror monterade, väntar på nätverk.", "Boka driftsättning.", ["Liftbokning klar"], -10, 6, "Bo Exempel");
    mk("d3", "pagar", "Exempel Kv. Beta", "Kund A", ["Passersystem"], ["info", "Besiktning om 3 veckor"], "18 läsare, 12 monterade.", "Montera resten.", [], -20, 21, "Cecilia Exempel");
    mk("d4", "redo", "Exempel Garage", "Kund C", ["RCO"], null, "Material levererat.", "Starta kabeldragning.", [], 8, 30, "Anna Exempel");
    mk("d5", "vantar", "Exempel Hus 5", "Kund D", [], null, "Offert lämnad.", "Invänta svar.", [], 70, null, "");
    mk("d6", "besikt", "Exempel Torget", "Kund E", ["Brandlarm"], null, "OK i fält.", "Lämna OR/SR.", ["Egenkontroller saknas"], -60, -5, "Bo Exempel");
    mk("d7", "planera", "Exempel Villa", "", [], null, "Avropad.", "Planera in.", [], 45, 90, "");
    mk("d8", "klar", "Exempel Kontor", "Kund F", ["CCTV"], null, "Överlämnat.", "", [], -120, -80, "Cecilia Exempel");
    docs.push({ id: "dd1", project: "Exempel Torget", body: "OR/SR och egenkontroller.", done: false, pos: 1, deleted: false, rev: 1 });
    docs.push({ id: "dd2", project: "Exempel Kv. Alfa", body: "Signera protokoll.", done: false, pos: 2, deleted: false, rev: 1 });
    docs.push({ id: "dd3", project: "Exempel Skolan", body: "Intyg.", done: true, pos: 3, deleted: false, rev: 1 });

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
    function addLog(action, entity, id, title, detail) {
      log.unshift({ id: log.length + 1, at: new Date().toISOString(), user_email: "demo@exempel.se", action: action, entity: entity, entity_id: id, title: title, detail: detail || null });
    }
    function changes(a, b, map) {
      var d = {}, k;
      for (k in b) if (k !== "rev" && k !== "pos" && JSON.stringify(a[k]) !== JSON.stringify(b[k])) d[map[k] || k] = [a[k], b[k]];
      return d;
    }
    var CM = { start: "start_date", end: "end_date", chip: "chip_text" };

    var B = { mode: "demo" };
    B.start = async function () { return { email: "demo@exempel.se", role: "admin" }; };
    B.signIn = async function () { signedIn = true; };
    B.signOut = async function () { signedIn = false; };
    B.onSignedOut = function () {};
    B.load = async function () { return { cards: clone(cards), docs: clone(docs) }; };
    B.insertCard = async function (c) { var n = clone(c); n.rev = 1; cards.push(n); addLog("insert", "card", n.id, n.name); return clone(n); };
    B.saveCard = async function (c, rev) {
      var cur = find(cards, c.id);
      if (!cur || cur.rev !== rev) throw conflictError();
      var n = clone(c); n.pos = cur.pos; n.rev = cur.rev + 1;
      var d = changes(cur, n, CM);
      Object.assign(cur, n);
      if (Object.keys(d).length) addLog("update", "card", cur.id, cur.name, d);
      return clone(cur);
    };
    B.patchCard = async function (id, patch) {
      var cur = find(cards, id), before = clone(cur), k;
      for (k in patch) cur[k] = patch[k];
      cur.rev++;
      if ("deleted" in patch && before.deleted !== cur.deleted) addLog(cur.deleted ? "delete" : "restore", "card", id, cur.name);
      else addLog("update", "card", id, cur.name, changes(before, cur, CM));
      return clone(cur);
    };
    B.insertDoc = async function (d) { var n = clone(d); n.rev = 1; docs.push(n); addLog("insert", "doc", n.id, n.project); return clone(n); };
    B.patchDoc = async function (id, patch) {
      var cur = find(docs, id), before = clone(cur), k;
      for (k in patch) cur[k] = patch[k];
      cur.rev++;
      if ("deleted" in patch && before.deleted !== cur.deleted) addLog(cur.deleted ? "delete" : "restore", "doc", id, cur.project);
      else addLog("update", "doc", id, cur.project, changes(before, cur, {}));
      return clone(cur);
    };
    B.activity = async function () { return clone(log).slice(0, 60); };
    B.importAll = async function (cs, ds) {
      cs.forEach(function (c) { var cur = find(cards, c.id); if (cur) Object.assign(cur, clone(c)); else cards.push(Object.assign(clone(c), { rev: 1 })); });
      ds.forEach(function (d) { var cur = find(docs, d.id); if (cur) Object.assign(cur, clone(d)); else docs.push(Object.assign(clone(d), { rev: 1 })); });
    };
    B.subscribe = function () {};
    return B;
  }

  /* ---------- Tillstånd ---------- */
  var be = null;
  var state = { cards: [], docs: [], role: null, email: "" };
  var lastDeleted = null; // { kind: "card"|"doc", id }
  var editingId = null, editRev = null;
  var gZoom = 6;

  function canEdit() { return state.role === "admin" || state.role === "editor"; }
  function isAdmin() { return state.role === "admin"; }
  function visibleCards() { return state.cards.filter(function (c) { return !c.deleted; }); }
  function visibleDocs() { return state.docs.filter(function (d) { return !d.deleted; }); }
  function findCard(id) { for (var i = 0; i < state.cards.length; i++) if (state.cards[i].id === id) return state.cards[i]; return null; }
  function findDoc(id) { for (var i = 0; i < state.docs.length; i++) if (state.docs[i].id === id) return state.docs[i]; return null; }
  function replaceIn(list, saved) {
    for (var i = 0; i < list.length; i++) if (list[i].id === saved.id) { list[i] = saved; return; }
    list.push(saved);
  }
  function maxPos(list) { return list.reduce(function (m, x) { return Math.max(m, x.pos || 0); }, 0); }

  /* ---------- Meddelanden ---------- */
  var toast = $("toast"), toastTimer = null;
  function showToast(msg, withUndo) {
    $("toast-msg").textContent = msg;
    $("toast-undo").hidden = !withUndo;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.hidden = true; lastDeleted = null; }, 8000);
  }
  function banner(msg, isErr) {
    var b = $("banner");
    if (!msg) { b.hidden = true; b.textContent = ""; return; }
    b.textContent = msg;
    b.className = "banner" + (isErr ? " err" : "");
    b.hidden = false;
  }
  function friendly(e) {
    var m = (e && e.message) || String(e);
    if (e && e.conflict) return m;
    if (/row-level security|permission denied/i.test(m)) return "Du har inte behörighet att göra den ändringen.";
    if (/tidplan|betalplan/i.test(m) && /column|schema cache/i.test(m)) return "Databasen saknar kolumnerna för tidplan och betalplan. Kör migreringen i Supabase (se README) och försök igen.";
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Ingen kontakt med servern. Kontrollera nätverket och försök igen.";
    if (/Invalid login credentials/i.test(m)) return "Fel e-post eller lösenord.";
    return "Något gick fel: " + m;
  }
  function fail(e) {
    banner(friendly(e), true);
    if (e && e.conflict) reload();
  }

  /* ---------- Rensa tid- och betalplan ---------- */
  function num(v) { var n = typeof v === "number" ? v : parseFloat(String(v).replace(/\s/g, "").replace(",", ".")); return isFinite(n) ? n : 0; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function cleanTplan(v) {
    if (!Array.isArray(v)) return [];
    return v.slice(0, 100).filter(function (o) { return o && typeof o === "object"; }).map(function (o) {
      return { id: idOk(o.id) ? o.id : newId("m-"), name: str(o.name, 200), start: dateStr(o.start), end: dateStr(o.end), done: o.done === true };
    });
  }
  function cleanPay(v) {
    if (!v || typeof v !== "object") return null;
    var items = (Array.isArray(v.items) ? v.items : []).slice(0, 60).filter(function (o) { return o && typeof o === "object"; }).map(function (o) {
      return { id: idOk(o.id) ? o.id : newId("l-"), label: str(o.label, 200), pct: r2(clamp(num(o.pct), 0, 100)), date: dateStr(o.date), paid: o.paid === true };
    });
    return {
      sum: r2(clamp(num(v.sum), 0, 1e11)), n: Math.round(clamp(num(v.n) || 1, 1, 60)), ret: r2(clamp(num(v.ret), 0, 100)),
      items: items, retDate: dateStr(v.retDate), retPaid: v.retPaid === true
    };
  }
  function fmtKr(ore) {
    return (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
  }
  // Räknar i hela ören. Lyftens belopp följer ackumulerad andel, så att summan alltid blir exakt kontraktssumman.
  function payCalc(p) {
    var S = Math.round(p.sum * 100), cum = 0, cumP = 0, held = 0, inv = 0, rows = [];
    p.items.forEach(function (it) {
      cumP = r2(cumP + it.pct);
      var target = Math.round(S * cumP / 100), amt = target - cum, ret = Math.round(amt * p.ret / 100);
      cum = target; held += ret; inv += amt - ret;
      rows.push({ amt: amt, ret: ret, inv: amt - ret });
    });
    return { S: S, rows: rows, held: held, inv: inv, pctSum: cumP, total: cum };
  }
  function genItems(n, old) {
    var items = [], sum = 0, i, pct;
    for (i = 0; i < n; i++) {
      pct = i < n - 1 ? Math.round(10000 / n) / 100 : r2(100 - sum);
      sum = r2(sum + pct);
      items.push({ id: newId("l-"), label: "Lyft " + (i + 1), pct: pct, date: "", paid: false });
    }
    return items;
  }
  function numText(n) { return n ? String(n).replace(".", ",") : ""; }

  /* ---------- Visa kort i ruta (med tidplan och betalplan) ---------- */
  var viewId = null, viewDlg = $("view"), viewMode = "view", vDirty = false, vWarned = false, vTid = [], vPay = null, vGenArmed = false;
  function vrow(label, html) { return html ? '<div class="vrow"><b>' + label + "</b><div>" + html + "</div></div>" : ""; }
  function setVMode(m) { viewMode = m; viewDlg.setAttribute("data-mode", m); }
  function vmsg(t, bad) { var el = $("vmsg"); if (el) { el.textContent = t || ""; el.className = "vmsg" + (bad ? " bad" : ""); } }
  function fillView(c) {
    setVMode("view");
    $("view-title").setAttribute("style", (titleStyle(c).match(/--h:\d+/) || [""])[0]);
    $("view-title").className = titleStyle(c) ? "tt" : "";
    $("view-title").innerHTML = esc(c.name) + (c.client ? ' <span class="client">· ' + esc(c.client) + "</span>" : "");
    var s = dayOf(c.start), e = dayOf(c.end), h = "";
    var nodate = c.col !== "klar", miss = '<span class="missing">Saknas</span>';
    h += vrow("Status", canEdit()
      ? '<select id="view-move" aria-label="Flytta till kolumn">' + COLS.map(function (k) { return '<option value="' + k.id + '"' + (k.id === c.col ? " selected" : "") + ">" + esc(k.t) + "</option>"; }).join("") + "</select>"
      : esc(colName(c.col)));
    h += vrow("Tekniker", c.tech ? techPill(c.tech) : "");
    h += vrow("Taggar", c.tags && c.tags.length ? '<div class="tags">' + c.tags.map(function (t) { return '<span class="tag' + tagAttr(t) + '">' + tagIcon(t) + esc(t) + "</span>"; }).join("") + "</div>" : "");
    h += vrow("Markering", c.chip ? '<span class="chip ' + esc(c.chip[0]) + '">' + esc(c.chip[1]) + "</span>" : "");
    h += vrow("Start", s !== null ? esc(fmtDay(s) + " (v" + isoWeek(s) + ")") : nodate ? miss : "");
    h += vrow("Slutbesiktning", e !== null ? esc(fmtDay(e) + " (v" + isoWeek(e) + ")") : nodate ? miss : "");
    h += vrow("Läge", c.lage ? '<div class="vtext">' + esc(c.lage) + "</div>" : "");
    h += vrow("Nästa steg", c.next ? '<div class="vtext">' + esc(c.next) + "</div>" : "");
    h += vrow("Anteckningar", c.notes && c.notes.length ? '<ul class="notes">' + c.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" : "");
    if (c.tplan && c.tplan.length) {
      var dn = c.tplan.filter(function (m) { return m.done; }).length;
      h += vrow("Tidplan", esc(c.tplan.length + " moment, " + dn + " klara"));
    }
    if (c.pay && c.pay.sum) {
      var pc = payCalc(c.pay), pd = c.pay.items.filter(function (i) { return i.paid; }).length;
      h += vrow("Betalplan", esc(fmtKr(pc.S) + " exkl. moms, " + c.pay.items.length + " lyft, " + pd + " fakturerade"));
    }
    h += vrow("Senast ändrad", c.updated ? esc(fmtStamp(c.updated)) : "");
    $("view-body").innerHTML = h;
    $("view-edit").hidden = !canEdit();
  }
  function openView(id) {
    var c = findCard(id);
    if (!c || c.deleted) return;
    viewId = id; vDirty = false; vWarned = false; fillView(c);
    if (viewDlg.showModal) { if (!viewDlg.open) viewDlg.showModal(); } else viewDlg.setAttribute("open", "");
  }
  function closeNow() {
    viewId = null; vDirty = false; vWarned = false;
    if (viewDlg.close) viewDlg.close(); else viewDlg.removeAttribute("open");
  }
  // Frågar en gång om det finns osparade ändringar i tid- eller betalplanen.
  function leave(fn) {
    if (vDirty && !vWarned) { vWarned = true; vmsg("Du har osparade ändringar. Klicka igen för att kasta dem.", true); return; }
    vDirty = false; vWarned = false; fn();
  }
  function closeView() { leave(closeNow); }
  function backToView() { leave(function () { var c = findCard(viewId); if (c) fillView(c); else closeNow(); }); }
  function refreshView() {
    if (!viewId || !viewDlg.open) return;
    var c = findCard(viewId);
    if (!c || c.deleted) { closeNow(); return; }
    if (viewMode === "view") fillView(c);
  }
  function touched() { vDirty = true; vWarned = false; vmsg(""); }

  /* Tidplan */
  var WEEKDAYS_MON = 1;
  function momGantt(list, card) {
    var pts = [], i, s, e;
    list.forEach(function (m) { s = dayOf(m.start); e = dayOf(m.end); if (s !== null) pts.push(s); if (e !== null) pts.push(e); });
    if (!pts.length) return '<p class="hint">Fyll i start och slut på momenten så visas tidsplanen här.</p>';
    var cs = dayOf(card.start), ce = dayOf(card.end), td = todayDay();
    var min = Math.min.apply(null, pts) - 2, max = Math.max.apply(null, pts) + 3, span = max - min;
    function pc(d) { return ((d - min) / span * 100).toFixed(3); }
    var ticks = "", lines = "", d, dt, w;
    if (span <= 150) {
      for (d = min; d <= max; d++) {
        if (((dateOfDay(d).getUTCDay() + 6) % 7) === 0) {
          lines += '<i class="ln" style="left:' + pc(d) + '%"></i>';
          ticks += '<span style="left:' + pc(d) + '%">v' + isoWeek(d) + "</span>";
        }
      }
    } else {
      for (d = min; d <= max; d++) {
        dt = dateOfDay(d);
        if (dt.getUTCDate() === 1) {
          lines += '<i class="ln" style="left:' + pc(d) + '%"></i>';
          ticks += '<span style="left:' + pc(d) + '%">' + MONTHS[dt.getUTCMonth()] + (dt.getUTCMonth() === 0 ? " " + dt.getUTCFullYear() : "") + "</span>";
        }
      }
    }
    var marks = "";
    if (cs !== null && cs >= min && cs <= max) marks += '<i class="mk st" style="left:' + pc(cs) + '%" title="Start ' + esc(fmtDay(cs)) + '"></i>';
    if (ce !== null && ce >= min && ce <= max) marks += '<i class="mk en" style="left:' + pc(ce) + '%" title="Slutbesiktning ' + esc(fmtDay(ce)) + '"></i>';
    if (td >= min && td <= max) marks += '<i class="mk td" style="left:' + pc(td) + '%" title="Idag"></i>';
    var h = '<div class="mg"><div class="mg-row mg-head"><div class="mg-name"></div><div class="mg-track">' + ticks + "</div></div>";
    list.forEach(function (m) {
      s = dayOf(m.start); e = dayOf(m.end);
      var bar = "", tip = (m.name || "Moment") + ": " + (s !== null ? fmtDay(s) : "?") + " till " + (e !== null ? fmtDay(e) : "?");
      if (s !== null && e !== null) {
        var a = Math.min(s, e), z = Math.max(s, e);
        bar = '<b class="bar' + (m.done ? " done" : "") + '" style="left:' + pc(a) + "%;width:" + ((z - a + 1) / span * 100).toFixed(3) + '%" title="' + esc(tip) + '"></b>';
      } else if (s !== null || e !== null) {
        bar = '<b class="dot' + (m.done ? " done" : "") + '" style="left:' + pc(s !== null ? s : e) + '%" title="' + esc(tip) + '"></b>';
      }
      h += '<div class="mg-row"><div class="mg-name' + (m.done ? " done" : "") + '" title="' + esc(m.name) + '">' + (esc(m.name) || '<span class="hint">Utan namn</span>') + '</div><div class="mg-track">' + lines + marks + bar + "</div></div>";
    });
    return h + '</div><div class="mg-leg"><span><i class="lg-bar"></i>Moment</span><span><i class="mk st"></i>Projektstart</span><span><i class="mk en"></i>Slutbesiktning</span><span><i class="mk td"></i>Idag</span></div>';
  }
  function tidRows(ed) {
    var dis = ed ? "" : " disabled";
    return vTid.map(function (m, i) {
      return '<div class="trow"><input type="text" maxlength="200" data-tf="name" data-i="' + i + '" value="' + esc(m.name) + '" placeholder="Moment, till exempel Kabeldragning"' + dis + ' aria-label="Moment">' +
        '<input type="date" data-tf="start" data-i="' + i + '" value="' + esc(m.start) + '"' + dis + ' aria-label="Start">' +
        '<input type="date" data-tf="end" data-i="' + i + '" value="' + esc(m.end) + '"' + dis + ' aria-label="Slut">' +
        '<label class="chk"><input type="checkbox" data-tf="done" data-i="' + i + '"' + (m.done ? " checked" : "") + dis + '> Klart</label>' +
        (ed ? '<button type="button" class="del" data-tdel="' + i + '">Ta bort</button>' : "<span></span>") + "</div>";
    }).join("");
  }
  function openTid() {
    var c = findCard(viewId); if (!c) return;
    setVMode("tid"); vDirty = false; vWarned = false;
    vTid = cleanTplan(c.tplan || []);
    renderTid();
  }
  function renderTid() {
    var c = findCard(viewId), ed = canEdit();
    $("view-title").innerHTML = "Tidplan <span class=\"client\">· " + esc(c.name) + "</span>";
    $("view-body").innerHTML =
      '<div id="mg-wrap">' + momGantt(vTid, c) + "</div>" +
      '<div class="trows" id="trows">' + tidRows(ed) + "</div>" +
      (vTid.length ? "" : '<p class="hint">Inga moment än.' + (ed ? " Lägg till det första." : "") + "</p>") +
      '<div class="view-actions">' +
      (ed ? '<button type="button" class="btn ghost" data-tadd="1">Lägg till moment</button><button type="button" class="btn" data-tsave="1">Spara</button>' : "") +
      '<button type="button" class="btn ghost" data-back="1">Tillbaka</button><span class="vmsg" id="vmsg" role="status"></span></div>';
  }
  async function saveTid() {
    var c = findCard(viewId); if (!c || !canEdit()) return;
    var card = Object.assign({}, c, { tplan: cleanTplan(vTid) });
    try {
      var saved = await be.saveCard(card, c.rev);
      replaceIn(state.cards, saved); vDirty = false; vWarned = false;
      renderAll(); renderActivity(); vmsg("Sparat.");
    } catch (err) { vmsg(friendly(err), true); if (err && err.conflict) reload(); }
  }

  /* Betalplan */
  function openPay() {
    var c = findCard(viewId); if (!c) return;
    setVMode("pay"); vDirty = false; vWarned = false; vGenArmed = false;
    vPay = cleanPay(c.pay) || { sum: 0, n: 4, ret: 10, items: [], retDate: "", retPaid: false };
    if (!c.pay) vPay.n = 4;
    renderPay();
  }
  function payRowsHtml(ed) {
    var dis = ed ? "" : " disabled", pc = payCalc(vPay);
    var h = vPay.items.map(function (it, i) {
      return "<tr><td><input type=\"text\" maxlength=\"200\" data-pf=\"label\" data-i=\"" + i + "\" value=\"" + esc(it.label) + "\"" + dis + " aria-label=\"Beskrivning\"></td>" +
        '<td><input type="text" inputmode="decimal" class="sm" data-pf="pct" data-i="' + i + '" value="' + esc(numText(it.pct)) + '"' + dis + ' aria-label="Andel i procent"></td>' +
        '<td><input type="date" data-pf="date" data-i="' + i + '" value="' + esc(it.date) + '"' + dis + ' aria-label="Faktureringsdatum"></td>' +
        '<td class="r" data-c="amt" data-i="' + i + '">' + fmtKr(pc.rows[i].amt) + "</td>" +
        '<td class="r" data-c="ret" data-i="' + i + '">' + fmtKr(pc.rows[i].ret) + "</td>" +
        '<td class="r strong" data-c="inv" data-i="' + i + '">' + fmtKr(pc.rows[i].inv) + "</td>" +
        '<td class="c"><input type="checkbox" data-pf="paid" data-i="' + i + '"' + (it.paid ? " checked" : "") + dis + ' aria-label="Fakturerad"></td></tr>';
    }).join("");
    h += "<tr class=\"held\"><td colspan=\"2\">Hållna medel, frisläpps efter godkänd slutbesiktning</td>" +
      '<td><input type="date" data-pf="retDate" value="' + esc(vPay.retDate) + '"' + dis + ' aria-label="Datum för frisläppning"></td>' +
      '<td class="r">–</td><td class="r">–</td><td class="r strong" data-c="held">' + fmtKr(pc.held) + "</td>" +
      '<td class="c"><input type="checkbox" data-pf="retPaid"' + (vPay.retPaid ? " checked" : "") + dis + ' aria-label="Fakturerad"></td></tr>';
    h += '<tr class="tot"><td colspan="2">Totalt</td><td></td><td class="r" data-c="tamt">' + fmtKr(pc.total) + '</td><td class="r"></td><td class="r strong" data-c="tinv">' + fmtKr(pc.inv + pc.held) + "</td><td></td></tr>";
    return h;
  }
  function renderPay() {
    var c = findCard(viewId), ed = canEdit(), dis = ed ? "" : " disabled";
    $("view-title").innerHTML = "Betalplan <span class=\"client\">· " + esc(c.name) + "</span>";
    $("view-body").innerHTML =
      '<div class="pform">' +
      '<label>Kontraktssumma, kr exkl. moms<input type="text" inputmode="decimal" data-pf="sum" value="' + esc(numText(vPay.sum)) + '"' + dis + '></label>' +
      '<label>Antal lyft<input type="number" min="1" max="60" step="1" data-pf="n" value="' + vPay.n + '"' + dis + '></label>' +
      '<label>Innehållna medel, %<input type="text" inputmode="decimal" data-pf="ret" value="' + esc(numText(vPay.ret)) + '"' + dis + '></label>' +
      (ed ? '<button type="button" class="btn ghost" data-pgen="1" id="pgen">Fördela lyft</button>' : "") +
      "</div>" +
      '<p class="hint" id="pwarn" role="status"></p>' +
      (vPay.items.length ? '<div class="ptab-wrap"><table class="ptab"><thead><tr><th>Lyft</th><th>Andel %</th><th>Faktureringsdatum</th><th class="r">Lyftets värde</th><th class="r">Innehåll</th><th class="r">Att fakturera</th><th>Fakturerad</th></tr></thead><tbody id="ptb">' + payRowsHtml(ed) + "</tbody></table></div>" :
        '<p class="hint">Fyll i kontraktssumma och antal lyft och klicka på Fördela lyft.</p>') +
      '<p class="hint">Alla belopp är exklusive moms. Innehållet dras från varje lyft och faktureras som hållna medel efter godkänd slutbesiktning. Kontrollera procentsats och villkor mot kontraktet.</p>' +
      '<div class="view-actions">' + (ed ? '<button type="button" class="btn" data-psave="1">Spara</button>' : "") +
      '<button type="button" class="btn ghost" data-back="1">Tillbaka</button><span class="vmsg" id="vmsg" role="status"></span></div>';
    payWarn();
  }
  function payWarn() {
    var w = $("pwarn"); if (!w) return;
    var pc = payCalc(vPay), bad = vPay.items.length && Math.abs(pc.pctSum - 100) > 0.001;
    w.textContent = bad ? "Andelarna blir " + numText(pc.pctSum) + " %, de ska bli 100 %. Beloppen stämmer inte med kontraktssumman förrän det är rätt." : "";
    w.className = "hint" + (bad ? " bad" : "");
  }
  function payUpdateNums() {
    var pc = payCalc(vPay);
    function set(sel, t) { var el = viewDlg.querySelector(sel); if (el) el.textContent = t; }
    pc.rows.forEach(function (r, i) {
      set('[data-c="amt"][data-i="' + i + '"]', fmtKr(r.amt));
      set('[data-c="ret"][data-i="' + i + '"]', fmtKr(r.ret));
      set('[data-c="inv"][data-i="' + i + '"]', fmtKr(r.inv));
    });
    set('[data-c="held"]', fmtKr(pc.held)); set('[data-c="tamt"]', fmtKr(pc.total)); set('[data-c="tinv"]', fmtKr(pc.inv + pc.held));
    payWarn();
  }
  async function savePay() {
    var c = findCard(viewId); if (!c || !canEdit()) return;
    var card = Object.assign({}, c, { pay: cleanPay(vPay) });
    try {
      var saved = await be.saveCard(card, c.rev);
      replaceIn(state.cards, saved); vDirty = false; vWarned = false;
      renderAll(); renderActivity(); vmsg("Sparat.");
    } catch (err) { vmsg(friendly(err), true); if (err && err.conflict) reload(); }
  }

  /* Händelser i rutan */
  $("view-close").addEventListener("click", closeView);
  $("view-edit").addEventListener("click", function () { var id = viewId; closeNow(); if (id) openEdit(id); });
  $("view-body").addEventListener("change", function (e) {
    if (e.target.id === "view-move" && viewId) moveCard(viewId, e.target.value);
  });
  $("view-tid").addEventListener("click", openTid);
  $("view-pay").addEventListener("click", openPay);
  viewDlg.addEventListener("click", function (e) { if (e.target === viewDlg) closeView(); });
  viewDlg.addEventListener("cancel", function (e) {
    if (vDirty && !vWarned) { e.preventDefault(); leave(closeNow); }
  });
  viewDlg.addEventListener("close", function () { viewId = null; vDirty = false; vWarned = false; });
  $("view-body").addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.hasAttribute("data-back")) backToView();
    else if (t.hasAttribute("data-tadd")) {
      if (vTid.length >= 100) return;
      vTid.push({ id: newId("m-"), name: "", start: "", end: "", done: false }); touched(); renderTid();
      var ins = viewDlg.querySelectorAll('[data-tf="name"]'); if (ins.length) ins[ins.length - 1].focus();
    } else if (t.hasAttribute("data-tdel")) { vTid.splice(+t.getAttribute("data-tdel"), 1); touched(); renderTid(); }
    else if (t.hasAttribute("data-tsave")) saveTid();
    else if (t.hasAttribute("data-psave")) savePay();
    else if (t.hasAttribute("data-pgen")) {
      if (vPay.items.length && !vGenArmed) { vGenArmed = true; t.textContent = "Bekräfta: ersätt lyften"; return; }
      vGenArmed = false; vPay.items = genItems(Math.round(clamp(vPay.n, 1, 60))); touched(); renderPay();
    }
  });
  $("view-body").addEventListener("input", function (e) {
    var t = e.target, i = +t.getAttribute("data-i"), k;
    if ((k = t.getAttribute("data-tf"))) {
      if (!vTid[i]) return;
      vTid[i][k] = k === "done" ? t.checked : t.value;
      touched();
      $("mg-wrap").innerHTML = momGantt(vTid, findCard(viewId));
    } else if ((k = t.getAttribute("data-pf"))) {
      if (k === "sum") vPay.sum = r2(clamp(num(t.value), 0, 1e11));
      else if (k === "n") vPay.n = Math.round(clamp(num(t.value) || 1, 1, 60));
      else if (k === "ret") vPay.ret = r2(clamp(num(t.value), 0, 100));
      else if (k === "retDate") vPay.retDate = dateStr(t.value);
      else if (k === "retPaid") vPay.retPaid = t.checked;
      else if (vPay.items[i]) {
        if (k === "pct") vPay.items[i].pct = r2(clamp(num(t.value), 0, 100));
        else if (k === "paid") vPay.items[i].paid = t.checked;
        else if (k === "date") vPay.items[i].date = dateStr(t.value);
        else vPay.items[i].label = t.value;
      }
      touched();
      if (k === "sum" || k === "ret" || k === "pct") payUpdateNums();
    }
  });

  /* ---------- Taggfilter ---------- */
  var NOTAG = "__none";
  var tagSel = [];
  try {
    var ts = JSON.parse(localStorage.getItem("pt-tags") || "[]");
    if (Array.isArray(ts)) tagSel = ts.filter(function (k) { return typeof k === "string"; });
  } catch (e) { tagSel = []; }
  function saveTagSel() { try { localStorage.setItem("pt-tags", JSON.stringify(tagSel)); } catch (e) {} }
  function tagKeys(c) {
    var k = (c.tags || []).map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean);
    return k.length ? k : [NOTAG];
  }
  function filteredCards() {
    var v = visibleCards();
    if (!tagSel.length) return v;
    return v.filter(function (c) { return tagKeys(c).some(function (k) { return tagSel.indexOf(k) >= 0; }); });
  }
  function renderTagFilter() {
    var host = $("tagfilter"), vis = visibleCards(), map = {}, order = [];
    vis.forEach(function (c) {
      var seen = {};
      (c.tags || []).forEach(function (t) {
        var key = t.trim().toLowerCase();
        if (!key || seen[key]) return;
        seen[key] = 1;
        if (!map[key]) { map[key] = { label: t.trim(), n: 0 }; order.push(key); }
        map[key].n++;
      });
      if (tagKeys(c)[0] === NOTAG) {
        if (!map[NOTAG]) { map[NOTAG] = { label: "Utan tagg", n: 0 }; order.push(NOTAG); }
        map[NOTAG].n++;
      }
    });
    tagSel = tagSel.filter(function (k) { return map[k]; });
    if (order.length < 2 && !tagSel.length) { host.hidden = true; host.innerHTML = ""; return; }
    order.sort(function (a, b) {
      if (a === NOTAG) return 1;
      if (b === NOTAG) return -1;
      return map[a].label.localeCompare(map[b].label, "sv");
    });
    var h = '<span class="lbl">Tagg</span>';
    order.forEach(function (k) {
      h += '<button type="button" class="tf' + (k === NOTAG ? "" : tagAttr(map[k].label)) + '" data-tag="' + esc(k) + '" aria-pressed="' + (tagSel.indexOf(k) >= 0) + '">' + (k === NOTAG ? "" : tagIcon(map[k].label)) + esc(map[k].label) + " <b>" + map[k].n + "</b></button>";
    });
    if (tagSel.length) {
      h += '<button type="button" class="tf clear" data-tag="">Visa alla</button><span class="tfinfo">Visar ' + filteredCards().length + " av " + vis.length + " kort</span>";
    }
    host.innerHTML = h;
    host.hidden = false;
  }
  $("tagfilter").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".tf") : null;
    if (!b) return;
    var k = b.getAttribute("data-tag");
    if (!k) tagSel = [];
    else if (tagSel.indexOf(k) >= 0) tagSel = tagSel.filter(function (x) { return x !== k; });
    else tagSel.push(k);
    saveTagSel();
    renderAll();
  });

  /* ---------- Visning: tavlan ---------- */
  function missingDates(c) {
    if (c.col !== "redo" && c.col !== "pagar" && c.col !== "besikt") return "";  // bara kort som redan är igång
    var s = dayOf(c.start) === null, e = dayOf(c.end) === null;
    return s && e ? "Saknar start och slutbesiktning" : s ? "Saknar startdatum" : e ? "Saknar slutbesiktning" : "";
  }
  var WARN_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.5" fill="none"/><path d="M8 8.5v2.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="12.2" r=".9" fill="currentColor"/></svg>';
  var USER_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="5.5" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.8 13.5c.6-2.6 2.6-4 5.2-4s4.6 1.4 5.2 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
  // Varje tekniker får sin egen nyans. Tilldelas i alfabetisk ordning, så olika tekniker får olika färger.
  var TECH_HUES = [210, 150, 25, 280, 320, 175, 50, 100, 240, 195];
  function techHue(name) {
    var key = String(name).trim().toLowerCase(), seen = {}, list = [];
    state.cards.forEach(function (c) { var k = (c.tech || "").trim().toLowerCase(); if (k && !c.deleted && !seen[k]) { seen[k] = 1; list.push(k); } });
    list.sort();
    var i = list.indexOf(key);
    return TECH_HUES[(i < 0 ? 0 : i) % TECH_HUES.length];
  }
  function techPill(name) {
    return '<span class="techpill" style="--h:' + techHue(name) + '" title="Ansvarig tekniker">' + USER_SVG + "<span>" + esc(name) + "</span></span>";
  }
  // Ikon per taggtyp. Känner igen namnen oavsett stavning och versaler; okända taggar får ingen ikon.
  var TAG_ICONS = {
    brand: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.8c.4 2.2 3.6 3.6 3.6 7A3.6 3.6 0 0 1 8 12.4 3.6 3.6 0 0 1 4.4 8.8c0-1.4.6-2.2 1.4-3 .1 1 .6 1.5 1.1 1.6C6.700 5.700 7.200 3.700 8 1.800z"/><path d="M6.600 14.200h2.800"/></svg>',
    cctv: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.800 5.500l8.200-2.200 1 3.600-8.200 2.200z"/><path d="M11 5.600l3.200-.9v3.300l-2.800.8M5.200 9.600L6 12.400h3"/></svg>',
    pass: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3.500" width="12" height="9" rx="1.500"/><circle cx="5.800" cy="7.600" r="1.300"/><path d="M3.800 10.800c.3-1 1-1.500 2-1.500s1.700.5 2 1.500M9.500 7h3M9.500 9.300h2"/></svg>',
    las: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="6.800" rx="1.500"/><path d="M5.200 7V5.200a2.800 2.800 0 0 1 5.600 0V7M8 9.500v2"/></svg>',
    tul: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.2h2.600L8 3.200v9.600L4.600 9.800H2z"/><path d="M10.300 5.800a3.100 3.100 0 0 1 0 4.400M12.200 4.200a5.500 5.500 0 0 1 0 7.600"/></svg>'
  };
  var TAG_HUES = { brand: 4, cctv: 45, pass: 270, las: 170, tul: 25 };
  function tagType(name) {
    var k = String(name).toLowerCase();
    if (k.indexOf("brand") >= 0) return "brand";
    if (k.indexOf("cctv") >= 0 || k.indexOf("kamera") >= 0 || k.indexOf("video") >= 0) return "cctv";
    if (k.indexOf("passer") >= 0 || k.indexOf("access") >= 0) return "pass";
    if (k.indexOf("lås") >= 0 || k.indexOf("las ") === 0 || k.indexOf("beslag") >= 0) return "las";
    if (k === "tul" || k.indexOf("tul ") === 0 || k.indexOf("utrymning") >= 0 || k.indexOf("talat") >= 0) return "tul";
    return "";
  }
  function tagIcon(name) { var t = tagType(name); return t ? TAG_ICONS[t] : ""; }
  function tagAttr(name) { var t = tagType(name); return t ? ' tc" style="--h:' + TAG_HUES[t] : ""; }
  // Kortets rubrik får färgen från den första taggen som har en färg.
  function titleStyle(c) {
    var i, t;
    for (i = 0; c.tags && i < c.tags.length; i++) { t = tagType(c.tags[i]); if (t) return ' style="--h:' + TAG_HUES[t] + '"'; }
    return "";
  }
  var IC = {
    view: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
    edit: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M10.5 2.5l3 3L5.5 13.5l-3.5.5.5-3.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
    del: '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.6 9h6.8l.6-9M6.7 7v4M9.3 7v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  function ib(kind, attr, id, label, cls) {
    return '<button type="button" class="ib ' + (cls || "") + '" ' + attr + '="' + esc(id) + '" title="' + label + '" aria-label="' + label + '">' + IC[kind] + "</button>";
  }
  // Slutbesiktning: röd när den passerat, gul inom 14 dagar (inte för kort i Klar).
  function endState(c) {
    var e = dayOf(c.end);
    if (e === null || c.col === "klar") return "";
    var d = e - todayDay();
    return d < 0 ? "late" : d <= 14 ? "soon" : "";
  }
  function cardDates(c) {
    var p = [], s = dayOf(c.start), e = dayOf(c.end), st = endState(c);
    if (s !== null) p.push("<span>Start " + esc(fmtDay(s)) + "</span>");
    if (e !== null) p.push('<span class="' + st + '">Slut ' + esc(fmtDay(e)) + (st === "late" ? " · försenad" : "") + "</span>");
    return p.join("");
  }
  function cardHtml(c) {
    var ed = canEdit(), st = endState(c);
    var h = '<article class="card' + (ed ? "" : " ro") + (c.col === "akut" ? " akut" : "") + (st === "late" ? " lateend" : "") + '"' + (ed ? ' draggable="true"' : "") + ' data-id="' + esc(c.id) + '">';
    var miss = missingDates(c);
    if (miss) h += '<span class="warn" role="img" aria-label="' + esc(miss) + '" title="' + esc(miss) + '">' + WARN_SVG + "</span>";
    h += "<h3 class=\"" + (miss ? "hasw " : "") + (titleStyle(c) ? "tt" : "") + "\"" + titleStyle(c) + ">" + esc(c.name) + (c.client ? ' <span class="client">· ' + esc(c.client) + "</span>" : "") + "</h3>";
    if (c.tags && c.tags.length) h += '<div class="tags">' + c.tags.map(function (t) { return '<span class="tag' + tagAttr(t) + '">' + tagIcon(t) + esc(t) + "</span>"; }).join("") + "</div>";
    if (c.chip) h += '<span class="chip ' + esc(c.chip[0]) + '">' + esc(c.chip[1]) + "</span>";
    if (c.tech) h += '<p class="tech">' + techPill(c.tech) + "</p>";
    if (hasDates(c)) h += '<p class="dts">' + cardDates(c) + "</p>";
    h += '<div class="rowbtns">' + ib("view", "data-view", c.id, "Visa");
    if (ed) h += ib("edit", "data-edit", c.id, "Redigera") + ib("del", "data-del", c.id, "Ta bort", "danger");
    return h + "</div></article>";
  }

  function renderBoard() {
    var vis = filteredCards();
    $("board").innerHTML = COLS.map(function (k) {
      var list = vis.filter(function (c) { return c.col === k.id; });
      return '<section class="col" data-col="' + k.id + '" style="--c:' + k.c + '"><div class="col-head"><h2>' + esc(k.t) +
        '</h2><span class="n">' + list.length + '</span></div><div class="col-sub">' + esc(k.s) +
        '</div><div class="cards">' + list.map(cardHtml).join("") + "</div></section>";
    }).join("");
    $("counts").innerHTML = COLS.map(function (k) {
      var n = vis.filter(function (c) { return c.col === k.id; }).length;
      return '<span class="count" style="--c:' + k.c + '"><span class="dot"></span>' + esc(k.t) + " <b>" + n + "</b></span>";
    }).join("");
    var nd = state.cards.length - visibleCards().length;
    $("restore").hidden = !(nd && canEdit());
    $("restore").textContent = "Återställ " + nd + " borttagna kort";
  }

  /* ---------- Visning: tidsplan ---------- */
  function renderGantt() {
    var host = $("g-scroll"), miss = $("g-miss");
    var all = filteredCards(), rows = [], nodate = 0;
    all.forEach(function (c) {
      var s = dayOf(c.start), e = dayOf(c.end);
      if (s === null && e === null) { nodate++; return; }
      rows.push({ c: c, s: s, e: e, k: s !== null ? s : e });
    });
    rows.sort(function (a, b) {
      return a.k - b.k || (a.e || 0) - (b.e || 0) || String(a.c.name).localeCompare(String(b.c.name), "sv");
    });
    miss.textContent = nodate ? nodate + " av " + all.length + " projekt saknar datum och syns inte här." + (canEdit() ? " Lägg in datum via Redigera på kortet." : "") : "";
    if (!rows.length) {
      host.innerHTML = '<p class="hint g-empty">Inga projekt har datum ännu.' + (canEdit() ? " Klicka på Redigera på ett kort och fyll i preliminärt startdatum och slutbesiktning." : "") + "</p>";
      return;
    }
    var keep = host.scrollLeft;
    var today = todayDay(), lo = today, hi = today, d;
    rows.forEach(function (r) {
      [r.s, r.e].forEach(function (v) { if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
    lo -= 4;
    while (dateOfDay(lo).getUTCDay() !== 1) lo--;
    hi += 7;
    var days = hi - lo + 1, LW = window.innerWidth < 520 ? 120 : 170;
    var avail = host.clientWidth - LW - 100;
    var ppd = Math.max(gZoom, avail > 0 ? avail / days : 0), TW = Math.round(days * ppd) + 100;

    var months = "", wk = "", lines = "";
    for (d = lo; d <= hi; d++) {
      var dt = dateOfDay(d), x = Math.round((d - lo) * ppd), first = dt.getUTCDate() === 1;
      if (first || d === lo) {
        months += '<span class="g-m" style="left:' + x + 'px">' + MONTHS[dt.getUTCMonth()] + (dt.getUTCMonth() === 0 || d === lo ? " " + dt.getUTCFullYear() : "") + "</span>";
        if (first) lines += '<i class="g-ln" style="left:' + x + 'px"></i>';
      }
      if (dt.getUTCDay() === 1 && ppd >= 5) {
        wk += '<span class="g-w" style="left:' + x + 'px">v' + isoWeek(d) + "</span>";
        lines += '<i class="g-ln wk" style="left:' + x + 'px"></i>';
      }
    }
    lines += '<i class="g-ln today" style="left:' + Math.round((today - lo + 0.5) * ppd) + 'px"></i>';

    var ed = canEdit();
    var body = rows.map(function (r) {
      var c = r.c, col = COLS.filter(function (k) { return k.id === c.col; })[0] || COLS[0];
      var bar = "", right, lab;
      var xs = r.s !== null ? (r.s - lo) * ppd : 0;
      var xe = r.e !== null ? (r.e - lo + 0.5) * ppd : 0;
      var xsc = r.s !== null ? (r.s - lo + 0.5) * ppd : 0;
      if (r.s !== null && r.e !== null && r.e >= r.s) {
        bar = '<i class="g-bar" style="left:' + xs.toFixed(1) + 'px;width:' + Math.max(6, (r.e - r.s + 1) * ppd).toFixed(1) + 'px"></i><i class="g-mk dia" style="left:' + xe.toFixed(1) + 'px"></i>';
        right = Math.max(xe + 8, xs + (r.e - r.s + 1) * ppd);
        lab = fmtDay(r.s) + " – " + fmtDay(r.e);
      } else {
        right = 0; lab = [];
        if (r.s !== null) { bar += '<i class="g-mk dot" style="left:' + xsc.toFixed(1) + 'px"></i>'; right = Math.max(right, xsc); lab.push("Start " + fmtDay(r.s)); }
        if (r.e !== null) { bar += '<i class="g-mk dia" style="left:' + xe.toFixed(1) + 'px"></i>'; right = Math.max(right, xe); lab.push("Besiktning " + fmtDay(r.e)); }
        lab = lab.join(" · ");
      }
      var tip = (c.client ? c.name + " · " + c.client : c.name) + " (" + col.t + ")" + (c.tech ? " · Tekniker: " + c.tech : "");
      var label = ed
        ? '<button type="button" data-gedit="' + esc(c.id) + '" title="' + esc(tip) + '">' + esc(c.name) + "</button>"
        : '<button type="button" data-gview="' + esc(c.id) + '" title="' + esc(tip) + '">' + esc(c.name) + "</button>";
      return '<div class="g-row" style="--c:' + col.c + '"><div class="g-lab">' + label + "</div>" +
        '<div class="g-track" style="width:' + TW + 'px">' + bar + '<span class="g-txt" style="left:' + Math.round(right + 10) + 'px">' + esc(lab) + "</span></div></div>";
    }).join("");

    host.innerHTML = '<div class="g-inner" style="--lw:' + LW + 'px;width:' + (LW + TW) + 'px">' +
      '<div class="g-head"><div class="g-corner"></div><div class="g-axis" style="width:' + TW + 'px">' + months + wk + "</div></div>" +
      '<div class="g-lines" style="width:' + TW + 'px">' + lines + "</div>" + body + "</div>";
    host.scrollLeft = keep;
  }

  /* ---------- Visning: dokumentation och datum ---------- */
  function renderDocs() {
    var ed = canEdit();
    var list = visibleDocs();
    $("docs").innerHTML = list.map(function (d) {
      return '<div class="docrow"><label class="check"><input type="checkbox" data-doc="' + esc(d.id) + '"' + (d.done ? " checked" : "") + (ed ? "" : " disabled") +
        "><span><b>" + esc(d.project) + ":</b> " + esc(d.body) + "</span></label>" +
        (ed ? '<button type="button" class="del" data-docdel="' + esc(d.id) + '" aria-label="Ta bort raden ' + esc(d.project) + '">Ta bort</button>' : "") + "</div>";
    }).join("") || '<p class="hint">Inga rader.</p>';
    var nd = state.docs.length - list.length;
    $("restore-docs").hidden = !(nd && ed);
    $("restore-docs").textContent = "Återställ " + nd + " borttagna " + (nd === 1 ? "rad" : "rader");
    $("docadd").hidden = !ed;
  }

  function renderDates() {
    var today = todayDay(), over = [], next = [];
    filteredCards().forEach(function (c) {
      if (c.col === "klar") return;
      var s = dayOf(c.start), e = dayOf(c.end);
      if (s !== null && s >= today) next.push({ d: s, c: c, what: "start" });
      if (e !== null) (e < today ? over : next).push({ d: e, c: c, what: "slutbesiktning" });
    });
    over.sort(function (a, b) { return a.d - b.d; });
    next.sort(function (a, b) { return a.d - b.d; });
    var items = over.concat(next.slice(0, 12));
    $("dates").innerHTML = items.map(function (it) {
      var diff = it.d - today, cls = it.d < today ? "late" : diff <= 7 ? "soon" : "";
      var rel = diff === 0 ? "idag" : diff > 0 ? "om " + diff + (diff === 1 ? " dag" : " dagar") : -diff + (diff === -1 ? " dag" : " dagar") + " sedan";
      return '<li class="' + cls + '"><time>' + esc(fmtDay(it.d)) + "<small>v" + isoWeek(it.d) + " · " + esc(rel) + "</small></time><span>" +
        esc(it.c.name) + ", " + it.what + (it.c.tech ? "<small>" + esc(it.c.tech) + "</small>" : "") + "</span></li>";
    }).join("") || '<li><span class="hint">Inga kommande datum. Lägg in start eller slutbesiktning på korten.</span></li>';
  }

  var FIELDS = { col: "status", name: "namn", client: "kund", tags: "taggar", chip_text: "markering", chip_cls: "markering", lage: "läge", next: "nästa steg",
    notes: "anteckningar", start_date: "start", end_date: "slutbesiktning", tech: "tekniker", tidplan: "tidplan", betalplan: "betalplan", done: "klar", body: "text", project: "projekt", pos: "" };
  function colName(id) { var c = COLS.filter(function (k) { return k.id === id; })[0]; return c ? c.t : id; }
  function actText(a) {
    var what = a.entity === "doc" ? "dokumentationsraden " : "kortet ", t = a.title || a.entity_id;
    if (a.action === "insert") return "Lade till " + what + t;
    if (a.action === "delete") return "Tog bort " + what + t;
    if (a.action === "restore") return "Återställde " + what + t;
    var d = a.detail || {}, parts = [];
    if (d.col) parts.push("flyttade " + t + " till " + colName(d.col[1]));
    if (d.done) parts.push((d.done[1] ? "bockade av " : "tog bort bocken på ") + t);
    var other = Object.keys(d).filter(function (k) { return k !== "col" && k !== "done" && FIELDS[k] !== ""; }).map(function (k) { return FIELDS[k] || k; });
    other = other.filter(function (x, i) { return other.indexOf(x) === i; });
    if (other.length) parts.push("ändrade " + other.join(", ") + " på " + t);
    var s = parts.join(" och ") || "ändrade " + t;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  async function renderActivity() {
    if (!$("act").open) return;
    try {
      var list = await be.activity();
      $("actlist").innerHTML = list.map(function (a) {
        return "<li><time>" + esc(fmtStamp(a.at)) + "</time><span>" + esc(actText(a)) + (a.user_email ? "<small>" + esc(a.user_email) + "</small>" : "") + "</span></li>";
      }).join("") || '<li><span class="hint">Inga ändringar än.</span></li>';
    } catch (e) { $("actlist").innerHTML = '<li><span class="hint">' + esc(friendly(e)) + "</span></li>"; }
  }

  function renderAll() {
    renderTagFilter(); renderBoard(); renderGantt(); renderDocs(); renderDates(); refreshView();
    $("open-add").hidden = !canEdit();
    $("io-import-box").hidden = !isAdmin();
  }

  /* ---------- Hämta om ---------- */
  var reloadTimer = null;
  async function reload() {
    try {
      var r = await be.load();
      state.cards = r.cards; state.docs = r.docs;
      renderAll(); renderActivity();
    } catch (e) { banner(friendly(e), true); }
  }
  function reloadSoon() { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 400); }

  /* ---------- Kort: flytta, ta bort, redigera ---------- */
  async function moveCard(id, col) {
    var c = findCard(id);
    if (!c || c.col === col || !canEdit()) return;
    var prev = c.col;
    c.col = col; renderAll();
    try { replaceIn(state.cards, await be.patchCard(id, { col: col })); renderAll(); renderActivity(); banner(""); }
    catch (e) { c.col = prev; renderAll(); fail(e); }
  }
  async function deleteCard(id) {
    var c = findCard(id);
    if (!c || !canEdit()) return;
    try {
      replaceIn(state.cards, await be.patchCard(id, { deleted: true }));
      lastDeleted = { kind: "card", id: id };
      renderAll(); renderActivity(); banner("");
      showToast("Tog bort " + c.name, true);
    } catch (e) { fail(e); }
  }

  var form = $("addform"), openBtn = $("open-add");
  $("f-col").innerHTML = COLS.map(function (k) { return '<option value="' + k.id + '">' + esc(k.t) + "</option>"; }).join("");
  function toggleForm(show) {
    form.hidden = !show;
    openBtn.setAttribute("aria-expanded", show ? "true" : "false");
    if (show) $("f-name").focus();
  }
  function setMode(id, rev) {
    editingId = id; editRev = rev == null ? null : rev;
    $("form-title").textContent = id ? "Redigera kort" : "Nytt kort";
    $("f-submit").textContent = id ? "Spara ändringar" : "Lägg till";
  }
  function checkDates() {
    var s = $("f-start").value, e = $("f-end");
    e.setCustomValidity(s && e.value && e.value < s ? "Slutbesiktning ligger före startdatum." : "");
  }
  function fillForm(c) {
    $("f-name").value = c.name || "";
    $("f-client").value = c.client || "";
    $("f-tech").value = c.tech || "";
    $("f-col").value = c.col;
    $("f-chip").value = c.chip ? c.chip[1] : "";
    $("f-start").value = dayOf(c.start) !== null ? c.start : "";
    $("f-end").value = dayOf(c.end) !== null ? c.end : "";
    $("f-lage").value = c.lage || "";
    $("f-next").value = c.next || "";
    $("f-notes").value = (c.notes || []).join("\n");
    $("f-tags").value = (c.tags || []).join(", ");
    checkDates();
  }
  function openEdit(id) {
    var c = findCard(id);
    if (!c || !canEdit()) return;
    form.reset(); setMode(id, c.rev); fillForm(c); toggleForm(true);
    try { form.scrollIntoView({ block: "nearest" }); } catch (x) {}
  }
  $("f-start").addEventListener("input", checkDates);
  $("f-end").addEventListener("input", checkDates);
  form.addEventListener("reset", function () { setTimeout(checkDates, 0); });
  openBtn.addEventListener("click", function () {
    if (!form.hidden && !editingId) { toggleForm(false); return; }
    form.reset(); setMode(null); $("f-col").value = "planera"; toggleForm(true);
  });
  $("cancel-add").addEventListener("click", function () { form.reset(); setMode(null); toggleForm(false); });

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!canEdit()) return;
    var name = $("f-name").value.trim();
    if (!name) return;
    var chipText = $("f-chip").value.trim();
    var existing = editingId ? findCard(editingId) : null;
    var cls = existing && existing.chip && CHIPCLS.indexOf(existing.chip[0]) >= 0 ? existing.chip[0] : "info";
    var card = {
      id: existing ? existing.id : newId("k-"),
      col: $("f-col").value,
      pos: existing ? existing.pos : maxPos(state.cards) + 1,
      name: name,
      client: $("f-client").value.trim(),
      tags: $("f-tags").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      chip: chipText ? [cls, chipText] : null,
      lage: $("f-lage").value.trim(),
      next: $("f-next").value.trim(),
      notes: $("f-notes").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean),
      start: dateStr($("f-start").value), end: dateStr($("f-end").value),
      tech: $("f-tech").value.trim(), deleted: false,
      tplan: existing ? existing.tplan : undefined, pay: existing ? existing.pay : undefined
    };
    var btn = $("f-submit"); btn.disabled = true;
    try {
      var saved = existing ? await be.saveCard(card, editRev) : await be.insertCard(card);
      replaceIn(state.cards, saved);
      form.reset(); setMode(null); toggleForm(false);
      renderAll(); renderActivity(); banner("");
      if (tagSel.length && !filteredCards().some(function (c) { return c.id === saved.id; })) {
        banner("Kortet sparades men syns inte just nu, eftersom ett taggfilter är aktivt. Klicka på Visa alla för att se alla kort.", false);
      }
    } catch (err) {
      banner(friendly(err), true);
      if (err && err.conflict) reload(); // formuläret ligger kvar så att texten inte går förlorad
    } finally { btn.disabled = false; }
  });

  /* ---------- Tavlan: dra, flytta, redigera, ta bort ---------- */
  var board = $("board"), dragId = null;
  board.addEventListener("dragstart", function (e) {
    var el = e.target.closest ? e.target.closest(".card") : null;
    if (!el || !canEdit()) return;
    dragId = el.getAttribute("data-id");
    el.classList.add("drag");
    try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch (x) {}
  });
  board.addEventListener("dragend", function () {
    dragId = null;
    Array.prototype.forEach.call(document.querySelectorAll(".drag,.over"), function (n) { n.classList.remove("drag", "over"); });
  });
  board.addEventListener("dragover", function (e) {
    var col = e.target.closest ? e.target.closest(".col") : null;
    if (!col || !dragId) return;
    e.preventDefault();
    Array.prototype.forEach.call(document.querySelectorAll(".over"), function (n) { if (n !== col) n.classList.remove("over"); });
    col.classList.add("over");
  });
  board.addEventListener("drop", function (e) {
    var col = e.target.closest ? e.target.closest(".col") : null;
    if (!col || !dragId) return;
    e.preventDefault();
    var id = dragId; dragId = null;
    moveCard(id, col.getAttribute("data-col"));
  });
  board.addEventListener("change", function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-move");
    if (id) moveCard(id, e.target.value);
  });
  board.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) {
      // Klick på själva kortet öppnar Visa-rutan (inte på rullista eller länk).
      var card = e.target.closest ? e.target.closest(".card") : null;
      if (card && !(e.target.closest && e.target.closest("select, a, input, label"))) openView(card.getAttribute("data-id"));
      return;
    }
    var editId = t.getAttribute("data-edit"), delId = t.getAttribute("data-del"), vid = t.getAttribute("data-view");
    if (vid) openView(vid);
    else if (editId) openEdit(editId);
    else if (delId) deleteCard(delId);
  });
  $("g-scroll").addEventListener("click", function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-gedit");
    var vid = e.target.getAttribute && e.target.getAttribute("data-gview");
    if (id) openEdit(id);
    else if (vid) openView(vid);
  });
  $("g-zoom").addEventListener("change", function (e) { gZoom = parseFloat(e.target.value) || 6; renderGantt(); });
  var gTimer = null, gWidth = window.innerWidth;
  window.addEventListener("resize", function () {
    clearTimeout(gTimer);
    gTimer = setTimeout(function () { if (window.innerWidth !== gWidth) { gWidth = window.innerWidth; renderGantt(); } }, 150);
  });

  $("restore").addEventListener("click", async function () {
    try {
      var del = state.cards.filter(function (c) { return c.deleted; });
      var res = await Promise.all(del.map(function (c) { return be.patchCard(c.id, { deleted: false }); }));
      res.forEach(function (s) { replaceIn(state.cards, s); });
      toast.hidden = true; lastDeleted = null;
      renderAll(); renderActivity(); banner("");
    } catch (e) { fail(e); }
  });

  /* ---------- Dokumentationsrader ---------- */
  $("docs").addEventListener("change", async function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-doc");
    if (!id || !canEdit()) return;
    var d = findDoc(id); if (!d) return;
    var prev = d.done; d.done = e.target.checked;
    try { replaceIn(state.docs, await be.patchDoc(id, { done: d.done })); renderActivity(); banner(""); }
    catch (err) { d.done = prev; renderDocs(); fail(err); }
  });
  $("docs").addEventListener("click", async function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-docdel");
    if (!id || !canEdit()) return;
    var d = findDoc(id); if (!d) return;
    try {
      replaceIn(state.docs, await be.patchDoc(id, { deleted: true }));
      lastDeleted = { kind: "doc", id: id };
      renderDocs(); renderActivity(); banner("");
      showToast("Tog bort raden " + d.project, true);
    } catch (err) { fail(err); }
  });
  $("restore-docs").addEventListener("click", async function () {
    try {
      var del = state.docs.filter(function (d) { return d.deleted; });
      var res = await Promise.all(del.map(function (d) { return be.patchDoc(d.id, { deleted: false }); }));
      res.forEach(function (s) { replaceIn(state.docs, s); });
      toast.hidden = true; lastDeleted = null;
      renderDocs(); renderActivity(); banner("");
    } catch (err) { fail(err); }
  });
  $("docadd").addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!canEdit()) return;
    var nm = $("doc-name").value.trim();
    if (!nm) return;
    var doc = { id: newId("r-"), project: nm.slice(0, 200), body: $("doc-text").value.trim().slice(0, 1000), done: false, pos: maxPos(state.docs) + 1, deleted: false };
    try {
      replaceIn(state.docs, await be.insertDoc(doc));
      e.target.reset(); renderDocs(); renderActivity(); banner("");
      $("doc-name").focus();
    } catch (err) { fail(err); }
  });

  $("toast-undo").addEventListener("click", async function () {
    var ld = lastDeleted; lastDeleted = null; toast.hidden = true;
    if (!ld) return;
    try {
      if (ld.kind === "card") replaceIn(state.cards, await be.patchCard(ld.id, { deleted: false }));
      else replaceIn(state.docs, await be.patchDoc(ld.id, { deleted: false }));
      renderAll(); renderActivity(); banner("");
    } catch (e) { fail(e); }
  });

  $("act").addEventListener("toggle", renderActivity);

  /* ---------- Import och export ---------- */
  var ioPanel = $("io"), importArmed = false, pending = null;
  function ioMsg(t) { $("io-msg").textContent = t; }
  function disarm() { importArmed = false; $("io-import").textContent = "Läs in"; }
  function toggleIo(show) {
    ioPanel.hidden = !show;
    $("open-io").setAttribute("aria-expanded", show ? "true" : "false");
    if (!show) { ioMsg(""); disarm(); pending = null; }
  }
  $("open-io").addEventListener("click", function () { toggleIo(ioPanel.hidden); });
  $("io-close").addEventListener("click", function () { toggleIo(false); });

  function exportJson() {
    return JSON.stringify({
      app: "projekttavla", version: 2, exported: new Date().toISOString(),
      cards: state.cards.map(function (c) { return { id: c.id, col: c.col, pos: c.pos, name: c.name, client: c.client, tags: c.tags, chip: c.chip, lage: c.lage, next: c.next, notes: c.notes, start: c.start, end: c.end, tech: c.tech, deleted: c.deleted, tplan: c.tplan || [], pay: c.pay || null }; }),
      docs: state.docs.map(function (d) { return { id: d.id, project: d.project, body: d.body, done: d.done, pos: d.pos, deleted: d.deleted }; })
    }, null, 2);
  }
  $("io-save").addEventListener("click", function () {
    var d = new Date(), name = "projekttavla-" + d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + ".json";
    try {
      var url = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
      var a = document.createElement("a");
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      ioMsg("Filen " + name + " skickades till dina nedladdningar.");
    } catch (x) { ioMsg("Kunde inte skapa filen."); }
  });

  function idOk(s) { return typeof s === "string" && IDRE.test(s) && s !== "__proto__"; }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max || 4000) : ""; }
  function cleanChip(v) {
    if (!Array.isArray(v) || v.length < 2 || typeof v[1] !== "string" || !v[1]) return null;
    return [CHIPCLS.indexOf(v[0]) >= 0 ? v[0] : "info", v[1].slice(0, 200)];
  }
  function cleanImport(d) {
    if (!d || typeof d !== "object" || d.app !== "projekttavla" || d.version !== 2 || !Array.isArray(d.cards)) {
      throw new Error("Filen är inte en tavlafil i rätt format.");
    }
    var cards = [], docs = [];
    d.cards.forEach(function (c, i) {
      if (!c || typeof c !== "object" || !idOk(c.id) || !str(c.name, 200)) return;
      cards.push({
        id: c.id, col: COLIDS.indexOf(c.col) >= 0 ? c.col : "planera", pos: typeof c.pos === "number" && isFinite(c.pos) ? Math.round(c.pos) : i + 1,
        name: str(c.name, 200), client: str(c.client, 200), tags: strList(c.tags), chip: cleanChip(c.chip),
        lage: str(c.lage), next: str(c.next), notes: strList(c.notes), start: dateStr(c.start), end: dateStr(c.end),
        tech: str(c.tech, 100), deleted: c.deleted === true,
        tplan: "tplan" in c ? cleanTplan(c.tplan) : undefined, pay: "pay" in c ? cleanPay(c.pay) : undefined
      });
    });
    (Array.isArray(d.docs) ? d.docs : []).forEach(function (x, i) {
      if (!x || typeof x !== "object" || !idOk(x.id) || !str(x.project, 200)) return;
      docs.push({ id: x.id, project: str(x.project, 200), body: str(x.body, 1000), done: x.done === true, pos: typeof x.pos === "number" && isFinite(x.pos) ? Math.round(x.pos) : i + 1, deleted: x.deleted === true });
    });
    return { cards: cards, docs: docs };
  }
  $("io-file").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    pending = null; disarm();
    if (!f) return;
    var r = new FileReader();
    r.onload = function () { pending = String(r.result || ""); ioMsg("Filen " + f.name + " är vald. Klicka på Läs in."); };
    r.onerror = function () { ioMsg("Filen gick inte att läsa."); };
    r.readAsText(f);
  });
  $("io-import").addEventListener("click", async function () {
    if (!isAdmin()) { ioMsg("Bara administratörer kan importera."); return; }
    if (!pending) { ioMsg("Välj en fil först."); return; }
    var clean;
    try { clean = cleanImport(JSON.parse(pending)); } catch (err) {
      disarm(); ioMsg(err && err.message && err.message.indexOf("tavlafil") >= 0 ? err.message : "Filen går inte att läsa. Kontrollera att du valt rätt fil.");
      return;
    }
    if (!importArmed) {
      importArmed = true;
      $("io-import").textContent = "Bekräfta och läs in";
      ioMsg("Filen innehåller " + clean.cards.length + " kort och " + clean.docs.length + " dokumentationsrader. Kort och rader med samma id skrivs över. Klicka igen för att läsa in.");
      return;
    }
    disarm();
    $("io-import").disabled = true;
    try {
      // Äldre filer saknar tid- och betalplan: behåll då det som redan finns i stället för att tömma det.
      clean.cards.forEach(function (c) {
        var cur = findCard(c.id);
        if (c.tplan === undefined) c.tplan = cur && cur.tplan ? cur.tplan : [];
        if (c.pay === undefined) c.pay = cur && cur.pay ? cur.pay : null;
      });
      await be.importAll(clean.cards, clean.docs);
      pending = null; $("io-file").value = "";
      ioMsg("Klart. " + clean.cards.length + " kort och " + clean.docs.length + " rader lästes in.");
      await reload();
    } catch (err) { ioMsg(friendly(err)); }
    finally { $("io-import").disabled = false; }
  });

  /* ---------- Inloggning och start ---------- */
  function show(which) {
    $("boot").hidden = which !== "boot";
    $("login").hidden = which !== "login";
    $("noaccess").hidden = which !== "noaccess";
    $("app").hidden = which !== "app";
  }
  $("login-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    var btn = $("l-submit"); btn.disabled = true; $("l-msg").textContent = "Loggar in …";
    try { await be.signIn($("l-email").value.trim(), $("l-pass").value); $("l-pass").value = ""; $("l-msg").textContent = ""; await boot(); }
    catch (err) { $("l-msg").textContent = friendly(err); }
    finally { btn.disabled = false; }
  });
  async function doLogout() { try { await be.signOut(); } catch (e) {} location.reload(); }
  $("logout").addEventListener("click", doLogout);
  $("na-out").addEventListener("click", doLogout);

  var entered = false;
  async function enter(u) {
    state.role = u.role; state.email = u.email;
    if (!u.role) {
      $("na-text").textContent = "Kontot " + u.email + " är inloggat men har inte fått åtkomst till tavlan. Be en administratör lägga till dig.";
      show("noaccess"); return;
    }
    show("app");
    $("who").innerHTML = "<b>" + esc(u.email) + "</b> · " + esc(ROLES[u.role] || u.role);
    $("logout").hidden = DEMO;
    if (DEMO) banner("Demoläge: ingen databas är kopplad, så det här är exempeldata som försvinner när du laddar om sidan.", false);
    await reload();
    if (!entered) {
      entered = true;
      be.subscribe(reloadSoon);
      be.onSignedOut(function () { location.reload(); });
      window.addEventListener("focus", reloadSoon);
    }
  }
  async function boot() {
    try {
      if (!be) be = DEMO ? makeDemo() : makeSb();
      var u = await be.start();
      if (!u) { show("login"); $("l-email").focus(); return; }
      await enter(u);
    } catch (e) {
      show("login");
      $("l-msg").textContent = friendly(e);
    }
  }
  boot();
})();
