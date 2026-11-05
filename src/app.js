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
      pay: r.betalplan || ("betalplan" in r ? null : undefined),
      ata: Array.isArray(r.ata) ? r.ata : ("ata" in r ? [] : undefined),
      kalk: "kalk_h" in r ? (r.kalk_h === null || r.kalk_h === undefined ? null : Number(r.kalk_h)) : undefined
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
    if (c.ata !== undefined) r.ata = c.ata;
    if (c.kalk !== undefined) r.kalk_h = c.kalk;
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
    B.loadPlan = async function (from, to) {
      var t = chk(await sb.from("plan_techs").select("*").order("pos", { ascending: true }).order("name", { ascending: true }));
      var o = chk(await sb.from("plan_other").select("*").order("pos", { ascending: true }).order("name", { ascending: true }));
      var all = [], i = 0, page;
      do {
        page = chk(await sb.from("plan_bookings").select("day,tech_id,ref").gte("day", from).lte("day", to).order("day", { ascending: true }).range(i, i + 999));
        all = all.concat(page); i += 1000;
      } while (page.length === 1000 && i < 20000);
      return { techs: t, others: o, bookings: all };
    };
    B.loadTasks = async function () {
      return chk(await sb.from("my_tasks").select("id,title,sect,due,card,done,pos").order("pos", { ascending: true })).map(function (r) {
        return { id: r.id, title: r.title, sect: r.sect, due: r.due || "", card: r.card || "", done: !!r.done, pos: r.pos || 0 };
      });
    };
    B.saveTasks = async function (list) {
      var rows = list.map(function (t) { return { id: t.id, title: t.title, sect: t.sect, due: t.due || null, card: t.card || null, done: !!t.done, pos: t.pos }; });
      for (var i = 0; i < rows.length; i += 100) chk(await sb.from("my_tasks").upsert(rows.slice(i, i + 100), { onConflict: "id" }));
    };
    B.deleteTask = async function (id) { chk(await sb.from("my_tasks").delete().eq("id", id)); };
    B.loadAllBookings = async function () {
      var all = [], i = 0, page;
      do {
        page = chk(await sb.from("plan_bookings").select("day,tech_id,ref").order("day", { ascending: true }).range(i, i + 999));
        all = all.concat(page); i += 1000;
      } while (page.length === 1000 && i < 50000);
      return all;
    };
    B.loadRefPlan = async function (ref, from) {
      var t = chk(await sb.from("plan_techs").select("id,name"));
      var b = chk(await sb.from("plan_bookings").select("day,tech_id").eq("ref", ref).gte("day", from).order("day", { ascending: true }).limit(1000));
      return { techs: t, bookings: b };
    };
    B.addBookings = async function (rows) {
      for (var i = 0; i < rows.length; i += 500) chk(await sb.from("plan_bookings").upsert(rows.slice(i, i + 500), { onConflict: "day,tech_id,ref", ignoreDuplicates: true }));
    };
    B.removeBookings = async function (rows) {
      var g = {};
      rows.forEach(function (b) { var k = b.tech_id + "\u0001" + b.ref; (g[k] = g[k] || { tech_id: b.tech_id, ref: b.ref, days: [] }).days.push(b.day); });
      for (var k in g) chk(await sb.from("plan_bookings").delete().eq("tech_id", g[k].tech_id).eq("ref", g[k].ref).in("day", g[k].days));
    };
    B.saveTech = async function (t) { chk(await sb.from("plan_techs").upsert({ id: t.id, name: t.name, pos: t.pos, active: t.active }, { onConflict: "id" })); };
    B.saveOther = async function (o) { chk(await sb.from("plan_other").upsert({ id: o.id, name: o.name, kind: o.kind, pos: o.pos, active: o.active }, { onConflict: "id" })); };
    B.subscribe = function (cb) {
      sb.channel("planering")
        .on("postgres_changes", { event: "*", schema: "public", table: "plan_bookings" }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "plan_techs" }, cb)
        .on("postgres_changes", { event: "*", schema: "public", table: "plan_other" }, cb)
        .subscribe();
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
    cards.forEach(function (c) { if (c.id === "d3") c.kalk = 80; if (c.id === "d4") c.kalk = 30; });
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
    var pt = [], po = [], pb = [];
    ["Anna Exempel", "Bo Exempel", "Cecilia Exempel", "David Exempel", "Eva Exempel"].forEach(function (n, i) { pt.push({ id: "pt" + i, name: n, pos: i + 1, active: true }); });
    po.push({ id: "po1", name: "Semester", kind: "abs", pos: 1, active: true }, { id: "po2", name: "Sjuk", kind: "abs", pos: 2, active: true }, { id: "po3", name: "Service - Diverse", kind: "work", pos: 3, active: true });
    (function () {
      var mon = todayDay() - ((dateOfDay(todayDay()).getUTCDay() + 6) % 7), d;
      for (d = 0; d < 5; d++) { pb.push({ day: isoOfDay(mon + d), tech_id: "pt0", ref: "k:d4" }); pb.push({ day: isoOfDay(mon + d), tech_id: "pt1", ref: "k:d3" }); }
      pb.push({ day: isoOfDay(mon + 1), tech_id: "pt2", ref: "o:po1" }, { day: isoOfDay(mon + 2), tech_id: "pt2", ref: "o:po1" }, { day: isoOfDay(mon + 2), tech_id: "pt0", ref: "o:po3" });
    })();
    B.loadPlan = async function (from, to) {
      return { techs: clone(pt), others: clone(po), bookings: clone(pb.filter(function (b) { return b.day >= from && b.day <= to; })) };
    };
    var tk = [
      { id: "t1", title: "Skicka offert Exempel Hus 5", sect: "ny", due: "", card: "d5", done: false, pos: 10 },
      { id: "t2", title: "Boka lift till Skolan", sect: "idag", due: isoOfDay(t), card: "d2", done: false, pos: 10 },
      { id: "t3", title: "Beställ läsare", sect: "vecka", due: isoOfDay(t + 5), card: "d3", done: false, pos: 10 }
    ];
    B.loadTasks = async function () { return clone(tk); };
    B.saveTasks = async function (list) { list.forEach(function (x) { var cur = find(tk, x.id); if (cur) Object.assign(cur, clone(x)); else tk.push(clone(x)); }); };
    B.deleteTask = async function (id) { tk = tk.filter(function (x) { return x.id !== id; }); };
    B.loadAllBookings = async function () { return clone(pb); };
    B.loadRefPlan = async function (ref, from) {
      return { techs: clone(pt), bookings: clone(pb.filter(function (b) { return b.ref === ref && b.day >= from; })) };
    };
    B.addBookings = async function (rows) {
      rows.forEach(function (r) { if (!pb.some(function (b) { return b.day === r.day && b.tech_id === r.tech_id && b.ref === r.ref; })) pb.push(clone(r)); });
    };
    B.removeBookings = async function (rows) {
      pb = pb.filter(function (b) { return !rows.some(function (r) { return b.day === r.day && b.tech_id === r.tech_id && b.ref === r.ref; }); });
    };
    function upsertIn(list, x) { var cur = find(list, x.id); if (cur) Object.assign(cur, clone(x)); else list.push(clone(x)); list.sort(function (a, b) { return a.pos - b.pos; }); }
    B.saveTech = async function (t) { upsertIn(pt, t); };
    B.saveOther = async function (o) { upsertIn(po, o); };
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
    if (/kalk_h/i.test(m) && /column|schema cache/i.test(m)) return "Databasen saknar kolumnen för kalkylerade timmar. Kör migreringen för kalkylerade timmar i Supabase (se README) och försök igen.";
    if (/['"\s.]ata['"\s.]/i.test(m) && /column|schema cache/i.test(m)) return "Databasen saknar kolumnen för ÄTA. Kör migreringen för ÄTA i Supabase (se README) och försök igen.";
    if (/my_tasks/i.test(m) && /relation|schema cache|does not exist|find the table/i.test(m)) return "Mina uppgifter saknas i databasen. Kör migreringen för Mina uppgifter i Supabase (se README).";
    if (/plan_(techs|other|bookings)/i.test(m) && /relation|schema cache|does not exist|find the table/i.test(m)) return "Planeringen saknas i databasen. Kör migreringen för teknikerplanering i Supabase (se README).";
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
      items: items, retDate: dateStr(v.retDate), retPaid: v.retPaid === true, ata: v.ata === true
    };
  }

  /* ---------- ÄTA ---------- */
  var ATA_TYPES = [["ata", "ÄTA"], ["avv", "Avvikelse"], ["fraga", "Fråga/Svar"]];
  var ATA_STAT = [["utkast", "Utkast"], ["skickad", "Skickad"], ["besvarad", "Besvarad"], ["godkand", "Godkänd"], ["avslagen", "Avslagen"], ["utford", "Utförd"], ["fakturerad", "Fakturerad"]];
  var ATA_APPROVED = ["godkand", "utford", "fakturerad"], ATA_OPEN = ["utkast", "skickad", "besvarad"];
  function pickOf(list, v, def) { return list.some(function (x) { return x[0] === v; }) ? v : def; }
  function labelOf(list, v) { var r = list.filter(function (x) { return x[0] === v; })[0]; return r ? r[1] : ""; }
  function cleanAta(v) {
    if (!Array.isArray(v)) return [];
    var seen = {}, max = 0, out = [];
    v.slice(0, 500).forEach(function (o) {
      if (!o || typeof o !== "object") return;
      var id = idOk(o.id) && !seen[o.id] ? o.id : newId("a-"); seen[id] = 1;
      var no = Math.round(clamp(num(o.no), 0, 100000)); if (no > max) max = no;
      out.push({
        id: id, no: no, type: pickOf(ATA_TYPES, o.type, "ata"), date: dateStr(o.date), to: str(o.to, 200), part: str(o.part, 300),
        due: dateStr(o.due), text: str(o.text, 4000), cost: o.cost === true, dir: o.dir === "sub" ? "sub" : "add",
        est: r2(clamp(num(o.est), 0, 1e11)), action: str(o.action, 4000), status: pickOf(ATA_STAT, o.status, "utkast"),
        acc: r2(clamp(num(o.acc), 0, 1e11)), accDate: dateStr(o.accDate), accName: str(o.accName, 200)
      });
    });
    var used = {};
    out.forEach(function (o) { if (o.no > 0 && !used[o.no]) used[o.no] = 1; else { o.no = ++max; used[o.no] = 1; } });
    return out;
  }
  function ataSigned(it, field) { return (it.dir === "sub" ? -1 : 1) * Math.round(it[field] * 100); }
  // Summor i hela ören. Avgående poster räknas som minus. Frågor har ingen kostnad.
  function ataTotals(list) {
    var t = { estOre: 0, accOre: 0, open: 0, wait: 0, late: 0, n: (list || []).length }, td = todayDay();
    (list || []).forEach(function (it) {
      if (it.type !== "fraga" && it.cost && it.status !== "avslagen") t.estOre += ataSigned(it, "est");
      if (it.type !== "fraga" && ATA_APPROVED.indexOf(it.status) >= 0) t.accOre += ataSigned(it, "acc");
      if (ATA_OPEN.indexOf(it.status) >= 0) t.open++;
      if (it.status === "skickad") { t.wait++; var d = dayOf(it.due); if (d !== null && d < td) t.late++; }
    });
    return t;
  }
  function fmtSigned(ore) { return (ore > 0 ? "+" : "") + fmtKr(ore); }
  function ataLabel(it) { return (it.type === "fraga" ? "Fråga " : it.type === "avv" ? "Avv. " : "ÄTA ") + it.no; }
  // Det belopp som godkända ÄTA lägger till eller drar från kontraktssumman, i ören.
  function payExtra(p, card) { return p && p.ata && card ? ataTotals(card.ata || []).accOre : 0; }
  function fmtKr(ore) {
    return (ore / 100).toLocaleString("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " kr";
  }
  // Räknar i hela ören. Lyftens belopp följer ackumulerad andel, så att summan alltid blir exakt kontraktssumman.
  function payCalc(p, extraOre) {
    var S = Math.max(0, Math.round(p.sum * 100) + (extraOre || 0)), cum = 0, cumP = 0, held = 0, inv = 0, rows = [];
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
    h += vrow("Kalkylerat", c.kalk ? esc(numText(c.kalk) + " timmar") : "");
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
      var px = payExtra(c.pay, c), pc = payCalc(c.pay, px), pd = c.pay.items.filter(function (i) { return i.paid; }).length;
      h += vrow("Betalplan", esc(fmtKr(pc.S) + " exkl. moms" + (c.pay.ata ? " (inkl. ÄTA " + fmtSigned(px) + ")" : "") + ", " + c.pay.items.length + " lyft, " + pd + " fakturerade"));
    }
    if (c.ata && c.ata.length) {
      var at = ataTotals(c.ata);
      h += vrow("ÄTA", esc(at.n + " poster, " + at.open + " öppna, godkänt " + fmtSigned(at.accOre) + " exkl. moms") + (at.late ? ' <span class="missing">Svar försenat: ' + at.late + "</span>" : ""));
    }
    h += '<div class="vrow" id="vplan" hidden><b>Planerad</b><div id="vplan-body"></div></div>';
    h += vrow("Senast ändrad", c.updated ? esc(fmtStamp(c.updated)) : "");
    $("view-body").innerHTML = h;
    loadCardPlan(c.id);
    $("view-edit").hidden = !canEdit();
  }
  // Visar vilka tekniker som är inplanerade på projektet framöver, från Teknikerplaneringen.
  async function loadCardPlan(id) {
    try {
      var r = await be.loadRefPlan("k:" + id, isoOfDay(todayDay()));
      if (viewId !== id || viewMode !== "view") return;
      var names = {}, per = {}, order = [];
      r.techs.forEach(function (t) { names[t.id] = t.name; });
      r.bookings.forEach(function (b) { if (!per[b.tech_id]) { per[b.tech_id] = []; order.push(b.tech_id); } per[b.tech_id].push(dayOf(b.day)); });
      if (!order.length) return;
      var h = order.map(function (tid) {
        var days = per[tid].sort(function (x, y) { return x - y; }), ranges = [], i, a = days[0], p = days[0], nx;
        for (i = 1; i <= days.length; i++) {
          nx = p + (((dateOfDay(p).getUTCDay() + 6) % 7) === 4 ? 3 : 1);
          if (i < days.length && days[i] === nx) { p = days[i]; continue; }
          ranges.push(a === p ? fmtDay(a) : fmtDay(a) + "–" + fmtDay(p));
          if (i < days.length) { a = days[i]; p = days[i]; }
        }
        return '<div><span class="techpill" style="--h:' + techHue(names[tid] || "") + '"><span>' + esc(names[tid] || "Okänd") + "</span></span> " + esc(ranges.slice(0, 6).join(", ") + (ranges.length > 6 ? " …" : "")) + "</div>";
      }).join("");
      $("vplan-body").innerHTML = h; $("vplan").hidden = false;
    } catch (e) { /* planeringen kan saknas i databasen, då visas inget */ }
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
      (vTid.length ? '<button type="button" class="btn ghost" data-tprint="1">Skriv ut</button>' : "") +
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
    var dis = ed ? "" : " disabled", pc = payCalc(vPay, payExtra(vPay, findCard(viewId)));
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
      '<label>Anbudssumma, kr exkl. moms<input type="text" inputmode="decimal" data-pf="sum" value="' + esc(numText(vPay.sum)) + '"' + dis + '></label>' +
      '<label>Antal lyft<input type="number" min="1" max="60" step="1" data-pf="n" value="' + vPay.n + '"' + dis + '></label>' +
      '<label>Innehållna medel, %<input type="text" inputmode="decimal" data-pf="ret" value="' + esc(numText(vPay.ret)) + '"' + dis + '></label>' +
      (ed ? '<button type="button" class="btn ghost" data-pgen="1" id="pgen">Fördela lyft</button>' : "") +
      "</div>" +
      '<label class="chk pata"><input type="checkbox" data-pf="ata"' + (vPay.ata ? " checked" : "") + dis + '> Räkna med godkända ÄTA (tillkommande läggs till, avgående dras av)</label>' +
      '<p class="hint" id="pata" role="status"></p>' +
      '<p class="hint" id="pwarn" role="status"></p>' +
      (vPay.items.length ? '<div class="ptab-wrap"><table class="ptab"><thead><tr><th>Lyft</th><th>Andel %</th><th>Faktureringsdatum</th><th class="r">Lyftets värde</th><th class="r">Innehåll</th><th class="r">Att fakturera</th><th>Fakturerad</th></tr></thead><tbody id="ptb">' + payRowsHtml(ed) + "</tbody></table></div>" :
        '<p class="hint">Fyll i kontraktssumma och antal lyft och klicka på Fördela lyft.</p>') +
      '<p class="hint">Alla belopp är exklusive moms. Innehållet dras från varje lyft och faktureras som hållna medel efter godkänd slutbesiktning. Kontrollera procentsats och villkor mot kontraktet.</p>' +
      '<div class="view-actions">' + (ed ? '<button type="button" class="btn" data-psave="1">Spara</button>' : "") +
      (vPay.items.length ? '<button type="button" class="btn ghost" data-pprint="1">Skriv ut</button>' : "") +
      '<button type="button" class="btn ghost" data-back="1">Tillbaka</button><span class="vmsg" id="vmsg" role="status"></span></div>';
    payWarn();
  }
  function payWarn() {
    var w = $("pwarn"); if (!w) return;
    var card = findCard(viewId), pa = $("pata");
    if (pa) {
      var x = payExtra(vPay, card), tot = card ? ataTotals(card.ata || []).accOre : 0;
      pa.textContent = vPay.ata
        ? "Anbudssumma " + fmtKr(Math.round(vPay.sum * 100)) + ", godkända ÄTA " + fmtSigned(x) + ", kontraktssumma inkl. ÄTA " + fmtKr(Math.max(0, Math.round(vPay.sum * 100) + x)) + "."
        : tot ? "Det finns godkända ÄTA på " + fmtSigned(tot) + " som inte räknas med i lyften." : "";
    }
    var pc = payCalc(vPay, payExtra(vPay, card)), bad = vPay.items.length && Math.abs(pc.pctSum - 100) > 0.001;
    w.textContent = bad ? "Andelarna blir " + numText(pc.pctSum) + " %, de ska bli 100 %. Beloppen stämmer inte med kontraktssumman förrän det är rätt." : "";
    w.className = "hint" + (bad ? " bad" : "");
  }
  function payUpdateNums() {
    var pc = payCalc(vPay, payExtra(vPay, findCard(viewId)));
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

  /* ÄTA */
  var vAta = [], vAtaCur = null, vAtaDelArmed = false;
  var ATA_DIR = [["add", "Tillkommande"], ["sub", "Avgående"]];
  function openAta() {
    var c = findCard(viewId); if (!c) return;
    setVMode("ata"); vDirty = false; vWarned = false; vAtaCur = null; vAtaDelArmed = false;
    vAta = cleanAta(c.ata || []);
    renderAta();
  }
  function renderAta() { if (vAtaCur) renderAtaForm(); else renderAtaList(); }
  function ataIsLate(it) { var d = dayOf(it.due); return it.status === "skickad" && d !== null && d < todayDay(); }
  function ataStatTag(it) {
    return '<span class="ast s-' + esc(it.status) + '">' + esc(labelOf(ATA_STAT, it.status)) + "</span>" + (ataIsLate(it) ? ' <span class="missing">Försenat</span>' : "");
  }
  function ataMoney(it, f) {
    if (it.type === "fraga" || !it[f]) return "–";
    if (f === "est" && !it.cost) return "–";
    if (f === "acc" && ATA_APPROVED.indexOf(it.status) < 0) return "–";
    return fmtSigned(ataSigned(it, f));
  }
  function renderAtaList() {
    var c = findCard(viewId), ed = canEdit(), t = ataTotals(vAta);
    $("view-title").innerHTML = 'ÄTA <span class="client">· ' + esc(c.name) + "</span>";
    var rows = vAta.slice().sort(function (a, b) { return a.no - b.no; }).map(function (it) {
      return '<tr class="aclick" data-aopen="' + esc(it.id) + '"><td><button type="button" class="linkbtn" data-aopen="' + esc(it.id) + '">' + esc(ataLabel(it)) + "</button></td>" +
        "<td>" + esc(labelOf(ATA_TYPES, it.type)) + '</td><td class="wrap">' + esc(it.part || it.text.slice(0, 80)) + "</td>" +
        "<td>" + (it.due ? esc(it.due) : "–") + "</td><td>" + ataStatTag(it) + '</td><td class="r">' + ataMoney(it, "est") + '</td><td class="r">' + ataMoney(it, "acc") + "</td></tr>";
    }).join("");
    $("view-body").innerHTML =
      (vAta.length ? '<p class="hint">' + esc(t.n + " poster, " + t.open + " öppna, " + t.wait + " väntar på svar" + (t.late ? ", " + t.late + " försenade" : "")) + "</p>" +
        '<div class="ptab-wrap"><table class="ptab atab"><thead><tr><th>Nr</th><th>Typ</th><th>Avser / del</th><th>Svar senast</th><th>Status</th><th class="r">Bedömd kostnad</th><th class="r">Accepterat</th></tr></thead><tbody>' + rows +
        '<tr class="tot"><td colspan="5">Totalt (tillkommande minus avgående)</td><td class="r">' + fmtSigned(t.estOre) + '</td><td class="r">' + fmtSigned(t.accOre) + "</td></tr></tbody></table></div>" +
        '<p class="hint">Alla belopp är exklusive moms. Bedömd kostnad räknar inte med avslagna poster. Accepterat räknar poster som är godkända, utförda eller fakturerade. Godkända ÄTA kan räknas in i Betalplan.</p>'
        : '<p class="hint">Inga ÄTA än.' + (ed ? " Lägg till den första." : "") + "</p>") +
      '<div class="view-actions">' + (ed ? '<button type="button" class="btn" data-anew="1">Ny post</button>' : "") +
      (vAta.length ? '<button type="button" class="btn ghost" data-aprint-all="1">Skriv ut förteckning</button>' : "") +
      '<button type="button" class="btn ghost" data-back="1">Tillbaka</button><span class="vmsg" id="vmsg" role="status"></span></div>';
  }
  function ataField(label, inner, cls) { return '<label class="af' + (cls ? " " + cls : "") + '"><span>' + label + "</span>" + inner + "</label>"; }
  function ataSel(list, val, key, dis) {
    return '<select data-af="' + key + '"' + dis + ">" + list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === val ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>";
  }
  function ataIn(type, key, val, dis, extra) { return '<input type="' + type + '" data-af="' + key + '" value="' + esc(val) + '"' + (extra || "") + dis + ">"; }
  function renderAtaForm() {
    var c = findCard(viewId), ed = canEdit(), dis = ed ? "" : " disabled", it = vAtaCur, fraga = it.type === "fraga";
    var exists = vAta.some(function (o) { return o.id === it.id; });
    $("view-title").innerHTML = esc(ataLabel(it)) + ' <span class="client">· ' + esc(c.name) + "</span>";
    var h = '<div class="aform">' +
      ataField("Typ", ataSel(ATA_TYPES, it.type, "type", dis)) +
      ataField("Datum", ataIn("date", "date", it.date, dis)) +
      ataField("Status", ataSel(ATA_STAT, it.status, "status", dis)) +
      ataField("Till", ataIn("text", "to", it.to, dis, ' maxlength="200"'), "w2") +
      ataField("Svar senast", ataIn("date", "due", it.due, dis)) +
      ataField("Avser / del", ataIn("text", "part", it.part, dis, ' maxlength="300"'), "full") +
      ataField(fraga ? "Fråga" : "Beskrivning", '<textarea data-af="text" rows="4" maxlength="4000"' + dis + ">" + esc(it.text) + "</textarea>", "full");
    if (!fraga) {
      h += '<label class="chk full"><input type="checkbox" data-af="cost"' + (it.cost ? " checked" : "") + dis + "> Kostnadsregleras</label>";
      if (it.cost) h += ataField("Riktning", ataSel(ATA_DIR, it.dir, "dir", dis)) + ataField("Bedömd kostnad, kr exkl. moms", ataIn("text", "est", numText(it.est), dis, ' inputmode="decimal"'), "w2");
    }
    h += ataField(fraga ? "Svar" : "Åtgärd / svar", '<textarea data-af="action" rows="3" maxlength="4000"' + dis + ">" + esc(it.action) + "</textarea>", "full");
    if (!fraga && it.cost) h += ataField("Accepterat belopp, kr exkl. moms", ataIn("text", "acc", numText(it.acc), dis, ' inputmode="decimal"'), "w2");
    h += ataField("Beslutsdatum", ataIn("date", "accDate", it.accDate, dis)) + ataField("Namn", ataIn("text", "accName", it.accName, dis, ' maxlength="200"'), "w2") + "</div>" +
      '<div class="view-actions">' + (ed ? '<button type="button" class="btn" data-asave="1">Spara</button>' : "") +
      '<button type="button" class="btn ghost" data-aprint-one="1">Skriv ut blankett</button>' +
      (ed && exists ? '<button type="button" class="btn ghost warnbtn" data-adel="1">Ta bort</button>' : "") +
      '<button type="button" class="btn ghost" data-aback="1">Till förteckningen</button><span class="vmsg" id="vmsg" role="status"></span></div>';
    $("view-body").innerHTML = h;
  }
  function openAtaItem(id) {
    var it = vAta.filter(function (o) { return o.id === id; })[0]; if (!it) return;
    vAtaCur = JSON.parse(JSON.stringify(it)); vAtaDelArmed = false; vDirty = false; vWarned = false;
    renderAtaForm();
  }
  function newAtaItem() {
    var c = findCard(viewId), max = 0; if (!c || !canEdit()) return;
    vAta.forEach(function (o) { if (o.no > max) max = o.no; });
    vAtaCur = { id: newId("a-"), no: max + 1, type: "ata", date: isoOfDay(todayDay()), to: c.client || "", part: "", due: "", text: "", cost: false, dir: "add", est: 0, action: "", status: "utkast", acc: 0, accDate: "", accName: "" };
    vAtaDelArmed = false; vDirty = false; vWarned = false;
    renderAtaForm();
    var f = viewDlg.querySelector('[data-af="part"]'); if (f) f.focus();
  }
  async function saveAta(list, after) {
    var c = findCard(viewId); if (!c || !canEdit()) return;
    var card = Object.assign({}, c, { ata: cleanAta(list) });
    try {
      var saved = await be.saveCard(card, c.rev);
      replaceIn(state.cards, saved); vAta = cleanAta(saved.ata); vDirty = false; vWarned = false;
      renderAll(); renderActivity(); after(); vmsg("Sparat.");
    } catch (err) { vmsg(friendly(err), true); if (err && err.conflict) reload(); }
  }
  function saveAtaItem() {
    if (!vAtaCur) return;
    var it = cleanAta([vAtaCur])[0];
    saveAta(vAta.filter(function (o) { return o.id !== it.id; }).concat([it]), function () { vAtaCur = null; renderAtaList(); });
  }
  function ataSet(t) {
    var k = t.getAttribute("data-af"), it = vAtaCur; if (!it) return;
    if (k === "est" || k === "acc") it[k] = r2(clamp(num(t.value), 0, 1e11));
    else if (k === "cost") it.cost = t.checked;
    else it[k] = t.value;
    touched();
    if (k === "status" && ATA_APPROVED.indexOf(it.status) >= 0) {
      if (it.cost && !it.acc && it.est) it.acc = it.est;
      if (!it.accDate) it.accDate = isoOfDay(todayDay());
    }
    if (k === "type" || k === "status" || k === "cost") renderAtaForm();
  }

  /* Utskrift av ÄTA-blankett och förteckning (PDF via skrivaren) */
  /* Utskrifter i samma stil som FST:s offerter: logotyp, rubrik i petrol, grå ruta för tabeller och sidfot med företagsuppgifter. */
  var ATA_LOGO = '<img class="ap-logo" src="img/fst-logo.png" alt="FST Säkerhetsbolaget" width="105" height="52">';
  function apHead(title, metas) {
    return '<div class="ap-top">' + ATA_LOGO + '<div class="ap-title"><h1>' + esc(title) + '</h1><div class="ap-meta">' +
      metas.map(function (m) { return "<div><small>" + esc(m[0]) + "</small><span>" + esc(m[1]) + "</span></div>"; }).join("") + '</div></div></div><div class="ap-rule"></div>';
  }
  function apFoot() {
    return '<div class="ap-rule thin"></div><div class="ap-foot"><div><small>Företag</small><span>Säkerhetsbolaget FST AB</span><small>Adress</small><span>Norra malmvägen 143<br>191 65 Sollentuna</span></div>' +
      '<div><small>Telefon</small><span>010-2282550</span><small>Hemsida</small><span>www.sakerhetsbolagetfst.se</span><small>E-post</small><span>info@sakerhetsbolagetfst.se</span></div></div>';
  }
  function apInfo(pairs) {
    return '<div class="ap-info">' + pairs.map(function (m) { return "<div><small>" + esc(m[0]) + "</small><span>" + (esc(m[1]) || "&nbsp;") + "</span></div>"; }).join("") + "</div>";
  }
  function apPage(head, body) {
    return '<table class="ap-page"><thead><tr><td>' + head + '</td></tr></thead><tfoot><tr><td>' + apFoot() + '</td></tr></tfoot><tbody><tr><td class="ap-body">' + body + "</td></tr></tbody></table>";
  }
  function ataSheet(c, it) {
    var fraga = it.type === "fraga", ok = ATA_APPROVED.indexOf(it.status) >= 0;
    var dec = ok ? "Ja" : it.status === "avslagen" ? "Nej" : "Ej beslutat";
    function row(l, v) { return "<tr><th>" + l + "</th><td>" + (v || "&nbsp;") + "</td></tr>"; }
    function sec(h, t) { return "<h2>" + h + '</h2><p class="pre">' + (esc(t) || "&nbsp;") + "</p>"; }
    var box = row("Typ", esc(labelOf(ATA_TYPES, it.type))) + row("Status", esc(labelOf(ATA_STAT, it.status))) + row("Till", esc(it.to)) + row("Svar senast", esc(it.due));
    if (!fraga) {
      box += row("Kostnadsregleras", it.cost ? "Ja" : "Nej");
      if (it.cost) box += row("Bedömd kostnad", esc(fmtSigned(ataSigned(it, "est"))) + " exkl. moms (" + (it.dir === "sub" ? "avgående" : "tillkommande") + ")");
      box += row("Kostnad accepteras", esc(dec));
      if (it.cost && ok) box += row("Accepterat belopp", esc(fmtSigned(ataSigned(it, "acc"))) + " exkl. moms");
    }
    box += row("Beslutsdatum", esc(it.accDate)) + row("Namn", esc(it.accName));
    var head = apHead((fraga ? "Fråga/Svar " : it.type === "avv" ? "Avvikelse " : "ÄTA ") + it.no, [["Nummer", ataLabel(it)], ["Datum", it.date || ""], ["Status", labelOf(ATA_STAT, it.status)]]);
    return apPage(head, apInfo([["Kund", c.client || ""], ["Projekt", c.name], ["Upprättad av", state.email || ""]]) +
      sec("Avser / del", it.part) + sec(fraga ? "Fråga" : "Beskrivning", it.text) + sec(fraga ? "Svar" : "Åtgärd / svar", it.action) +
      '<div class="ap-box"><table class="ap-kv">' + box + "</table></div>");
  }
  function ataRegister(c, list) {
    var t = ataTotals(list);
    var rows = list.slice().sort(function (a, b) { return a.no - b.no; }).map(function (it) {
      return "<tr><td>" + esc(ataLabel(it)) + "</td><td>" + esc(it.part || it.text.slice(0, 80)) + "</td><td>" + esc(labelOf(ATA_TYPES, it.type)) + "</td><td>" + esc(it.date) + "</td><td>" + esc(labelOf(ATA_STAT, it.status)) +
        '</td><td class="r">' + ataMoney(it, "est") + '</td><td class="r">' + ataMoney(it, "acc") + "</td></tr>";
    }).join("");
    var head = apHead("ÄTA-förteckning", [["Projekt", c.name], ["Utskriven", isoOfDay(todayDay())], ["Poster", String(t.n)]]);
    return apPage(head, apInfo([["Kund", c.client || ""], ["Projekt", c.name], ["Upprättad av", state.email || ""]]) +
      '<p class="ap-note">Belopp angivna exklusive moms</p><div class="ap-box"><table class="ap-reg"><thead><tr><th>Nr</th><th>Avser / del</th><th>Typ</th><th>Datum</th><th>Status</th><th class="r">Bedömd kostnad</th><th class="r">Accepterat</th></tr></thead><tbody>' +
      rows + '<tr class="tot"><td colspan="5">Totalt</td><td class="r">' + fmtSigned(t.estOre) + '</td><td class="r">' + fmtSigned(t.accOre) + "</td></tr></tbody></table></div>");
  }
  function payPrint() {
    var c = findCard(viewId); if (!c || !vPay) return;
    var x = payExtra(vPay, c), pc = payCalc(vPay, x), base = Math.round(vPay.sum * 100);
    var box = '<tr><th>Anbudssumma</th><td>' + esc(fmtKr(base)) + "</td></tr>";
    if (vPay.ata) box += "<tr><th>Godkända ÄTA</th><td>" + esc(fmtSigned(x)) + "</td></tr><tr><th>Kontraktssumma inkl. ÄTA</th><td>" + esc(fmtKr(pc.S)) + "</td></tr>";
    box += "<tr><th>Antal lyft</th><td>" + vPay.items.length + "</td></tr><tr><th>Innehållna medel</th><td>" + esc(numText(vPay.ret) || "0") + " %</td></tr>";
    var rows = vPay.items.map(function (it, i) {
      return "<tr><td>" + esc(it.label) + '</td><td class="r">' + esc(numText(it.pct)) + " %</td><td>" + esc(it.date) + '</td><td class="r">' + fmtKr(pc.rows[i].amt) + '</td><td class="r">' + fmtKr(pc.rows[i].ret) + '</td><td class="r">' + fmtKr(pc.rows[i].inv) + "</td><td>" + (it.paid ? "Ja" : "Nej") + "</td></tr>";
    }).join("") +
      '<tr class="held"><td colspan="2">Hållna medel, frisläpps efter godkänd slutbesiktning</td><td>' + esc(vPay.retDate) + '</td><td class="r">–</td><td class="r">–</td><td class="r">' + fmtKr(pc.held) + "</td><td>" + (vPay.retPaid ? "Ja" : "Nej") + "</td></tr>" +
      '<tr class="tot"><td colspan="3">Totalt</td><td class="r">' + fmtKr(pc.total) + '</td><td class="r"></td><td class="r">' + fmtKr(pc.inv + pc.held) + "</td><td></td></tr>";
    var html = apPage(apHead("Betalplan", [["Projekt", c.name], ["Utskriven", isoOfDay(todayDay())], ["Lyft", String(vPay.items.length)]]),
      apInfo([["Kund", c.client || ""], ["Projekt", c.name], ["Upprättad av", state.email || ""]]) +
      '<div class="ap-box"><table class="ap-kv">' + box + "</table></div>" +
      '<p class="ap-note" style="margin-top:14px">Belopp angivna exklusive moms</p>' +
      (rows && vPay.items.length ? '<div class="ap-box" style="margin-top:0"><table class="ap-reg"><thead><tr><th>Lyft</th><th class="r">Andel</th><th>Fakturering</th><th class="r">Lyftets värde</th><th class="r">Innehåll</th><th class="r">Att fakturera</th><th>Fakturerad</th></tr></thead><tbody>' + rows + "</tbody></table></div>" : "") +
      '<p class="ap-note" style="text-align:left;font-style:normal;margin-top:10px">Innehållet dras från varje lyft och faktureras som hållna medel efter godkänd slutbesiktning.</p>');
    $("ata-print").innerHTML = html;
    document.body.setAttribute("data-print", "ata");
    window.print();
  }
  function tidPrint() {
    var c = findCard(viewId); if (!c) return;
    var list = cleanTplan(vTid).filter(function (m) { return m.name || m.start || m.end; });
    if (!list.length) return;
    var done = list.filter(function (m) { return m.done; }).length;
    var rows = list.map(function (m) {
      var s = dayOf(m.start), e = dayOf(m.end), n = s !== null && e !== null ? Math.abs(e - s) + 1 : "";
      return "<tr><td>" + esc(m.name) + "</td><td>" + esc(m.start) + "</td><td>" + esc(m.end) + '</td><td class="r">' + (n !== "" ? n + (n === 1 ? " dag" : " dagar") : "") + "</td><td>" + (m.done ? "Klart" : "Pågår/planerad") + "</td></tr>";
    }).join("");
    var html = apPage(apHead("Tidplan", [["Projekt", c.name], ["Utskriven", isoOfDay(todayDay())], ["Moment", done + " av " + list.length + " klara"]]),
      apInfo([["Kund", c.client || ""], ["Start", c.start || ""], ["Slutbesiktning", c.end || ""]]) +
      '<div class="ap-box ap-mg">' + momGantt(list, c) + "</div>" +
      '<div class="ap-box"><table class="ap-reg"><thead><tr><th>Moment</th><th>Start</th><th>Slut</th><th class="r">Längd</th><th>Status</th></tr></thead><tbody>' + rows + "</tbody></table></div>");
    $("ata-print").innerHTML = html;
    document.body.setAttribute("data-print", "ata");
    window.print();
  }
  function ataPrint(all) {
    var c = findCard(viewId); if (!c) return;
    var html = all ? ataRegister(c, vAta) : vAtaCur ? ataSheet(c, cleanAta([vAtaCur])[0]) : "";
    if (!html) return;
    $("ata-print").innerHTML = html;
    document.body.setAttribute("data-print", "ata");
    window.print();
  }
  window.addEventListener("afterprint", function () { document.body.removeAttribute("data-print"); });

  /* Händelser i rutan */
  $("view-close").addEventListener("click", closeView);
  $("view-edit").addEventListener("click", function () { var id = viewId; closeNow(); if (id) openEdit(id); });
  $("view-body").addEventListener("change", function (e) {
    if (e.target.id === "view-move" && viewId) moveCard(viewId, e.target.value);
  });
  $("view-tid").addEventListener("click", openTid);
  $("view-pay").addEventListener("click", openPay);
  $("view-ata").addEventListener("click", openAta);
  viewDlg.addEventListener("click", function (e) { if (e.target === viewDlg) closeView(); });
  viewDlg.addEventListener("cancel", function (e) {
    if (vDirty && !vWarned) { e.preventDefault(); leave(closeNow); }
  });
  viewDlg.addEventListener("close", function () { viewId = null; vDirty = false; vWarned = false; });
  $("view-body").addEventListener("click", function (e) {
    var ro = e.target.closest ? e.target.closest("[data-aopen]") : null;
    if (ro && viewMode === "ata") { openAtaItem(ro.getAttribute("data-aopen")); return; }
    var t = e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    if (t.hasAttribute("data-back")) backToView();
    else if (t.hasAttribute("data-anew")) newAtaItem();
    else if (t.hasAttribute("data-asave")) saveAtaItem();
    else if (t.hasAttribute("data-aback")) leave(function () { vAtaCur = null; renderAta(); });
    else if (t.hasAttribute("data-aprint-one")) ataPrint(false);
    else if (t.hasAttribute("data-aprint-all")) ataPrint(true);
    else if (t.hasAttribute("data-adel")) {
      if (!vAtaDelArmed) { vAtaDelArmed = true; t.textContent = "Bekräfta borttagning"; return; }
      var gone = vAtaCur && vAtaCur.id;
      saveAta(vAta.filter(function (o) { return o.id !== gone; }), function () { vAtaCur = null; vAtaDelArmed = false; renderAtaList(); });
    }
    else if (t.hasAttribute("data-tadd")) {
      if (vTid.length >= 100) return;
      vTid.push({ id: newId("m-"), name: "", start: "", end: "", done: false }); touched(); renderTid();
      var ins = viewDlg.querySelectorAll('[data-tf="name"]'); if (ins.length) ins[ins.length - 1].focus();
    } else if (t.hasAttribute("data-tdel")) { vTid.splice(+t.getAttribute("data-tdel"), 1); touched(); renderTid(); }
    else if (t.hasAttribute("data-tsave")) saveTid();
    else if (t.hasAttribute("data-tprint")) tidPrint();
    else if (t.hasAttribute("data-psave")) savePay();
    else if (t.hasAttribute("data-pprint")) payPrint();
    else if (t.hasAttribute("data-pgen")) {
      if (vPay.items.length && !vGenArmed) { vGenArmed = true; t.textContent = "Bekräfta: ersätt lyften"; return; }
      vGenArmed = false; vPay.items = genItems(Math.round(clamp(vPay.n, 1, 60))); touched(); renderPay();
    }
  });
  $("view-body").addEventListener("input", function (e) {
    var t = e.target, i = +t.getAttribute("data-i"), k;
    if (t.hasAttribute("data-af")) { ataSet(t); return; }
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
      else if (k === "ata") vPay.ata = t.checked;
      else if (vPay.items[i]) {
        if (k === "pct") vPay.items[i].pct = r2(clamp(num(t.value), 0, 100));
        else if (k === "paid") vPay.items[i].paid = t.checked;
        else if (k === "date") vPay.items[i].date = dateStr(t.value);
        else vPay.items[i].label = t.value;
      }
      touched();
      if (k === "sum" || k === "ret" || k === "pct" || k === "ata") payUpdateNums();
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
    var i = list.indexOf(key), h = 0, j;
    if (i < 0) { for (j = 0; j < key.length; j++) h = (h * 31 + key.charCodeAt(j)) >>> 0; i = h; }  // tekniker utan kort: stabil färg efter namnet
    return TECH_HUES[i % TECH_HUES.length];
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
    inbrott: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.500L8 2.300l6 5.200M3.500 6.500v7h9v-7"/><path d="M8 6.600v3M8 11.600v.1"/></svg>',
    tul: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" class="ti" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6.2h2.600L8 3.200v9.600L4.600 9.800H2z"/><path d="M10.300 5.800a3.100 3.100 0 0 1 0 4.400M12.200 4.200a5.500 5.500 0 0 1 0 7.600"/></svg>'
  };
  var TAG_HUES = { brand: 4, cctv: 45, pass: 270, las: 170, tul: 25, inbrott: 200 };
  function tagType(name) {
    var k = String(name).toLowerCase();
    if (k.indexOf("brand") >= 0) return "brand";
    if (k.indexOf("inbrott") >= 0 || k.indexOf("intrång") >= 0) return "inbrott";
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
    var at = c.ata && c.ata.length ? ataTotals(c.ata) : null;
    if (at && at.open) h += '<p class="ataflag' + (at.late ? " late" : "") + '">ÄTA: ' + at.open + " öppna" + (at.late ? ", svar försenat" : at.wait ? ", " + at.wait + " väntar på svar" : "") + "</p>";
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
    notes: "anteckningar", start_date: "start", end_date: "slutbesiktning", tech: "tekniker", tidplan: "tidplan", betalplan: "betalplan", ata: "ÄTA", kalk_h: "kalkylerade timmar", done: "klar", body: "text", project: "projekt", pos: "" };
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
      if (curView === "plan") loadPlanData(); else if (curView === "tasks") loadTasks();
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
    $("f-kalk").value = c.kalk ? numText(c.kalk) : "";
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

  // Kalkylerade timmar: tomt fält blir null om kolumnen finns, annars skickas inget alls.
  function kalkIn(existing) {
    var v = $("f-kalk").value.trim();
    if (!v) return existing && existing.kalk !== undefined ? null : undefined;
    return r2(clamp(num(v), 0, 100000));
  }
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
      tplan: existing ? existing.tplan : undefined, pay: existing ? existing.pay : undefined, ata: existing ? existing.ata : undefined,
      kalk: kalkIn(existing)
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
      cards: state.cards.map(function (c) { return { id: c.id, col: c.col, pos: c.pos, name: c.name, client: c.client, tags: c.tags, chip: c.chip, lage: c.lage, next: c.next, notes: c.notes, start: c.start, end: c.end, tech: c.tech, deleted: c.deleted, tplan: c.tplan || [], pay: c.pay || null, ata: c.ata || [], kalk: c.kalk === undefined ? null : c.kalk }; }),
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
        tplan: "tplan" in c ? cleanTplan(c.tplan) : undefined, pay: "pay" in c ? cleanPay(c.pay) : undefined,
        ata: "ata" in c ? cleanAta(c.ata) : undefined,
        kalk: "kalk" in c ? (c.kalk === null || c.kalk === undefined || c.kalk === "" ? null : r2(clamp(num(c.kalk), 0, 100000))) : undefined
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
        if (c.ata === undefined) c.ata = cur && cur.ata ? cur.ata : [];
        if (c.kalk === undefined) c.kalk = cur && cur.kalk !== undefined ? cur.kalk : undefined;
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

  /* ---------- Mina uppgifter ---------- */
  var TSECT = [["ny", "Nyligen tillagda"], ["idag", "Göra i dag"], ["vecka", "Göra nästa vecka"], ["senare", "Göra senare"]];
  var tasks = { list: [], ok: false, err: "Laddar …" }, tkDone = false, tkCol = {}, tkTok = 0, tkFocus = null, tkDrag = null;
  try { tkDone = localStorage.getItem("pt-tk-done") === "1"; tkCol = JSON.parse(localStorage.getItem("pt-tk-col") || "{}") || {}; } catch (e) { tkCol = {}; }
  $("tk-showdone").checked = tkDone;
  function tkSort(a, b) { return a.pos - b.pos || a.title.localeCompare(b.title, "sv"); }
  function tkFind(id) { return tasks.list.filter(function (t) { return t.id === id; })[0]; }
  function tkRowOf(t) { return { id: t.id, title: t.title, sect: t.sect, due: t.due, card: t.card, done: t.done, pos: t.pos }; }
  async function tkSave(list) {
    try { await be.saveTasks(list.map(tkRowOf)); }
    catch (e) { banner(friendly(e), true); loadTasks(true); }
  }
  async function loadTasks(force) {
    var tok = ++tkTok;
    try {
      var rows = await be.loadTasks();
      if (tok !== tkTok) return;
      var ae = document.activeElement;
      if (!force && tasks.ok && ae && $("tk-list").contains(ae)) return;  // skriv inte över medan någon redigerar
      tasks.list = rows; tasks.ok = true; tasks.err = "";
    } catch (e) {
      if (tok !== tkTok) return;
      tasks.ok = false; tasks.err = friendly(e);
    }
    renderTasks();
  }
  function tkCardOpts(sel) {
    var found = false, cs = state.cards.filter(function (c) { return !c.deleted && (c.col !== "klar" || c.id === sel); }).sort(function (a, b) { return a.name.localeCompare(b.name, "sv"); });
    var h = '<option value="">Inget projekt</option>' + cs.map(function (c) {
      if (c.id === sel) found = true;
      return '<option value="' + esc(c.id) + '"' + (c.id === sel ? " selected" : "") + ">" + esc(c.name) + "</option>";
    }).join("");
    if (sel && !found) h += '<option value="' + esc(sel) + '" selected>(borttaget kort)</option>';
    return h;
  }
  function tkRowHtml(t) {
    var d = dayOf(t.due), td = todayDay(), cls = t.done || d === null ? "" : d < td ? " late" : d === td ? " today" : "";
    return '<div class="tk-row' + (t.done ? " done" : "") + '" data-id="' + esc(t.id) + '">' +
      '<span class="tk-grip" title="Dra för att flytta" aria-hidden="true">⋮⋮</span>' +
      '<button type="button" class="tk-chk" data-chk="' + esc(t.id) + '" role="checkbox" aria-checked="' + t.done + '" aria-label="Klar" title="' + (t.done ? "Markera som ej klar" : "Markera som klar") + '"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 8.300l2.100 2.100L11 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="ck"/></svg></button>' +
      '<input type="text" class="tk-title" data-f="title" maxlength="300" value="' + esc(t.title) + '" placeholder="Skriv en uppgift" aria-label="Uppgift">' +
      '<input type="date" class="tk-due' + cls + '" data-f="due" value="' + esc(t.due) + '" aria-label="Slutdatum">' +
      '<select class="tk-card" data-f="card" aria-label="Projekt">' + tkCardOpts(t.card) + "</select>" +
      '<span class="tk-act">' + (t.card ? ib("view", "data-tview", t.card, "Visa projektet") : "") +
      '<select class="tk-sect" data-f="sect" aria-label="Flytta till sektion">' + TSECT.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === t.sect ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select>" +
      ib("del", "data-tdel", t.id, "Ta bort uppgiften", "danger") + "</span></div>";
  }
  function renderTasks() {
    var host = $("tk-list");
    if (!tasks.ok) { host.innerHTML = '<p class="' + (tasks.err === "Laddar …" ? "hint" : "hint bad") + '">' + esc(tasks.err) + "</p>"; return; }
    tasks.list = tasks.list.filter(function (t) { return !(t._new && !t.title.trim() && t.id !== tkFocus); });
    var nd = tasks.list.filter(function (t) { return t.done; }).length;
    $("tk-donelbl").textContent = "Visa klara" + (nd ? " (" + nd + ")" : "");
    var h = '<div class="tk-head" aria-hidden="true"><span></span><span></span><span>Namn</span><span>Slutdatum</span><span>Projekt</span><span></span></div>';
    TSECT.forEach(function (x) {
      var all = tasks.list.filter(function (t) { return t.sect === x[0]; }).sort(tkSort), vis = all.filter(function (t) { return tkDone || !t.done; }), open = all.filter(function (t) { return !t.done; }).length;
      var col = !!tkCol[x[0]];
      h += '<section class="tk-sec' + (col ? " collapsed" : "") + '" data-sect="' + x[0] + '"><button type="button" class="tk-sh" data-tcol="' + x[0] + '" aria-expanded="' + (!col) + '"><span class="tk-car" aria-hidden="true">▾</span> ' + esc(x[1]) + ' <span class="n">' + open + "</span></button>";
      if (!col) h += '<div class="tk-body">' + vis.map(tkRowHtml).join("") + '<button type="button" class="tk-addrow" data-tadd="' + x[0] + '">+ Lägg till uppgift</button></div>';
      h += "</section>";
    });
    host.innerHTML = h;
    if (tkFocus) { var el = host.querySelector('.tk-row[data-id="' + tkFocus + '"] .tk-title'); if (el) el.focus(); }
  }
  function tkAdd(sect) {
    var max = 0;
    tasks.list = tasks.list.filter(function (t) { return !(t._new && !t.title.trim()); });
    tasks.list.forEach(function (t) { if (t.sect === sect && t.pos > max) max = t.pos; });
    var t = { id: newId("t-"), title: "", sect: sect, due: "", card: "", done: false, pos: max + 10, _new: true };
    tasks.list.push(t); tkCol[sect] = false; tkFocus = t.id; renderTasks();
  }
  function tkMove(id, sect, beforeId) {
    var t = tkFind(id); if (!t || beforeId === id) return;
    var list = tasks.list.filter(function (x) { return x.sect === sect && x.id !== id; }).sort(tkSort), idx = -1, i;
    for (i = 0; i < list.length; i++) if (list[i].id === beforeId) idx = i;
    t.sect = sect;
    if (idx < 0) list.push(t); else list.splice(idx, 0, t);
    var ch = [];
    list.forEach(function (x, n) { var p = (n + 1) * 10; if (x.pos !== p || x === t) { x.pos = p; if (!x._new) ch.push(x); } });
    renderTasks(); if (ch.length) tkSave(ch);
  }
  function saveTkCol() { try { localStorage.setItem("pt-tk-col", JSON.stringify(tkCol)); } catch (e) {} }
  $("tk-add").addEventListener("click", function () { tkAdd("ny"); });
  $("tk-showdone").addEventListener("change", function (e) { tkDone = e.target.checked; try { localStorage.setItem("pt-tk-done", tkDone ? "1" : "0"); } catch (x) {} renderTasks(); });
  $("tk-list").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null; if (!b) return;
    var k;
    if ((k = b.getAttribute("data-tcol"))) { tkCol[k] = !tkCol[k]; saveTkCol(); renderTasks(); }
    else if ((k = b.getAttribute("data-tadd"))) tkAdd(k);
    else if ((k = b.getAttribute("data-chk"))) { var t = tkFind(k); if (t && !t._new) { t.done = !t.done; renderTasks(); tkSave([t]); } }
    else if ((k = b.getAttribute("data-tview"))) openView(k);
    else if ((k = b.getAttribute("data-tdel"))) {
      if (!b.classList.contains("arm")) { b.classList.add("arm"); b.title = "Klicka igen för att ta bort"; setTimeout(function () { b.classList.remove("arm"); b.title = "Ta bort uppgiften"; }, 3000); return; }
      var gone = tkFind(k); tasks.list = tasks.list.filter(function (x) { return x.id !== k; }); renderTasks();
      if (gone && !gone._new) be.deleteTask(k).catch(function (err) { banner(friendly(err), true); loadTasks(true); });
    }
  });
  $("tk-list").addEventListener("change", function (e) {
    var el = e.target, f = el.getAttribute ? el.getAttribute("data-f") : null, row = el.closest ? el.closest(".tk-row") : null;
    if (!f || !row) return;
    var t = tkFind(row.getAttribute("data-id")); if (!t) return;
    if (f === "title") {
      var v = el.value.trim();
      if (!v) { el.value = t.title; return; }
      t.title = v; delete t._new; tkFocus = null; tkSave([t]);
    } else if (f === "due") { t.due = dateStr(el.value); if (!t._new) tkSave([t]); renderTasks(); }
    else if (f === "card") { t.card = el.value; if (!t._new) tkSave([t]); renderTasks(); }
    else if (f === "sect") { tkMove(t.id, el.value, null); }
  });
  $("tk-list").addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.classList && e.target.classList.contains("tk-title")) e.target.blur(); });
  $("tk-list").addEventListener("focusout", function (e) { if (e.target.classList && e.target.classList.contains("tk-title")) tkFocus = null; });
  // Dra och släpp: håll i greppet till vänster och släpp på en rad eller en sektion.
  $("tk-list").addEventListener("mousedown", function (e) {
    var g = e.target.closest ? e.target.closest(".tk-grip") : null;
    if (g) g.closest(".tk-row").setAttribute("draggable", "true");
  });
  $("tk-list").addEventListener("dragstart", function (e) {
    var r = e.target.closest ? e.target.closest(".tk-row") : null; if (!r) return;
    tkDrag = r.getAttribute("data-id"); e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", tkDrag); } catch (x) {}
    r.classList.add("drag");
  });
  $("tk-list").addEventListener("dragover", function (e) {
    if (!tkDrag) return;
    var s = e.target.closest ? e.target.closest(".tk-sec") : null; if (!s) return;
    e.preventDefault();
    Array.prototype.forEach.call(document.querySelectorAll(".tk-sec.over"), function (x) { if (x !== s) x.classList.remove("over"); });
    s.classList.add("over");
  });
  $("tk-list").addEventListener("drop", function (e) {
    if (!tkDrag) return;
    var s = e.target.closest ? e.target.closest(".tk-sec") : null, r = e.target.closest ? e.target.closest(".tk-row") : null;
    e.preventDefault();
    if (s) tkMove(tkDrag, s.getAttribute("data-sect"), r ? r.getAttribute("data-id") : null);
    tkDrag = null;
  });
  $("tk-list").addEventListener("dragend", function () {
    tkDrag = null;
    Array.prototype.forEach.call(document.querySelectorAll(".tk-sec.over, .tk-row.drag"), function (x) { x.classList.remove("over", "drag"); });
    Array.prototype.forEach.call(document.querySelectorAll('.tk-row[draggable]'), function (x) { x.removeAttribute("draggable"); });
  });
  document.addEventListener("mouseup", function () {
    if (!tkDrag) Array.prototype.forEach.call(document.querySelectorAll('.tk-row[draggable]'), function (x) { x.removeAttribute("draggable"); });
  });

  /* ---------- Teknikerplanering ---------- */
  var curView = "board";
  var plan = { techs: [], others: [], bookings: [], all: null, ok: false, err: "Laddar …" };
  var WD = ["mån", "tis", "ons", "tors", "fre"];
  function mondayOf(d) { return d - ((dateOfDay(d).getUTCDay() + 6) % 7); }
  var planWeek0 = mondayOf(todayDay()), planSpan = 4, planTok = 0, armed = null, painting = null, popCells = null;
  try { var sp = parseInt(localStorage.getItem("pt-plan-span"), 10); if ([2, 4, 6, 8].indexOf(sp) >= 0) planSpan = sp; } catch (e) {}
  $("pl-span").value = String(planSpan);

  function setView(v) {
    curView = v; $("app").setAttribute("data-view", v);
    Array.prototype.forEach.call(document.querySelectorAll("#tabs .tab"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === v)); });
    try { localStorage.setItem("pt-view", v); } catch (e) {}
    if (v === "plan") loadPlanData(); else if (v === "tasks") loadTasks();
  }
  $("tabs").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".tab") : null;
    if (b) setView(b.getAttribute("data-view"));
  });

  async function loadPlanData() {
    var tok = ++planTok, from = planWeek0, to = planWeek0 + planSpan * 7 - 1;
    try {
      var r = await be.loadPlan(isoOfDay(from), isoOfDay(to));
      if (tok !== planTok) return;
      be.loadAllBookings().then(function (all) { if (tok === planTok) { plan.all = all; renderKpi(); } }).catch(function () { plan.all = null; });
      plan.techs = r.techs.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "sv", { sensitivity: "base" }); }); plan.others = r.others; plan.bookings = r.bookings; plan.ok = true; plan.err = "";
    } catch (e) {
      if (tok !== planTok) return;
      plan.ok = false; plan.err = friendly(e);
    }
    renderPlan();
  }

  function refInfo(ref) {
    var kind = ref.charAt(0), id = ref.slice(2), c, i, t, h = null, o;
    if (kind === "k") {
      c = findCard(id);
      if (!c) return { label: "(borttaget kort)", hue: null, abs: false };
      for (i = 0; c.tags && i < c.tags.length; i++) { t = tagType(c.tags[i]); if (t) { h = TAG_HUES[t]; break; } }
      return { label: c.name, hue: h, abs: false, sub: c.client || "" };
    }
    o = plan.others.filter(function (x) { return x.id === id; })[0];
    return o ? { label: o.name, hue: null, abs: o.kind === "abs", other: true } : { label: "(borttaget)", hue: null, abs: false };
  }
  function chipHtml(ref) {
    var f = refInfo(ref);
    return '<span class="pchip' + (f.abs ? " abs" : f.hue === null ? " nh" : "") + '"' + (f.hue !== null ? ' style="--h:' + f.hue + '"' : "") + ' title="' + esc(f.label + (f.sub ? " · " + f.sub : "")) + '">' + esc(f.label) + "</span>";
  }
  function projectList() {
    var cards = state.cards.filter(function (c) { return !c.deleted && c.col !== "klar"; }).sort(function (a, b) { return a.name.localeCompare(b.name, "sv"); })
      .map(function (c) { return "k:" + c.id; });
    var oth = plan.others.filter(function (o) { return o.active; }).map(function (o) { return "o:" + o.id; });
    return oth.concat(cards);
  }
  function bookingIndex() {
    var ix = {};
    plan.bookings.forEach(function (b) { (ix[b.day + "|" + b.tech_id] = ix[b.day + "|" + b.tech_id] || []).push(b.ref); });
    return ix;
  }

  /* ---------- Nyckeltal: timmar och beläggning ---------- */
  var HPD = 8;  // timmar per tekniker och arbetsdag
  var holCache = {};
  // Svenska helgdagar på vardagar, samt midsommarafton, julafton och nyårsafton som i praktiken är lediga.
  function holidaysOf(y) {
    if (holCache[y]) return holCache[y];
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    var easter = Math.round(Date.UTC(y, mo - 1, da) / 864e5), set = {}, x;
    function add(n) { set[n] = 1; }
    function ymd(mm, dd) { return Math.round(Date.UTC(y, mm - 1, dd) / 864e5); }
    [[1, 1], [1, 6], [5, 1], [6, 6], [12, 24], [12, 25], [12, 26], [12, 31]].forEach(function (z) { add(ymd(z[0], z[1])); });
    add(easter - 2); add(easter + 1); add(easter + 39);
    for (x = 19; x <= 25; x++) if (new Date(Date.UTC(y, 5, x)).getUTCDay() === 5) add(ymd(6, x));
    holCache[y] = set; return set;
  }
  function isHoliday(day) { return !!holidaysOf(dateOfDay(day).getUTCFullYear())[day]; }
  function isWeekday(day) { var w = (dateOfDay(day).getUTCDay() + 6) % 7; return w < 5; }
  function fmtH(n) { return (Math.round(n * 10) / 10).toLocaleString("sv-SE", { maximumFractionDigits: 1 }) + " h"; }
  function fmtPct(n) { return Math.round(n).toLocaleString("sv-SE") + " %"; }
  function isAbsRef(ref) { if (ref.charAt(0) !== "o") return false; var o = plan.others.filter(function (x) { return x.id === ref.slice(2); })[0]; return !!(o && o.kind === "abs"); }
  // Delar en tekniker-dag lika mellan de poster som är bokade samma dag.
  function groupDays(list) {
    var g = {};
    list.forEach(function (b) { var k = b.day + "|" + b.tech_id; (g[k] = g[k] || { day: b.day, tech: b.tech_id, refs: [] }).refs.push(b.ref); });
    return g;
  }
  function bar(pct, cls) { return '<span class="kbar ' + (cls || "") + '"><i style="width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%"></i></span>'; }
  function renderKpi() {
    var host = $("pl-kpi"); if (!host) return;
    if (!plan.ok) { host.innerHTML = ""; return; }
    var from = planWeek0, to = planWeek0 + planSpan * 7 - 1, techs = plan.techs.filter(function (t) { return t.active; }), act = {};
    techs.forEach(function (t) { act[t.id] = { t: t, avail: 0, plan: 0 }; });
    var d, tid, wd = 0;
    for (d = from; d <= to; d++) {
      if (!isWeekday(d) || isHoliday(d)) continue;
      wd++;
      for (tid in act) act[tid].avail += HPD;
    }
    var g = groupDays(plan.bookings.filter(function (b) { var dn = dayOf(b.day); return dn !== null && isWeekday(dn) && act[b.tech_id]; }));
    Object.keys(g).forEach(function (k) {
      var x = g[k], n = x.refs.length, dn = dayOf(x.day), hol = isHoliday(dn);
      x.refs.forEach(function (ref) {
        if (isAbsRef(ref)) { if (!hol) act[x.tech].avail -= HPD / n; } else act[x.tech].plan += HPD / n;
      });
    });
    var rows = techs.map(function (t) { return act[t.id]; }), tp = 0, ta = 0;
    rows.forEach(function (r) { tp += r.plan; ta += r.avail; });
    var occ = ta > 0 ? tp / ta * 100 : null;
    var h = '<h3>Nyckeltal · vecka ' + isoWeek(from) + (planSpan > 1 ? "–" + isoWeek(from + planSpan * 7 - 3) : "") + "</h3>" +
      '<div class="kpi-tiles">' +
      '<div class="kpi"><span>Planerade timmar</span><b>' + fmtH(tp) + "</b></div>" +
      '<div class="kpi"><span>Tillgängliga resurstimmar</span><b>' + fmtH(ta) + "</b></div>" +
      '<div class="kpi"><span>Beläggningsgrad</span><b>' + (occ === null ? "–" : fmtPct(occ)) + "</b></div>" +
      '<div class="kpi"><span>Lediga timmar</span><b>' + fmtH(Math.max(0, ta - tp)) + "</b></div></div>" +
      '<div class="ptab-wrap"><table class="ptab ktab"><thead><tr><th>Tekniker</th><th class="r">Planerat</th><th class="r">Tillgängligt</th><th class="r">Beläggning</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var p = r.avail > 0 ? r.plan / r.avail * 100 : null;
        return '<tr><td><span class="techpill" style="--h:' + techHue(r.t.name) + '"><span>' + esc(r.t.name) + '</span></span></td><td class="r">' + fmtH(r.plan) + '</td><td class="r">' + fmtH(r.avail) + '</td><td class="r strong">' + (p === null ? "–" : fmtPct(p)) + "</td><td>" + (p === null ? "" : bar(p)) + "</td></tr>";
      }).join("") +
      '<tr class="tot"><td>Totalt</td><td class="r">' + fmtH(tp) + '</td><td class="r">' + fmtH(ta) + '</td><td class="r">' + (occ === null ? "–" : fmtPct(occ)) + "</td><td>" + (occ === null ? "" : bar(occ)) + "</td></tr></tbody></table></div>" +
      '<p class="hint">Räknat på ' + HPD + " timmar per tekniker och arbetsdag, måndag till fredag. Helgdagar och frånvaro (Semester, Sjuk med flera) minskar tillgängliga timmar. Är en tekniker bokad på flera poster samma dag delas dagen lika. Beläggning är planerade timmar delat med tillgängliga timmar.</p>";
    // Per projekt: kalkylerat mot planerat, hela planeringen
    h += "<h3>Projekt: kalkylerat mot planerat</h3>";
    if (!plan.all) h += '<p class="hint">Laddar …</p>';
    else {
      var iFrom = isoOfDay(from), iTo = isoOfDay(to);
      var all = plan.all.filter(function (b) { return b.day < iFrom || b.day > iTo; }).concat(plan.bookings);
      var gp = groupDays(all.filter(function (b) { var dn = dayOf(b.day); return dn !== null && isWeekday(dn) && b.ref.charAt(0) === "k"; })), per = {};
      // Frånvaro och övrigt arbete samma dag tar också del av dagen
      var gAll = groupDays(all.filter(function (b) { var dn = dayOf(b.day); return dn !== null && isWeekday(dn); }));
      Object.keys(gp).forEach(function (k) {
        var n = gAll[k].refs.length;
        gp[k].refs.forEach(function (ref) { per[ref.slice(2)] = (per[ref.slice(2)] || 0) + HPD / n; });
      });
      var cs = state.cards.filter(function (c) { return !c.deleted && c.col !== "klar" && ((c.kalk || 0) > 0 || per[c.id] > 0); })
        .sort(function (a, b) { return a.name.localeCompare(b.name, "sv"); });
      if (!cs.length) h += '<p class="hint">Inga projekt har kalkylerade eller planerade timmar än. Fyll i Kalkylerade timmar när du redigerar ett projekt.</p>';
      else {
        h += '<div class="ptab-wrap"><table class="ptab ktab"><thead><tr><th>Projekt</th><th class="r">Kalkylerat</th><th class="r">Planerat totalt</th><th class="r">Kvar att planera</th><th class="r">Planerat av kalkyl</th><th></th></tr></thead><tbody>' +
          cs.map(function (c) {
            var pl = per[c.id] || 0, k = c.kalk || 0, left = k - pl, pc = k > 0 ? pl / k * 100 : null;
            return "<tr><td>" + esc(c.name) + (c.client ? ' <span class="client">· ' + esc(c.client) + "</span>" : "") + '</td><td class="r">' + (k ? fmtH(k) : "–") + '</td><td class="r">' + fmtH(pl) + '</td><td class="r' + (k && left < 0 ? " over" : "") + '">' +
              (k ? (left < 0 ? "−" + fmtH(-left) : fmtH(left)) : "–") + '</td><td class="r strong">' + (pc === null ? "–" : fmtPct(pc)) + "</td><td>" + (pc === null ? "" : bar(pc, pc > 100 ? "over" : "")) + "</td></tr>";
          }).join("") + "</tbody></table></div>" +
          '<p class="hint">Planerat totalt är alla bokningar på projektet i planeringen, även tidigare veckor. Står en tekniker på flera poster samma dag delas dagen lika. Röda siffror betyder att mer är planerat än kalkylerat.</p>';
      }
    }
    host.innerHTML = h;
  }

  function renderPlan() {
    var host = $("plan-grid"), ed = canEdit();
    $("pl-edit").hidden = !ed || !plan.ok;
    $("pl-manage-d").hidden = !ed || !plan.ok;
    if (!plan.ok) { $("pl-kpi").innerHTML = ""; host.innerHTML = '<p class="' + (plan.err === "Laddar …" ? "hint" : "hint bad") + '">' + esc(plan.err) + "</p>"; return; }
    var last = planWeek0 + planSpan * 7 - 3;
    renderKpi();
    var stamp = new Date();
    $("pl-print-title").textContent = "Teknikerplanering · vecka " + isoWeek(planWeek0) + (planSpan > 1 ? "–" + isoWeek(planWeek0 + planSpan * 7 - 3) : "") + " · utskriven " + stamp.getDate() + "/" + (stamp.getMonth() + 1) + " " + stamp.getFullYear();
    $("pl-label").textContent = "Vecka " + isoWeek(planWeek0) + (planSpan > 1 ? "–" + isoWeek(last) : "") + " · " + fmtDay(planWeek0) + "–" + fmtDay(last);
    var ix = bookingIndex(), td = todayDay(), techs = plan.techs.filter(function (t) { return t.active; }), w, d, day, h1 = "", h2 = "", days = [];
    for (w = 0; w < planSpan; w++) {
      var m = planWeek0 + w * 7;
      h1 += '<th colspan="5" class="wk">Vecka ' + isoWeek(m) + " · " + esc(fmtDay(m)) + "–" + esc(fmtDay(m + 4)) + "</th>";
      for (d = 0; d < 5; d++) {
        day = m + d; days.push(day);
        h2 += '<th class="dy' + (d === 0 ? " mon" : "") + (day === td ? " today" : "") + '">' + WD[d] + " " + esc(fmtDay(day)) + "</th>";
      }
    }
    var body = techs.map(function (t) {
      var row = '<tr><th class="tn" scope="row"><span class="techpill" style="--h:' + techHue(t.name) + '"><span>' + esc(t.name) + "</span></span></th>";
      days.forEach(function (dn, i) {
        var iso = isoOfDay(dn), refs = ix[iso + "|" + t.id] || [];
        row += '<td data-r="' + techs.indexOf(t) + '" data-c="' + i + '" class="pc' + (i % 5 === 0 ? " mon" : "") + (dn === td ? " today" : "") + (refs.length > 1 ? " multi" : "") + '" data-day="' + iso + '" data-tech="' + esc(t.id) + '">' + refs.map(chipHtml).join("") + "</td>";
      });
      return row + "</tr>";
    }).join("");
    var free = '<tr class="free"><th class="tn" scope="row">Lediga</th>' + days.map(function (dn, i) {
      var iso = isoOfDay(dn), n = techs.filter(function (t) { return !(ix[iso + "|" + t.id] || []).length; }).length;
      return '<td class="' + (i % 5 === 0 ? "mon" : "") + (dn === td ? " today" : "") + '">' + n + "</td>";
    }).join("") + "</tr>";
    host.innerHTML = '<table class="pgrid' + (armed && ed ? " armed" : "") + '"><thead><tr><th class="corner" rowspan="2">Tekniker</th>' + h1 + "</tr><tr>" + h2 + "</tr></thead><tbody>" + (body || '<tr><td colspan="' + (days.length + 1) + '" class="hint">Inga tekniker än. Lägg till under Hantera tekniker och övrigt.</td></tr>') + free + "</tbody></table>";
    if (ed) { renderPalette(); renderManage(); }
  }

  var plOpen = false;
  function matchList() {
    var q = $("pl-q").value.trim().toLowerCase();
    return projectList().filter(function (ref) {
      if (!q) return true;
      var f = refInfo(ref);
      return (f.label + " " + (f.sub || "")).toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderResults() {
    var box = $("pl-results"), list = matchList(), h = "";
    list.slice(0, 60).forEach(function (ref) {
      var f = refInfo(ref);
      h += '<button type="button" class="pl-opt" role="option" data-ref="' + esc(ref) + '">' + chipHtml(ref) + (f.sub ? ' <span class="client">' + esc(f.sub) + "</span>" : "") + "</button>";
    });
    box.innerHTML = h || '<p class="hint">Inga projekt hittades.</p>';
    box.hidden = !plOpen; $("pl-q").setAttribute("aria-expanded", String(plOpen));
  }
  function renderPalette() {
    var el = $("pl-armed");
    if (armed && armed !== "__erase") { el.innerHTML = 'Valt: ' + chipHtml(armed) + ' <button type="button" class="pl-x" id="pl-disarm" aria-label="Avmarkera projektet" title="Avmarkera">×</button>'; el.hidden = false; }
    else { el.innerHTML = ""; el.hidden = true; }
    $("pl-erase").setAttribute("aria-pressed", String(armed === "__erase"));
    var g = document.querySelector(".pgrid"); if (g) g.classList.toggle("armed", !!armed);
    renderResults();
  }
  function armProject(ref) { armed = ref; plOpen = false; $("pl-q").value = ""; renderPalette(); }
  $("pl-q").addEventListener("focus", function () { plOpen = true; renderResults(); });
  $("pl-q").addEventListener("input", function () { plOpen = true; renderResults(); });
  $("pl-q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var l = matchList(); if (l.length) { e.preventDefault(); armProject(l[0]); $("pl-q").blur(); } }
    else if (e.key === "Escape") { plOpen = false; renderResults(); $("pl-q").blur(); e.stopPropagation(); }
  });
  $("pl-results").addEventListener("pointerdown", function (e) { e.preventDefault(); });  // behåll fokus tills valet är gjort
  $("pl-results").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".pl-opt") : null;
    if (b) { armProject(b.getAttribute("data-ref")); $("pl-q").blur(); }
  });
  document.addEventListener("click", function (e) {
    if (plOpen && !(e.target.closest && e.target.closest(".pl-search"))) { plOpen = false; renderResults(); }
  });
  $("pl-erase").addEventListener("click", function () { armed = armed === "__erase" ? null : "__erase"; plOpen = false; renderPalette(); });
  $("pl-armed").addEventListener("click", function (e) { if (e.target.id === "pl-disarm") { armed = null; renderPalette(); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && armed && !$("view").open && !$("cellpop").open) { armed = null; if (curView === "plan" && plan.ok && canEdit()) renderPalette(); } });

  async function applyBookings(adds, rems) {
    function key(b) { return b.day + "|" + b.tech_id + "|" + b.ref; }
    var have = {}, rm = {};
    plan.bookings.forEach(function (b) { have[key(b)] = 1; });
    adds = adds.filter(function (b) { return !have[key(b)]; });
    rems = rems.filter(function (b) { return have[key(b)]; });
    if (!adds.length && !rems.length) return;
    rems.forEach(function (b) { rm[key(b)] = 1; });
    plan.bookings = plan.bookings.filter(function (b) { return !rm[key(b)]; }).concat(adds);
    renderPlan();
    try {
      if (adds.length) await be.addBookings(adds);
      if (rems.length) await be.removeBookings(rems);
      banner("");
    } catch (e) { banner(friendly(e), true); loadPlanData(); }
  }
  function refsAt(iso, tech) { return plan.bookings.filter(function (b) { return b.day === iso && b.tech_id === tech; }).map(function (b) { return b.ref; }); }

  /* Måla med valt projekt */
  function paintCell(td) {
    var k = td.getAttribute("data-day") + "|" + td.getAttribute("data-tech");
    if (!painting || painting.cells[k]) return;
    painting.cells[k] = { day: td.getAttribute("data-day"), tech_id: td.getAttribute("data-tech") };
    td.classList.add("pv");
  }
  $("plan-grid").addEventListener("pointerdown", function (e) {
    var td = e.target.closest ? e.target.closest("td.pc") : null;
    if (!td || !armed || !canEdit() || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    var has = refsAt(td.getAttribute("data-day"), td.getAttribute("data-tech"));
    painting = { mode: armed === "__erase" ? "erase" : has.indexOf(armed) >= 0 ? "remove" : "add", cells: {}, ref: armed };
    paintCell(td);
  });
  document.addEventListener("pointermove", function (e) {
    if (!painting) return;
    var el = document.elementFromPoint(e.clientX, e.clientY), td = el && el.closest ? el.closest("td.pc") : null;
    if (td) paintCell(td);
  });
  function endPaint() {
    if (!painting) return;
    var p = painting, adds = [], rems = [], k, c;
    painting = null;
    Array.prototype.forEach.call(document.querySelectorAll("td.pv"), function (n) { n.classList.remove("pv"); });
    for (k in p.cells) {
      c = p.cells[k];
      if (p.mode === "add") adds.push({ day: c.day, tech_id: c.tech_id, ref: p.ref });
      else if (p.mode === "remove") rems.push({ day: c.day, tech_id: c.tech_id, ref: p.ref });
      else refsAt(c.day, c.tech_id).forEach(function (r) { rems.push({ day: c.day, tech_id: c.tech_id, ref: r }); });
    }
    applyBookings(adds, rems);
  }
  document.addEventListener("pointerup", endPaint);
  document.addEventListener("pointercancel", endPaint);

  /* Utan valt projekt: dra över rutor (eller klicka på en) och välj projekt en gång för alla */
  var cpDlg = $("cellpop"), sel = null, swallowClick = false;
  function cellAt(r, c) { return document.querySelector('td.pc[data-r="' + r + '"][data-c="' + c + '"]'); }
  function selRect(a, b) {
    var r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c), out = [], r, c, td;
    for (r = r0; r <= r1; r++) for (c = c0; c <= c1; c++) { td = cellAt(r, c); if (td) out.push(td); }
    return out;
  }
  function selMark() {
    Array.prototype.forEach.call(document.querySelectorAll("td.pc.sel"), function (n) { n.classList.remove("sel"); });
    if (sel) selRect(sel.a, sel.b).forEach(function (td) { td.classList.add("sel"); });
  }
  function rc(td) { return { r: +td.getAttribute("data-r"), c: +td.getAttribute("data-c") }; }
  $("plan-grid").addEventListener("pointerdown", function (e) {
    var td = e.target.closest ? e.target.closest("td.pc") : null;
    if (!td || armed || !canEdit() || e.pointerType === "touch" || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    sel = { a: rc(td), b: rc(td) }; selMark();
  });
  document.addEventListener("pointermove", function (e) {
    if (!sel) return;
    var el = document.elementFromPoint(e.clientX, e.clientY), td = el && el.closest ? el.closest("td.pc") : null;
    if (td) { var p = rc(td); if (p.r !== sel.b.r || p.c !== sel.b.c) { sel.b = p; selMark(); } }
  });
  function openCellPop(cells) {
    popCells = cells.map(function (td) { return { day: td.getAttribute("data-day"), tech: td.getAttribute("data-tech") }; });
    var techIds = {}, days = [], t;
    popCells.forEach(function (c) { techIds[c.tech] = 1; days.push(dayOf(c.day)); });
    days.sort(function (x, y) { return x - y; });
    var ids = Object.keys(techIds), title;
    t = plan.techs.filter(function (x) { return x.id === ids[0]; })[0];
    if (popCells.length === 1) title = (t ? t.name : "") + " · " + fmtDay(days[0]);
    else if (ids.length === 1) title = (t ? t.name : "") + " · " + fmtDay(days[0]) + "–" + fmtDay(days[days.length - 1]) + " (" + popCells.length + " dagar)";
    else title = popCells.length + " rutor, " + ids.length + " tekniker";
    $("cp-title").textContent = title;
    $("cp-q").value = ""; renderCellPop();
    if (cpDlg.showModal) { if (!cpDlg.open) cpDlg.showModal(); } else cpDlg.setAttribute("open", "");
  }
  document.addEventListener("pointerup", function () {
    if (!sel) return;
    var cells = selRect(sel.a, sel.b);
    sel = null; selMark(); swallowClick = true;
    if (cells.length) openCellPop(cells);
  });
  document.addEventListener("pointercancel", function () { sel = null; selMark(); });
  $("plan-grid").addEventListener("click", function (e) {
    if (swallowClick) { swallowClick = false; return; }
    var td = e.target.closest ? e.target.closest("td.pc") : null;
    if (!td || armed || !canEdit()) return;
    openCellPop([td]);   // pekskärm: klick på en ruta
  });
  function renderCellPop() {
    if (!popCells || !popCells.length) return;
    var q = $("cp-q").value.trim().toLowerCase(), h = "", n = popCells.length, count = {};
    popCells.forEach(function (c) { refsAt(c.day, c.tech).forEach(function (r) { count[r] = (count[r] || 0) + 1; }); });
    var all = projectList(), extra = Object.keys(count).filter(function (r) { return all.indexOf(r) < 0; });
    all.concat(extra).forEach(function (ref) {
      var f = refInfo(ref), k = count[ref] || 0;
      if (q && (f.label + " " + (f.sub || "")).toLowerCase().indexOf(q) < 0 && !k) return;
      h += '<label class="cp-row"><input type="checkbox" data-ref="' + esc(ref) + '"' + (k === n ? " checked" : "") + (k > 0 && k < n ? ' data-part="1"' : "") + "> " + chipHtml(ref) + (f.sub ? ' <span class="client">' + esc(f.sub) + "</span>" : "") + (k > 0 && k < n ? ' <span class="hint">(' + k + " av " + n + ")</span>" : "") + "</label>";
    });
    $("cp-list").innerHTML = h || '<p class="hint">Inga projekt hittades.</p>';
    Array.prototype.forEach.call($("cp-list").querySelectorAll("[data-part]"), function (cb) { cb.indeterminate = true; });
  }
  $("cp-q").addEventListener("input", renderCellPop);
  $("cp-list").addEventListener("change", function (e) {
    var cb = e.target; if (!cb.getAttribute || !popCells) return;
    var ref = cb.getAttribute("data-ref"), rows = popCells.map(function (c) { return { day: c.day, tech_id: c.tech, ref: ref }; });
    applyBookings(cb.checked ? rows : [], cb.checked ? [] : rows);
    // renderPlan i applyBookings bygger om rutnätet; uppdatera listan så att markeringarna stämmer
    setTimeout(renderCellPop, 0);
  });
  $("cp-close").addEventListener("click", function () { cpDlg.close ? cpDlg.close() : cpDlg.removeAttribute("open"); });
  cpDlg.addEventListener("click", function (e) { if (e.target === cpDlg) $("cp-close").click(); });
  cpDlg.addEventListener("close", function () { popCells = null; });

  /* Navigering */
  function goWeek(w0) { planWeek0 = w0; loadPlanData(); }
  $("pl-prev").addEventListener("click", function () { goWeek(planWeek0 - 7 * (planSpan > 2 ? planSpan / 2 : 1)); });
  $("pl-next").addEventListener("click", function () { goWeek(planWeek0 + 7 * (planSpan > 2 ? planSpan / 2 : 1)); });
  $("pl-print").addEventListener("click", function () { window.print(); });
  $("pl-today").addEventListener("click", function () { goWeek(mondayOf(todayDay())); });
  $("pl-span").addEventListener("change", function (e) {
    planSpan = parseInt(e.target.value, 10) || 4;
    try { localStorage.setItem("pt-plan-span", String(planSpan)); } catch (x) {}
    loadPlanData();
  });

  /* Hantera tekniker och övrigt */
  function renderManage() {
    var d = $("pl-manage-d"); if (!d.open) return;
    var h = '<h3>Tekniker</h3><div class="mrows">';
    plan.techs.forEach(function (t, i) {
      h += '<div class="mrow"><input type="text" maxlength="100" data-mt="name" data-id="' + esc(t.id) + '" value="' + esc(t.name) + '" aria-label="Namn">' +
        '<label class="chk"><input type="checkbox" data-mt="active" data-id="' + esc(t.id) + '"' + (t.active ? " checked" : "") + "> Visas</label></div>";
    });
    h += '</div><p class="hint">Teknikerna sorteras automatiskt i bokstavsordning på förnamn.</p><div class="mrow add"><input type="text" id="mt-new" maxlength="100" placeholder="Ny tekniker" aria-label="Ny tekniker"><button type="button" class="btn ghost" id="mt-add">Lägg till tekniker</button></div>';
    h += '<h3>Övrigt (semester, sjuk, service med mera)</h3><div class="mrows">';
    plan.others.forEach(function (o) {
      h += '<div class="mrow"><input type="text" maxlength="100" data-mo="name" data-id="' + esc(o.id) + '" value="' + esc(o.name) + '" aria-label="Namn">' +
        '<select data-mo="kind" data-id="' + esc(o.id) + '" aria-label="Typ"><option value="abs"' + (o.kind === "abs" ? " selected" : "") + '>Frånvaro</option><option value="work"' + (o.kind === "work" ? " selected" : "") + ">Övrigt arbete</option></select>" +
        '<label class="chk"><input type="checkbox" data-mo="active" data-id="' + esc(o.id) + '"' + (o.active ? " checked" : "") + "> Visas</label></div>";
    });
    h += '</div><div class="mrow add"><input type="text" id="mo-new" maxlength="100" placeholder="Ny rad, till exempel Utbildning" aria-label="Ny rad"><button type="button" class="btn ghost" id="mo-add">Lägg till</button></div>' +
      '<p class="hint">Projekten i listan hämtas automatiskt från tavlan (alla kort utom Klar).</p>';
    $("pl-manage").innerHTML = h;
  }
  $("pl-manage-d").addEventListener("toggle", renderManage);
  async function saveManage(fn) {
    try { await fn(); banner(""); } catch (e) { banner(friendly(e), true); }
    loadPlanData();
  }
  $("pl-manage").addEventListener("change", function (e) {
    var t = e.target, id = t.getAttribute("data-id"), k, o;
    if ((k = t.getAttribute("data-mt"))) {
      o = plan.techs.filter(function (x) { return x.id === id; })[0]; if (!o) return;
      var nm = k === "name" ? t.value.trim() : o.name;
      if (!nm) { renderManage(); return; }
      saveManage(function () { return be.saveTech({ id: o.id, name: nm, pos: o.pos, active: k === "active" ? t.checked : o.active }); });
    } else if ((k = t.getAttribute("data-mo"))) {
      o = plan.others.filter(function (x) { return x.id === id; })[0]; if (!o) return;
      var n2 = k === "name" ? t.value.trim() : o.name;
      if (!n2) { renderManage(); return; }
      saveManage(function () { return be.saveOther({ id: o.id, name: n2, kind: k === "kind" ? t.value : o.kind, pos: o.pos, active: k === "active" ? t.checked : o.active }); });
    }
  });
  $("pl-manage").addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null; if (!b) return;
    if (b.id === "mt-add") {
      var n = $("mt-new").value.trim(); if (!n) return;
      saveManage(function () { return be.saveTech({ id: newId("pt-"), name: n, pos: (plan.techs.length ? plan.techs[plan.techs.length - 1].pos : 0) + 10, active: true }); });
    } else if (b.id === "mo-add") {
      var n3 = $("mo-new").value.trim(); if (!n3) return;
      saveManage(function () { return be.saveOther({ id: newId("po-"), name: n3, kind: "work", pos: (plan.others.length ? plan.others[plan.others.length - 1].pos : 0) + 10, active: true }); });
    }
  });

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
    try { var sv = localStorage.getItem("pt-view"); if (sv === "plan" || sv === "tasks") setView(sv); } catch (e) {}
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
