/* Operations01 — web app (PWA). Données locales (localStorage) + Google Drive.
   Sections : Missions, Temps, Finances, Contacts, Groupe, Tableau de bord. */
"use strict";

// ----------------------------- Référentiels -----------------------------
const STATUSES = [
  { code: "enCours", label: "En cours", rank: 0 },
  { code: "aDemarrer", label: "À démarrer", rank: 1 },
  { code: "enPause", label: "En pause", rank: 2 },
  { code: "terminee", label: "Terminée", rank: 3 },
];
const statusLabel = (c) => (STATUSES.find((s) => s.code === c) || STATUSES[1]).label;
const statusRank = (c) => (STATUSES.find((s) => s.code === c) || STATUSES[1]).rank;

const KINDS = [
  { code: "note", label: "Note", ic: "📝" }, { code: "email", label: "E-mail", ic: "✉️" },
  { code: "visio", label: "Visio", ic: "🎥" }, { code: "action", label: "Action", ic: "✅" },
  { code: "deliverable", label: "Livrable", ic: "📦" },
];
const kindMeta = (c) => KINDS.find((k) => k.code === c) || KINDS[0];

const ROLES = [{ code: "holding", label: "Holding" }, { code: "filiale", label: "Filiale" }];
const CONTACT_CATS = [
  { code: "client", label: "Client" }, { code: "prospect", label: "Prospect" },
  { code: "financeur", label: "Financeur" }, { code: "partenaire", label: "Partenaire" },
  { code: "fournisseur", label: "Fournisseur" }, { code: "institution", label: "Institution" },
  { code: "concurrent", label: "Concurrent" }, { code: "associe", label: "Associé" },
];
const contactCatLabel = (c) => (CONTACT_CATS.find((x) => x.code === c) || CONTACT_CATS[0]).label;
const DIRECTIONS = [{ code: "recette", label: "Recette" }, { code: "depense", label: "Dépense" }];
const INV_STATUSES = [
  { code: "aEmettre", label: "À émettre" }, { code: "emise", label: "Émise" },
  { code: "aPayer", label: "À payer" }, { code: "payee", label: "Payée" },
];
const invStatusLabel = (c) => (INV_STATUSES.find((x) => x.code === c) || INV_STATUSES[0]).label;
const TASK_STATUSES = [{ code: "aFaire", label: "À faire" }, { code: "enCours", label: "En cours" }, { code: "termine", label: "Terminée" }];

// ----------------------------- Données -----------------------------
const STORE_KEY = "operations01";
let state = load();

function blankState() {
  return { companies: [], contacts: [], categories: [], invoices: [], missions: [], tasks: [], actions: [], rendezvous: [], updatedAt: 0 };
}
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(blankState(), JSON.parse(raw));
  } catch (e) {}
  return blankState();
}
function save() {
  state.updatedAt = Date.now();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (window.DriveSync && DriveSync.isConnected()) DriveSync.push(state);
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ----------------------------- Utilitaires -----------------------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}
const euros = (v) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(v || 0);
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
function fmtDate(iso) { if (!iso) return "—"; const d = new Date(iso + (iso.length <= 10 ? "T12:00:00" : "")); return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }); }
const todayISO = () => new Date().toISOString().slice(0, 10);
const parseDate = (iso) => (iso ? new Date(iso + "T12:00:00") : null);
function validURL(u) { try { return !!new URL(u).protocol; } catch (e) { return false; } }

const companyName = (id) => { const c = state.companies.find((x) => x.id === id); return c ? c.name : ""; };
const contactName = (c) => `${c.firstName || ""} ${c.lastName || ""}`.trim() || "Sans nom";

// ----------------------------- Finances (calculs) -----------------------------
const invTTC = (v) => (v.amount || 0) * (1 + (v.vatRate || 0) / 100);
function invNature(v) { const cat = state.categories.find((c) => c.name === v.categoryName); return cat ? cat.nature : (v.direction === "recette" ? "produit" : "charge"); }
function invCashDate(v) {
  if (v.status === "payee" && v.paymentDate) return parseDate(v.paymentDate);
  if (v.hasDueDate && v.dueDate) return parseDate(v.dueDate);
  return parseDate(v.startDate) || new Date();
}
const invSigned = (v) => (v.direction === "recette" ? 1 : -1) * invTTC(v);
function companyBalance(c, now) {
  const cb = parseDate(c.cashBalanceDate) || new Date(0);
  let s = c.initialCashBalance || 0;
  state.invoices.filter((v) => v.companyId === c.id).forEach((v) => { const d = invCashDate(v); if (d > cb && d <= now) s += invSigned(v); });
  return s;
}
function treasuryEntities() { return state.companies.filter((c) => (c.initialCashBalance || 0) !== 0 || state.invoices.some((v) => v.companyId === c.id)); }
function treasuryNow(now) { return treasuryEntities().reduce((t, c) => t + companyBalance(c, now), 0); }
function treasuryProjected(now, days) {
  const limit = new Date(now.getTime() + days * 86400000);
  let base = treasuryNow(now);
  state.invoices.filter((v) => v.companyId).forEach((v) => { const d = invCashDate(v); if (d > now && d <= limit) base += invSigned(v); });
  return base;
}
const recettes = () => state.invoices.filter((v) => v.direction === "recette");
const depenses = () => state.invoices.filter((v) => v.direction === "depense");
const sumAmount = (arr) => arr.reduce((t, v) => t + (v.amount || 0), 0);

// ----------------------------- Navigation -----------------------------
const SECTIONS = [
  { id: "missions", label: "Missions", ic: "🏁", fn: renderMissions },
  { id: "tasks", label: "Tâches", ic: "✅", fn: renderTasks },
  { id: "actions", label: "Actions", ic: "🎫", fn: renderActions },
  { id: "rendezvous", label: "Rendez-vous", ic: "📅", fn: renderRendezvous },
  { id: "planning", label: "Planning", ic: "🗓️", fn: renderPlanning },
  { id: "time", label: "Temps", ic: "⏱️", fn: renderTime },
  { id: "finances", label: "Finances", ic: "€", fn: renderFinances },
  { id: "contacts", label: "Contacts", ic: "👥", fn: renderContacts },
  { id: "groupe", label: "Groupe", ic: "🏢", fn: renderGroupe },
  { id: "dashboard", label: "Tableau de bord", ic: "🎛️", fn: renderDashboard },
];
let view = { section: "missions", detailId: null };
function go(section) { view = { section, detailId: null }; render(); }
function openDetail(section, id) { view = { section, detailId: id }; render(); }

// ----------------------------- Rendu -----------------------------
function render() {
  renderNav();
  const content = document.getElementById("content");
  const sec = SECTIONS.find((s) => s.id === view.section) || SECTIONS[0];
  content.innerHTML = sec.fn();
  wire();
}
function renderNav() {
  const sidebar = document.getElementById("sidebar");
  sidebar.querySelectorAll(".nav-item").forEach((n) => n.remove());
  const driveBar = document.getElementById("driveBar");
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "nav-item" + (s.id === view.section ? " active" : "");
    b.innerHTML = `<span class="ic">${s.ic}</span> ${esc(s.label)}`;
    b.onclick = () => go(s.id);
    sidebar.insertBefore(b, driveBar);
  });
  const tabbar = document.getElementById("tabbar");
  tabbar.innerHTML = "";
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.className = s.id === view.section ? "active" : "";
    b.innerHTML = `<span class="ic">${s.ic}</span>${esc(s.label)}`;
    b.onclick = () => go(s.id);
    tabbar.appendChild(b);
  });
}
function stub(name) {
  return `<div class="page-title">${esc(name)}</div><div class="center-empty">Cette section arrivera dans une prochaine version.</div>`;
}
function companySelect(bind, current) {
  const opts = ['<option value="">Aucune</option>'].concat(
    state.companies.map((c) => `<option value="${c.id}" ${c.id === current ? "selected" : ""}>${esc(c.name || "Sans nom")}</option>`)
  ).join("");
  return `<select data-bind="${bind}" data-rerender>${opts}</select>`;
}

// ----------------------------- Missions -----------------------------
function missionTotal(m) { return (m.entries || []).reduce((t, e) => t + entryElapsed(e), 0); }
function entryElapsed(e) { const run = e.timerStartedAt ? (Date.now() - e.timerStartedAt) / 1000 : 0; return (e.accumulatedSeconds || 0) + run; }
function sortedMissions() {
  return [...state.missions].sort((a, b) => {
    const r = statusRank(a.statusCode) - statusRank(b.statusCode);
    return r !== 0 ? r : (a.title || "").localeCompare(b.title || "", "fr", { sensitivity: "base" });
  });
}
function renderMissions() {
  if (view.detailId) return renderMissionDetail(view.detailId);
  const items = sortedMissions();
  const rows = items.map((m) => {
    const total = missionTotal(m);
    const sub = [`${(m.entries || []).length} élément(s)`, total > 0 ? `⏱ ${fmtDuration(total)}` : null, m.companyId ? esc(companyName(m.companyId)) : null].filter(Boolean).join(" · ");
    return `<div class="row" data-open-mission="${m.id}" style="border-left-color:var(--primary)">
      <div class="grow"><div class="r-title">${esc(m.title || "Nouvelle mission")}</div><div class="r-sub">${sub}</div></div>
      <span class="badge ${m.statusCode}">${statusLabel(m.statusCode)}</span></div>`;
  }).join("");
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Missions</div>
      <button class="btn danger small" data-reset>Réinitialiser</button>
      <button class="btn secondary small" data-import>Importer</button>
      <button class="btn secondary small" data-export>Exporter</button>
      <button class="btn" data-add-mission>+ Nouvelle mission</button></div>
    <div class="list">${items.length ? rows : '<div class="center-empty">Aucune mission.</div>'}</div>
    <button class="btn fab" data-add-mission>+</button>`;
}
function renderMissionDetail(id) {
  const m = state.missions.find((x) => x.id === id);
  if (!m) return renderMissions();
  const statusOpts = STATUSES.map((s) => `<option value="${s.code}" ${s.code === m.statusCode ? "selected" : ""}>${s.label}</option>`).join("");
  const entries = [...(m.entries || [])].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
  const entriesHtml = entries.length ? entries.map((e) => renderEntry(m.id, e)).join("") : '<div class="muted" style="padding:8px 2px">Aucun élément.</div>';
  const kindButtons = KINDS.map((k) => `<button class="chip" data-add-entry="${k.code}" data-m="${m.id}">${k.ic} ${k.label}</button>`).join("");
  return `<button class="back" data-back>‹ Missions</button>
    <div class="toolbar">
      <input class="grow" data-bind="missions|${m.id}|title" value="${esc(m.title)}" placeholder="Intitulé" style="font-size:20px;font-weight:700"/>
      <select data-bind="missions|${m.id}|statusCode" style="width:auto">${statusOpts}</select>
    </div>
    <label class="field"><span>Société</span>${companySelect(`missions|${m.id}|companyId`, m.companyId)}</label>
    <div class="section-h">Historique de la mission</div>
    <div class="list">${entriesHtml}</div>
    <div class="chip-row" style="margin-top:12px">${kindButtons}</div>
    <div class="section-h">Suivi du temps</div>
    <div class="card"><div class="inline"><strong class="grow">Temps total</strong>
      <span class="timer ${(m.entries || []).some((e) => e.timerStartedAt) ? "running" : ""}" data-total="${m.id}">${fmtDuration(missionTotal(m))}</span></div></div>
    <div style="margin-top:22px"><button class="btn danger small" data-del-mission="${m.id}">Supprimer la mission</button></div>`;
}
function renderEntry(mid, e) {
  const k = kindMeta(e.kind), running = !!e.timerStartedAt;
  const urlLink = validURL(e.url) ? `<a class="btn ghost small" href="${esc(e.url)}" target="_blank" rel="noopener">↗ Ouvrir</a>` : (e.url ? '<span class="muted" style="font-size:12px">Lien invalide</span>' : "");
  const kindOpts = KINDS.map((x) => `<option value="${x.code}" ${x.code === e.kind ? "selected" : ""}>${x.ic} ${x.label}</option>`).join("");
  return `<div class="entry">
    <div class="entry-head" data-toggle="${e.id}" data-m="${mid}">
      <span class="ic">${k.ic}</span>
      <div class="grow"><div class="r-title">${esc(e.title || k.label)}</div>
        <div class="r-sub">${k.label} · ${fmtDate(e.date)}${entryElapsed(e) > 0 ? ` · ⏱ <span class="timer ${running ? "running" : ""}" data-entry-time="${e.id}">${fmtDuration(entryElapsed(e))}</span>` : ""}${running ? " 🔴" : ""}</div></div>
      <span class="muted">${e._open ? "▾" : "▸"}</span></div>
    <div class="entry-body" style="display:${e._open ? "block" : "none"}">
      <label class="field"><span>Type</span><select data-efield="kind" data-m="${mid}" data-e="${e.id}">${kindOpts}</select></label>
      <label class="field"><span>Titre</span><input data-efield="title" data-m="${mid}" data-e="${e.id}" value="${esc(e.title)}"/></label>
      <label class="field"><span>Date</span><input type="date" data-efield="date" data-m="${mid}" data-e="${e.id}" value="${esc(e.date || todayISO())}"/></label>
      <label class="field"><span>Détails</span><textarea data-efield="content" data-m="${mid}" data-e="${e.id}">${esc(e.content)}</textarea></label>
      <label class="field"><span>Lien (Gmail, Drive, Meet…)</span><input data-efield="url" data-m="${mid}" data-e="${e.id}" value="${esc(e.url)}" inputmode="url"/></label>
      <div class="inline" style="margin-top:6px">
        <button class="btn ${running ? "danger" : "secondary"} small" data-timer="${e.id}" data-m="${mid}">${running ? "■ Arrêter le chrono" : "▶ Démarrer le chrono"}</button>
        ${urlLink}<span class="grow"></span>
        <button class="btn ghost small" data-del-entry="${e.id}" data-m="${mid}">Supprimer</button></div>
    </div></div>`;
}

// ----------------------------- Contacts -----------------------------
function renderContacts() {
  if (view.detailId) return renderContactDetail(view.detailId);
  const items = [...state.contacts].sort((a, b) => contactName(a).localeCompare(contactName(b), "fr", { sensitivity: "base" }));
  const rows = items.map((c) => `<div class="row" data-open-contact="${c.id}" style="border-left-color:var(--activity)">
    <div class="grow"><div class="r-title">${esc(contactName(c))}</div>
      <div class="r-sub">${[esc(c.jobTitle), esc(c.organization)].filter(Boolean).join(" · ")}</div></div>
    <span class="badge aDemarrer">${contactCatLabel(c.category)}</span></div>`).join("");
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Contacts</div>
      <button class="btn" data-add-contact>+ Nouveau contact</button></div>
    <div class="list">${items.length ? rows : '<div class="center-empty">Aucun contact.</div>'}</div>
    <button class="btn fab" data-add-contact>+</button>`;
}
function renderContactDetail(id) {
  const c = state.contacts.find((x) => x.id === id);
  if (!c) return renderContacts();
  const catOpts = CONTACT_CATS.map((x) => `<option value="${x.code}" ${x.code === c.category ? "selected" : ""}>${x.label}</option>`).join("");
  const F = (label, field, type) => `<label class="field"><span>${label}</span><input ${type ? `type="${type}"` : ""} data-bind="contacts|${c.id}|${field}" value="${esc(c[field])}"/></label>`;
  return `<button class="back" data-back>‹ Contacts</button>
    <div class="page-title">${esc(contactName(c))}</div>
    <div class="card">
      ${F("Prénom", "firstName")}${F("Nom", "lastName")}${F("Organisation", "organization")}${F("Fonction", "jobTitle")}
      <label class="field"><span>Catégorie</span><select data-bind="contacts|${c.id}|category" data-rerender>${catOpts}</select></label>
      <label class="field"><span>Société</span>${companySelect(`contacts|${c.id}|companyId`, c.companyId)}</label>
      ${F("Email", "email", "email")}${F("Téléphone", "phone", "tel")}${F("Adresse", "address")}${F("LinkedIn", "linkedIn")}
      <label class="field"><span>Notes</span><textarea data-bind="contacts|${c.id}|notes">${esc(c.notes)}</textarea></label>
    </div>
    <div style="margin-top:18px"><button class="btn danger small" data-del-contact="${c.id}">Supprimer le contact</button></div>`;
}

// ----------------------------- Groupe (sociétés) -----------------------------
function renderGroupe() {
  if (view.detailId) return renderCompanyDetail(view.detailId);
  const items = [...state.companies].sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr", { sensitivity: "base" }));
  const rows = items.map((c) => `<div class="row" data-open-company="${c.id}" style="border-left-color:var(--primary)">
    <div class="grow"><div class="r-title">${esc(c.name || "Nouvelle société")}</div>
      <div class="r-sub">${(ROLES.find((r) => r.code === c.role) || ROLES[1]).label}${(c.activities || []).length ? ` · ${(c.activities || []).length} activité(s)` : ""}</div></div>
    <span class="timer muted">${euros(companyBalance(c, new Date()))}</span></div>`).join("");
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Groupe</div>
      <button class="btn" data-add-company>+ Nouvelle société</button></div>
    <div class="list">${items.length ? rows : '<div class="center-empty">Aucune société.</div>'}</div>
    <button class="btn fab" data-add-company>+</button>`;
}
function renderCompanyDetail(id) {
  const c = state.companies.find((x) => x.id === id);
  if (!c) return renderGroupe();
  const roleOpts = ROLES.map((r) => `<option value="${r.code}" ${r.code === c.role ? "selected" : ""}>${r.label}</option>`).join("");
  const acts = (c.activities || []).map((a) => `<div class="inline" style="margin:6px 0">
    <input class="grow" data-actfield="name" data-c="${c.id}" data-a="${a.id}" value="${esc(a.name)}" placeholder="Nom de l'activité"/>
    <button class="btn ghost small" data-del-act="${a.id}" data-c="${c.id}">✕</button></div>`).join("");
  return `<button class="back" data-back>‹ Groupe</button>
    <div class="page-title">${esc(c.name || "Société")}</div>
    <div class="card">
      <label class="field"><span>Nom</span><input data-bind="companies|${c.id}|name" value="${esc(c.name)}"/></label>
      <label class="field"><span>Forme juridique</span><input data-bind="companies|${c.id}|legalForm" value="${esc(c.legalForm)}"/></label>
      <label class="field"><span>Rôle</span><select data-bind="companies|${c.id}|role" data-rerender>${roleOpts}</select></label>
      <label class="field"><span>Trésorerie initiale (€)</span><input type="number" data-bind="companies|${c.id}|initialCashBalance" value="${c.initialCashBalance || 0}"/></label>
      <label class="field"><span>À la date du</span><input type="date" data-bind="companies|${c.id}|cashBalanceDate" value="${esc((c.cashBalanceDate || "").slice(0, 10) || todayISO())}"/></label>
      <label class="field"><span>Notes</span><textarea data-bind="companies|${c.id}|notes">${esc(c.notes)}</textarea></label>
    </div>
    <div class="section-h">Activités</div>
    <div class="card">${acts || '<div class="muted">Aucune activité.</div>'}<div style="margin-top:8px"><button class="btn secondary small" data-add-act="${c.id}">+ Ajouter une activité</button></div></div>
    <div style="margin-top:18px"><button class="btn danger small" data-del-company="${c.id}">Supprimer la société</button></div>`;
}

// ----------------------------- Finances -----------------------------
let financeTab = "factures";
function renderFinances() {
  if (view.detailId) return renderInvoiceDetail(view.detailId);
  const tabs = [["factures", "Factures"], ["cdr", "Compte de résultat"], ["tresorerie", "Trésorerie"], ["categories", "Catégories"], ["import", "Import bancaire"]]
    .map(([id, lbl]) => `<button class="chip ${financeTab === id ? "active" : ""}" data-ftab="${id}">${lbl}</button>`).join("");
  let body = "";
  if (financeTab === "factures") body = financeFactures();
  else if (financeTab === "cdr") body = financeCDR();
  else if (financeTab === "import") body = financeImport();
  else if (financeTab === "categories") body = financeCategories();
  else body = financeTresorerie();
  return `<div class="page-title">Finances</div><div class="chip-row" style="margin-bottom:16px">${tabs}</div>${body}`;
}
function financeFactures() {
  const items = [...state.invoices].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  const rows = items.map((v) => `<div class="row" data-open-invoice="${v.id}" style="border-left-color:${v.direction === "recette" ? "var(--finance)" : "var(--alert)"}">
    <div class="grow"><div class="r-title">${esc(v.title || "Nouvelle facture")}</div>
      <div class="r-sub">${[esc(companyName(v.companyId)), v.categoryName ? esc(v.categoryName) : null].filter(Boolean).join(" · ")}</div></div>
    <div style="text-align:right"><div>${euros(v.amount)}</div><span class="badge aDemarrer" style="font-size:10px">${invStatusLabel(v.status)}</span></div></div>`).join("");
  return `<div class="toolbar"><span class="grow"></span>
      <button class="btn secondary small" data-export-factures>⬇ CSV</button>
      <button class="btn" data-add-invoice>+ Nouvelle facture</button></div>
    <div class="list">${items.length ? rows : '<div class="center-empty">Aucune facture.</div>'}</div>`;
}
function financeCDR() {
  const lines = (nature) => {
    const map = {};
    state.invoices.filter((v) => invNature(v) === nature).forEach((v) => { const key = v.categoryName || "À catégoriser"; map[key] = (map[key] || 0) + (v.amount || 0); });
    return Object.entries(map).filter(([, val]) => val !== 0).sort((a, b) => b[1] - a[1]);
  };
  const produits = lines("produit"), charges = lines("charge");
  const totP = produits.reduce((t, l) => t + l[1], 0), totC = charges.reduce((t, l) => t + l[1], 0);
  const expBar = `<div class="toolbar"><span class="grow"></span><button class="btn secondary small" data-export-cdr>📄 Exporter (PDF)</button></div>`;
  const block = (title, arr, tot, color) => `<div class="section-h">${title}</div><div class="card">
    ${arr.length ? arr.map((l) => `<div class="inline" style="padding:4px 0"><span class="grow">${esc(l[0])}</span><span class="muted">${euros(l[1])}</span></div>`).join("") : '<div class="muted">—</div>'}
    <div class="inline" style="padding:6px 0;border-top:1px solid var(--line);margin-top:6px"><strong class="grow">Total ${title.toLowerCase()}</strong><strong style="color:${color}">${euros(tot)}</strong></div></div>`;
  return `${expBar}${block("Produits", produits, totP, "var(--finance)")}${block("Charges", charges, totC, "var(--alert)")}
    <div class="card" style="margin-top:12px"><div class="inline"><strong class="grow">Résultat à date</strong>
      <strong style="color:${totP - totC >= 0 ? "var(--positive)" : "#d23c3c"};font-size:18px">${euros(totP - totC)}</strong></div>
      <div class="muted" style="font-size:12px;margin-top:4px">Montants HT, toutes factures confondues.</div></div>`;
}
function financeTresorerie() {
  const now = new Date();
  const ents = treasuryEntities();
  const perEnt = ents.map((c) => `<div class="inline" style="padding:5px 0"><span class="grow">${esc(c.name || "Sans nom")}</span><span class="timer">${euros(companyBalance(c, now))}</span></div>`).join("");
  return `<div class="toolbar"><span class="grow"></span><button class="btn secondary small" data-export-treso>📄 Exporter (PDF)</button></div>
    <div class="card"><div class="inline"><strong class="grow">Trésorerie consolidée</strong>
      <strong style="color:${treasuryNow(now) >= 0 ? "var(--positive)" : "#d23c3c"};font-size:18px">${euros(treasuryNow(now))}</strong></div></div>
    <div class="section-h">Prévisionnel</div><div class="card">
      <div class="inline" style="padding:4px 0"><span class="grow">À 30 jours</span><span class="timer">${euros(treasuryProjected(now, 30))}</span></div>
      <div class="inline" style="padding:4px 0"><span class="grow">À 60 jours</span><span class="timer">${euros(treasuryProjected(now, 60))}</span></div>
      <div class="inline" style="padding:4px 0"><span class="grow">À 90 jours</span><span class="timer">${euros(treasuryProjected(now, 90))}</span></div></div>
    <div class="section-h">Par société</div><div class="card">${perEnt || '<div class="muted">—</div>'}</div>`;
}
function renderInvoiceDetail(id) {
  const v = state.invoices.find((x) => x.id === id);
  if (!v) { view.detailId = null; return renderFinances(); }
  const dirOpts = DIRECTIONS.map((d) => `<option value="${d.code}" ${d.code === v.direction ? "selected" : ""}>${d.label}</option>`).join("");
  const stOpts = INV_STATUSES.map((d) => `<option value="${d.code}" ${d.code === v.status ? "selected" : ""}>${d.label}</option>`).join("");
  const catOpts = ['<option value="">À catégoriser</option>'].concat(state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === v.categoryName ? "selected" : ""}>${esc(c.name)}</option>`)).join("");
  const ctOpts = ['<option value="">Aucun</option>'].concat(state.contacts.map((c) => `<option value="${c.id}" ${c.id === v.contactId ? "selected" : ""}>${esc(contactName(c))}</option>`)).join("");
  return `<button class="back" data-back-invoice>‹ Finances</button>
    <div class="page-title">${esc(v.title || "Facture")}</div>
    <div class="card">
      <label class="field"><span>Intitulé</span><input data-bind="invoices|${v.id}|title" value="${esc(v.title)}"/></label>
      <label class="field"><span>Sens</span><select data-bind="invoices|${v.id}|direction" data-rerender>${dirOpts}</select></label>
      <label class="field"><span>Statut</span><select data-bind="invoices|${v.id}|status" data-rerender>${stOpts}</select></label>
      <label class="field"><span>Montant HT (€)</span><input type="number" data-bind="invoices|${v.id}|amount" value="${v.amount || 0}"/></label>
      <label class="field"><span>TVA (%)</span><input type="number" data-bind="invoices|${v.id}|vatRate" value="${v.vatRate == null ? 20 : v.vatRate}"/></label>
      <div class="inline" style="margin:6px 0"><span class="grow muted">Montant TTC</span><strong>${euros(invTTC(v))}</strong></div>
      <label class="field"><span>Catégorie</span><select data-bind="invoices|${v.id}|categoryName">${catOpts}</select></label>
      <label class="field"><span>Société</span>${companySelect(`invoices|${v.id}|companyId`, v.companyId)}</label>
      <label class="field"><span>Tiers</span><select data-bind="invoices|${v.id}|contactId">${ctOpts}</select></label>
      <label class="field"><span>Date</span><input type="date" data-bind="invoices|${v.id}|startDate" value="${esc((v.startDate || "").slice(0, 10) || todayISO())}"/></label>
      <label class="field"><span>Échéance</span><input type="date" data-bind="invoices|${v.id}|dueDate" value="${esc((v.dueDate || "").slice(0, 10))}"/></label>
      <label class="field"><span>Payée le</span><input type="date" data-bind="invoices|${v.id}|paymentDate" value="${esc((v.paymentDate || "").slice(0, 10))}"/></label>
    </div>
    <div style="margin-top:18px"><button class="btn danger small" data-del-invoice="${v.id}">Supprimer la facture</button></div>`;
}

// ----------------------------- Catégories -----------------------------
const NATURES = [{ code: "produit", label: "Produit (recette)" }, { code: "charge", label: "Charge (dépense)" }];
function ensureCatIds() { state.categories.forEach((c) => { if (!c.id) c.id = uid(); }); }
function catUsage(name) { return state.invoices.filter((v) => v.categoryName === name).length; }
function financeCategories() {
  ensureCatIds();
  const cats = [...state.categories].sort((a, b) => (a.nature || "").localeCompare(b.nature || "") || (a.name || "").localeCompare(b.name || "", "fr"));
  const block = (nature, label) => {
    const arr = cats.filter((c) => (c.nature || "charge") === nature);
    const rows = arr.map((c) => {
      const natOpts = NATURES.map((n) => `<option value="${n.code}" ${n.code === (c.nature || "charge") ? "selected" : ""}>${n.label}</option>`).join("");
      const used = catUsage(c.name);
      return `<div class="row" style="cursor:default;border-left-color:${nature === "produit" ? "var(--finance)" : "var(--alert)"}">
        <input class="grow" data-catfield="name" data-cat="${c.id}" data-old="${esc(c.name)}" value="${esc(c.name)}" placeholder="Nom de la catégorie"/>
        <select data-catfield="nature" data-cat="${c.id}" style="width:auto">${natOpts}</select>
        <span class="muted" style="font-size:11px;white-space:nowrap">${used} fact.</span>
        <button class="btn ghost small" data-del-cat="${c.id}">✕</button></div>`;
    }).join("");
    return `<div class="section-h">${label} <span class="muted">(${arr.length})</span></div>
      <div class="list">${arr.length ? rows : '<div class="muted" style="padding:4px 2px">Aucune catégorie.</div>'}</div>`;
  };
  return `<div class="toolbar"><span class="grow muted" style="font-size:12px">Les catégories structurent le compte de résultat (produits / charges).</span>
      <button class="btn small" data-add-cat="produit">+ Produit</button>
      <button class="btn small" data-add-cat="charge">+ Charge</button></div>
    ${block("produit", "Produits")}
    ${block("charge", "Charges")}`;
}

// ----------------------------- Import bancaire (CSV / OFX) -----------------------------
let bankImport = { companyId: "", rows: [], fileName: "" };
function parseNumberFR(s) {
  if (typeof s === "number") return s;
  s = String(s).trim().replace(/\s/g, "").replace(/[€$]/g, "");
  if (!s) return NaN;
  if (s.indexOf(",") > -1 && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return parseFloat(s);
}
function parseDateAny(s) {
  s = String(s).trim(); let m;
  if ((m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{2,4})/))) { let y = m[3]; if (y.length === 2) y = "20" + y; return `${y}-${m[2]}-${m[1]}`; }
  if ((m = s.match(/^(\d{8})$/))) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return "";
}
function splitCSVLine(line, delim) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else { if (ch === '"') q = true; else if (ch === delim) { out.push(cur); cur = ""; } else cur += ch; }
  }
  out.push(cur); return out;
}
function detectDelim(l) { const c = { ";": (l.match(/;/g) || []).length, "\t": (l.match(/\t/g) || []).length, ",": (l.match(/,/g) || []).length }; return Object.keys(c).sort((a, b) => c[b] - c[a])[0]; }
function parseCSVBank(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
  if (!lines.length) return [];
  let headerIdx = -1, delim = ";", cols = [];
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const d = detectDelim(lines[i]);
    const cells = splitCSVLine(lines[i], d).map((x) => x.toLowerCase().trim());
    if (cells.some((c) => c.includes("date")) && cells.some((c) => c.includes("montant") || c.includes("débit") || c.includes("debit") || c.includes("crédit") || c.includes("credit"))) { headerIdx = i; delim = d; cols = cells; break; }
  }
  if (headerIdx === -1) {
    delim = detectDelim(lines[0]);
    return lines.map((l) => { const c = splitCSVLine(l, delim); const date = parseDateAny(c[0] || ""); const amount = parseNumberFR(c[c.length - 1] || ""); const label = (c.slice(1, c.length - 1).join(" ") || "").trim() || "Opération"; return (date && !isNaN(amount)) ? { date, label, amount } : null; }).filter(Boolean);
  }
  const find = (keys) => cols.findIndex((c) => keys.some((k) => c.includes(k)));
  const iDate = find(["date de comptab", "date d'opé", "date ope", "date val", "date"]);
  const iLabel = find(["libellé", "libelle", "description", "nature", "motif", "détail", "detail", "intitulé", "intitule", "opération", "operation"]);
  const iAmount = find(["montant"]);
  const iDebit = find(["débit", "debit"]);
  const iCredit = find(["crédit", "credit"]);
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const c = splitCSVLine(lines[i], delim); if (c.length < 2) continue;
    const date = parseDateAny(c[iDate] || ""); if (!date) continue;
    let amount;
    if (iAmount > -1 && (c[iAmount] || "").trim() !== "") amount = parseNumberFR(c[iAmount]);
    else { const deb = iDebit > -1 ? parseNumberFR(c[iDebit]) : NaN; const cred = iCredit > -1 ? parseNumberFR(c[iCredit]) : NaN; amount = (!isNaN(cred) && cred !== 0) ? Math.abs(cred) : (!isNaN(deb) && deb !== 0 ? -Math.abs(deb) : NaN); }
    if (isNaN(amount)) continue;
    rows.push({ date, label: (iLabel > -1 ? c[iLabel] : "").trim() || "Opération", amount });
  }
  return rows;
}
function parseOFX(text) {
  const rows = []; const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((b) => {
    const g = (tag) => { const m = b.match(new RegExp("<" + tag + ">([^<\\r\\n]*)", "i")); return m ? m[1].trim() : ""; };
    const amount = parseFloat(g("TRNAMT").replace(",", ".")); const dt = g("DTPOSTED").slice(0, 8);
    const date = dt.length === 8 ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : "";
    const label = (g("NAME") || g("MEMO") || "Opération").trim();
    if (!isNaN(amount) && date) rows.push({ date, label, amount });
  });
  return rows;
}
function parseBankFile(text, name) {
  if (/<OFX>/i.test(text) || /<STMTTRN>/i.test(text) || /\.ofx$/i.test(name || "")) return parseOFX(text);
  return parseCSVBank(text);
}
function financeImport() {
  const compOpts = ['<option value="">Choisir la société / le compte…</option>'].concat(state.companies.map((c) => `<option value="${c.id}" ${c.id === bankImport.companyId ? "selected" : ""}>${esc(c.name || "Sans nom")}</option>`)).join("");
  const rows = bankImport.rows;
  let preview = "";
  if (rows.length) {
    const credit = rows.filter((r) => r.amount > 0).reduce((t, r) => t + r.amount, 0);
    const debit = rows.filter((r) => r.amount < 0).reduce((t, r) => t + r.amount, 0);
    const list = rows.map((r, i) => `<tr>
      <td style="text-align:center"><input type="checkbox" data-bankrow="${i}" checked style="width:auto"/></td>
      <td style="white-space:nowrap">${fmtDate(r.date)}</td>
      <td>${esc(r.label)}</td>
      <td style="text-align:right;white-space:nowrap;color:${r.amount >= 0 ? "var(--positive)" : "#d23c3c"}">${euros(r.amount)}</td></tr>`).join("");
    preview = `<div class="section-h">${rows.length} opération(s) détectée(s)${bankImport.fileName ? ` · ${esc(bankImport.fileName)}` : ""}</div>
      <div class="card" style="padding:8px">
        <div style="overflow-x:auto"><table class="bank-table">
          <thead><tr><th></th><th>Date</th><th>Libellé</th><th style="text-align:right">Montant</th></tr></thead>
          <tbody>${list}</tbody></table></div>
        <div class="inline" style="margin-top:10px;font-size:13px"><span class="grow muted">Crédits ${euros(credit)} · Débits ${euros(debit)}</span></div>
      </div>
      <div class="inline" style="margin-top:12px">
        <button class="btn" data-bank-import>Importer les opérations cochées</button>
        <button class="btn ghost small" data-bank-clear>Annuler</button></div>`;
  }
  return `<div class="card">
      <div style="font-weight:600;margin-bottom:8px">Importer un relevé bancaire</div>
      <div class="muted" style="font-size:13px;line-height:1.5;margin-bottom:12px">Exporte un relevé depuis ta banque au format <strong>CSV</strong> ou <strong>OFX</strong>, puis charge-le ici. Les opérations sont ajoutées comme factures <em>payées</em> (crédit = recette, débit = dépense) et alimentent la trésorerie.</div>
      <label class="field"><span>Rattacher au compte</span><select id="bankCompany">${compOpts}</select></label>
      <label class="field"><span>Fichier du relevé (CSV ou OFX)</span><input type="file" id="bankFile" accept=".csv,.ofx,.txt,text/csv"/></label>
    </div>
    ${preview}
    <div class="muted" style="font-size:11px;margin-top:12px;line-height:1.5">⚠️ Ces opérations sont des mouvements de trésorerie réels (montants TTC, TVA 0). Si tu saisis aussi les factures à la main, tu peux avoir un double comptage : range les opérations importées dans une catégorie dédiée pour les distinguer. Les doublons d'un même relevé ré-importé sont automatiquement ignorés.</div>`;
}
function doBankImport() {
  if (!bankImport.companyId) { alert("Choisis d'abord la société / le compte de rattachement."); return; }
  const chosen = [];
  document.querySelectorAll("[data-bankrow]").forEach((cb) => { if (cb.checked) chosen.push(bankImport.rows[Number(cb.dataset.bankrow)]); });
  if (!chosen.length) { alert("Aucune opération sélectionnée."); return; }
  const existing = new Set(state.invoices.filter((v) => v.bankKey).map((v) => v.bankKey));
  let added = 0, skipped = 0;
  chosen.forEach((r) => {
    const key = `${bankImport.companyId}|${r.date}|${r.amount.toFixed(2)}|${r.label}`;
    if (existing.has(key)) { skipped++; return; }
    existing.add(key);
    state.invoices.push({ id: uid(), title: r.label, reference: "", direction: r.amount >= 0 ? "recette" : "depense", status: "payee", amount: Math.abs(r.amount), vatRate: 0, startDate: r.date, hasDueDate: false, dueDate: "", paymentDate: r.date, companyId: bankImport.companyId, contactId: null, categoryName: "", bankKey: key });
    added++;
  });
  save();
  bankImport.rows = []; bankImport.fileName = "";
  alert(`Import terminé : ${added} opération(s) ajoutée(s)${skipped ? `, ${skipped} déjà présente(s) ignorée(s)` : ""}.`);
  financeTab = "factures"; render();
}

// ----------------------------- Tableau de bord -----------------------------
function renderDashboard() {
  const now = new Date();
  const caFacture = sumAmount(recettes().filter((v) => v.status === "emise" || v.status === "payee"));
  const caEncaisse = sumAmount(recettes().filter((v) => v.status === "payee"));
  const caAEmettre = sumAmount(recettes().filter((v) => v.status === "aEmettre"));
  const produits = state.invoices.filter((v) => invNature(v) === "produit").reduce((t, v) => t + (v.amount || 0), 0);
  const charges = state.invoices.filter((v) => invNature(v) === "charge").reduce((t, v) => t + (v.amount || 0), 0);
  const overdue = recettes().filter((v) => v.status !== "payee" && invCashDate(v) < now);
  const toPay = depenses().filter((v) => v.status !== "payee");
  const missionsEnCours = state.missions.filter((m) => m.statusCode === "enCours").length;
  const card = (title, value, sub, color) => `<div class="card" style="background:${color}1f">
    <div class="timer" style="font-size:20px;font-weight:700;color:${color}">${value}</div>
    <div style="margin-top:2px">${title}</div>${sub ? `<div class="muted" style="font-size:11px">${sub}</div>` : ""}</div>`;
  const grid = (items) => `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">${items}</div>`;
  const alerts = [];
  if (overdue.length) alerts.push(`${overdue.length} facture(s) client en retard · ${euros(overdue.reduce((t, v) => t + invTTC(v), 0))}`);
  if (toPay.length) alerts.push(`${toPay.length} facture(s) fournisseur à payer · ${euros(toPay.reduce((t, v) => t + invTTC(v), 0))}`);
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Tableau de bord</div>
      <button class="btn secondary small" data-export-dashboard>📄 Exporter (PDF)</button></div>
    <div class="section-h">Activité (HT)</div>
    ${grid(card("CA facturé", euros(caFacture), "émises + payées", "#18c1d8") + card("CA encaissé", euros(caEncaisse), "payées", "#4dc8bb") + card("CA à émettre", euros(caAEmettre), "en attente", "#c3d679") + card("Résultat à date", euros(produits - charges), "produits − charges", produits - charges >= 0 ? "#4dc8bb" : "#d23c3c"))}
    <div class="section-h">Trésorerie consolidée (TTC)</div>
    ${grid(card("Disponible", euros(treasuryNow(now)), "aujourd'hui", "#4dc8bb") + card("Prév. 30 j", euros(treasuryProjected(now, 30)), "", "#a2d28c") + card("Prév. 60 j", euros(treasuryProjected(now, 60)), "", "#a2d28c") + card("Prév. 90 j", euros(treasuryProjected(now, 90)), "", "#a2d28c"))}
    <div class="section-h">À traiter</div>
    ${grid(card("Clients en retard", String(overdue.length), euros(overdue.reduce((t, v) => t + invTTC(v), 0)), overdue.length ? "#d23c3c" : "#4dc8bb") + card("Fournisseurs à payer", String(toPay.length), euros(toPay.reduce((t, v) => t + invTTC(v), 0)), "#e9db65") + card("Missions en cours", String(missionsEnCours), "", "#18c1d8") + card("Sociétés", String(state.companies.length), `${state.contacts.length} contacts`, "#18c1d8"))}
    ${alerts.length ? `<div class="section-h">Alertes</div><div class="card">${alerts.map((a) => `<div style="padding:4px 0">⚠️ ${esc(a)}</div>`).join("")}</div>` : ""}`;
}

// ----------------------------- Temps -----------------------------
function renderTime() {
  const { start, end } = weekInterval(new Date());
  let total = 0; const perMission = [];
  state.missions.forEach((m) => {
    let s = 0;
    (m.entries || []).forEach((e) => { const d = e.date ? new Date(e.date + "T12:00:00") : null; if (d && d >= start && d < end) s += entryElapsed(e); });
    if (s > 0) { perMission.push({ title: m.title || "Sans titre", s }); total += s; }
  });
  perMission.sort((a, b) => b.s - a.s);
  const rows = perMission.length ? perMission.map((p) => `<div class="inline" style="padding:6px 0"><span class="grow">${esc(p.title)}</span><span class="timer">${fmtDuration(p.s)}</span></div>`).join("") : '<div class="muted">Aucun temps cette semaine.</div>';
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Temps</div>
      <button class="btn secondary small" data-export-temps-csv>⬇ CSV</button>
      <button class="btn secondary small" data-export-temps-pdf>📄 PDF</button></div>
    <div class="card"><div class="muted" style="font-size:13px">Semaine · lundi → dimanche</div>
      <div style="font-weight:600;margin:2px 0 10px">${fmtDate(start.toISOString().slice(0, 10))} → ${fmtDate(new Date(end - 86400000).toISOString().slice(0, 10))}</div>
      <div class="inline"><strong class="grow">Temps total</strong><span class="timer" style="color:var(--primary);font-size:18px">${fmtDuration(total)}</span></div></div>
    <div class="section-h">Par mission</div><div class="card">${rows}</div>`;
}
function weekInterval(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); const day = (d.getDay() + 6) % 7; const start = new Date(d); start.setDate(d.getDate() - day); const end = new Date(start); end.setDate(start.getDate() + 7); return { start, end }; }

// ----------------------------- Tâches -----------------------------
function missionSelect(bind, current) {
  const opts = ['<option value="">Aucune mission</option>'].concat(
    sortedMissions().map((m) => `<option value="${m.id}" ${m.id === current ? "selected" : ""}>${esc(m.title || "Sans titre")}</option>`)
  ).join("");
  return `<select data-bind="${bind}">${opts}</select>`;
}
const taskStatusLabel = (c) => (TASK_STATUSES.find((s) => s.code === c) || TASK_STATUSES[0]).label;
// Nombre de jours (arrondi) entre aujourd'hui et une date ISO (négatif = passé).
function daysUntil(due) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due + "T00:00:00");
  return Math.round((d - today) / 86400000);
}
// Couleur d'échéance : plus la deadline approche, plus on descend le disque
// chromatique du cyan (lointain) vers le rouge (imminent). HORIZON = jours au-delà
// desquels la tâche est considérée « lointaine » (couleur la plus froide).
const DEADLINE_HORIZON = 21;
function deadlineColor(days) {
  if (days <= 0) return "hsl(0,85%,45%)"; // échéance atteinte ou dépassée → rouge
  const t = Math.min(days / DEADLINE_HORIZON, 1); // 0 = imminent, 1 = lointain
  const hue = Math.round(t * 190); // 0° rouge → 190° cyan (rouge→orange→jaune→vert→cyan)
  return `hsl(${hue},80%,45%)`;
}
function deadlineInfo(due, done) {
  if (!due) return { color: "var(--line)", label: "Sans échéance", muted: true };
  const days = daysUntil(due);
  if (done) return { color: "var(--line)", label: `Échéance ${fmtDate(due)}`, muted: true };
  let label;
  if (days < 0) label = `En retard de ${-days} j · ${fmtDate(due)}`;
  else if (days === 0) label = `Aujourd'hui · ${fmtDate(due)}`;
  else if (days === 1) label = `Demain (J-1) · ${fmtDate(due)}`;
  else label = `J-${days} · ${fmtDate(due)}`;
  return { color: deadlineColor(days), label, muted: false };
}
function renderTasks() {
  const groups = TASK_STATUSES.map((st) => {
    const items = state.tasks.filter((t) => (t.status || "aFaire") === st.code)
      .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (b.createdAt || 0) - (a.createdAt || 0));
    const rows = items.map((t) => {
      const done = (t.status || "aFaire") === "termine";
      const di = deadlineInfo(t.dueDate, done);
      const nextOpts = TASK_STATUSES.map((s) => `<option value="${s.code}" ${s.code === (t.status || "aFaire") ? "selected" : ""}>${s.label}</option>`).join("");
      const mission = t.missionId ? `<span>${esc(missionTitle(t.missionId))}</span>` : "";
      const dl = `<span style="color:${di.muted ? "var(--muted)" : di.color};font-weight:${di.muted ? 400 : 600}">${di.muted ? "" : "⬤ "}${esc(di.label)}</span>`;
      return `<div class="row task-row" style="border-left-color:${di.color}">
        <div class="grow" style="min-width:160px"><input class="flat-input r-title" data-taskfield="title" data-t="${t.id}" value="${esc(t.title)}" placeholder="Intitulé de la tâche"/>
          <div class="r-sub">${[mission, dl].filter(Boolean).join(" · ")}</div></div>
        <input type="date" class="task-due" data-taskdue="${t.id}" value="${esc(t.dueDate || "")}" title="Échéance"/>
        <select data-task-status="${t.id}" style="width:auto">${nextOpts}</select>
        <button class="btn ghost small" data-del-task="${t.id}">✕</button></div>`;
    }).join("");
    return `<div class="section-h">${st.label} <span class="muted">(${items.length})</span></div>
      <div class="list">${items.length ? rows : '<div class="muted" style="padding:4px 2px">—</div>'}</div>`;
  }).join("");
  const legend = `<div class="dl-legend"><span class="muted">Échéance :</span>
    <span class="dl-grad"></span>
    <span class="muted" style="font-size:11px">lointaine → imminente</span></div>`;
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Tâches</div>
      <button class="btn" data-add-task>+ Nouvelle tâche</button></div>
    ${legend}
    ${groups}
    <button class="btn fab" data-add-task>+</button>`;
}
function missionTitle(id) { const m = state.missions.find((x) => x.id === id); return m ? (m.title || "Sans titre") : ""; }

// ----------------------------- Actions (tickets) -----------------------------
function renderActions() {
  if (view.detailId) return renderActionDetail(view.detailId);
  const open = state.actions.filter((a) => !a.closed);
  const closed = state.actions.filter((a) => a.closed);
  const card = (a) => {
    const sub = [a.recipientName ? esc(a.recipientName) : null, a.projectName ? esc(a.projectName) : (a.missionId ? esc(missionTitle(a.missionId)) : null)].filter(Boolean).join(" · ");
    return `<div class="row" data-open-action="${a.id}" style="border-left-color:${a.closed ? "var(--line)" : "var(--alert)"}">
      <div class="grow"><div class="r-title">${esc(a.title || "Sans objet")}</div>
        <div class="r-sub">${sub || "—"}${a.reminderDaily && !a.closed ? " · 🔔 rappel quotidien 9h" : ""}</div></div>
      <span class="badge ${a.closed ? "terminee" : "enCours"}">${a.closed ? "Close" : "Ouverte"}</span></div>`;
  };
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Actions</div>
      <button class="btn" data-add-action>+ Nouvelle action</button></div>
    <div class="muted" style="font-size:12px;margin-bottom:10px">Suivi des documents ou informations à recevoir d'un interlocuteur. Tant qu'une action est ouverte, un rappel e-mail est envoyé chaque jour à 9h (via le script Google, voir la doc).</div>
    <div class="section-h">Ouvertes <span class="muted">(${open.length})</span></div>
    <div class="list">${open.length ? open.map(card).join("") : '<div class="muted" style="padding:4px 2px">Aucune action ouverte.</div>'}</div>
    ${closed.length ? `<div class="section-h">Closes <span class="muted">(${closed.length})</span></div><div class="list">${closed.map(card).join("")}</div>` : ""}
    <button class="btn fab" data-add-action>+</button>`;
}
function renderActionDetail(id) {
  const a = state.actions.find((x) => x.id === id);
  if (!a) { view.detailId = null; return renderActions(); }
  const ctOpts = ['<option value="">— Saisie libre —</option>'].concat(
    state.contacts.map((c) => `<option value="${c.id}" ${c.id === a.contactId ? "selected" : ""}>${esc(contactName(c))}${c.email ? ` · ${esc(c.email)}` : ""}</option>`)
  ).join("");
  return `<button class="back" data-back-action>‹ Actions</button>
    <div class="page-title">${esc(a.title || "Action")}</div>
    <div class="card">
      <label class="field"><span>Objet</span><input data-bind="actions|${a.id}|title" value="${esc(a.title)}" placeholder="Ex. Recevoir le bilan 2025"/></label>
      <label class="field"><span>Projet / mission</span>${missionSelect(`actions|${a.id}|missionId`, a.missionId)}</label>
      <label class="field"><span>Projet (libre, si hors mission)</span><input data-bind="actions|${a.id}|projectName" value="${esc(a.projectName)}"/></label>
      <label class="field"><span>Documents / informations à recevoir</span><textarea data-bind="actions|${a.id}|request">${esc(a.request)}</textarea></label>
      <label class="field"><span>Interlocuteur (dans les contacts)</span><select data-action-contact="${a.id}" data-rerender>${ctOpts}</select></label>
      <label class="field"><span>Nom de l'interlocuteur</span><input data-bind="actions|${a.id}|recipientName" value="${esc(a.recipientName)}"/></label>
      <label class="field"><span>E-mail du destinataire</span><input type="email" data-bind="actions|${a.id}|recipientEmail" value="${esc(a.recipientEmail)}" inputmode="email"/></label>
      <label class="field"><span>Échéance souhaitée</span><input type="date" data-bind="actions|${a.id}|dueDate" value="${esc((a.dueDate || "").slice(0, 10))}"/></label>
      <label class="field inline-check"><input type="checkbox" data-action-reminder="${a.id}" ${a.reminderDaily ? "checked" : ""}/> <span>Rappel e-mail quotidien à 9h tant que l'action est ouverte</span></label>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="inline"><span class="grow"><strong>Statut :</strong> ${a.closed ? "Close" : "Ouverte"}</span>
        ${a.closed
          ? `<button class="btn secondary small" data-reopen-action="${a.id}">Rouvrir</button>`
          : `<button class="btn small" data-close-action="${a.id}">Clore l'action</button>`}</div>
      <div class="muted" style="font-size:12px;margin-top:6px">${a.closed && a.closedAt ? `Close le ${fmtDate(new Date(a.closedAt).toISOString().slice(0, 10))}.` : (a.reminderDaily ? "Un rappel est envoyé chaque matin à 9h au destinataire (script Google)." : "Rappel quotidien désactivé.")}</div>
    </div>
    <div style="margin-top:18px"><button class="btn danger small" data-del-action="${a.id}">Supprimer l'action</button></div>`;
}

// ----------------------------- Rendez-vous -----------------------------
function rdvWhen(r) {
  if (!r.date) return "Date à définir";
  return fmtDate(r.date) + (r.time ? ` · ${r.time}` : "");
}
function renderRendezvous() {
  if (view.detailId) return renderRendezvousDetail(view.detailId);
  const today = todayISO();
  const sorted = [...state.rendezvous].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.time || "").localeCompare(b.time || ""));
  const upcoming = sorted.filter((r) => (r.date || "9999") >= today);
  const past = sorted.filter((r) => (r.date || "0") < today).reverse();
  const card = (r) => {
    const who = r.withName || (r.contactId ? contactName(state.contacts.find((c) => c.id === r.contactId) || {}) : "");
    const sub = [who, r.location ? `📍 ${esc(r.location)}` : null, r.missionId ? esc(missionTitle(r.missionId)) : null].filter(Boolean).join(" · ");
    return `<div class="row" data-open-rdv="${r.id}" style="border-left-color:var(--primary)">
      <div class="grow"><div class="r-title">${esc(r.title || "Rendez-vous")}</div>
        <div class="r-sub">${esc(rdvWhen(r))}${sub ? ` · ${sub}` : ""}</div></div>
      <span class="muted">›</span></div>`;
  };
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Rendez-vous</div>
      <button class="btn" data-add-rdv>+ Nouveau rendez-vous</button></div>
    <div class="section-h">À venir <span class="muted">(${upcoming.length})</span></div>
    <div class="list">${upcoming.length ? upcoming.map(card).join("") : '<div class="muted" style="padding:4px 2px">Aucun rendez-vous à venir.</div>'}</div>
    ${past.length ? `<div class="section-h">Passés <span class="muted">(${past.length})</span></div><div class="list">${past.map(card).join("")}</div>` : ""}
    <button class="btn fab" data-add-rdv>+</button>`;
}
function renderRendezvousDetail(id) {
  const r = state.rendezvous.find((x) => x.id === id);
  if (!r) { view.detailId = null; return renderRendezvous(); }
  const ctOpts = ['<option value="">— Saisie libre —</option>'].concat(
    state.contacts.map((c) => `<option value="${c.id}" ${c.id === r.contactId ? "selected" : ""}>${esc(contactName(c))}</option>`)
  ).join("");
  return `<button class="back" data-back-rdv>‹ Rendez-vous</button>
    <div class="page-title">${esc(r.title || "Rendez-vous")}</div>
    <div class="card">
      <label class="field"><span>Objet</span><input data-bind="rendezvous|${r.id}|title" value="${esc(r.title)}" placeholder="Ex. Point mensuel"/></label>
      <label class="field"><span>Date</span><input type="date" data-bind="rendezvous|${r.id}|date" value="${esc(r.date || "")}"/></label>
      <label class="field"><span>Heure</span><input type="time" data-bind="rendezvous|${r.id}|time" value="${esc(r.time || "")}"/></label>
      <label class="field"><span>Lieu / lien</span><input data-bind="rendezvous|${r.id}|location" value="${esc(r.location)}" placeholder="Adresse, visio…"/></label>
      <label class="field"><span>Avec (contact)</span><select data-rdv-contact="${r.id}" data-rerender>${ctOpts}</select></label>
      <label class="field"><span>Avec (libre)</span><input data-bind="rendezvous|${r.id}|withName" value="${esc(r.withName)}"/></label>
      <label class="field"><span>Mission / projet</span>${missionSelect(`rendezvous|${r.id}|missionId`, r.missionId)}</label>
      <label class="field"><span>Notes</span><textarea data-bind="rendezvous|${r.id}|notes">${esc(r.notes)}</textarea></label>
    </div>
    <div style="margin-top:18px"><button class="btn danger small" data-del-rdv="${r.id}">Supprimer le rendez-vous</button></div>`;
}

// ----------------------------- Planning (agenda consolidé) -----------------------------
function planningEvents() {
  const ev = [];
  state.tasks.forEach((t) => {
    if (!t.dueDate || (t.status || "aFaire") === "termine") return;
    ev.push({ date: t.dueDate, time: "", kind: "Tâche", ic: "✅", title: t.title || "Tâche", color: deadlineColor(daysUntil(t.dueDate)), section: "tasks", detailId: null });
  });
  state.actions.forEach((a) => {
    if (!a.dueDate || a.closed) return;
    ev.push({ date: a.dueDate, time: "", kind: "Action", ic: "🎫", title: a.title || "Action", color: deadlineColor(daysUntil(a.dueDate)), section: "actions", detailId: a.id });
  });
  state.rendezvous.forEach((r) => {
    if (!r.date) return;
    ev.push({ date: r.date, time: r.time || "", kind: "RDV", ic: "📅", title: r.title || "Rendez-vous", color: "var(--primary)", section: "rendezvous", detailId: r.id });
  });
  return ev.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
}
function renderPlanning() {
  const today = todayISO();
  const all = planningEvents();
  const overdue = all.filter((e) => e.date < today);
  const upcoming = all.filter((e) => e.date >= today);
  const evRow = (e) => {
    const extra = [e.time || null, e.kind].filter(Boolean).join(" · ");
    return `<div class="row" data-plan-open="${e.section}" data-plan-id="${e.detailId || ""}" style="border-left-color:${e.color}">
      <span class="ic">${e.ic}</span>
      <div class="grow"><div class="r-title">${esc(e.title)}</div><div class="r-sub">${esc(extra)}</div></div></div>`;
  };
  // Regroupement des à-venir par date
  let groupsHtml = "";
  let curDate = null, buf = [];
  const flush = () => { if (buf.length) { groupsHtml += `<div class="plan-day">${esc(fmtDate(curDate))}${curDate === today ? " · aujourd'hui" : ""}</div><div class="list">${buf.join("")}</div>`; buf = []; } };
  upcoming.forEach((e) => { if (e.date !== curDate) { flush(); curDate = e.date; } buf.push(evRow(e)); });
  flush();
  const overdueHtml = overdue.length
    ? `<div class="section-h" style="color:#d23c3c">En retard <span class="muted">(${overdue.length})</span></div><div class="list">${overdue.map(evRow).join("")}</div>`
    : "";
  const empty = !all.length ? '<div class="center-empty">Rien de planifié.<br>Ajoute des échéances aux tâches/actions ou crée des rendez-vous.</div>' : "";
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Planning</div>
      <button class="btn" data-add-rdv>+ Rendez-vous</button></div>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Échéances des tâches et des actions ouvertes, et rendez-vous — par ordre chronologique.</div>
    ${empty}${overdueHtml}
    ${upcoming.length ? `<div class="section-h">À venir <span class="muted">(${upcoming.length})</span></div>${groupsHtml}` : ""}`;
}

// ----------------------------- Interactions -----------------------------
function findMission(id) { return state.missions.find((m) => m.id === id); }
function findEntry(m, id) { return (m.entries || []).find((e) => e.id === id); }

function wire() {
  const c = document.getElementById("content");

  // liaison générique des champs top-niveau : data-bind="collection|id|field"
  c.querySelectorAll("[data-bind]").forEach((el) => {
    const [coll, id, field] = el.dataset.bind.split("|");
    const h = () => { const o = (state[coll] || []).find((x) => x.id === id); if (!o) return; o[field] = el.type === "number" ? (parseFloat(el.value) || 0) : el.value; save(); if (el.dataset.rerender !== undefined) render(); };
    el.addEventListener("change", h); el.addEventListener("blur", h);
  });

  // ouvertures
  c.querySelectorAll("[data-open-mission]").forEach((r) => r.onclick = () => openDetail("missions", r.dataset.openMission));
  c.querySelectorAll("[data-open-contact]").forEach((r) => r.onclick = () => openDetail("contacts", r.dataset.openContact));
  c.querySelectorAll("[data-open-company]").forEach((r) => r.onclick = () => openDetail("groupe", r.dataset.openCompany));
  c.querySelectorAll("[data-open-invoice]").forEach((r) => r.onclick = () => openDetail("finances", r.dataset.openInvoice));
  const back = c.querySelector("[data-back]"); if (back) back.onclick = () => { view.detailId = null; render(); };
  const backInv = c.querySelector("[data-back-invoice]"); if (backInv) backInv.onclick = () => { view.detailId = null; render(); };

  // ajouts
  c.querySelectorAll("[data-add-mission]").forEach((b) => b.onclick = () => { const m = { id: uid(), title: "", statusCode: "aDemarrer", companyId: null, createdAt: Date.now(), entries: [] }; state.missions.push(m); save(); openDetail("missions", m.id); });
  c.querySelectorAll("[data-add-contact]").forEach((b) => b.onclick = () => { const x = { id: uid(), firstName: "", lastName: "", organization: "", jobTitle: "", email: "", phone: "", address: "", linkedIn: "", category: "client", notes: "", companyId: null }; state.contacts.push(x); save(); openDetail("contacts", x.id); });
  c.querySelectorAll("[data-add-company]").forEach((b) => b.onclick = () => { const x = { id: uid(), name: "", legalForm: "", role: "filiale", notes: "", initialCashBalance: 0, cashBalanceDate: todayISO(), activities: [] }; state.companies.push(x); save(); openDetail("groupe", x.id); });
  c.querySelectorAll("[data-add-invoice]").forEach((b) => b.onclick = () => { const x = { id: uid(), title: "", reference: "", direction: "recette", status: "aEmettre", amount: 0, vatRate: 20, startDate: todayISO(), hasDueDate: false, dueDate: "", paymentDate: "", companyId: null, contactId: null, categoryName: "" }; state.invoices.push(x); save(); openDetail("finances", x.id); });

  // suppressions
  c.querySelectorAll("[data-del-mission]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette mission ?")) { state.missions = state.missions.filter((m) => m.id !== b.dataset.delMission); save(); go("missions"); } });
  c.querySelectorAll("[data-del-contact]").forEach((b) => b.onclick = () => { if (confirm("Supprimer ce contact ?")) { state.contacts = state.contacts.filter((x) => x.id !== b.dataset.delContact); save(); go("contacts"); } });
  c.querySelectorAll("[data-del-company]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette société ?")) { state.companies = state.companies.filter((x) => x.id !== b.dataset.delCompany); save(); go("groupe"); } });
  c.querySelectorAll("[data-del-invoice]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette facture ?")) { state.invoices = state.invoices.filter((x) => x.id !== b.dataset.delInvoice); save(); view.detailId = null; go("finances"); } });

  // activités (société)
  c.querySelectorAll("[data-add-act]").forEach((b) => b.onclick = () => { const co = state.companies.find((x) => x.id === b.dataset.addAct); if (!co) return; (co.activities = co.activities || []).push({ id: uid(), name: "", detail: "" }); save(); render(); });
  c.querySelectorAll("[data-del-act]").forEach((b) => b.onclick = () => { const co = state.companies.find((x) => x.id === b.dataset.c); if (!co) return; co.activities = (co.activities || []).filter((a) => a.id !== b.dataset.delAct); save(); render(); });
  c.querySelectorAll("[data-actfield]").forEach((el) => { const h = () => { const co = state.companies.find((x) => x.id === el.dataset.c); const a = (co.activities || []).find((z) => z.id === el.dataset.a); if (a) { a[el.dataset.actfield] = el.value; save(); } }; el.addEventListener("change", h); el.addEventListener("blur", h); });

  // onglets Finances
  c.querySelectorAll("[data-ftab]").forEach((b) => b.onclick = () => { financeTab = b.dataset.ftab; render(); });

  // catégories
  c.querySelectorAll("[data-add-cat]").forEach((b) => b.onclick = () => { ensureCatIds(); state.categories.push({ id: uid(), name: "", nature: b.dataset.addCat, sortIndex: state.categories.length }); save(); render(); });
  c.querySelectorAll("[data-del-cat]").forEach((b) => b.onclick = () => {
    const cat = state.categories.find((x) => x.id === b.dataset.delCat); if (!cat) return;
    const used = catUsage(cat.name);
    if (!confirm(`Supprimer la catégorie « ${cat.name || "sans nom"} » ?${used ? `\n${used} facture(s) l'utilisent : elles repasseront « à catégoriser ».` : ""}`)) return;
    if (used) state.invoices.forEach((v) => { if (v.categoryName === cat.name) v.categoryName = ""; });
    state.categories = state.categories.filter((x) => x.id !== b.dataset.delCat); save(); render();
  });
  c.querySelectorAll("[data-catfield]").forEach((el) => {
    const h = () => {
      const cat = state.categories.find((x) => x.id === el.dataset.cat); if (!cat) return;
      const field = el.dataset.catfield;
      if (field === "name") {
        const oldName = el.dataset.old, newName = el.value.trim();
        if (newName && newName !== oldName) state.invoices.forEach((v) => { if (v.categoryName === oldName) v.categoryName = newName; });
        cat.name = newName; el.dataset.old = newName; save();
      } else { cat.nature = el.value; save(); render(); }
    };
    el.addEventListener("change", h); el.addEventListener("blur", h);
  });

  // exports PDF / CSV
  const onclick = (sel, fn) => c.querySelectorAll(sel).forEach((b) => b.onclick = fn);
  onclick("[data-export-cdr]", () => printReport("Operations01 - Compte de resultat", "Compte de résultat", reportCDR()));
  onclick("[data-export-treso]", () => printReport("Operations01 - Tresorerie", "Trésorerie", reportTresorerie()));
  onclick("[data-export-dashboard]", () => printReport("Operations01 - Tableau de bord", "Tableau de bord", reportDashboard()));
  onclick("[data-export-temps-pdf]", () => printReport("Operations01 - Suivi du temps", "Suivi du temps (semaine)", reportTemps()));
  onclick("[data-export-temps-csv]", exportTempsCSV);
  onclick("[data-export-factures]", exportFacturesCSV);

  // import bancaire
  const bankComp = c.querySelector("#bankCompany"); if (bankComp) bankComp.onchange = () => { bankImport.companyId = bankComp.value; };
  const bankFile = c.querySelector("#bankFile"); if (bankFile) bankFile.onchange = () => {
    const f = bankFile.files && bankFile.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let text; const buf = r.result;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
      catch (e) { try { text = new TextDecoder("windows-1252").decode(buf); } catch (e2) { text = new TextDecoder().decode(buf); } }
      bankImport.rows = parseBankFile(text, f.name); bankImport.fileName = f.name;
      if (!bankImport.rows.length) alert("Aucune opération détectée. Vérifie que le fichier est bien un relevé au format CSV ou OFX.");
      render();
    };
    r.readAsArrayBuffer(f);
  };
  const bankClear = c.querySelector("[data-bank-clear]"); if (bankClear) bankClear.onclick = () => { bankImport.rows = []; bankImport.fileName = ""; render(); };
  const bankImp = c.querySelector("[data-bank-import]"); if (bankImp) bankImp.onclick = doBankImport;

  // import / export / reset
  c.querySelectorAll("[data-import]").forEach((b) => b.onclick = importClick);
  c.querySelectorAll("[data-export]").forEach((b) => b.onclick = exportJSON);
  c.querySelectorAll("[data-reset]").forEach((b) => b.onclick = () => { if (confirm("Effacer TOUTES les données de la web app ? (irréversible)")) { state = blankState(); save(); go("missions"); } });

  // entrées d'historique
  c.querySelectorAll("[data-add-entry]").forEach((b) => b.onclick = () => { const m = findMission(b.dataset.m); if (!m) return; m.entries.push({ id: uid(), kind: b.dataset.addEntry, title: "", content: "", date: todayISO(), url: "", accumulatedSeconds: 0, timerStartedAt: null, createdAt: Date.now(), _open: true }); save(); render(); });
  c.querySelectorAll("[data-toggle]").forEach((h) => h.onclick = (ev) => { if (ev.target.closest("a,button,input,select,textarea")) return; const m = findMission(h.dataset.m); const e = findEntry(m, h.dataset.toggle); if (e) { e._open = !e._open; render(); } });
  c.querySelectorAll("[data-efield]").forEach((el) => { const h = () => { const m = findMission(el.dataset.m); const e = findEntry(m, el.dataset.e); if (!e) return; e[el.dataset.efield] = el.value; save(); if (el.dataset.efield === "kind") render(); }; el.addEventListener("change", h); el.addEventListener("blur", h); });
  c.querySelectorAll("[data-timer]").forEach((b) => b.onclick = () => { const m = findMission(b.dataset.m); const e = findEntry(m, b.dataset.timer); if (!e) return; if (e.timerStartedAt) { e.accumulatedSeconds = (e.accumulatedSeconds || 0) + (Date.now() - e.timerStartedAt) / 1000; e.timerStartedAt = null; } else { e.timerStartedAt = Date.now(); } save(); render(); });
  c.querySelectorAll("[data-del-entry]").forEach((b) => b.onclick = () => { const m = findMission(b.dataset.m); if (!m) return; m.entries = m.entries.filter((e) => e.id !== b.dataset.delEntry); save(); render(); });

  // Tâches
  c.querySelectorAll("[data-add-task]").forEach((b) => b.onclick = () => { state.tasks.push({ id: uid(), title: "", status: "aFaire", missionId: null, dueDate: "", createdAt: Date.now() }); save(); render(); });
  c.querySelectorAll("[data-taskfield]").forEach((el) => { const h = () => { const t = state.tasks.find((x) => x.id === el.dataset.t); if (t) { t[el.dataset.taskfield] = el.value; save(); } }; el.addEventListener("change", h); el.addEventListener("blur", h); });
  c.querySelectorAll("[data-taskdue]").forEach((el) => el.onchange = () => { const t = state.tasks.find((x) => x.id === el.dataset.taskdue); if (t) { t.dueDate = el.value; save(); render(); } });
  c.querySelectorAll("[data-task-status]").forEach((sel) => sel.onchange = () => { const t = state.tasks.find((x) => x.id === sel.dataset.taskStatus); if (t) { t.status = sel.value; save(); render(); } });
  c.querySelectorAll("[data-del-task]").forEach((b) => b.onclick = () => { state.tasks = state.tasks.filter((t) => t.id !== b.dataset.delTask); save(); render(); });

  // Actions (tickets)
  c.querySelectorAll("[data-open-action]").forEach((r) => r.onclick = () => openDetail("actions", r.dataset.openAction));
  const backAct = c.querySelector("[data-back-action]"); if (backAct) backAct.onclick = () => { view.detailId = null; render(); };
  c.querySelectorAll("[data-add-action]").forEach((b) => b.onclick = () => { const x = { id: uid(), title: "", projectName: "", missionId: null, request: "", contactId: null, recipientName: "", recipientEmail: "", dueDate: "", reminderDaily: true, closed: false, closedAt: null, createdAt: Date.now() }; state.actions.push(x); save(); openDetail("actions", x.id); });
  c.querySelectorAll("[data-action-contact]").forEach((sel) => sel.onchange = () => { const a = state.actions.find((x) => x.id === sel.dataset.actionContact); if (!a) return; a.contactId = sel.value || null; const ct = state.contacts.find((x) => x.id === a.contactId); if (ct) { a.recipientName = contactName(ct); if (ct.email) a.recipientEmail = ct.email; } save(); render(); });
  c.querySelectorAll("[data-action-reminder]").forEach((cb) => cb.onchange = () => { const a = state.actions.find((x) => x.id === cb.dataset.actionReminder); if (a) { a.reminderDaily = cb.checked; save(); render(); } });
  c.querySelectorAll("[data-close-action]").forEach((b) => b.onclick = () => { const a = state.actions.find((x) => x.id === b.dataset.closeAction); if (a) { a.closed = true; a.closedAt = Date.now(); save(); render(); } });
  c.querySelectorAll("[data-reopen-action]").forEach((b) => b.onclick = () => { const a = state.actions.find((x) => x.id === b.dataset.reopenAction); if (a) { a.closed = false; a.closedAt = null; save(); render(); } });
  c.querySelectorAll("[data-del-action]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette action ?")) { state.actions = state.actions.filter((x) => x.id !== b.dataset.delAction); save(); view.detailId = null; go("actions"); } });

  // Rendez-vous
  c.querySelectorAll("[data-open-rdv]").forEach((r) => r.onclick = () => openDetail("rendezvous", r.dataset.openRdv));
  const backRdv = c.querySelector("[data-back-rdv]"); if (backRdv) backRdv.onclick = () => { view.detailId = null; render(); };
  c.querySelectorAll("[data-add-rdv]").forEach((b) => b.onclick = () => { const x = { id: uid(), title: "", date: todayISO(), time: "", location: "", contactId: null, withName: "", missionId: null, notes: "", createdAt: Date.now() }; state.rendezvous.push(x); save(); openDetail("rendezvous", x.id); });
  c.querySelectorAll("[data-rdv-contact]").forEach((sel) => sel.onchange = () => { const r = state.rendezvous.find((x) => x.id === sel.dataset.rdvContact); if (!r) return; r.contactId = sel.value || null; const ct = state.contacts.find((x) => x.id === r.contactId); if (ct) r.withName = contactName(ct); save(); render(); });
  c.querySelectorAll("[data-del-rdv]").forEach((b) => b.onclick = () => { if (confirm("Supprimer ce rendez-vous ?")) { state.rendezvous = state.rendezvous.filter((x) => x.id !== b.dataset.delRdv); save(); view.detailId = null; go("rendezvous"); } });

  // Planning : ouvrir l'élément dans sa section
  c.querySelectorAll("[data-plan-open]").forEach((r) => r.onclick = () => { const sec = r.dataset.planOpen, id = r.dataset.planId; if (id) openDetail(sec, id); else go(sec); });
}

// ----------------------------- Import / Export -----------------------------
function normStatus(c) { return STATUSES.some((s) => s.code === c) ? c : "aDemarrer"; }
function normKind(c) { return KINDS.some((k) => k.code === c) ? c : "note"; }
function importClick() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importJSON(String(r.result)); r.readAsText(f); };
  inp.click();
}
function importJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { alert("Fichier JSON invalide."); return; }
  if (Array.isArray(data)) data = { missions: data };
  const replace = confirm("Remplacer TOUTES les données actuelles par ce fichier ?\n\n(OK = remplacer · Annuler = ajouter aux données existantes)");
  if (replace) state = blankState();

  const compByName = {};
  (data.companies || []).forEach((c) => {
    const m = { id: uid(), name: c.name || "", legalForm: c.legalForm || "", role: c.role || "filiale", notes: c.notes || "", initialCashBalance: Number(c.initialCashBalance) || 0, cashBalanceDate: (c.cashBalanceDate || "").slice(0, 10) || todayISO(), activities: (c.activities || []).map((a) => ({ id: uid(), name: a.name || "", detail: a.detail || "" })) };
    state.companies.push(m); if (m.name) compByName[m.name] = m.id;
  });
  (data.categories || []).forEach((c) => { if (c.name && !state.categories.some((x) => x.name === c.name)) state.categories.push({ name: c.name, nature: c.nature === "produit" ? "produit" : "charge", sortIndex: Number(c.sortIndex) || 0 }); });
  (data.contacts || []).forEach((c) => state.contacts.push({ id: uid(), firstName: c.firstName || "", lastName: c.lastName || "", organization: c.organization || "", jobTitle: c.jobTitle || "", email: c.email || "", phone: c.phone || "", address: c.address || "", linkedIn: c.linkedIn || "", category: (CONTACT_CATS.some((x) => x.code === c.category) ? c.category : "client"), notes: c.notes || "", companyId: compByName[c.companyName] || null }));
  const contactByName = {}; state.contacts.forEach((c) => { contactByName[contactName(c)] = c.id; });
  (data.invoices || []).forEach((v) => state.invoices.push({ id: uid(), title: v.title || "", reference: v.reference || "", direction: v.direction === "depense" ? "depense" : "recette", status: (INV_STATUSES.some((x) => x.code === v.status) ? v.status : "aEmettre"), amount: Number(v.amount) || 0, vatRate: v.vatRate == null ? 20 : Number(v.vatRate), startDate: (v.startDate || "").slice(0, 10) || todayISO(), hasDueDate: !!v.hasDueDate, dueDate: (v.dueDate || "").slice(0, 10), paymentDate: (v.paymentDate || "").slice(0, 10), companyId: compByName[v.companyName] || null, contactId: contactByName[v.contactName] || null, categoryName: v.categoryName || "" }));
  const missionByTitle = {};
  (data.missions || []).forEach((m) => { const nm = { id: uid(), title: m.title || "", statusCode: normStatus(m.statusCode || m.status), companyId: compByName[m.companyName] || null, createdAt: Date.now(), entries: (m.entries || []).map((e) => ({ id: uid(), kind: normKind(e.kind), title: e.title || "", content: e.content || "", date: (e.date || "").slice(0, 10) || todayISO(), url: e.url || e.urlString || "", accumulatedSeconds: Number(e.accumulatedSeconds) || 0, timerStartedAt: null, createdAt: Date.now() })) }; state.missions.push(nm); if (nm.title) missionByTitle[nm.title] = nm.id; });
  (data.tasks || []).forEach((t) => state.tasks.push({ id: uid(), title: t.title || "", status: (TASK_STATUSES.some((s) => s.code === t.status) ? t.status : "aFaire"), missionId: missionByTitle[t.missionTitle] || null, dueDate: (t.dueDate || "").slice(0, 10), createdAt: Date.now() }));
  (data.actions || []).forEach((a) => state.actions.push({ id: uid(), title: a.title || "", projectName: a.projectName || "", missionId: missionByTitle[a.missionTitle] || null, request: a.request || "", contactId: null, recipientName: a.recipientName || "", recipientEmail: a.recipientEmail || "", dueDate: (a.dueDate || "").slice(0, 10), reminderDaily: a.reminderDaily !== false, closed: !!a.closed, closedAt: a.closedAt || null, createdAt: Date.now() }));
  (data.rendezvous || []).forEach((r) => state.rendezvous.push({ id: uid(), title: r.title || "", date: (r.date || "").slice(0, 10), time: r.time || "", location: r.location || "", contactId: null, withName: r.withName || "", missionId: missionByTitle[r.missionTitle] || null, notes: r.notes || "", createdAt: Date.now() }));

  save();
  alert(`Import terminé : ${state.companies.length} société(s), ${state.contacts.length} contact(s), ${state.invoices.length} facture(s), ${state.missions.length} mission(s).`);
  go("dashboard");
}
function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "operations01-data.json"; a.click(); URL.revokeObjectURL(a.href);
}

// ----------------------------- Google Drive -----------------------------
function renderDriveBar() {
  const el = document.getElementById("driveBar"); if (!el) return;
  const cfgOk = window.OPERATIONS01_CONFIG && OPERATIONS01_CONFIG.googleClientId;
  if (!cfgOk) { el.innerHTML = `<div class="muted" style="font-size:11px;line-height:1.4">Google Drive non configuré.<br>Voir README → « Google Drive ».</div>`; return; }
  if (window.DriveSync && DriveSync.isConnected()) {
    el.innerHTML = `<div style="font-size:12px">☁︎ <strong>Drive</strong> · <span id="driveStatus" class="muted">synchronisé</span></div>
      <button class="btn ghost small" id="driveBackups" style="width:100%;margin-top:6px">🛟 Sauvegardes</button>`;
    const b = document.getElementById("driveBackups"); if (b) b.onclick = openBackups;
  }
  else { el.innerHTML = `<button class="btn secondary small" id="driveConnect" style="width:100%">Se connecter à Google Drive</button>`; const b = document.getElementById("driveConnect"); if (b) b.onclick = connectDrive; }
}
// ---- Panneau Sauvegardes ----
function closeModal() { const m = document.getElementById("modalOverlay"); if (m) m.remove(); }
function showModal(html) {
  closeModal();
  const ov = document.createElement("div");
  ov.id = "modalOverlay"; ov.className = "modal-overlay";
  ov.innerHTML = `<div class="modal">${html}</div>`;
  ov.addEventListener("click", (e) => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  return ov;
}
async function openBackups() {
  showModal(`<div class="modal-head"><strong class="grow">Sauvegardes Google Drive</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <div class="muted" style="font-size:12px;margin-bottom:10px">Une sauvegarde automatique est créée chaque jour. Tu peux en restaurer une, ou en créer une maintenant.</div>
    <div class="inline" style="margin-bottom:10px"><button class="btn small" data-backup-now>Sauvegarder maintenant</button></div>
    <div id="backupList" class="muted" style="font-size:13px">Chargement…</div>`);
  document.querySelector("[data-modal-close]").onclick = closeModal;
  document.querySelector("[data-backup-now]").onclick = async () => {
    try { await DriveSync.backupNow(state); await refreshBackupList(); } catch (e) { alert("Sauvegarde impossible : " + e.message); }
  };
  refreshBackupList();
}
async function refreshBackupList() {
  const box = document.getElementById("backupList"); if (!box) return;
  try {
    const files = await DriveSync.listBackups();
    if (!files.length) { box.innerHTML = "Aucune sauvegarde pour l'instant."; return; }
    box.innerHTML = files.map((f) => {
      const conflict = f.name.indexOf("conflit") > -1;
      const when = f.modifiedTime ? new Date(f.modifiedTime).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "";
      return `<div class="row" style="cursor:default;border-left-color:${conflict ? "var(--alert)" : "var(--primary)"}">
        <div class="grow"><div class="r-title" style="font-size:13px">${conflict ? "⚠️ Conflit" : "🛟 Sauvegarde"} · ${esc(when)}</div>
          <div class="r-sub" style="font-size:11px">${esc(f.name)}</div></div>
        <button class="btn ghost small" data-restore="${f.id}">Restaurer</button></div>`;
    }).join("");
    box.querySelectorAll("[data-restore]").forEach((b) => b.onclick = async () => {
      if (!confirm("Restaurer cette sauvegarde ? Les données actuelles seront remplacées (une sauvegarde de sécurité est créée avant).")) return;
      try {
        await DriveSync.backupNow(state); // filet de sécurité avant restauration
        const restored = await DriveSync.restore(b.dataset.restore);
        state = Object.assign(blankState(), restored);
        save(); closeModal(); go("dashboard");
        alert("Sauvegarde restaurée.");
      } catch (e) { alert("Restauration impossible : " + e.message); }
    });
  } catch (e) { box.innerHTML = "Impossible de charger les sauvegardes : " + esc(e.message); }
}
async function connectDrive() {
  if (!(window.DriveSync && DriveSync.ready())) { alert("Google Drive n'est pas disponible (identifiant manquant ou app non hébergée en HTTPS)."); return; }
  try {
    const remote = await DriveSync.connect();
    if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) { state = Object.assign(blankState(), remote); localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    else DriveSync.push(state);
    renderDriveBar(); render();
  } catch (e) { alert("Connexion Google Drive impossible : " + e.message); }
}

// ----------------------------- Exports (PDF via impression + CSV) -----------------------------
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 210" width="150" height="49" role="img" aria-label="choice">
  <defs><linearGradient id="choiceGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#0FB6D8"/><stop offset="0.5" stop-color="#7FC96B"/><stop offset="1" stop-color="#F2D64B"/></linearGradient></defs>
  <text x="8" y="165" font-family="'Baloo 2','Quicksand','Nunito','Segoe UI',Helvetica,Arial,sans-serif" font-weight="800" font-size="200" fill="url(#choiceGrad)">choice</text></svg>`;
function reportHeader(subtitle) {
  const d = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  return `<div class="rep-head"><div>${LOGO_SVG}</div>
    <div style="flex:1"></div>
    <div style="text-align:right"><div class="rep-title">${esc(subtitle)}</div><div class="rep-date">Édité le ${d} · Operations01</div></div></div>`;
}
function printReport(fileTitle, subtitle, bodyHtml) {
  let pa = document.getElementById("printArea");
  if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); }
  pa.innerHTML = reportHeader(subtitle) + bodyHtml;
  const prev = document.title; document.title = fileTitle;
  const restore = () => { document.title = prev; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  window.print();
}
const repNum = (v) => euros(v);
function cdrLines(nature) {
  const map = {};
  state.invoices.filter((v) => invNature(v) === nature).forEach((v) => { const k = v.categoryName || "À catégoriser"; map[k] = (map[k] || 0) + (v.amount || 0); });
  return Object.entries(map).filter(([, val]) => val !== 0).sort((a, b) => b[1] - a[1]);
}
function reportCDR() {
  const produits = cdrLines("produit"), charges = cdrLines("charge");
  const totP = produits.reduce((t, l) => t + l[1], 0), totC = charges.reduce((t, l) => t + l[1], 0);
  const tbl = (title, arr, tot) => `<div class="rep-section">${title}</div>
    <table class="rep-table"><thead><tr><th>Catégorie</th><th class="num">Montant HT</th></tr></thead><tbody>
    ${arr.length ? arr.map((l) => `<tr><td>${esc(l[0])}</td><td class="num">${repNum(l[1])}</td></tr>`).join("") : '<tr><td colspan="2">—</td></tr>'}
    <tr class="rep-total"><td>Total ${title.toLowerCase()}</td><td class="num">${repNum(tot)}</td></tr></tbody></table>`;
  return tbl("Produits", produits, totP) + tbl("Charges", charges, totC) +
    `<table class="rep-table"><tbody><tr class="rep-total"><td>Résultat à date (produits − charges)</td><td class="num">${repNum(totP - totC)}</td></tr></tbody></table>
     <div class="rep-date">Montants HT, toutes factures confondues.</div>`;
}
function reportTresorerie() {
  const now = new Date();
  const ents = treasuryEntities();
  const rows = ents.map((c) => `<tr><td>${esc(c.name || "Sans nom")}</td><td class="num">${repNum(companyBalance(c, now))}</td></tr>`).join("");
  return `<table class="rep-table"><tbody>
      <tr class="rep-total"><td>Trésorerie consolidée (aujourd'hui)</td><td class="num">${repNum(treasuryNow(now))}</td></tr></tbody></table>
    <div class="rep-section">Prévisionnel</div>
    <table class="rep-table"><tbody>
      <tr><td>À 30 jours</td><td class="num">${repNum(treasuryProjected(now, 30))}</td></tr>
      <tr><td>À 60 jours</td><td class="num">${repNum(treasuryProjected(now, 60))}</td></tr>
      <tr><td>À 90 jours</td><td class="num">${repNum(treasuryProjected(now, 90))}</td></tr></tbody></table>
    <div class="rep-section">Par société</div>
    <table class="rep-table"><thead><tr><th>Société</th><th class="num">Solde</th></tr></thead><tbody>${rows || '<tr><td colspan="2">—</td></tr>'}</tbody></table>`;
}
function reportTemps() {
  const { start, end } = weekInterval(new Date());
  let total = 0; const per = [];
  state.missions.forEach((m) => { let s = 0; (m.entries || []).forEach((e) => { const d = e.date ? new Date(e.date + "T12:00:00") : null; if (d && d >= start && d < end) s += entryElapsed(e); }); if (s > 0) { per.push({ t: m.title || "Sans titre", s }); total += s; } });
  per.sort((a, b) => b.s - a.s);
  const rows = per.map((p) => `<tr><td>${esc(p.t)}</td><td class="num">${(p.s / 3600).toFixed(2).replace(".", ",")}</td><td class="num">${fmtDuration(p.s)}</td></tr>`).join("");
  return `<div class="rep-date">Semaine du ${fmtDate(start.toISOString().slice(0, 10))} au ${fmtDate(new Date(end - 86400000).toISOString().slice(0, 10))}</div>
    <table class="rep-table"><thead><tr><th>Mission</th><th class="num">Heures</th><th class="num">Durée</th></tr></thead><tbody>
    ${rows || '<tr><td colspan="3">Aucun temps cette semaine.</td></tr>'}
    <tr class="rep-total"><td>Total</td><td class="num">${(total / 3600).toFixed(2).replace(".", ",")}</td><td class="num">${fmtDuration(total)}</td></tr></tbody></table>`;
}
function reportDashboard() {
  const now = new Date();
  const caFacture = sumAmount(recettes().filter((v) => v.status === "emise" || v.status === "payee"));
  const caEncaisse = sumAmount(recettes().filter((v) => v.status === "payee"));
  const produits = state.invoices.filter((v) => invNature(v) === "produit").reduce((t, v) => t + (v.amount || 0), 0);
  const charges = state.invoices.filter((v) => invNature(v) === "charge").reduce((t, v) => t + (v.amount || 0), 0);
  const line = (k, v) => `<tr><td>${k}</td><td class="num">${v}</td></tr>`;
  return `<div class="rep-section">Activité (HT)</div><table class="rep-table"><tbody>
      ${line("CA facturé (émises + payées)", repNum(caFacture))}${line("CA encaissé (payées)", repNum(caEncaisse))}
      ${line("Produits", repNum(produits))}${line("Charges", repNum(charges))}
      <tr class="rep-total"><td>Résultat à date</td><td class="num">${repNum(produits - charges)}</td></tr></tbody></table>
    <div class="rep-section">Trésorerie (TTC)</div><table class="rep-table"><tbody>
      ${line("Disponible aujourd'hui", repNum(treasuryNow(now)))}${line("Prévisionnel 30 j", repNum(treasuryProjected(now, 30)))}
      ${line("Prévisionnel 60 j", repNum(treasuryProjected(now, 60)))}${line("Prévisionnel 90 j", repNum(treasuryProjected(now, 90)))}</tbody></table>
    <div class="rep-section">Structure</div><table class="rep-table"><tbody>
      ${line("Sociétés", state.companies.length)}${line("Contacts", state.contacts.length)}
      ${line("Missions en cours", state.missions.filter((m) => m.statusCode === "enCours").length)}</tbody></table>`;
}
// --- CSV ---
function csvCell(s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; }
const csvNum = (v) => (+v || 0).toFixed(2).replace(".", ",");
function downloadFile(name, content, type) { const blob = new Blob([content], { type }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
function contactNameById(id) { const c = state.contacts.find((x) => x.id === id); return c ? contactName(c) : ""; }
function exportFacturesCSV() {
  const H = ["Date", "Intitulé", "Société", "Catégorie", "Nature", "Sens", "Statut", "Montant HT", "TVA %", "Montant TTC", "Échéance", "Payée le", "Tiers"];
  const rows = [...state.invoices].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || "")).map((v) => [
    v.startDate || "", v.title || "", companyName(v.companyId), v.categoryName || "", invNature(v), v.direction === "recette" ? "Recette" : "Dépense", invStatusLabel(v.status),
    csvNum(v.amount), v.vatRate == null ? "" : v.vatRate, csvNum(invTTC(v)), v.dueDate || "", v.paymentDate || "", contactNameById(v.contactId)]);
  const csv = "﻿" + [H, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  downloadFile("operations01-factures.csv", csv, "text/csv;charset=utf-8");
}
function exportTempsCSV() {
  const { start, end } = weekInterval(new Date());
  const H = ["Mission", "Heures", "Durée"];
  const rows = [];
  state.missions.forEach((m) => { let s = 0; (m.entries || []).forEach((e) => { const d = e.date ? new Date(e.date + "T12:00:00") : null; if (d && d >= start && d < end) s += entryElapsed(e); }); if (s > 0) rows.push([m.title || "Sans titre", (s / 3600).toFixed(2).replace(".", ","), fmtDuration(s)]); });
  const csv = "﻿" + [H, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  downloadFile("operations01-temps-semaine.csv", csv, "text/csv;charset=utf-8");
}

// ----------------------------- Chronos live -----------------------------
setInterval(() => {
  document.querySelectorAll("[data-entry-time]").forEach((span) => {
    const id = span.dataset.entryTime;
    for (const m of state.missions) { const e = (m.entries || []).find((x) => x.id === id); if (e && e.timerStartedAt) span.textContent = fmtDuration(entryElapsed(e)); }
  });
  document.querySelectorAll("[data-total]").forEach((span) => { const m = findMission(span.dataset.total); if (m && (m.entries || []).some((e) => e.timerStartedAt)) span.textContent = fmtDuration(missionTotal(m)); });
}, 1000);

// ----------------------------- Installation (PWA) -----------------------------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; document.getElementById("installBanner").style.display = "flex"; });
document.getElementById("installBtn").onclick = () => { document.getElementById("installBanner").style.display = "none"; if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } };
document.getElementById("installClose").onclick = () => { document.getElementById("installBanner").style.display = "none"; };

// ----------------------------- Démarrage -----------------------------
render();
renderDriveBar();
if (window.DriveSync) DriveSync.onStatus((s) => { const el = document.getElementById("driveStatus"); if (el) el.textContent = s; });
