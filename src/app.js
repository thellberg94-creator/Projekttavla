/* Projekttavla: tavla, tidsplan, dokumentationsrader och ändringslogg.
   Två backends med samma gränssnitt: Supabase (inloggning + delad databas)
   och ett demoläge i minnet när ingen databas är kopplad eller ?demo anges. */
(function () {
  "use strict";

  var COLS = [
    { id: "akut", t: "Akut", s: "Kräver åtgärd nu", c: "var(--akut)" },
    { id: "pagar", t: "Pågår", s: "Arbete pågår i fält", c: "var(--pagar)" },
    { id: "redo", t: "Redo att utföra", s: "Beställt eller levererat", c: "var(--redo)" },
    { id: "vantar", t: "Väntar", s: "På svar, avrop eller tidplan", c: "var(--vantar)" },
    { id: "besikt", t: "Rest och dokumentation", s: "OK i fält, återstår besiktning eller papper", c: "var(--besikt)" },
    { id: "planera", t: "Planera in", s: "Offererat eller avropat, ej startat", c: "var(--planera)" },
    { id: "klar", t: "Klar", s: "Färdigt och överlämnat", c: "var(--klar)" }
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
      deleted: !!r.deleted, rev: r.rev
    };
  }
  function toRow(c) {
    return {
      id: c.id, col: c.col, pos: c.pos || 0, name: c.name, client: c.client || "",
      tags: c.tags || [], chip_cls: c.chip ? c.chip[0] : null, chip_text: c.chip ? c.chip[1] : null,
      lage: c.lage || "", next: c.next || "", notes: c.notes || [],
      start_date: c.start || null, end_date: c.end || null, tech: c.tech || "", deleted: !!c.deleted
    };
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
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Ingen kontakt med servern. Kontrollera nätverket och försök igen.";
    if (/Invalid login credentials/i.test(m)) return "Fel e-post eller lösenord.";
    return "Något gick fel: " + m;
  }
  function fail(e) {
    banner(friendly(e), true);
    if (e && e.conflict) reload();
  }

  /* ---------- Visning: tavlan ---------- */
  function cardHtml(c) {
    var ed = canEdit();
    var h = '<article class="card' + (ed ? "" : " ro") + '"' + (ed ? ' draggable="true"' : "") + ' data-id="' + esc(c.id) + '">';
    h += "<h3>" + esc(c.name) + (c.client ? ' <span class="client">· ' + esc(c.client) + "</span>" : "") + "</h3>";
    if (c.tags && c.tags.length) h += '<div class="tags">' + c.tags.map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("") + "</div>";
    if (c.chip) h += '<span class="chip ' + esc(c.chip[0]) + '">' + esc(c.chip[1]) + "</span>";
    if (c.tech) h += '<p class="tech"><b>Tekniker</b>' + esc(c.tech) + "</p>";
    if (hasDates(c)) h += '<p class="dts">' + dateText(c) + "</p>";
    if (c.lage) h += '<p class="lage">' + esc(c.lage) + "</p>";
    if (c.next) h += '<p class="next"><b>Nästa steg</b>' + esc(c.next) + "</p>";
    if (c.notes && c.notes.length) h += '<ul class="notes">' + c.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>";
    if (ed) {
      h += '<label class="move">Flytta till <select data-move="' + esc(c.id) + '">' +
        COLS.map(function (k) { return '<option value="' + k.id + '"' + (k.id === c.col ? " selected" : "") + ">" + esc(k.t) + "</option>"; }).join("") +
        "</select></label>" +
        '<div class="rowbtns"><button type="button" class="del edit" data-edit="' + esc(c.id) + '">Redigera</button>' +
        '<button type="button" class="del" data-del="' + esc(c.id) + '">Ta bort</button></div>';
    }
    return h + "</article>";
  }

  function renderBoard() {
    var vis = visibleCards();
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
    var nd = state.cards.length - vis.length;
    $("restore").hidden = !(nd && canEdit());
    $("restore").textContent = "Återställ " + nd + " borttagna kort";
  }

  /* ---------- Visning: tidsplan ---------- */
  function renderGantt() {
    var host = $("g-scroll"), miss = $("g-miss");
    var all = visibleCards(), rows = [], nodate = 0;
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
        : '<span class="nm" title="' + esc(tip) + '">' + esc(c.name) + "</span>";
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
    visibleCards().forEach(function (c) {
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
    notes: "anteckningar", start_date: "start", end_date: "slutbesiktning", tech: "tekniker", done: "klar", body: "text", project: "projekt", pos: "" };
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
    renderBoard(); renderGantt(); renderDocs(); renderDates();
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
      tech: $("f-tech").value.trim(), deleted: false
    };
    var btn = $("f-submit"); btn.disabled = true;
    try {
      var saved = existing ? await be.saveCard(card, editRev) : await be.insertCard(card);
      replaceIn(state.cards, saved);
      form.reset(); setMode(null); toggleForm(false);
      renderAll(); renderActivity(); banner("");
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
    var t = e.target;
    if (!t.getAttribute) return;
    var editId = t.getAttribute("data-edit"), delId = t.getAttribute("data-del");
    if (editId) openEdit(editId);
    else if (delId) deleteCard(delId);
  });
  $("g-scroll").addEventListener("click", function (e) {
    var id = e.target.getAttribute && e.target.getAttribute("data-gedit");
    if (id) openEdit(id);
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
      cards: state.cards.map(function (c) { return { id: c.id, col: c.col, pos: c.pos, name: c.name, client: c.client, tags: c.tags, chip: c.chip, lage: c.lage, next: c.next, notes: c.notes, start: c.start, end: c.end, tech: c.tech, deleted: c.deleted }; }),
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
        tech: str(c.tech, 100), deleted: c.deleted === true
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
