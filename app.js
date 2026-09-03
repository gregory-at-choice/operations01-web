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
  { code: "deliverable", label: "Livrable", ic: "📦" }, { code: "suivi", label: "Suivi du projet", ic: "⏱️" },
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

// Version de l'application : affichée dans le menu pour vérifier d'un coup d'œil
// que l'appareil exécute bien la dernière version publiée.
const APP_VERSION = "v53";

// ----------------------------- Données -----------------------------
const STORE_KEY = "operations01";
let state = load();

function blankState() {
  return { companies: [], contacts: [], categories: [], invoices: [], missions: [], tasks: [], actions: [], rendezvous: [], recurrences: [], slots: [], accounts: [], ccaMovements: [], salaries: [], leave: defaultLeave(), readerOrder: [], readerCurrent: null, pdfOrder: [], pdfCurrent: null, mailboxes: [], mailLinks: {}, updatedAt: 0 };
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
// Une facture réglée par un associé ne fait pas bouger la trésorerie de la société :
// elle alimente le compte courant d'associé.
const paidByAssociate = (v) => v.payMode === "associe";
const companyAccounts = (cid) => state.accounts.filter((a) => a.companyId === cid);
function accountBalance(a, now) {
  const d0 = parseDate(a.balanceDate) || new Date(0);
  let s = a.initialBalance || 0;
  state.invoices.filter((v) => v.accountId === a.id && !paidByAssociate(v)).forEach((v) => { const d = invCashDate(v); if (d > d0 && d <= now) s += invSigned(v); });
  return s;
}
function companyBalance(c, now) {
  const cb = parseDate(c.cashBalanceDate) || new Date(0);
  let s = c.initialCashBalance || 0;
  // factures de la société non rattachées à un compte précis (et non payées par un associé)
  state.invoices.filter((v) => v.companyId === c.id && !paidByAssociate(v) && !v.accountId)
    .forEach((v) => { const d = invCashDate(v); if (d > cb && d <= now) s += invSigned(v); });
  companyAccounts(c.id).forEach((a) => { s += accountBalance(a, now); });
  return s;
}
function treasuryEntities() { return state.companies.filter((c) => (c.initialCashBalance || 0) !== 0 || companyAccounts(c.id).length || state.invoices.some((v) => v.companyId === c.id)); }
function treasuryNow(now) { return treasuryEntities().reduce((t, c) => t + companyBalance(c, now), 0); }
function treasuryProjected(now, days) {
  const limit = new Date(now.getTime() + days * 86400000);
  let base = treasuryNow(now);
  state.invoices.filter((v) => v.companyId && !paidByAssociate(v)).forEach((v) => { const d = invCashDate(v); if (d > now && d <= limit) base += invSigned(v); });
  return base;
}
// ---- Compte courant d'associé ----
// Solde positif = la société doit de l'argent à l'associé.
function associates() {
  const asso = state.contacts.filter((c) => c.category === "associe");
  return asso.length ? asso : state.contacts;
}
function ccaBalance(associateId, companyId) {
  let s = 0;
  state.invoices.filter((v) => paidByAssociate(v) && v.associateId === associateId && (!companyId || v.companyId === companyId))
    .forEach((v) => { s += (v.direction === "depense" ? 1 : -1) * invTTC(v); });
  state.ccaMovements.filter((m) => m.associateId === associateId && (!companyId || m.companyId === companyId))
    .forEach((m) => { s += (m.kind === "remboursement" ? -1 : 1) * (m.amount || 0); });
  return s;
}
function ccaLines(associateId, companyId) {
  const lines = [];
  state.invoices.filter((v) => paidByAssociate(v) && v.associateId === associateId && (!companyId || v.companyId === companyId))
    .forEach((v) => lines.push({ date: v.startDate || "", label: v.title || "Facture", detail: companyName(v.companyId), amount: (v.direction === "depense" ? 1 : -1) * invTTC(v), kind: v.direction === "depense" ? "Avance (facture)" : "Encaissement", invoiceId: v.id }));
  state.ccaMovements.filter((m) => m.associateId === associateId && (!companyId || m.companyId === companyId))
    .forEach((m) => lines.push({ date: m.date || "", label: m.notes || (m.kind === "apport" ? "Apport" : m.kind === "remboursement" ? "Remboursement" : "Mouvement"), detail: companyName(m.companyId), amount: (m.kind === "remboursement" ? -1 : 1) * (m.amount || 0), kind: m.kind === "apport" ? "Apport" : m.kind === "remboursement" ? "Remboursement" : "Autre", movementId: m.id }));
  return lines.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
const recettes = () => state.invoices.filter((v) => v.direction === "recette");
const depenses = () => state.invoices.filter((v) => v.direction === "depense");
const sumAmount = (arr) => arr.reduce((t, v) => t + (v.amount || 0), 0);

// ----------------------------- Navigation -----------------------------
const SECTIONS = [
  { id: "search", label: "Recherche", ic: "🔎", fn: renderSearch },
  { id: "relances", label: "Relances", ic: "📨", fn: renderRelances },
  { id: "missions", label: "Projets", ic: "📁", fn: renderMissions },
  { id: "tasks", label: "Tâches", ic: "✅", fn: renderTasks },
  { id: "actions", label: "Actions", ic: "🎫", fn: renderActions },
  { id: "rendezvous", label: "Rendez-vous", ic: "📅", fn: renderRendezvous },
  { id: "planning", label: "Planning", ic: "🗓️", fn: renderPlanning },
  { id: "time", label: "Temps", ic: "⏱️", fn: renderTime },
  { id: "finances", label: "Finances", ic: "€", fn: renderFinances },
  { id: "contacts", label: "Contacts", ic: "👥", fn: renderContacts },
  { id: "groupe", label: "Groupe", ic: "🏢", fn: renderGroupe },
  { id: "dashboard", label: "Tableau de bord", ic: "🎛️", fn: renderDashboard },
  { id: "reader", label: "Lecteur", ic: "📖", fn: renderReader },
  { id: "pdftools", label: "Outils PDF", ic: "🧰", fn: renderPdfTools },
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
// Compteur affiché à droite de chaque entrée du menu (null = rien).
function navCount(id) {
  const today = todayISO();
  if (id === "relances") {
    let n = missingReceipts().length;
    if (mailData) n += (mailData.unread || []).length + (mailData.relance || []).length + (mailData.nouveau || []).length + (mailData.rdvPrep || []).length;
    return n || null;
  }
  if (id === "missions") return state.missions.filter((m) => (m.statusCode || "aDemarrer") !== "terminee").length || null;
  if (id === "tasks") return state.tasks.filter((t) => (t.status || "aFaire") !== "termine").length || null;
  if (id === "actions") return state.actions.filter((a) => !a.closed).length || null;
  if (id === "rendezvous") return (state.rendezvous.filter((r) => (r.date || "9999") >= today).length
    + calendar.events.filter((e) => e.date >= today).length) || null;
  if (id === "planning") return (state.slots.filter((s) => s.date === today).length
    + calendar.events.filter((e) => e.date === today).length) || null;
  if (id === "time") { const t = weekWorkedSeconds(); return t > 0 ? fmtDurationShort(t) : null; }
  return null;
}
function weekWorkedSeconds() {
  const { start, end } = weekInterval(new Date());
  let total = 0;
  state.missions.forEach((m) => (m.entries || []).forEach((e) => {
    const d = e.date ? new Date(e.date + "T12:00:00") : null;
    if (d && d >= start && d < end) total += entryElapsed(e);
  }));
  return total;
}
function fmtDurationShort(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}` : `${m}min`;
}
function renderNav() {
  const sidebar = document.getElementById("sidebar");
  sidebar.querySelectorAll(".nav-item").forEach((n) => n.remove());
  const driveBar = document.getElementById("driveBar");
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "nav-item" + (s.id === view.section ? " active" : "");
    const n = navCount(s.id);
    const dot = (s.id === "missions" || s.id === "time") && anyTimerRunning() ? '<span class="run-dot" title="Chronomètre en cours"></span>' : "";
    b.innerHTML = `<span class="ic">${s.ic}</span> <span class="nav-lbl">${esc(s.label)}</span>${dot}${n != null ? `<span class="nav-count" id="navCount-${s.id}">${esc(String(n))}</span>` : ""}`;
    b.onclick = () => go(s.id);
    sidebar.insertBefore(b, driveBar);
  });
  const tabbar = document.getElementById("tabbar");
  tabbar.innerHTML = "";
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.className = s.id === view.section ? "active" : "";
    const n = navCount(s.id);
    b.innerHTML = `<span class="ic">${s.ic}${n != null ? `<span class="tab-count">${esc(String(n))}</span>` : ""}</span>${esc(s.label)}`;
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

// ----------------------------- Lecteur Markdown -----------------------------
// Conversion Markdown → HTML sans librairie externe.
// Le contenu du fichier est ÉCHAPPÉ avant tout traitement : aucun HTML ni script
// présent dans le document ne peut s'exécuter.
// Polices proposées au lecteur. Chaque pile prévoit des substituts : si la police
// n'est pas installée sur l'appareil, le navigateur retombe sur une équivalente.
const MD_FONTS = [
  // Serif — lecture longue
  { code: "newyork", group: "Serif", label: "New York", css: "ui-serif, 'New York', 'Times New Roman', serif" },
  { code: "charter", group: "Serif", label: "Charter", css: "Charter, 'Bitstream Charter', 'Charis SIL', Georgia, serif" },
  { code: "baskerville", group: "Serif", label: "Baskerville", css: "Baskerville, 'Baskerville Old Face', 'Libre Baskerville', Georgia, serif" },
  { code: "hoefler", group: "Serif", label: "Hoefler Text", css: "'Hoefler Text', 'Times New Roman', Times, serif" },
  { code: "times", group: "Serif", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  // Sans serif
  { code: "avenir", group: "Sans serif", label: "Avenir Next", css: "'Avenir Next', Avenir, 'Segoe UI', Roboto, sans-serif" },
  { code: "optima", group: "Sans serif", label: "Optima", css: "Optima, Candara, 'Segoe UI', sans-serif" },
  { code: "futura", group: "Sans serif", label: "Futura", css: "Futura, 'Century Gothic', 'Trebuchet MS', sans-serif" },
  { code: "gill", group: "Sans serif", label: "Gill Sans", css: "'Gill Sans', 'Gill Sans MT', Calibri, sans-serif" },
  { code: "verdana", group: "Sans serif", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { code: "tahoma", group: "Sans serif", label: "Tahoma", css: "Tahoma, Geneva, Verdana, sans-serif" },
  // Monospace
  { code: "menlo", group: "Monospace", label: "Menlo", css: "Menlo, ui-monospace, SFMono-Regular, Consolas, monospace" },
  { code: "monaco", group: "Monospace", label: "Monaco", css: "Monaco, Menlo, ui-monospace, Consolas, monospace" },
  { code: "courier", group: "Monospace", label: "Courier New", css: "'Courier New', Courier, monospace" },
];
const MD_BGS = [
  { code: "blanc", label: "Blanc", bg: "#ffffff" },
  { code: "sepia", label: "Sépia", bg: "#f6ecd9" },
  { code: "gris", label: "Gris clair", bg: "#eef1f2" },
  { code: "vert", label: "Vert pâle", bg: "#e9f1e8" },
  { code: "nuit", label: "Nuit", bg: "#141a1e" },
];
const READER_KEY = "operations01_reader";   // préférences d'affichage (propres à l'appareil)
const READER_CACHE = "operations01_readercache"; // copie locale des documents (lecture hors ligne)
const READER_MAX = 4.5 * 1024 * 1024;
function readerDefaults() { return { kind: "md", font: "newyork", bg: "blanc", customBg: "", size: 17, pdfZoom: 1 }; }
let reader = loadReader();
let readerLib = loadCache();      // [{id, name, size}] connus
let readerBusy = false;           // chargement Drive en cours
function loadReader() {
  try {
    const r = JSON.parse(localStorage.getItem(READER_KEY) || "null");
    if (r) return Object.assign(readerDefaults(), { kind: r.kind, font: r.font, bg: r.bg, customBg: r.customBg, size: r.size, pdfZoom: r.pdfZoom });
  } catch (e) {}
  return readerDefaults();
}
function saveReader() { try { localStorage.setItem(READER_KEY, JSON.stringify(reader)); } catch (e) {} }
// Cache local : { docs:[{id,name,size}], texts:{id:contenu} }
function loadCache() {
  try { const c = JSON.parse(localStorage.getItem(READER_CACHE) || "null"); if (c && Array.isArray(c.docs)) return c; } catch (e) {}
  return { docs: [], texts: {} };
}
function saveCache() {
  try { localStorage.setItem(READER_CACHE, JSON.stringify(readerLib)); }
  catch (e) { readerLib.texts = {}; try { localStorage.setItem(READER_CACHE, JSON.stringify(readerLib)); } catch (e2) {} }
}
// L'ordre de lecture et le document courant sont dans l'état synchronisé (petits),
// les documents eux-mêmes sont des fichiers Drive séparés.
function readerOrder() { return Array.isArray(state.readerOrder) ? state.readerOrder : (state.readerOrder = []); }
function orderedDocs() {
  const ord = readerOrder();
  return [...readerLib.docs].sort((a, b) => {
    const ia = ord.indexOf(a.id), ib = ord.indexOf(b.id);
    if (ia > -1 && ib > -1) return ia - ib;
    if (ia > -1) return -1;
    if (ib > -1) return 1;
    return (a.name || "").localeCompare(b.name || "", "fr");
  });
}
const currentDoc = () => orderedDocs().find((d) => d.id === state.readerCurrent) || null;
function fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " Mo" : Math.max(1, Math.round(n / 1024)) + " ko"; }
// Récupère la liste depuis le Drive (les documents suivent d'un appareil à l'autre).
async function refreshDocs(force) {
  if (!(window.DriveSync && DriveSync.isConnected())) return;
  if (readerBusy) return;
  readerBusy = true; if (view.section === "reader") render();
  try {
    const docs = await DriveSync.listDocs();
    const texts = {};
    docs.forEach((d) => { if (readerLib.texts[d.id]) texts[d.id] = readerLib.texts[d.id]; });
    readerLib = { docs, texts };
    saveCache();
  } catch (e) {}
  readerBusy = false;
  if (view.section === "reader") render();
}
// Contenu d'un document : cache local, sinon téléchargement depuis le Drive.
async function ensureDocText(id) {
  if (readerLib.texts[id] != null) return readerLib.texts[id];
  if (!(window.DriveSync && DriveSync.isConnected())) return null;
  readerBusy = true; if (view.section === "reader") render();
  try {
    const txt = await DriveSync.readDoc(id);
    if (JSON.stringify(readerLib).length + txt.length < READER_MAX) readerLib.texts[id] = txt;
    else readerLib.texts[id] = txt;   // gardé en mémoire même si le cache déborde
    saveCache();
  } catch (e) {}
  readerBusy = false;
  if (view.section === "reader") render();
  return readerLib.texts[id] != null ? readerLib.texts[id] : null;
}
// Texte lisible (clair ou foncé) selon la luminance du fond.
function textOn(bg) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(bg).trim());
  if (!m) return "#14201f";
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#14201f" : "#e8efee";
}
// ----------------------------- Formules (LaTeX → MathML) -----------------------------
// MathML est le format mathématique natif des navigateurs : rendu typographique
// correct, aucune librairie externe, et impression/PDF propres.
const TEX_SYM = {
  alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",varepsilon:"ε",zeta:"ζ",eta:"η",theta:"θ",vartheta:"ϑ",
  iota:"ι",kappa:"κ",lambda:"λ",mu:"μ",nu:"ν",xi:"ξ",pi:"π",rho:"ρ",sigma:"σ",tau:"τ",upsilon:"υ",
  phi:"φ",varphi:"φ",chi:"χ",psi:"ψ",omega:"ω",
  Gamma:"Γ",Delta:"Δ",Theta:"Θ",Lambda:"Λ",Xi:"Ξ",Pi:"Π",Sigma:"Σ",Upsilon:"Υ",Phi:"Φ",Psi:"Ψ",Omega:"Ω",
  infty:"∞",partial:"∂",nabla:"∇",forall:"∀",exists:"∃",emptyset:"∅",varnothing:"∅",
  ell:"ℓ",hbar:"ℏ",Re:"ℜ",Im:"ℑ",aleph:"ℵ",degree:"°",prime:"′"
};
const TEX_OP = {
  cdot:"⋅",times:"×",div:"÷",pm:"±",mp:"∓",ast:"∗",star:"⋆",circ:"∘",bullet:"∙",
  leq:"≤",le:"≤",geq:"≥",ge:"≥",neq:"≠",ne:"≠",approx:"≈",equiv:"≡",sim:"∼",simeq:"≃",cong:"≅",
  propto:"∝",ll:"≪",gg:"≫",subset:"⊂",supset:"⊃",subseteq:"⊆",supseteq:"⊇",in:"∈",notin:"∉",ni:"∋",
  cup:"∪",cap:"∩",setminus:"∖",wedge:"∧",vee:"∨",neg:"¬",oplus:"⊕",otimes:"⊗",
  rightarrow:"→",to:"→",leftarrow:"←",leftrightarrow:"↔",Rightarrow:"⇒",Leftarrow:"⇐",Leftrightarrow:"⇔",
  mapsto:"↦",implies:"⟹",iff:"⟺",cdots:"⋯",ldots:"…",dots:"…",vdots:"⋮",ddots:"⋱",
  sum:"∑",prod:"∏",coprod:"∐",int:"∫",iint:"∬",iiint:"∭",oint:"∮",bigcup:"⋃",bigcap:"⋂",
  sqrt:"√",angle:"∠",perp:"⊥",parallel:"∥",therefore:"∴",because:"∵",pm2:"±"
};
const TEX_BIG = { sum:1, prod:1, coprod:1, int:1, iint:1, iiint:1, oint:1, bigcup:1, bigcap:1, lim:1 };
const TEX_FUN = ["arcsin","arccos","arctan","sinh","cosh","tanh","sin","cos","tan","cot","sec","csc",
  "log","ln","exp","lim","max","min","sup","inf","det","dim","gcd","arg","deg","ker","Pr"];
const TEX_ACCENT = { hat:"^", bar:"‾", vec:"→", tilde:"~", dot:"˙", ddot:"¨", widehat:"^", overline:"‾" };
const TEX_SPACE = { ",":"0.17em", ":":"0.22em", ";":"0.28em", quad:"1em", qquad:"2em", "!":"-0.17em" };
const mesc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function texTokenize(src) {
  const ts = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (!m) { i++; continue; }
      ts.push({ t: "cmd", v: m[1] }); i += m[0].length; continue;
    }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i)); ts.push({ t: "num", v: m[0] }); i += m[0].length; continue; }
    if (/[a-zA-Z]/.test(c)) { ts.push({ t: "id", v: c }); i++; continue; }
    if (c === "{" || c === "}" || c === "^" || c === "_") { ts.push({ t: c }); i++; continue; }
    ts.push({ t: "op", v: c }); i++;
  }
  return ts;
}
// Analyse une suite de jetons jusqu'à « } » (ou la fin) et renvoie du MathML.
function texParse(ts, pos, stopAtBrace) {
  const out = [];
  let i = pos;
  const readAtom = () => {
    const tk = ts[i];
    if (!tk) return "";
    if (tk.t === "{") { const r = texParse(ts, i + 1, true); i = r.i; return `<mrow>${r.html}</mrow>`; }
    return texOne();
  };
  const texOne = () => {
    const tk = ts[i];
    if (!tk) return "";
    if (tk.t === "num") { i++; return `<mn>${mesc(tk.v)}</mn>`; }
    if (tk.t === "id") { i++; return `<mi>${mesc(tk.v)}</mi>`; }
    if (tk.t === "op") {
      i++;
      if (tk.v === "(" || tk.v === ")" || tk.v === "[" || tk.v === "]" || tk.v === "|") return `<mo stretchy="false">${mesc(tk.v)}</mo>`;
      return `<mo>${mesc(tk.v)}</mo>`;
    }
    if (tk.t === "{") { const r = texParse(ts, i + 1, true); i = r.i; return `<mrow>${r.html}</mrow>`; }
    if (tk.t === "cmd") {
      const v = tk.v; i++;
      if (v === "frac" || v === "dfrac" || v === "tfrac") { const a = readAtom(), b = readAtom(); return `<mfrac>${a || "<mi></mi>"}${b || "<mi></mi>"}</mfrac>`; }
      if (v === "sqrt") {
        if (ts[i] && ts[i].t === "op" && ts[i].v === "[") {
          i++; const idx = [];
          while (ts[i] && !(ts[i].t === "op" && ts[i].v === "]")) { idx.push(texOne()); }
          if (ts[i]) i++;
          return `<mroot>${readAtom()}<mrow>${idx.join("")}</mrow></mroot>`;
        }
        return `<msqrt>${readAtom()}</msqrt>`;
      }
      if (v === "text" || v === "mathrm" || v === "textrm" || v === "mbox") {
        if (ts[i] && ts[i].t === "{") {
          i++; let txt = "";
          while (ts[i] && ts[i].t !== "}") { txt += (ts[i].v != null ? ts[i].v : ts[i].t); i++; }
          if (ts[i]) i++;
          return `<mtext>${mesc(txt)}</mtext>`;
        }
        return "";
      }
      if (v === "mathbf" || v === "bf") { return `<mstyle mathvariant="bold">${readAtom()}</mstyle>`; }
      if (v === "mathit") { return `<mstyle mathvariant="italic">${readAtom()}</mstyle>`; }
      if (TEX_ACCENT[v]) { return `<mover accent="true">${readAtom()}<mo>${mesc(TEX_ACCENT[v])}</mo></mover>`; }
      if (TEX_SPACE[v]) { return `<mspace width="${TEX_SPACE[v]}"/>`; }
      if (v === "left" || v === "right") {
        const d = ts[i] ? (ts[i].v || "") : "";
        i++;
        if (d === "." || d === "") return "";
        return `<mo stretchy="true">${mesc(d)}</mo>`;
      }
      if (v === "\\") return "";
      if (TEX_FUN.indexOf(v) > -1) return `<mi>${mesc(v)}</mi><mo>&#8289;</mo>`;
      if (TEX_OP[v]) return `<mo${TEX_BIG[v] ? ' largeop="true"' : ""}>${mesc(TEX_OP[v])}</mo>`;
      if (TEX_SYM[v]) return `<mi>${mesc(TEX_SYM[v])}</mi>`;
      return `<mi>${mesc(v)}</mi>`;
    }
    i++; return "";
  };
  while (i < ts.length) {
    if (stopAtBrace && ts[i].t === "}") { i++; break; }
    if (ts[i].t === "^" || ts[i].t === "_") {
      const kind = ts[i].t; i++;
      const arg = readAtom();
      const base = out.length ? out.pop() : "<mi></mi>";
      // un exposant qui suit un indice (ou l'inverse) donne msubsup
      const prev = /^<m(sub|sup)>([\s\S]*)<\/m(?:sub|sup)>$/.exec(base);
      if (prev && ((prev[1] === "sub" && kind === "^") || (prev[1] === "sup" && kind === "_"))) {
        const inner = prev[2];
        out.push(kind === "^" ? `<msubsup>${inner}${arg}</msubsup>` : `<msubsup>${inner}${arg}</msubsup>`);
      } else {
        out.push(kind === "^" ? `<msup>${base}${arg}</msup>` : `<msub>${base}${arg}</msub>`);
      }
      continue;
    }
    const before = i;
    out.push(texOne());
    if (i === before) i++;   // sécurité anti-boucle
  }
  return { html: out.join(""), i };
}
function texToMathML(tex, display) {
  try {
    const ts = texTokenize(String(tex));
    const r = texParse(ts, 0, false);
    if (!r.html) throw new Error("vide");
    return `<math xmlns="http://www.w3.org/1998/Math/MathML"${display ? ' display="block"' : ""}><mrow>${r.html}</mrow></math>`;
  } catch (e) {
    // en cas d'échec, on montre la formule source plutôt que de casser la page
    return `<code class="tex-raw">${esc(String(tex))}</code>`;
  }
}

const safeUrl = (u) => /^(https?:\/\/|mailto:|#|\/|\.\/)/i.test(String(u).trim());
function mdInline(t) {
  t = t.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  // l'URL peut contenir un niveau de parenthèses (liens Wikipédia, etc.)
  t = t.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (m, alt, url) => {
    const u = url.replace(/&amp;/g, "&");
    return safeUrl(u) ? `<img src="${u}" alt="${alt}"/>` : alt;
  });
  t = t.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)/g, (m, txt, url) => {
    const u = url.replace(/&amp;/g, "&");
    return safeUrl(u) ? `<a href="${u}" target="_blank" rel="noopener">${txt}</a>` : txt;
  });
  return t;
}
function mdToHtml(src) {
  const blocks = [];      // blocs de code
  const inlines = [];     // code en ligne
  const maths = [];       // formules { tex, display }
  let s = String(src || "").replace(/\r\n?/g, "\n");
  // 1) blocs de code : mis de côté pour ne pas être reformatés
  s = s.replace(/```[\w+-]*\n([\s\S]*?)```/g, (m, code) => { blocks.push(code); return `\uE000C${blocks.length - 1}\uE000`; });
  // 2) code en ligne : protégé avant tout (ni Markdown ni formules à l'intérieur)
  s = s.replace(/`([^`\n]+)`/g, (m, code) => { inlines.push(code); return `\uE000I${inlines.length - 1}\uE000`; });
  // 3) formules : extraites AVANT le Markdown, sinon _ et ^ seraient mal interprétés
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => { maths.push({ tex, display: true }); return `\uE000D${maths.length - 1}\uE000`; });
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (m, tex) => { maths.push({ tex, display: true }); return `\uE000D${maths.length - 1}\uE000`; });
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (m, tex) => { maths.push({ tex, display: false }); return `\uE000M${maths.length - 1}\uE000`; });
  // $...$ : règle prudente — pas d'espace collé aux délimiteurs, pas de retour à la
  // ligne, et pas de chiffre juste avant (pour ne pas capturer un montant en dollars)
  s = s.replace(/(^|[^\w$])\$(?!\s)([^$\n]*[^\s$])\$(?!\w)/g, (m, pre, tex) => { maths.push({ tex, display: false }); return `${pre}\uE000M${maths.length - 1}\uE000`; });
  s = esc(s);
  const lines = s.split("\n");
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => mdInline(c.trim()));
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) { i++; continue; }
    if (/^\uE000[CD]\d+\uE000$/.test(l.trim())) { out.push(l.trim()); i++; continue; }
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) { out.push(`<h${m[1].length}>${mdInline(m[2].trim())}</h${m[1].length}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { out.push("<hr/>"); i++; continue; }
    // tableau
    if (l.indexOf("|") > -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l); i += 2;
      const body = [];
      while (i < lines.length && lines[i].indexOf("|") > -1 && !/^\s*$/.test(lines[i])) { body.push(cells(lines[i])); i++; }
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${
        body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    // citation
    if (/^\s*&gt;\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*&gt;\s?/, "")); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join("\n").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"))}</blockquote>`);
      continue;
    }
    // listes
    if (/^\s*([-*+])\s+/.test(l) || /^\s*\d+[.)]\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*+])\s+/).test(lines[i])) {
        let txt = lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*([-*+])\s+/, "");
        const task = /^\[( |x|X)\]\s+/.exec(txt);
        if (task) txt = (task[1].toLowerCase() === "x" ? "☑ " : "☐ ") + txt.replace(/^\[( |x|X)\]\s+/, "");
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { txt += " " + lines[i].trim(); i++; }
        items.push(`<li>${mdInline(txt)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
      continue;
    }
    // paragraphe
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])
      && !/^\s*([-*+])\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*&gt;\s?/.test(lines[i])
      && !/^\uE000[CD]\d+\uE000$/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
    if (buf.length) out.push(`<p>${mdInline(buf.join("\n")).replace(/\n/g, "<br/>")}</p>`);
  }
  return out.join("\n").replace(/\uE000([CIDM])(\d+)\uE000/g, (m, kind, n) => {
    const k = Number(n);
    if (kind === "C") return `<pre><code>${esc(blocks[k])}</code></pre>`;
    if (kind === "I") return `<code>${esc(inlines[k])}</code>`;
    const f = maths[k] || { tex: "", display: false };
    return f.display ? `<div class="math-block">${texToMathML(f.tex, true)}</div>` : texToMathML(f.tex, false);
  });
}
// Impression / export PDF du document en cours de lecture.
// La police choisie est conservée ; le fond coloré est remplacé par du blanc
// (un fond sépia ou nuit n'a pas de sens sur papier ni dans un PDF).
function printCurrentDoc() {
  const d = currentDoc();
  if (!d) { toast("Aucun document ouvert."); return; }
  const txt = readerLib.texts[d.id];
  if (txt == null) { toast("Document pas encore chargé — ouvre-le d'abord."); return; }
  const fontCss = (MD_FONTS.find((f) => f.code === reader.font) || MD_FONTS[0]).css;
  const nom = String(d.name || "Document").replace(/\.(md|markdown|txt)$/i, "");
  printReport("Operations01 - " + nom, nom,
    `<div class="md-doc md-print" style="font-family:${fontCss}">${mdToHtml(txt)}</div>`);
}
// ----------------------------- Lecteur PDF -----------------------------
// Même principe que le lecteur Markdown : les fichiers vivent sur le Drive,
// la liste de lecture et le document courant suivent d'un appareil à l'autre.
let pdfLib = { docs: [] };        // [{id, name, size}]
let pdfBusyR = false;             // chargement en cours
let pdfOpen = null;               // { id, doc } document pdf.js ouvert
let pdfPainted = "";              // clé de ce qui est déjà dessiné (id@zoom)
let pdfError = "";                // dernière erreur, affichée dans la vue
let pdfPageNow = 1;               // page actuellement visible
function pdfOrder() { return Array.isArray(state.pdfOrder) ? state.pdfOrder : (state.pdfOrder = []); }
function orderedPdfs() {
  const ord = pdfOrder();
  return [...pdfLib.docs].sort((a, b) => {
    const ia = ord.indexOf(a.id), ib = ord.indexOf(b.id);
    if (ia > -1 && ib > -1) return ia - ib;
    if (ia > -1) return -1;
    if (ib > -1) return 1;
    return (a.name || "").localeCompare(b.name || "", "fr");
  });
}
const currentPdf = () => orderedPdfs().find((d) => d.id === state.pdfCurrent) || null;
async function refreshPdfs() {
  if (!(window.DriveSync && DriveSync.isConnected()) || pdfBusyR) return;
  pdfBusyR = true; if (view.section === "reader") render();
  try { pdfLib.docs = await DriveSync.listPdfs(); } catch (e) {}
  pdfBusyR = false; if (view.section === "reader") render();
}
// Télécharge le PDF depuis le Drive et l'ouvre avec pdf.js.
async function openPdf(id) {
  if (pdfOpen && pdfOpen.id === id) return;
  pdfBusyR = true; pdfOpen = null; pdfPainted = ""; pdfError = ""; pdfPageNow = 1; render();
  try {
    const pdfjs = await needPdfJs();
    const bytes = await DriveSync.readBinary(id);
    const doc = await pdfjs.getDocument({ data: bytes, standardFontDataUrl: "vendor/standard_fonts/" }).promise;
    pdfOpen = { id, doc, bytes };
  } catch (e) { pdfOpen = null; pdfError = e && e.message ? e.message : String(e); }
  pdfBusyR = false; render();
}
// Dessine les pages dans le conteneur, après insertion dans le DOM.
async function paintPdfPages() {
  const host = document.getElementById("pdfPages");
  if (!host || !pdfOpen) return;
  const key = pdfOpen.id + "@" + reader.pdfZoom;
  if (pdfPainted === key) return;
  pdfPainted = key;
  host.innerHTML = "";
  const doc = pdfOpen.doc;
  for (let i = 1; i <= doc.numPages; i++) {
    if (pdfPainted !== key) return;          // un autre rendu a pris le relais
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: reader.pdfZoom * (window.devicePixelRatio || 1) });
    const cv = document.createElement("canvas");
    cv.className = "pdf-page";
    cv.id = "pdfpage-" + i;
    cv.dataset.page = String(i);
    cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
    cv.style.width = Math.floor(vp.width / (window.devicePixelRatio || 1)) + "px";
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    host.appendChild(cv);
    try { await page.render({ canvasContext: ctx, viewport: vp }).promise; }
    catch (e) { pdfError = "Affichage de la page " + i + " : " + (e && e.message ? e.message : e); render(); return; }
  }
}
// Fait défiler jusqu'à une page précise.
function goToPdfPage(n) {
  if (!pdfOpen) return;
  const total = pdfOpen.doc.numPages;
  const page = Math.max(1, Math.min(total, parseInt(n, 10) || 1));
  const el = document.getElementById("pdfpage-" + page);
  if (!el) return;
  const host = document.getElementById("content");
  if (host) host.scrollTop += el.getBoundingClientRect().top - host.getBoundingClientRect().top - 8;
  else el.scrollIntoView({ block: "start" });
  pdfPageNow = page;
  const inp = document.getElementById("pdfPageNo"); if (inp) inp.value = String(page);
}
// Met à jour le numéro affiché selon la page réellement visible (sans tout redessiner).
function syncPdfPageNumber() {
  const host = document.getElementById("content");
  const pages = document.querySelectorAll("[id^='pdfpage-']");
  if (!host || !pages.length) return;
  const top = host.getBoundingClientRect().top;
  let cur = 1;
  pages.forEach((el) => { if (el.getBoundingClientRect().top - top <= 60) cur = Number(el.dataset.page) || cur; });
  if (cur !== pdfPageNow) {
    pdfPageNow = cur;
    const inp = document.getElementById("pdfPageNo"); if (inp) inp.value = String(cur);
  }
}
function renderPdfReader() {
  const docs = orderedPdfs();
  const cur = currentPdf();
  const idx = cur ? docs.findIndex((d) => d.id === cur.id) : -1;
  const connected = window.DriveSync && DriveSync.isConnected();
  const items = docs.map((d, i) => `<div class="md-item ${d.id === state.pdfCurrent ? "active" : ""}" data-pdfr-open="${d.id}">
      <span class="md-num">${i + 1}</span>
      <div class="grow" style="min-width:0">
        <div class="md-item-t">${esc(d.name || "Document")}</div>
        <div class="md-item-s">${esc(fmtSize(d.size || 0))}</div></div>
      <button class="btn ghost small" data-pdfr-move="-1" data-d="${d.id}" ${i === 0 ? "disabled" : ""} title="Monter">↑</button>
      <button class="btn ghost small" data-pdfr-move="1" data-d="${d.id}" ${i === docs.length - 1 ? "disabled" : ""} title="Descendre">↓</button>
      <button class="btn ghost small" data-pdfr-del="${d.id}" title="Retirer">✕</button>
    </div>`).join("");
  const nav = docs.length > 1 && idx > -1
    ? `<div class="md-nav">
        <button class="btn ghost small" data-pdfr-prev ${idx === 0 ? "disabled" : ""}>‹ Précédent</button>
        <span class="grow" style="text-align:center">${idx + 1} / ${docs.length}</span>
        <button class="btn ghost small" data-pdfr-next ${idx === docs.length - 1 ? "disabled" : ""}>Suivant ›</button></div>`
    : "";
  let body;
  if (!connected) body = `<div class="center-empty">Connecte-toi à Google Drive : tes PDF y sont enregistrés et suivent d'un appareil à l'autre.</div>`;
  else if (pdfBusyR) body = `<div class="center-empty">Chargement…</div>`;
  else if (cur && pdfOpen && pdfOpen.id === cur.id) body = `${nav}<div id="pdfPages" class="pdf-pages"></div>`;
  else if (cur && pdfError) body = `${nav}<div class="center-empty" style="color:#d23c3c">Impossible d'afficher ce PDF.<br><span style="font-size:12px">${esc(pdfError)}</span><br><br><button class="btn secondary small" data-pdfr-retry>Réessayer</button></div>`;
  else if (cur) body = `${nav}<div class="center-empty">Ouverture du document…</div>`;
  else body = `<div class="center-empty">${docs.length ? "Choisis un PDF dans la liste de lecture." : "Aucun PDF.<br>Clique sur « Importer des PDF » — tu peux en sélectionner plusieurs."}</div>`;

  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Lecteur</div>
      <button class="btn ghost small" data-pdfr-refresh>${pdfBusyR ? "…" : "↻"}</button>
      ${pdfOpen ? '<button class="btn secondary small" data-pdfr-download>⤓ Télécharger</button>' : ""}
      <button class="btn" data-pdfr-import>📂 Importer des PDF</button></div>
    ${readerTabs()}
    <div class="md-bar">
      <label class="md-ctl"><span>Zoom</span>
        <select id="pdfZoom">${[0.75, 1, 1.25, 1.5, 2].map((z) => `<option value="${z}" ${Math.abs(reader.pdfZoom - z) < 0.01 ? "selected" : ""}>${Math.round(z * 100)} %</option>`).join("")}</select></label>
      ${pdfOpen ? `<div class="md-ctl"><span>Aller à la page</span>
        <div class="pdf-goto">
          <button class="btn ghost small" data-pdf-page="-1" title="Page précédente">‹</button>
          <input type="number" id="pdfPageNo" min="1" max="${pdfOpen.doc.numPages}" value="${Math.min(pdfPageNow, pdfOpen.doc.numPages)}"/>
          <span class="muted">/ ${pdfOpen.doc.numPages}</span>
          <button class="btn ghost small" data-pdf-page="1" title="Page suivante">›</button>
        </div></div>` : ""}
      <span class="grow"></span>
    </div>
    <div class="md-layout">
      <div class="md-side">
        <div class="section-h" style="margin-top:0">Liste de lecture <span class="muted">(${docs.length})</span></div>
        <div class="md-list">${items || '<div class="muted" style="font-size:12px">Vide.</div>'}</div>
        ${docs.length ? '<div class="muted" style="font-size:11px;margin-top:8px">Enregistrés sur ton Google Drive</div>' : ""}
      </div>
      <div class="md-main">${body}</div>
    </div>`;
}
function readerTabs() {
  return `<div class="chip-row" style="margin-bottom:14px">${
    [["md", "Markdown"], ["pdf", "PDF"]].map(([id, lbl]) =>
      `<button class="chip ${reader.kind === id ? "active" : ""}" data-rkind="${id}">${lbl}</button>`).join("")
  }</div>`;
}
function renderReader() {
  if (reader.kind === "pdf") return renderPdfReader();
  return renderMdReader();
}
function renderMdReader() {
  const fontCss = (MD_FONTS.find((f) => f.code === reader.font) || MD_FONTS[0]).css;
  const bg = reader.customBg || (MD_BGS.find((b) => b.code === reader.bg) || MD_BGS[0]).bg;
  const fg = textOn(bg);
  // menu groupé par famille ; chaque option s'affiche dans sa propre police
  const groups = [];
  MD_FONTS.forEach((f) => {
    let g = groups.find((x) => x.name === (f.group || ""));
    if (!g) { g = { name: f.group || "", items: [] }; groups.push(g); }
    g.items.push(f);
  });
  const fontOpts = groups.map((g) => `<optgroup label="${esc(g.name)}">${
    g.items.map((f) => `<option value="${f.code}" style="font-family:${f.css}" ${f.code === reader.font ? "selected" : ""}>${esc(f.label)}</option>`).join("")
  }</optgroup>`).join("");
  const bgChips = MD_BGS.map((b) => `<button class="md-swatch ${!reader.customBg && reader.bg === b.code ? "active" : ""}" data-md-bg="${b.code}" style="background:${b.bg}" title="${b.label}"></button>`).join("");

  const docs = orderedDocs();
  const cur = currentDoc();
  const idx = cur ? docs.findIndex((d) => d.id === cur.id) : -1;
  const connected = window.DriveSync && DriveSync.isConnected();
  const items = docs.map((d, i) => `<div class="md-item ${d.id === state.readerCurrent ? "active" : ""}" data-md-open="${d.id}">
      <span class="md-num">${i + 1}</span>
      <div class="grow" style="min-width:0">
        <div class="md-item-t">${esc(d.name || "Document")}</div>
        <div class="md-item-s">${esc(fmtSize(d.size || (readerLib.texts[d.id] || "").length))}${readerLib.texts[d.id] != null ? "" : " · sur le Drive"}</div></div>
      <button class="btn ghost small" data-md-move="-1" data-d="${d.id}" ${i === 0 ? "disabled" : ""} title="Monter">↑</button>
      <button class="btn ghost small" data-md-move="1" data-d="${d.id}" ${i === docs.length - 1 ? "disabled" : ""} title="Descendre">↓</button>
      <button class="btn ghost small" data-md-del="${d.id}" title="Retirer">✕</button>
    </div>`).join("");

  const nav = docs.length > 1 && idx > -1
    ? `<div class="md-nav">
        <button class="btn ghost small" data-md-prev ${idx === 0 ? "disabled" : ""}>‹ Précédent</button>
        <span class="grow" style="text-align:center">${idx + 1} / ${docs.length}</span>
        <button class="btn ghost small" data-md-next ${idx === docs.length - 1 ? "disabled" : ""}>Suivant ›</button></div>`
    : "";
  const curText = cur ? readerLib.texts[cur.id] : null;
  let body;
  if (!connected) body = `<div class="center-empty">Connecte-toi à Google Drive (menu de gauche) : tes documents y sont enregistrés et suivent d'un appareil à l'autre.</div>`;
  else if (cur && curText != null) body = `${nav}<div class="md-doc" style="font-family:${fontCss};background:${bg};color:${fg};font-size:${reader.size}px">${mdToHtml(curText)}</div>`;
  else if (cur) body = `${nav}<div class="center-empty">${readerBusy ? "Chargement du document…" : "Document non chargé — clique à nouveau dessus dans la liste."}</div>`;
  else body = `<div class="center-empty">${docs.length ? "Choisis un document dans la liste de lecture." : (readerBusy ? "Lecture du Drive…" : "Aucun document.<br>Clique sur « Importer des .md » — tu peux en sélectionner plusieurs d'un coup.")}</div>`;

  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Lecteur</div>
      <button class="btn ghost small" data-md-refresh>${readerBusy ? "…" : "↻"}</button>
      ${cur && readerLib.texts[cur.id] != null ? '<button class="btn secondary small" data-md-print>📄 Imprimer / PDF</button>' : ""}
      ${docs.length ? '<button class="btn ghost small" data-md-clear>Tout retirer</button>' : ""}
      <button class="btn" data-md-import>📂 Importer des .md</button></div>
    ${readerTabs()}
    <div class="md-bar">
      <label class="md-ctl"><span>Police</span><select id="mdFont">${fontOpts}</select></label>
      <label class="md-ctl"><span>Taille</span><input type="number" id="mdSize" min="12" max="28" step="1" value="${reader.size}"/></label>
      <div class="md-ctl"><span>Fond</span><div class="md-swatches">${bgChips}
        <input type="color" id="mdCustom" value="${esc(reader.customBg || bg)}" title="Couleur personnalisée"/></div></div>
      <span class="grow"></span>
    </div>
    <div class="md-layout">
      <div class="md-side">
        <div class="section-h" style="margin-top:0">Liste de lecture <span class="muted">(${docs.length})</span></div>
        <div class="md-list">${items || '<div class="muted" style="font-size:12px">Vide.</div>'}</div>
        ${docs.length ? `<div class="muted" style="font-size:11px;margin-top:8px">Enregistrés sur ton Google Drive</div>` : ""}
      </div>
      <div class="md-main">${body}</div>
    </div>`;
}

// ----------------------------- Outils PDF -----------------------------
// Tout se fait dans le navigateur : aucun fichier n'est envoyé sur un serveur.
// Les bibliothèques (pdf-lib, pdf.js) sont embarquées dans le site et chargées
// seulement quand cette section est utilisée, pour ne pas alourdir l'app.
let pdfTool = "fusion";
let pdfFiles = [];            // [{name, size, bytes}]
let pdfBusy = "", pdfLog = "";

function pdfSay(msg) { pdfLog = msg; if (view.section === "pdftools") render(); }
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) return resolve();
    const el = document.createElement("script");
    el.src = src; el.async = true; el.setAttribute("data-src", src);
    el.onload = () => resolve(); el.onerror = () => reject(new Error("Chargement impossible : " + src));
    document.head.appendChild(el);
  });
}
async function needPdfLib() {
  if (!window.PDFLib) { pdfSay("Chargement de l'outil…"); await loadScript("vendor/pdf-lib.min.js"); }
  if (!window.PDFLib) throw new Error("Bibliothèque PDF indisponible.");
  return window.PDFLib;
}
async function needPdfJs() {
  if (!window.pdfjsLib) {
    await loadScript("vendor/pdf.min.js");
    if (!window.pdfjsLib) throw new Error("Moteur PDF indisponible (fichier vendor/pdf.min.js non chargé).");
  }
  // toujours vérifié : sans worker, pdf.js ne peut rien afficher
  const opts = window.pdfjsLib.GlobalWorkerOptions;
  if (opts && !opts.workerSrc) opts.workerSrc = "vendor/pdf.worker.min.js";
  return window.pdfjsLib;
}
function downloadBytes(name, bytes, type) {
  const blob = new Blob([bytes], { type: type || "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// --- 1. Fusionner plusieurs PDF ---
async function pdfMerge() {
  if (pdfFiles.length < 2) { alert("Ajoute au moins deux fichiers PDF."); return; }
  pdfBusy = "fusion"; render();
  try {
    const { PDFDocument } = await needPdfLib();
    const out = await PDFDocument.create();
    let pages = 0;
    for (const f of pdfFiles) {
      pdfSay(`Lecture de ${f.name}…`);
      const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((pg) => { out.addPage(pg); pages++; });
    }
    pdfSay("Assemblage…");
    const bytes = await out.save({ useObjectStreams: true });
    downloadBytes("operations01-fusion.pdf", bytes);
    pdfSay(`Fusion terminée : ${pages} page(s), ${fmtSize(bytes.length)}.`);
  } catch (e) { pdfSay("Échec : " + e.message); }
  pdfBusy = ""; render();
}

// --- 2. Convertir un PDF en Markdown ---
// Le texte est extrait avec ses positions et sa taille de police, ce qui permet de
// reconstituer titres, paragraphes et listes. Un PDF scanné (image pure) n'a pas de
// texte à extraire : on le signale au lieu de produire un fichier vide.
// Reconstitue un Markdown à partir des lignes extraites (texte, taille, ordonnée).
// La taille de police dominante sert de référence : au-dessus, c'est un titre.
function linesToMarkdown(lines, title) {
  const sizes = lines.filter((l) => l.text).map((l) => Math.round(l.size));
  const freq = {}; sizes.forEach((v) => { freq[v] = (freq[v] || 0) + 1; });
  const body = Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0]) || 10;
  const isList = (t) => /^([-*+]|\d+[.)])\s+/.test(t);
  const isHead = (t) => /^#{1,6}\s/.test(t);
  const blocks = [];            // un bloc = un paragraphe, un titre ou une liste
  let prev = null;
  lines.forEach((l) => {
    if (l.brk) { blocks.push("---"); prev = null; return; }
    if (!l.text) return;
    const t = l.text, ratio = l.size / body;
    let out;
    if (ratio >= 1.6) out = "# " + t;
    else if (ratio >= 1.3) out = "## " + t;
    else if (ratio >= 1.15) out = "### " + t;
    else if (/^([-•·▪–]|\d+[.)])\s+/.test(t)) out = t.replace(/^[•·▪–]\s+/, "- ");
    else out = t;
    // éléments de liste consécutifs : même bloc, une ligne chacun
    if (prev && isList(out) && isList(prev.last)) {
      blocks[blocks.length - 1] += "\n" + out;
      prev = { last: out, ratio, y: l.y };
      return;
    }
    // lignes d'un même paragraphe : on recolle (corps de texte, sans ponctuation finale)
    if (prev && ratio < 1.15 && prev.ratio < 1.15 && !isList(out) && !isList(prev.last) && !isHead(prev.last)
        && Math.abs(prev.y - l.y) < body * 2.2 && !/[.!?:;»)]$/.test(prev.last)) {
      blocks[blocks.length - 1] += " " + out;
      prev = { last: blocks[blocks.length - 1], ratio, y: l.y };
      return;
    }
    blocks.push(out);
    prev = { last: out, ratio, y: l.y };
  });
  return `# ${title}\n\n` + blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
async function pdfToMarkdown() {
  if (pdfFiles.length !== 1) { alert("Choisis un seul fichier PDF à convertir."); return; }
  pdfBusy = "markdown"; render();
  const f = pdfFiles[0];
  try {
    const pdfjs = await needPdfJs();
    const src = await pdfjs.getDocument({ data: f.bytes.slice(0), standardFontDataUrl: "vendor/standard_fonts/" }).promise;
    const lines = [];
    for (let i = 1; i <= src.numPages; i++) {
      pdfSay(`Page ${i} / ${src.numPages}…`);
      const page = await src.getPage(i);
      const tc = await page.getTextContent();
      // regroupement des fragments par ligne (même ordonnée, à la tolérance près)
      const rows = [];
      tc.items.forEach((it) => {
        if (!it.str) return;
        const y = Math.round(it.transform[5]);
        const size = Math.abs(it.transform[0]) || 10;
        let row = rows.find((r) => Math.abs(r.y - y) <= Math.max(2, size * 0.4));
        if (!row) { row = { y, size, parts: [] }; rows.push(row); }
        row.size = Math.max(row.size, size);
        row.parts.push({ x: it.transform[4], s: it.str });
      });
      rows.sort((a, b) => b.y - a.y);
      rows.forEach((r) => {
        r.parts.sort((a, b) => a.x - b.x);
        const text = r.parts.map((p) => p.s).join("").replace(/\s+/g, " ").trim();
        if (text) lines.push({ text, size: r.size, y: r.y, page: i });
      });
      if (i < src.numPages) lines.push({ text: "", size: 0, y: 0, page: i, brk: true });
    }
    if (!lines.some((l) => l.text)) throw new Error("Aucun texte trouvé : ce PDF est probablement un scan (image). Une reconnaissance de caractères serait nécessaire.");
    const text = linesToMarkdown(lines, f.name.replace(/\.pdf$/i, ""));
    downloadBytes(f.name.replace(/\.pdf$/i, "") + ".md", text, "text/markdown;charset=utf-8");
    pdfSay(`Conversion terminée : ${src.numPages} page(s), ${fmtSize(text.length)} de Markdown.`);
  } catch (e) { pdfSay("Échec : " + e.message); }
  pdfBusy = ""; render();
}

function renderPdfTools() {
  const tabs = [["fusion", "Fusionner"], ["markdown", "PDF → Markdown"]]
    .map(([id, lbl]) => `<button class="chip ${pdfTool === id ? "active" : ""}" data-pdftab="${id}">${lbl}</button>`).join("");
  const multi = pdfTool === "fusion";
  const files = pdfFiles.map((f, i) => `<div class="md-item" style="cursor:default">
      <span class="md-num">${i + 1}</span>
      <div class="grow" style="min-width:0"><div class="md-item-t">${esc(f.name)}</div>
        <div class="md-item-s">${esc(fmtSize(f.size))}</div></div>
      ${multi ? `<button class="btn ghost small" data-pdf-move="-1" data-i="${i}" ${i === 0 ? "disabled" : ""} title="Monter">↑</button>
      <button class="btn ghost small" data-pdf-move="1" data-i="${i}" ${i === pdfFiles.length - 1 ? "disabled" : ""} title="Descendre">↓</button>` : ""}
      <button class="btn ghost small" data-pdf-del="${i}" title="Retirer">✕</button>
    </div>`).join("");

  let panel = "";
  if (pdfTool === "fusion") {
    panel = `<div class="muted" style="font-size:12px;margin-bottom:10px">Les PDF sont assemblés dans l'ordre de la liste — utilise ↑ ↓ pour le modifier.</div>
      <button class="btn" data-pdf-run ${pdfFiles.length < 2 || pdfBusy ? "disabled" : ""}>${pdfBusy === "fusion" ? "Fusion en cours…" : "Fusionner en un seul PDF"}</button>`;
  } else {
    panel = `<div class="muted" style="font-size:12px;margin-bottom:10px">Le texte est extrait avec sa mise en forme approximative : les titres sont déduits de la taille de police, et les paragraphes reconstitués. Un PDF scanné (image pure) ne contient pas de texte à extraire.</div>
      <button class="btn" data-pdf-run ${pdfFiles.length !== 1 || pdfBusy ? "disabled" : ""}>${pdfBusy === "markdown" ? "Conversion en cours…" : "Convertir en Markdown"}</button>`;
  }

  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Outils PDF</div>
      ${pdfFiles.length ? '<button class="btn ghost small" data-pdf-clear>Vider</button>' : ""}
      <button class="btn secondary" data-pdf-add>📂 Choisir des PDF</button></div>
    <div class="chip-row" style="margin-bottom:14px">${tabs}</div>
    <div class="md-layout">
      <div class="md-side">
        <div class="section-h" style="margin-top:0">Fichiers <span class="muted">(${pdfFiles.length})</span></div>
        <div class="md-list">${files || '<div class="muted" style="font-size:12px">Aucun fichier sélectionné.</div>'}</div>
      </div>
      <div class="md-main">
        <div class="card">${panel}
          ${pdfLog ? `<div class="muted" style="font-size:12px;margin-top:10px">${esc(pdfLog)}</div>` : ""}</div>
        <div class="muted" style="font-size:11px;margin-top:12px;line-height:1.5">🔒 Le traitement a lieu entièrement dans ton navigateur : aucun fichier n'est envoyé sur Internet.</div>
      </div>
    </div>`;
}

// ----------------------------- Recherche globale -----------------------------
let searchQ = "";
function renderSearch() {
  const q = searchQ.trim().toLowerCase();
  const results = [];
  if (q) {
    const has = (s) => String(s || "").toLowerCase().includes(q);
    state.missions.forEach((m) => { if (has(m.title) || has(companyName(m.companyId))) results.push({ sec: "missions", id: m.id, ic: "📁", title: m.title || "Projet", sub: companyName(m.companyId) }); });
    state.contacts.forEach((c) => { if (has(contactName(c)) || has(c.organization) || has(c.email) || has(c.jobTitle)) results.push({ sec: "contacts", id: c.id, ic: "👥", title: contactName(c), sub: [c.jobTitle, c.organization].filter(Boolean).join(" · ") }); });
    state.companies.forEach((c) => { if (has(c.name)) results.push({ sec: "groupe", id: c.id, ic: "🏢", title: c.name || "Société", sub: "" }); });
    state.invoices.forEach((v) => { if (has(v.title) || has(v.categoryName) || has(companyName(v.companyId))) results.push({ sec: "finances", id: v.id, ic: "€", title: v.title || "Facture", sub: `${euros(v.amount)} · ${companyName(v.companyId)}` }); });
    state.tasks.forEach((t) => { if (has(t.title)) results.push({ sec: "tasks", id: null, ic: "✅", title: t.title || "Tâche", sub: taskStatusLabel(t.status) }); });
    state.actions.forEach((a) => { if (has(a.title) || has(a.recipientName)) results.push({ sec: "actions", id: a.id, ic: "🎫", title: a.title || "Action", sub: a.recipientName || "" }); });
    state.rendezvous.forEach((r) => { if (has(r.title) || has(r.withName)) results.push({ sec: "rendezvous", id: r.id, ic: "📅", title: r.title || "Rendez-vous", sub: rdvWhen(r) }); });
  }
  const rows = results.map((r) => `<div class="row" data-search-open="${r.sec}" data-search-id="${r.id || ""}" style="border-left-color:var(--primary)">
    <span class="ic">${r.ic}</span><div class="grow"><div class="r-title">${esc(r.title)}</div><div class="r-sub">${esc(r.sub)}</div></div></div>`).join("");
  return `<div class="page-title">Recherche</div>
    <input id="globalSearch" placeholder="Rechercher un projet, un contact, une facture…" value="${esc(searchQ)}" style="margin-bottom:14px"/>
    ${q ? `<div class="muted" style="font-size:12px;margin-bottom:8px">${results.length} résultat(s)</div><div class="list">${rows || '<div class="center-empty">Aucun résultat.</div>'}</div>` : '<div class="center-empty">Tape un mot-clé pour chercher dans toutes les sections.</div>'}`;
}

// ----------------------------- Relances (analyse des mails) -----------------------------
// Une entrée par boîte mail : « main » pour le compte relié, puis les boîtes
// secondaires déclarées dans state.mailboxes (chacune a son fichier d'analyse).
let mailStore = {};
let mailData = null, mailLoading = false, mailLoadedAt = 0;
const MAIL_RETRY = 5 * 60000;    // après un échec ou un fichier absent
const MAIL_FRESH = 15 * 60000;   // relecture automatique quand les analyses datent (script toutes les 15 min)
const mailVisible = () => view.section === "relances" || (view.section === "missions" && view.detailId);
async function loadMails() {
  if (!(window.DriveSync && DriveSync.isConnected())) return;
  if (mailLoading) return;
  mailLoadedAt = Date.now();
  mailLoading = true; if (mailVisible()) render();
  try { mailStore.main = await DriveSync.readMails(); } catch (e) { mailStore.main = null; }
  mailData = mailStore.main;
  for (const b of (state.mailboxes || [])) {
    try { mailStore[b.id] = await DriveSync.readMailbox(b.fileName); } catch (e) { mailStore[b.id] = null; }
  }
  mailLoading = false; if (mailVisible()) render();
}
// Ajoute une boîte secondaire : crée son fichier d'analyse, le partage avec ce
// compte (écriture) ainsi que le fichier de données (lecture, pour les contacts).
async function addMailbox(label, email) {
  email = String(email || "").trim().toLowerCase();
  if (!email || email.indexOf("@") === -1) { alert("Adresse e-mail invalide."); return; }
  if ((state.mailboxes || []).some((b) => b.email === email)) { alert("Cette boîte est déjà déclarée."); return; }
  const slug = email.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `operations01-mails-${slug}.json`;
  mailLoading = true; render();
  try {
    const fileId = await DriveSync.ensureMailbox(fileName);
    let shared = true, dataShared = true;
    try { await DriveSync.shareFile(fileId, email, "writer"); } catch (e) { shared = false; }
    try { const did = await DriveSync.dataFileId(); if (did) await DriveSync.shareFile(did, email, "reader"); else dataShared = false; } catch (e) { dataShared = false; }
    state.mailboxes = state.mailboxes || [];
    state.mailboxes.push({ id: uid(), label: label || email, email, fileName, fileId, shared, dataShared, createdAt: Date.now() });
    save();
    mailLoading = false; render();
    mailboxHelp(state.mailboxes[state.mailboxes.length - 1]);
  } catch (e) {
    mailLoading = false; render();
    alert("Impossible de préparer cette boîte : " + e.message);
  }
}
function mailboxHelp(b) {
  showModal(`<div class="modal-head"><strong class="grow">Relier la boîte ${esc(b.email)}</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <ol class="mb-steps">
      <li>Connecte-toi à Google avec <strong>${esc(b.email)}</strong>, puis ouvre <a href="https://script.google.com" target="_blank" rel="noopener">script.google.com</a> → <strong>Nouveau projet</strong>.</li>
      <li>Colle le contenu du fichier <code>appsscript-mails.gs</code> (le même script que pour la boîte principale).</li>
      <li>En haut du script, renseigne :<br><code>var FICHIER_MAILS_ID = "${esc(b.fileId)}";</code>
        <button class="btn ghost small" data-copy="${esc(b.fileId)}">Copier l'identifiant</button></li>
      <li>Exécute <strong>installerAnalyseMails</strong> et autorise l'accès (Gmail + Drive). Pour tester tout de suite : exécute <strong>analyserMails</strong>.</li>
    </ol>
    <div class="muted" style="font-size:12px">${b.shared ? "Le fichier d'analyse a été partagé avec cette adresse (écriture)." : "⚠️ Le partage automatique a échoué : partage à la main le fichier « " + esc(b.fileName) + " » (Drive) avec cette adresse, en écriture."}
      ${b.dataShared ? " Le fichier de données lui est partagé en lecture (contacts)." : " Le fichier de données n'a pas pu être partagé : les relances de contacts ne seront pas calculées pour cette boîte, mais la correspondance le sera."}</div>
    <div style="margin-top:12px"><button class="btn" data-modal-close>Fermer</button></div>`);
  document.querySelectorAll("[data-modal-close]").forEach((b) => b.onclick = closeModal);
  const cp = document.querySelector("[data-copy]");
  if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(cp.dataset.copy); toast("Identifiant copié"); } catch (e) {} };
}
function renderMailboxes() {
  const main = mailStore.main;
  const line = (label, email, sub, btns) => `<div class="row" style="cursor:default;border-left-color:var(--activity)">
    <span class="ic">📮</span><div class="grow"><div class="r-title">${esc(label)}</div><div class="r-sub">${esc(email)}${sub ? ` · ${sub}` : ""}</div></div>${btns || ""}</div>`;
  const when = (d) => d && d.generatedAt ? `dernière analyse ${new Date(d.generatedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · ${(d.threads || []).length} fils` : "script pas encore exécuté";
  const rows = [line("Boîte principale", (main && main.mailbox) || "compte relié à l'app", when(main))]
    .concat((state.mailboxes || []).map((b) => line(b.label || b.email, b.email, when(mailStore[b.id]),
      `<button class="btn ghost small" data-mailbox-help="${b.id}">Marche à suivre</button><button class="btn ghost small" data-del-mailbox="${b.id}" title="Retirer">✕</button>`)));
  return `<div class="section-h">📮 Boîtes mail <span class="muted">(${(state.mailboxes || []).length + 1})</span></div>
    <div class="list">${rows.join("")}</div>
    <div class="card" style="margin-top:10px"><div class="inline" style="flex-wrap:wrap">
      <input id="mbLabel" class="grow" placeholder="Nom (ex. Boîte perso)" style="min-width:140px"/>
      <input id="mbEmail" class="grow" type="email" placeholder="adresse@gmail.com" inputmode="email" style="min-width:200px"/>
      <button class="btn small" data-add-mailbox>+ Ajouter une boîte</button></div>
      <div class="muted" style="font-size:12px;margin-top:6px">Chaque boîte est lue par le script Google installé dans son compte. Une boîte qui n'est pas chez Google (Outlook, OVH…) peut être rapatriée dans l'une de tes boîtes Gmail (Gmail → Paramètres → Comptes → « Consulter d'autres comptes de messagerie »), puis lue par ce script.</div></div>`;
}
function mailRow(it, extra) {
  const link = it.link ? `<a class="btn ghost small" href="${esc(it.link)}" target="_blank" rel="noopener">Ouvrir</a>` : "";
  const info = [extra ? extra(it) : null, it.date ? fmtDate((it.date || "").slice(0, 10)) : null].filter(Boolean).join(" · ");
  return `<div class="row" style="cursor:default;border-left-color:var(--activity)">
    <div class="grow"><div class="r-title">${esc(it.subject || "(sans objet)")}</div>
      <div class="r-sub">${esc(it.name || it.from || "")}${info ? ` · ${esc(info)}` : ""}</div></div>${link}</div>`;
}
// Bloc « Justificatifs manquants » (données locales, toujours à jour).
function receiptsBlock() {
  const miss = missingReceipts();
  if (!miss.length) return `<div class="section-h">🧾 Justificatifs manquants <span class="muted">(0)</span></div>
    <div class="muted" style="padding:4px 2px;font-size:13px">Toutes les écritures ont un justificatif. 👌</div>`;
  const rows = miss.slice(0, 60).map((v) => `<div class="row" data-open-invoice="${v.id}" style="border-left-color:#d23c3c">
    <div class="grow"><div class="r-title">${esc(v.title || "Écriture sans intitulé")}</div>
      <div class="r-sub">${[fmtDate(v.startDate), euros(v.amount), esc(companyName(v.companyId)), v.direction === "recette" ? "Recette" : "Dépense"].filter(Boolean).join(" · ")}</div></div>
    <span class="muted">›</span></div>`).join("");
  return `<div class="section-h">🧾 Justificatifs manquants <span class="muted">(${miss.length})</span></div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">Ouvre l'écriture pour coller le lien du justificatif, ou coche « Aucun justificatif nécessaire ».</div>
    <div class="list">${rows}</div>
    ${miss.length > 60 ? `<div class="muted" style="font-size:12px;margin-top:6px">… et ${miss.length - 60} autre(s).</div>` : ""}`;
}
function renderRelances() {
  const head = `<div class="toolbar"><div class="page-title grow" style="margin:0">Relances</div>
      <button class="btn secondary small" data-mail-refresh>${mailLoading ? "…" : "↻ Rafraîchir"}</button></div>`;
  const receipts = receiptsBlock();
  if (!(window.DriveSync && DriveSync.isConnected()))
    return head + receipts + `<div class="section-h">✉️ Suivi des mails</div><div class="center-empty">Connecte-toi à Google Drive (menu de gauche) pour activer le suivi des mails.</div>`;
  const m = mailData;
  const boxes = renderMailboxes();
  if (!m && !Object.keys(mailStore).some((k) => mailStore[k])) return head + receipts + boxes + `<div class="section-h">✉️ Suivi des mails</div>` + (mailLoading
    ? '<div class="center-empty">Chargement…</div>'
    : `<div class="center-empty">Aucune analyse disponible.<br>Installe le script « Mails » (voir la marche à suivre) : il analysera ta boîte Gmail chaque heure et remplira cet onglet.</div>`);
  // Toutes les boîtes sont fusionnées ; l'étiquette de la boîte est ajoutée
  // quand il y en a plusieurs.
  const multi = Object.keys(mailStore).filter((k) => mailStore[k]).length > 1;
  const merged = (field) => {
    const out = [];
    Object.keys(mailStore).forEach((k) => { const d = mailStore[k]; if (d) (d[field] || []).forEach((x) => out.push(Object.assign({ box: mailboxLabel(k) }, x))); });
    return out.sort((x, y) => (y.date || "").localeCompare(x.date || ""));
  };
  const grp = (title, ic, arr, extra) => `<div class="section-h">${ic} ${title} <span class="muted">(${(arr || []).length})</span></div>
    <div class="list">${(arr || []).length ? arr.map((x) => mailRow(x, (it) => [extra ? extra(it) : null, multi ? it.box : null].filter(Boolean).join(" · "))).join("") : '<div class="muted" style="padding:4px 2px">—</div>'}</div>`;
  const when = m && m.generatedAt ? `Dernière analyse : ${new Date(m.generatedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}` : "";
  return head + receipts + boxes + `<div class="muted" style="font-size:12px;margin:14px 0 8px">${esc(when)}</div>`
    + grp("Non lus de contacts", "📩", merged("unread"))
    + grp("À relancer", "⏰", merged("relance"), (it) => `sans réponse depuis ${it.jours != null ? it.jours : "?"} j`)
    + grp("Nouveaux expéditeurs", "🆕", merged("nouveau"))
    + grp("Rendez-vous à préparer", "📅", merged("rdvPrep"));
}

// ----------------------------- Missions -----------------------------
function missionTotal(m) { return (m.entries || []).reduce((t, e) => t + entryElapsed(e), 0); }
function entryElapsed(e) { const run = e.timerStartedAt ? (Date.now() - e.timerStartedAt) / 1000 : 0; return (e.accumulatedSeconds || 0) + run; }
// Fixe le temps d'un élément (saisie ou correction manuelle).
// Si un chrono tourne, il repart de la valeur corrigée au lieu de s'y ajouter.
function setEntryDuration(e, seconds) {
  e.accumulatedSeconds = Math.max(0, seconds || 0);
  if (e.timerStartedAt) e.timerStartedAt = Date.now();
}
// Dates repères d'une mission.
// Démarrage : date saisie si renseignée, sinon 1er événement, sinon création.
function missionStart(m) {
  if (m.startDate) return m.startDate;
  const d = (m.entries || []).map((e) => e.date).filter(Boolean).sort();
  if (d.length) return d[0];
  return m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 10) : "";
}
// Dernier événement : date la plus récente de l'historique.
function missionLast(m) {
  const d = (m.entries || []).map((e) => e.date).filter(Boolean).sort();
  return d.length ? d[d.length - 1] : "";
}
const missionCreated = (m) => m.createdAt || (m.startDate ? new Date(m.startDate + "T12:00:00").getTime() : 0);
// Classement par ordre chronologique de création (la plus ancienne en premier).
// Le tri est stable : à date identique (données importées en bloc), l'ordre
// d'origine du fichier est conservé.
let missionView = "liste", missionSort = "creation";
const MISSION_SORTS = [["creation", "Création"], ["nom", "Nom (A→Z)"], ["recent", "Dernier événement"]];
function sortMissions(arr) {
  const a = [...arr];
  if (missionSort === "nom") a.sort((x, y) => (x.title || "").localeCompare(y.title || "", "fr", { sensitivity: "base" }));
  else if (missionSort === "recent") a.sort((x, y) => (missionLast(y) || "").localeCompare(missionLast(x) || "") || missionCreated(y) - missionCreated(x));
  else a.sort((x, y) => missionCreated(x) - missionCreated(y));   // ordre chronologique de création
  return a;
}
function sortedMissions() { return sortMissions(state.missions); }
const missionRunning = (m) => (m.entries || []).some((e) => e.timerStartedAt);
const anyTimerRunning = () => state.missions.some(missionRunning);
function renderMissions() {
  if (view.detailId) return renderMissionDetail(view.detailId);
  const all = sortedMissions();
  const nbRunning = all.filter(missionRunning).length;
  const banner = nbRunning
    ? `<div class="run-banner"><span class="run-dot"></span>
        <span class="grow">${nbRunning} chronomètre(s) en cours</span>
        <button class="btn danger small" data-stop-all>■ Tout arrêter</button></div>`
    : "";
  const viewChips = [["liste", "Liste"], ["kanban", "Kanban"]]
    .map(([id, lbl]) => `<button class="chip ${missionView === id ? "active" : ""}" data-mview="${id}">${lbl}</button>`).join("");
  const sortOpts = MISSION_SORTS.map(([id, lbl]) => `<option value="${id}" ${missionSort === id ? "selected" : ""}>${lbl}</option>`).join("");
  const head = `<div class="toolbar"><div class="page-title grow" style="margin:0">Projets</div>
      <button class="btn danger small" data-reset>Réinitialiser</button>
      <button class="btn secondary small" data-import>Importer</button>
      <button class="btn secondary small" data-export>Exporter</button>
      <button class="btn" data-add-mission>+ Nouveau projet</button></div>
    <div class="toolbar" style="margin-bottom:12px">
      <div class="chip-row">${viewChips}</div>
      <span class="grow"></span>
      <label class="md-ctl" style="flex-direction:row;align-items:center;gap:6px"><span>Trier par</span>
        <select id="missionSort" style="width:auto">${sortOpts}</select></label></div>`;

  const meta = (m) => {
    const parts = [`${(m.entries || []).length} élément(s)`,
      `⏱ <span class="timer${missionRunning(m) ? " running" : ""}" data-total="${m.id}">${fmtDuration(missionTotal(m))}</span>`];
    if (m.companyId) parts.push(esc(companyName(m.companyId)));
    return parts.join(" · ");
  };
  const dates = (m) => {
    const st = missionStart(m), la = missionLast(m);
    return `Début ${st ? esc(fmtDate(st)) : "—"} · Dernier événement ${la ? esc(fmtDate(la)) : "—"}`;
  };

  if (missionView === "kanban") {
    const cols = STATUSES.map((st, idx) => {
      const items = sortMissions(state.missions.filter((m) => (m.statusCode || "aDemarrer") === st.code));
      const cards = items.map((m) => {
        const run = missionRunning(m);
        return `<div class="kb-card mission-card" data-mission-card="${m.id}" style="border-left-color:${run ? "#d23c3c" : "var(--primary)"}">
          <div class="kb-title-row"><span class="grow">${esc(m.title || "Nouveau projet")}</span>${run ? '<span class="run-dot" title="Chronomètre en cours"></span>' : ""}</div>
          <div class="kb-meta">${meta(m)}</div>
          <div class="kb-meta">${dates(m)}</div>
          <div class="kb-actions">
            <button class="btn ghost small" data-open-mission="${m.id}">Ouvrir</button>
            <span class="grow"></span>
            <button class="btn ghost small" data-mission-move="-1" data-m="${m.id}" ${idx === 0 ? "disabled" : ""} title="Colonne précédente">‹</button>
            <button class="btn ghost small" data-mission-move="1" data-m="${m.id}" ${idx === STATUSES.length - 1 ? "disabled" : ""} title="Colonne suivante">›</button>
          </div></div>`;
      }).join("");
      return `<div class="kb-col" data-mission-col="${st.code}">
        <div class="kb-head"><span class="grow">${st.label}</span><span class="kb-count">${items.length}</span></div>
        <div class="kb-body">${cards || '<div class="kb-empty">Aucun projet</div>'}</div></div>`;
    }).join("");
    return head + banner
      + `<div class="muted" style="font-size:11px;margin-bottom:10px">Glisse un projet vers une autre colonne pour changer son statut, ou utilise ‹ ›.</div>
         <div class="kb-board cols4">${cols}</div>
         <button class="btn fab" data-add-mission>+</button>`;
  }

  const rows = all.map((m) => {
    const run = missionRunning(m);
    return `<div class="row" data-open-mission="${m.id}" style="border-left-color:${run ? "#d23c3c" : "var(--primary)"}">
      <div class="grow"><div class="r-title">${esc(m.title || "Nouveau projet")}</div>
        <div class="r-sub">${meta(m)}</div>
        <div class="r-sub">${dates(m)}</div></div>
      ${run ? '<span class="run-dot" title="Chronomètre en cours"></span>' : ""}
      <span class="badge ${m.statusCode}">${statusLabel(m.statusCode)}</span></div>`;
  }).join("");
  return head + banner
    + `<div class="list">${all.length ? rows : '<div class="center-empty">Aucun projet.</div>'}</div>
       <button class="btn fab" data-add-mission>+</button>`;
}

// ----------------------------- Projet : fiche à trois vues -----------------------------
// Résumé · Gestion de projet (tâches par section) · Correspondance (mails liés).
let projectTab = "resume", projectTabFor = null;
const PROJECT_TABS = [["resume", "Résumé"], ["gestion", "Gestion de projet"], ["courrier", "Correspondance"]];

function projectTasks(m) { return state.tasks.filter((t) => t.missionId === m.id); }
const taskDone = (t) => (t.status || "aFaire") === "termine";
// Avancement d'une tâche : une tâche terminée vaut 100 ; une tâche non terminée
// ne peut pas afficher 100, même si le champ le dit.
function taskProgress(t) {
  if (taskDone(t)) return 100;
  const p = Number(t.progress);
  return isFinite(p) ? Math.max(0, Math.min(99, Math.round(p))) : 0;
}
function setTaskProgress(t, p) {
  p = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
  t.progress = p;
  if (p >= 100) t.status = "termine";
  else if (p > 0 && (t.status || "aFaire") !== "enCours") t.status = "enCours";
  else if (p === 0 && t.status === "termine") t.status = "aFaire";
}
// Avancement du projet : moyenne des avancements de ses tâches (null sans tâche).
function projectProgress(m) {
  const ts = projectTasks(m);
  if (!ts.length) return null;
  return Math.round(ts.reduce((a, t) => a + taskProgress(t), 0) / ts.length);
}
function taskSlots(t) { return state.slots.filter((s) => s.taskId === t.id).sort((a, b) => (a.date || "").localeCompare(b.date || "")); }
// Provenance d'une tâche : issue d'un mail, planifiée dans l'emploi du temps, ou saisie.
function taskOrigin(t) {
  const out = [];
  if (t.origin === "mail") out.push({ ic: "✉️", label: "Issue d'un mail", link: t.mailLink || "" });
  const slots = taskSlots(t);
  const slot = slots.find((s) => s.date >= todayISO()) || slots[slots.length - 1];
  if (slot) out.push({ ic: "📅", label: `Planifiée le ${fmtDate(slot.date)} à ${fmtMin(slot.start)}` });
  if (t.origin === "import") out.push({ ic: "⤓", label: "Importée d'un tableau" });
  if (!out.length) out.push({ ic: "✍️", label: "Saisie à la main" });
  return out;
}
const taskSeconds = (m, t) => (m.entries || []).filter((e) => e.taskId === t.id).reduce((a, e) => a + entryElapsed(e), 0);
const projectRunning = (m) => (m.entries || []).filter((e) => e.timerStartedAt);
function stopEntry(e) {
  if (!e.timerStartedAt) return;
  e.accumulatedSeconds = (e.accumulatedSeconds || 0) + (Date.now() - e.timerStartedAt) / 1000;
  e.timerStartedAt = null;
}
// Lance un chrono sur le projet (« suivi ») ou sur une tâche. On réutilise
// l'élément du jour s'il existe, pour ne pas multiplier les lignes d'historique.
function startProjectTimer(m, taskId) {
  const today = todayISO();
  m.entries = m.entries || [];
  let e = m.entries.find((x) => x.date === today && (taskId ? x.taskId === taskId : (x.kind === "suivi" && !x.taskId)));
  if (!e) {
    const t = taskId ? state.tasks.find((x) => x.id === taskId) : null;
    e = { id: uid(), kind: taskId ? "action" : "suivi", title: t ? (t.title || "Tâche") : "Suivi du projet", content: "", date: today, url: "",
      accumulatedSeconds: 0, timerStartedAt: null, createdAt: Date.now(), taskId: taskId || null };
    m.entries.push(e);
  }
  if (!e.timerStartedAt) e.timerStartedAt = Date.now();
  if (taskId) { const t = state.tasks.find((x) => x.id === taskId); if (t && (t.status || "aFaire") === "aFaire") t.status = "enCours"; }
  return e;
}
function projectWeekSeconds(m) {
  const { start, end } = weekInterval(new Date());
  return (m.entries || []).reduce((a, e) => {
    const d = e.date ? new Date(e.date + "T12:00:00") : null;
    return a + ((d && d >= start && d < end) ? entryElapsed(e) : 0);
  }, 0);
}
// Sections d'un projet : celles déclarées, puis celles rencontrées dans les tâches.
function projectSections(m) {
  const out = [...(m.sections || [])];
  projectTasks(m).forEach((t) => { const s = t.section || ""; if (s && out.indexOf(s) === -1) out.push(s); });
  return out;
}
const sortTasks = (ts) => [...ts].sort((a, b) => (taskDone(a) - taskDone(b))
  || (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || (a.createdAt || 0) - (b.createdAt || 0));

function renderMissionDetail(id) {
  const m = state.missions.find((x) => x.id === id);
  if (!m) return renderMissions();
  if (projectTabFor !== m.id) { projectTab = "resume"; projectTabFor = m.id; }
  const statusOpts = STATUSES.map((s) => `<option value="${s.code}" ${s.code === m.statusCode ? "selected" : ""}>${s.label}</option>`).join("");
  const running = projectRunning(m);
  const timerBar = running.length
    ? running.map((e) => `<div class="run-banner"><span class="run-dot"></span>
        <span class="grow">⏱ ${esc(e.title || "Suivi du projet")} · <span class="timer running" data-entry-time="${e.id}">${fmtDuration(entryElapsed(e))}</span></span>
        <button class="btn danger small" data-stop-entry="${e.id}" data-m="${m.id}">■ Arrêter</button></div>`).join("")
    : `<div class="inline" style="margin-bottom:12px;flex-wrap:wrap">
        <button class="btn" data-project-timer="${m.id}">▶ Suivi du projet</button>
        <span class="muted" style="font-size:12px">Temps total : <span class="timer" data-total="${m.id}">${fmtDuration(missionTotal(m))}</span> · cette semaine : ${fmtDuration(projectWeekSeconds(m))}</span></div>`;
  const tabs = PROJECT_TABS.map(([tid, lbl]) => `<button class="chip ${projectTab === tid ? "active" : ""}" data-projtab="${tid}">${lbl}</button>`).join("");
  const body = projectTab === "gestion" ? renderProjectGestion(m) : projectTab === "courrier" ? renderProjectCourrier(m) : renderProjectResume(m);
  return `<button class="back" data-back>‹ Projets</button>
    <div class="toolbar">
      <input class="grow" data-bind="missions|${m.id}|title" value="${esc(m.title)}" placeholder="Intitulé du projet" style="font-size:20px;font-weight:700"/>
      <select data-bind="missions|${m.id}|statusCode" style="width:auto">${statusOpts}</select>
    </div>
    ${timerBar}
    <div class="chip-row" style="margin-bottom:14px">${tabs}</div>
    ${body}`;
}

// ---- Résumé ----
function renderProjectResume(m) {
  const ts = projectTasks(m);
  const done = ts.filter(taskDone).length;
  const enCours = ts.filter((t) => t.status === "enCours").length;
  const late = ts.filter((t) => !taskDone(t) && t.dueDate && daysUntil(t.dueDate) < 0);
  const next = sortTasks(ts.filter((t) => !taskDone(t) && t.dueDate && daysUntil(t.dueDate) >= 0))[0];
  const prog = projectProgress(m);
  const mails = projectThreads(m).length;
  const stat = (n, lbl, color) => `<div class="cal-stat"${color ? ` style="border-left:4px solid ${color}"` : ""}><div class="cal-stat-n">${n}</div><div class="cal-stat-l">${lbl}</div></div>`;
  const entries = [...(m.entries || [])].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
  const entriesHtml = entries.length ? entries.map((e) => renderEntry(m.id, e)).join("") : '<div class="muted" style="padding:8px 2px">Aucun élément.</div>';
  const kindButtons = KINDS.map((k) => `<button class="chip" data-add-entry="${k.code}" data-m="${m.id}">${k.ic} ${k.label}</button>`).join("");
  return `<div class="cal-stats">
      ${stat(prog == null ? "—" : prog + " %", "avancement", prog == null ? "" : "var(--primary)")}
      ${stat(`${done}/${ts.length}`, `tâches terminées${enCours ? ` · ${enCours} en cours` : ""}`)}
      ${stat(late.length, "en retard", late.length ? "#d23c3c" : "")}
      ${stat(next ? fmtDate(next.dueDate) : "—", next ? `prochaine échéance · ${esc(next.title || "tâche")}` : "prochaine échéance")}
      ${stat(fmtDuration(missionTotal(m)), "temps passé")}
      ${stat(mails, "fils de correspondance")}
    </div>
    ${prog != null ? `<div class="pm-bar" style="margin:8px 0 14px"><div class="pm-bar-fill" style="width:${prog}%"></div></div>` : ""}
    <div class="card">
      <label class="field"><span>Société</span>${companySelect(`missions|${m.id}|companyId`, m.companyId)}</label>
      <label class="field"><span>Date de démarrage</span><input type="date" data-bind="missions|${m.id}|startDate" data-rerender value="${esc(missionStart(m))}"/></label>
      <label class="field"><span>Objectif / description</span><textarea data-bind="missions|${m.id}|summary" placeholder="En deux lignes : de quoi il s'agit, ce qu'on attend.">${esc(m.summary || "")}</textarea></label>
      <div class="muted" style="font-size:12px">Dernier événement : ${missionLast(m) ? esc(fmtDate(missionLast(m))) : "—"}</div>
    </div>
    ${late.length ? `<div class="section-h" style="color:#d23c3c">⚠️ En retard <span class="muted">(${late.length})</span></div>
      <div class="list">${late.map((t) => `<div class="row" data-goto-gestion style="border-left-color:#d23c3c"><div class="grow"><div class="r-title">${esc(t.title || "Tâche")}</div><div class="r-sub">${esc(deadlineInfo(t.dueDate, false).label)}${t.assignee ? ` · ${esc(t.assignee)}` : ""}</div></div><span class="muted">›</span></div>`).join("")}</div>` : ""}
    <div class="section-h">Historique du projet</div>
    <div class="list">${entriesHtml}</div>
    <div class="chip-row" style="margin-top:12px">${kindButtons}</div>
    <div style="margin-top:22px"><button class="btn danger small" data-del-mission="${m.id}">Supprimer le projet</button></div>`;
}

// ---- Gestion de projet ----
function renderProjectGestion(m) {
  const ts = projectTasks(m);
  const open = ts.filter((t) => !taskDone(t));
  const late = open.filter((t) => t.dueDate && daysUntil(t.dueDate) < 0);
  const soon = open.filter((t) => t.dueDate && daysUntil(t.dueDate) >= 0 && daysUntil(t.dueDate) <= 7);
  const noDue = open.filter((t) => !t.dueDate);
  const alerts = [
    late.length ? `<span class="pm-alert late">⚠️ ${late.length} en retard</span>` : "",
    soon.length ? `<span class="pm-alert soon">⏳ ${soon.length} sous 7 jours</span>` : "",
    noDue.length ? `<span class="pm-alert none">📭 ${noDue.length} sans date limite</span>` : "",
    !late.length && !soon.length && !noDue.length && open.length ? '<span class="pm-alert ok">✓ Aucune alerte</span>' : ""
  ].filter(Boolean).join(" ");
  const names = {};
  state.contacts.forEach((c) => { const n = contactName(c); if (n) names[n] = 1; });
  state.tasks.forEach((t) => { if (t.assignee) names[t.assignee] = 1; });
  const datalist = `<datalist id="assigneeList"><option value="Moi"></option>${Object.keys(names).sort((a, b) => a.localeCompare(b, "fr")).map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>`;
  const progOpts = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const row = (t) => {
    const done = taskDone(t);
    const di = deadlineInfo(t.dueDate, done);
    const p = taskProgress(t);
    const running = (m.entries || []).some((e) => e.taskId === t.id && e.timerStartedAt);
    const secs = taskSeconds(m, t);
    const origin = taskOrigin(t).map((o) => o.link
      ? `<a class="pm-tag" href="${esc(o.link)}" target="_blank" rel="noopener">${o.ic} ${esc(o.label)}</a>`
      : `<span class="pm-tag">${o.ic} ${esc(o.label)}</span>`).join(" ");
    return `<tr class="${done ? "done" : ""}" style="border-left:4px solid ${di.color}">
      <td class="pm-title"><input class="flat-input" data-taskfield="title" data-t="${t.id}" value="${esc(t.title)}" placeholder="Intitulé de la tâche"/>
        ${t.notes ? `<div class="pm-note">${esc(t.notes)}</div>` : ""}
        <div class="pm-origin">${origin}${t.durationDays ? `<span class="pm-tag">⏳ ${esc(String(t.durationDays).replace(".", ","))} j</span>` : ""}</div></td>
      <td><input class="flat-input" list="assigneeList" data-taskfield="assignee" data-t="${t.id}" value="${esc(t.assignee || "")}" placeholder="—"/></td>
      <td class="pm-due"><input type="date" data-taskdue="${t.id}" value="${esc(t.dueDate || "")}"/>
        <div class="pm-dl" style="color:${di.muted ? "var(--muted)" : di.color}">${di.muted ? esc(di.label) : "⬤ " + esc(di.label)}</div></td>
      <td class="pm-prog"><select data-taskprog="${t.id}">${progOpts.map((v) => `<option value="${v}" ${v === p || (p > 0 && v === Math.round(p / 10) * 10 && v !== 100 && !done) ? "selected" : ""}>${v} %</option>`).join("")}</select>
        <div class="pm-bar"><div class="pm-bar-fill" style="width:${p}%"></div></div></td>
      <td class="pm-time"><span class="timer ${running ? "running" : ""}">${secs ? fmtDurationShort(secs) : "—"}</span>
        <button class="btn ${running ? "danger" : "ghost"} small" data-task-timer="${t.id}" data-m="${m.id}" title="${running ? "Arrêter le chrono" : "Lancer le chrono sur cette tâche"}">${running ? "■" : "▶"}</button></td>
      <td class="pm-x"><button class="btn ghost small" data-del-task="${t.id}" title="Supprimer">✕</button></td>
    </tr>`;
  };
  const sections = projectSections(m);
  const bySection = (name) => sortTasks(ts.filter((t) => (t.section || "") === name));
  const block = (name) => {
    const items = bySection(name);
    const head = name
      ? `<tr class="pm-section"><td colspan="6"><div class="inline"><input class="flat-input grow" data-section-name="${esc(name)}" data-m="${m.id}" value="${esc(name)}"/>
          <span class="muted" style="font-size:12px">${items.filter(taskDone).length}/${items.length}</span>
          <button class="btn ghost small" data-add-ptask="${m.id}" data-section="${esc(name)}">+ Tâche</button>
          <button class="btn ghost small" data-del-section="${esc(name)}" data-m="${m.id}" title="Retirer la section (les tâches restent)">✕</button></div></td></tr>`
      : `<tr class="pm-section"><td colspan="6"><div class="inline"><span class="grow muted">Sans section</span>
          <button class="btn ghost small" data-add-ptask="${m.id}" data-section="">+ Tâche</button></div></td></tr>`;
    if (!name && !items.length && sections.length) return "";
    return head + (items.map(row).join("") || `<tr><td colspan="6" class="muted" style="padding:8px 12px;font-size:12px">Aucune tâche.</td></tr>`);
  };
  const body = sections.map(block).join("") + block("");
  return `<div class="inline" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">${alerts || '<span class="muted" style="font-size:12px">Aucune tâche pour l\'instant.</span>'}
      <span class="grow"></span>
      <button class="btn ghost small" data-import-tasks="${m.id}" title="Importer des tâches depuis un fichier CSV (tableau de suivi) ou JSON">⤓ Importer</button>
      <button class="btn secondary small" data-add-section="${m.id}">+ Section</button>
      <button class="btn small" data-add-ptask="${m.id}" data-section="">+ Tâche</button></div>
    ${datalist}
    <div class="table-wrap"><table class="pm-table">
      <thead><tr><th>Tâche</th><th>Personne en charge</th><th>Date limite</th><th>Avancement</th><th>Temps</th><th></th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <div class="muted" style="font-size:11px;margin-top:8px">Une tâche à 100 % passe « Terminée » ; une tâche avec un avancement passe « En cours ». Les tâches se retrouvent aussi dans l'onglet Tâches et, si elles ont une date limite ou un créneau, dans Planning.</div>`;
}

// ---- Import de tâches dans un projet (JSON ou CSV) ----
// Le CSV vient typiquement d'un tableau de suivi (Google Sheets / Excel) :
// Section ; Tâche ; Personne en charge ; Temps de réalisation (j) ; Date limite ; Avancement (%) ; Remarque ; Communication.
function parseCSV(text) {
  const lines = String(text || "").replace(/^\ufeff/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  const split = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === sep) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  return lines.map(split);
}
// Date au format ISO, jj/mm/aaaa, ou numéro de série Excel/Sheets. Sinon "".
function parseTaskDate(v) {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const n = Number(s.replace(",", "."));
  if (isFinite(n) && n > 40000 && n < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}
// Colonne reconnue à partir de son en-tête (sans accents ni casse).
function taskColumn(header) {
  const h = noAccents(header);
  if (/^section/.test(h)) return "section";
  if (/^tache|^titre|^intitule|^task/.test(h)) return "title";
  if (/en charge|responsable|assign|qui$/.test(h)) return "assignee";
  if (/date limite|echeance|deadline|date d/.test(h)) return "dueDate";
  if (/avancement|progress|%/.test(h)) return "progress";
  if (/remarque|detail|precision/.test(h)) return "remark";
  if (/communication|note|commentaire/.test(h)) return "notes";
  if (/temps|duree|jours/.test(h)) return "durationDays";
  return null;
}
// Normalise une ligne (JSON ou CSV déjà mappée) en tâche du projet.
function normImportedTask(m, r) {
  const t = {
    id: uid(), title: String(r.title || "").trim(), status: "aFaire", missionId: m.id,
    section: String(r.section || "").trim(), assignee: String(r.assignee || "").trim(),
    progress: 0, origin: "import", dueDate: parseTaskDate(r.dueDate), createdAt: Date.now()
  };
  if (!t.title) return null;
  const remark = String(r.remark || "").trim();
  if (remark) t.title += " · " + remark;
  const notes = String(r.notes || "").trim();
  if (notes) t.notes = notes;
  // « Temps de réalisation » : un nombre de jours, ou parfois une date (fin de
  // tâche saisie dans cette colonne) qui sert alors d'échéance.
  const dur = r.durationDays;
  if (dur != null && String(dur).trim() !== "") {
    const asDate = parseTaskDate(dur);
    const n = Number(String(dur).replace(",", "."));
    if (asDate && (!isFinite(n) || n > 40000)) { if (!t.dueDate) t.dueDate = asDate; }
    else if (isFinite(n) && n > 0) t.durationDays = n;
  }
  const p = Number(String(r.progress == null ? "" : r.progress).replace("%", "").replace(",", "."));
  if (isFinite(p) && p > 0) setTaskProgress(t, p <= 1 && String(r.progress).indexOf("%") === -1 && p !== 1 ? p * 100 : p);
  return t;
}
// Importe des tâches dans le projet. Renvoie { added, skipped }.
// Une tâche identique (même section, même intitulé, même échéance) déjà présente
// n'est pas dupliquée : on peut réimporter un tableau mis à jour sans risque.
function importTasksInto(m, text, fileName) {
  let rows = [];
  const isJson = /\.json$/i.test(fileName || "") || /^\s*[\[{]/.test(String(text || ""));
  if (isJson) {
    let data; try { data = JSON.parse(text); } catch (e) { throw new Error("Fichier JSON invalide."); }
    rows = Array.isArray(data) ? data : (data.tasks || []);
  } else {
    const lines = parseCSV(text);
    if (lines.length < 2) throw new Error("Le fichier CSV est vide.");
    const cols = lines[0].map(taskColumn);
    if (cols.indexOf("title") === -1) throw new Error("Aucune colonne « Tâche » trouvée dans l'en-tête.");
    rows = lines.slice(1).map((cells) => { const r = {}; cols.forEach((c, i) => { if (c && cells[i] != null && cells[i] !== "") r[c] = cells[i]; }); return r; });
  }
  const existing = {};
  projectTasks(m).forEach((t) => { existing[(t.section || "") + "|" + (t.title || "") + "|" + (t.dueDate || "")] = 1; });
  m.sections = m.sections || [];
  let added = 0, skipped = 0;
  rows.forEach((r) => {
    const t = normImportedTask(m, r);
    if (!t) return;
    const key = t.section + "|" + t.title + "|" + t.dueDate;
    if (existing[key]) { skipped++; return; }
    existing[key] = 1;
    if (t.section && m.sections.indexOf(t.section) === -1) m.sections.push(t.section);
    state.tasks.push(t); added++;
  });
  return { added, skipped };
}
function importTasksClick(mid) {
  const m = findMission(mid); if (!m) return;
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".csv,.json,text/csv,application/json";
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const res = importTasksInto(m, String(r.result), f.name);
        save(); render();
        toast(`${res.added} tâche(s) ajoutée(s)${res.skipped ? ` · ${res.skipped} déjà présente(s)` : ""}`);
      } catch (e) { alert("Import impossible : " + e.message); }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ---- Correspondance ----
// Fils de discussion de toutes les boîtes, avec l'étiquette de la boîte.
function mailThreads() {
  const out = [];
  Object.keys(mailStore).forEach((k) => {
    const d = mailStore[k]; if (!d) return;
    const box = mailboxLabel(k);
    (d.threads || []).forEach((th) => out.push(Object.assign({ box, boxId: k }, th)));
  });
  return out;
}
function mailboxLabel(id) {
  if (id === "main") { const d = mailStore.main; return (d && d.mailbox) || "Boîte principale"; }
  const b = (state.mailboxes || []).find((x) => x.id === id);
  return b ? (b.label || b.email) : id;
}
// Fils liés à un projet : mots-clés (titre par défaut) dans l'objet ou l'extrait,
// ou un participant parmi les adresses du projet / des contacts de sa société.
function projectMailEmails(m) {
  const set = {};
  String(m.mailEmails || "").split(/[,;\s]+/).forEach((e) => { e = e.trim().toLowerCase(); if (e && e.indexOf("@") > -1) set[e] = 1; });
  return set;
}
// Adresses des contacts de la société du projet : proposées, jamais imposées.
function companyEmailSuggestions(m) {
  const have = projectMailEmails(m);
  return state.contacts
    .filter((c) => m.companyId && c.companyId === m.companyId && c.email && !have[String(c.email).toLowerCase()])
    .map((c) => ({ email: String(c.email).toLowerCase(), name: contactName(c) }));
}
// Mes propres adresses (boîtes lues) : un fil ne doit jamais être rattaché à un
// projet parce que j'y figure.
function ownAddresses() {
  const set = {};
  Object.keys(mailStore).forEach((k) => { const d = mailStore[k]; if (d && d.mailbox) set[String(d.mailbox).toLowerCase()] = 1; });
  (state.mailboxes || []).forEach((b) => { if (b.email) set[String(b.email).toLowerCase()] = 1; });
  return set;
}
// Un mot-clé compte s'il apparaît comme mot entier (« feder » ne prend pas « fédération »).
function hasKeyword(hay, kw) {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^a-z0-9])" + esc + "($|[^a-z0-9])").test(hay);
}
function projectKeywords(m) {
  const src = String(m.mailKeywords || "").trim() || String(m.title || "");
  return src.split(",").map((k) => noAccents(k).trim()).filter((k) => k.length >= 3);
}
// Sans mots-clés explicites : les mots significatifs du titre (4 lettres et plus)
// doivent tous apparaître, dans n'importe quel ordre.
function projectTitleWords(m) {
  if (String(m.mailKeywords || "").trim()) return [];
  const w = noAccents(m.title || "").split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
  return w.length >= 2 ? w : [];
}
// Un fil correspond automatiquement au projet si un mot-clé y figure (objet ou
// extrait) ou si un participant, autre que moi, est une adresse du projet.
function threadMatches(m, th) {
  const kws = projectKeywords(m), words = projectTitleWords(m), emails = projectMailEmails(m), mine = ownAddresses();
  const hay = noAccents((th.subject || "") + " " + (th.snippet || ""));
  if (kws.some((k) => hasKeyword(hay, k))) return true;
  if (words.length && words.every((w) => hasKeyword(hay, w))) return true;
  const from = (th.from || "").toLowerCase();
  if (!mine[from] && emails[from]) return true;
  return (th.people || []).some((p) => { const e = (p.email || "").toLowerCase(); return e && !mine[e] && emails[e]; });
}
// Classement explicite d'un fil : id de projet, "" pour « aucun », undefined si non classé.
const mailLinkOf = (id) => (state.mailLinks || {})[id];
function setMailLink(id, missionId) {
  state.mailLinks = state.mailLinks || {};
  if (missionId === undefined) delete state.mailLinks[id]; else state.mailLinks[id] = missionId;
}
// Fils du projet : ceux qu'on y a classés à la main, plus les suggestions
// automatiques (non classées ailleurs). `only` = "linked" | "suggested" | undefined.
function projectThreads(m, only) {
  const excluded = m.mailExclude || [];
  return mailThreads().filter((th) => {
    const link = mailLinkOf(th.id);
    if (link !== undefined) return link === m.id && only !== "suggested";
    if (only === "linked") return false;
    if (excluded.indexOf(th.id) > -1) return false;
    return threadMatches(m, th);
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
function renderProjectCourrier(m) {
  const linked = projectThreads(m, "linked");
  const suggested = projectThreads(m, "suggested");
  const anyIndex = mailThreads().length > 0;
  const emailEntries = (m.entries || []).filter((e) => e.kind === "email").sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const taskLinked = {};
  state.tasks.forEach((t) => { if (t.mailThreadId) taskLinked[t.mailThreadId] = 1; });
  const others = sortedMissions().filter((x) => x.id !== m.id);
  const row = (th, isLinked) => {
    const d = th.date ? new Date(th.date) : null;
    const when = d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const sub = [th.mine ? "📤 moi" : esc(th.fromName || th.from || ""), when, th.count > 1 ? `${th.count} messages` : null, `<span class="pm-tag">${esc(th.box)}</span>`].filter(Boolean).join(" · ");
    const sel = `<select class="mail-sel" data-mail-assign="${esc(th.id)}" data-m="${m.id}" title="Classer ce fil">
        ${isLinked ? "" : '<option value="" selected>Classer…</option>'}
        <option value="${m.id}" ${isLinked ? "selected" : ""}>✓ Ce projet</option>
        <option value="none">— Aucun projet</option>
        ${others.map((x) => `<option value="${x.id}">→ ${esc(x.title || "Sans titre")}</option>`).join("")}
      </select>`;
    return `<div class="row mail-row" style="cursor:default;border-left-color:${isLinked ? "var(--positive)" : (th.unread ? "var(--primary)" : "var(--line)")}">
      <span class="ic">✉️</span>
      <div class="grow"><div class="r-title">${th.unread ? '<span class="pm-tag mail-unread">● Non lu</span> ' : ""}${esc(th.subject)}${taskLinked[th.id] ? ' <span class="pm-tag">✅ tâche créée</span>' : ""}${isLinked ? "" : ' <span class="pm-tag">suggestion</span>'}</div>
        <div class="r-sub">${sub}</div>
        ${th.snippet ? `<div class="mail-snippet">${esc(th.snippet)}</div>` : ""}</div>
      <div class="mail-actions">
        ${sel}
        ${th.link ? `<a class="btn ghost small" href="${esc(th.link)}" target="_blank" rel="noopener">Ouvrir</a>` : ""}
        <button class="btn ghost small" data-mail-task="${esc(th.id)}" data-m="${m.id}" title="Créer une tâche à partir de ce mail">→ Tâche</button>
        <button class="btn ghost small" data-mail-entry="${esc(th.id)}" data-m="${m.id}" title="Ajouter à l'historique du projet">→ Historique</button>
      </div></div>`;
  };
  // Lu / non lu : état relevé dans Gmail au dernier passage du script (toutes les heures).
  const nbUnread = (arr) => arr.filter((th) => th.unread).length;
  const cnt = (arr) => `(${arr.length}${nbUnread(arr) ? ` · ${nbUnread(arr)} non lu${nbUnread(arr) > 1 ? "s" : ""}` : ""})`;
  const sugg = companyEmailSuggestions(m);
  const suggHtml = sugg.length
    ? `<div class="muted" style="font-size:12px;margin-top:6px">Contacts de ${esc(companyName(m.companyId))} : ${sugg.slice(0, 12).map((x) => `<button class="chip" data-mail-addemail="${esc(x.email)}" data-m="${m.id}" title="Ajouter ${esc(x.email)} aux adresses du projet">+ ${esc(x.name)}</button>`).join(" ")}${sugg.length > 12 ? ` <span>… (${sugg.length - 12} de plus)</span>` : ""}</div>`
    : "";
  const conf = `<div class="card" style="margin-bottom:12px">
      <label class="field"><span>Mots-clés (séparés par des virgules), cherchés comme mots entiers dans l'objet et l'extrait — à défaut, les mots du titre du projet</span>
        <input data-bind="missions|${m.id}|mailKeywords" data-rerender value="${esc(m.mailKeywords || "")}" placeholder="${esc(m.title || "mot-clé")}"/></label>
      <label class="field"><span>Adresses e-mail liées au projet (un fil est suggéré si l'une d'elles y participe)</span>
        <input data-bind="missions|${m.id}|mailEmails" data-rerender value="${esc(m.mailEmails || "")}" placeholder="prenom@client.fr, autre@partenaire.com"/></label>
      ${suggHtml}
      <div class="muted" style="font-size:12px;margin-top:8px">${Object.keys(projectMailEmails(m)).length} adresse(s) · ${projectKeywords(m).length} mot(s)-clé(s) · ${(state.mailboxes || []).length + 1} boîte(s) mail lue(s). Mes propres adresses ne comptent jamais comme critère.</div>
    </div>`;
  let body;
  if (!(window.DriveSync && DriveSync.isConnected())) body = '<div class="center-empty">Connecte-toi à Google Drive pour lire la correspondance.</div>';
  else if (!anyIndex) body = `<div class="center-empty">${mailLoading ? "Lecture des boîtes mail…" : "Aucun index de mails disponible.<br>Installe (ou mets à jour) le script « Mails » dans chaque boîte : il indexe les fils récents toutes les heures. Voir Relances → Boîtes mail."}</div>`;
  else body = `<div class="section-h">✓ Classés dans ce projet <span class="muted">${cnt(linked)}</span></div>
      ${linked.length ? `<div class="list">${linked.map((th) => row(th, true)).join("")}</div>` : '<div class="muted" style="padding:4px 2px;font-size:13px">Aucun fil classé pour l\'instant : confirme une suggestion ci-dessous avec « ✓ Ce projet ».</div>'}
      <div class="section-h">Suggestions <span class="muted">${cnt(suggested)}</span></div>
      <div class="muted" style="font-size:12px;margin-bottom:6px">Fils qui contiennent un mot-clé ou impliquent une adresse du projet. Classe chacun : ce projet, un autre projet, ou aucun.</div>
      ${suggested.length ? `<div class="list">${suggested.map((th) => row(th, false)).join("")}</div>` : '<div class="muted" style="padding:4px 2px;font-size:13px">Aucune suggestion : précise des mots-clés ou des adresses ci-dessus.</div>'}`;
  const manual = emailEntries.length
    ? `<div class="section-h">Mails notés dans l'historique <span class="muted">(${emailEntries.length})</span></div><div class="list">${emailEntries.map((e) => renderEntry(m.id, e)).join("")}</div>`
    : "";
  return `${conf}
    <div class="section-h">✉️ Correspondance <span class="muted">${cnt(linked.concat(suggested))}</span>
      <button class="btn ghost small" data-mail-refresh style="margin-left:8px">${mailLoading ? "…" : "↻ Rafraîchir"}</button></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 8px">« ● Non lu » = fil non lu dans Gmail au dernier passage du script (toutes les 15 minutes). Un mail lu depuis peut le rester jusqu'au passage suivant.</div>
    ${body}${manual}`;
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
      <div class="field-b"><span>Temps passé ${running ? '<span style="color:#d23c3c">· chrono en cours</span>' : "(saisie manuelle possible)"}</span>
        <div class="inline" style="flex-wrap:wrap">
          <input type="number" min="0" step="1" style="width:74px" data-dur-h data-m="${mid}" data-e="${e.id}" value="${Math.floor(entryElapsed(e) / 3600)}"/><span class="muted">h</span>
          <input type="number" min="0" max="59" step="1" style="width:74px" data-dur-m data-m="${mid}" data-e="${e.id}" value="${Math.floor((entryElapsed(e) % 3600) / 60)}"/><span class="muted">min</span>
          <button class="btn ghost small" data-dur-add="-15" data-m="${mid}" data-e="${e.id}">−15</button>
          <button class="btn ghost small" data-dur-add="15" data-m="${mid}" data-e="${e.id}">+15</button>
          <button class="btn ghost small" data-dur-zero data-m="${mid}" data-e="${e.id}">Remettre à 0</button>
        </div>
        ${running && entryElapsed(e) > 8 * 3600 ? `<div style="color:#d23c3c;font-size:12px;margin-top:6px">⚠️ Chrono lancé depuis ${fmtDuration(entryElapsed(e))} — chrono probablement oublié : arrête-le puis corrige la durée ci-dessus.</div>` : ""}
      </div>
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
    <div class="section-h">Comptes bancaires</div>
    <div class="card">${companyAccounts(c.id).map((a) => `<div class="inline" style="margin:6px 0;flex-wrap:wrap">
        <input class="grow" style="min-width:130px" data-accfield="name" data-acc="${a.id}" value="${esc(a.name)}" placeholder="Nom du compte (ex. BNP courant)"/>
        <input type="number" style="width:120px" data-accfield="initialBalance" data-acc="${a.id}" value="${a.initialBalance || 0}" title="Solde initial (€)"/>
        <input type="date" style="width:150px" data-accfield="balanceDate" data-acc="${a.id}" value="${esc((a.balanceDate || "").slice(0, 10) || todayISO())}" title="À la date du"/>
        <span class="muted" style="font-size:12px;white-space:nowrap">${euros(accountBalance(a, new Date()))}</span>
        <button class="btn ghost small" data-del-acc="${a.id}">✕</button></div>`).join("") || '<div class="muted">Aucun compte bancaire.</div>'}
      <div style="margin-top:8px"><button class="btn secondary small" data-add-acc="${c.id}">+ Ajouter un compte</button></div>
      <div class="muted" style="font-size:11px;margin-top:6px">Ces comptes sont proposés dans le bloc « Règlement » de chaque facture.</div></div>
    <div style="margin-top:18px"><button class="btn danger small" data-del-company="${c.id}">Supprimer la société</button></div>`;
}

// ----------------------------- Finances -----------------------------
let financeTab = "factures";
function renderFinances() {
  if (view.detailId) return renderInvoiceDetail(view.detailId);
  const tabs = [["factures", "Factures"], ["cdr", "Compte de résultat"], ["tresorerie", "Trésorerie"], ["cca", "Compte courant d'associé"], ["salaires", "Salaires"], ["categories", "Catégories"], ["recurrences", "Récurrences"], ["import", "Import bancaire"]]
    .map(([id, lbl]) => `<button class="chip ${financeTab === id ? "active" : ""}" data-ftab="${id}">${lbl}</button>`).join("");
  let body = "";
  if (financeTab === "factures") body = financeFactures();
  else if (financeTab === "cdr") body = financeCDR();
  else if (financeTab === "import") body = financeImport();
  else if (financeTab === "categories") body = financeCategories();
  else if (financeTab === "recurrences") body = financeRecurrences();
  else if (financeTab === "cca") body = financeCCA();
  else if (financeTab === "salaires") body = financeSalaires();
  else body = financeTresorerie();
  return `<div class="page-title">Finances</div><div class="chip-row" style="margin-bottom:16px">${tabs}</div>${body}`;
}
// Écriture dont le justificatif manque (et qui n'est pas marquée « sans justificatif »).
const receiptMissing = (v) => !v.receiptUrl && !v.noReceipt;
function missingReceipts() {
  return state.invoices.filter(receiptMissing)
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
}
let factureFilter = { q: "", companyId: "", status: "", from: "", to: "", noReceipt: false };
function financeFactures() {
  const f = factureFilter;
  let items = [...state.invoices];
  if (f.q) { const q = f.q.toLowerCase(); items = items.filter((v) => [v.title, v.categoryName, companyName(v.companyId), contactNameById(v.contactId)].some((s) => String(s || "").toLowerCase().includes(q))); }
  if (f.companyId) items = items.filter((v) => v.companyId === f.companyId);
  if (f.status) items = items.filter((v) => v.status === f.status);
  if (f.from) items = items.filter((v) => (v.startDate || "") >= f.from);
  if (f.to) items = items.filter((v) => (v.startDate || "") <= f.to);
  if (f.noReceipt) items = items.filter(receiptMissing);
  items.sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  const totalHT = items.reduce((t, v) => t + (v.amount || 0), 0);
  const compOpts = ['<option value="">Toutes sociétés</option>'].concat(state.companies.map((c) => `<option value="${c.id}" ${c.id === f.companyId ? "selected" : ""}>${esc(c.name || "Sans nom")}</option>`)).join("");
  const stOpts = ['<option value="">Tous statuts</option>'].concat(INV_STATUSES.map((s) => `<option value="${s.code}" ${s.code === f.status ? "selected" : ""}>${s.label}</option>`)).join("");
  const active = f.q || f.companyId || f.status || f.from || f.to || f.noReceipt;
  const nbMissing = missingReceipts().length;
  const rows = items.map((v) => {
    const miss = receiptMissing(v);
    const mark = miss ? '<span title="Justificatif manquant" style="color:#d23c3c">⚠️</span>' : (v.receiptUrl ? '<span title="Justificatif présent" style="color:var(--positive)">📎</span>' : "");
    return `<div class="row" data-open-invoice="${v.id}" style="border-left-color:${v.direction === "recette" ? "var(--finance)" : "var(--alert)"}">
    <div class="grow"><div class="r-title">${mark} ${esc(v.title || "Nouvelle facture")}</div>
      <div class="r-sub">${[fmtDate(v.startDate), esc(companyName(v.companyId)), v.categoryName ? esc(v.categoryName) : null].filter(Boolean).join(" · ")}</div></div>
    <div style="text-align:right"><div>${euros(v.amount)}</div><span class="badge aDemarrer" style="font-size:10px">${invStatusLabel(v.status)}</span></div></div>`;
  }).join("");
  return `<div class="toolbar"><span class="grow"></span>
      <button class="btn secondary small" data-export-factures>⬇ CSV</button>
      <button class="btn" data-add-invoice>+ Nouvelle facture</button></div>
    <div class="filterbar">
      <input id="factureSearch" placeholder="🔎 Rechercher…" value="${esc(f.q)}"/>
      <select id="factureCompany">${compOpts}</select>
      <select id="factureStatus">${stOpts}</select>
      <input type="date" id="factureFrom" value="${esc(f.from)}" title="Depuis"/>
      <input type="date" id="factureTo" value="${esc(f.to)}" title="Jusqu'à"/>
      <button class="chip ${f.noReceipt ? "active" : ""}" data-facture-noreceipt>⚠️ Sans justificatif${nbMissing ? ` (${nbMissing})` : ""}</button>
      ${active ? '<button class="btn ghost small" data-facture-reset>✕</button>' : ""}
    </div>
    <div class="muted" style="font-size:12px;margin:2px 0 8px">${items.length} facture(s) · Total HT ${euros(totalHT)}</div>
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
    <div class="section-h">Par société</div><div class="card">${perEnt || '<div class="muted">—</div>'}</div>
    ${state.accounts.length ? `<div class="section-h">Par compte bancaire</div><div class="card">${state.accounts.map((a) => `<div class="inline" style="padding:5px 0"><span class="grow">${esc(a.name || "Compte")}<span class="muted" style="font-size:11px"> · ${esc(companyName(a.companyId))}</span></span><span class="timer">${euros(accountBalance(a, now))}</span></div>`).join("")}</div>` : ""}
    ${(() => { const t = associates().reduce((s, c) => s + ccaBalance(c.id), 0); return Math.abs(t) > 0.005 ? `<div class="section-h">Comptes courants d'associés</div><div class="card"><div class="inline"><span class="grow">Total dû aux associés</span><span class="timer" style="color:${t >= 0 ? "var(--positive)" : "#d23c3c"}">${euros(t)}</span></div><div class="muted" style="font-size:11px;margin-top:4px">Hors trésorerie : ces sommes n'ont pas transité par les comptes de l'entreprise.</div></div>` : ""; })()}`;
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
    <div class="section-h">Règlement</div>
    <div class="card">${invoicePaymentFields(v)}</div>
    <div class="section-h">Justificatif</div>
    <div class="card">
      <label class="field"><span>Lien vers le justificatif (Google Drive, facture PDF…)</span>
        <input data-bind="invoices|${v.id}|receiptUrl" value="${esc(v.receiptUrl)}" inputmode="url" placeholder="https://drive.google.com/…"/></label>
      <div class="inline">
        ${validURL(v.receiptUrl) ? `<a class="btn secondary small" href="${esc(v.receiptUrl)}" target="_blank" rel="noopener">↗ Ouvrir le justificatif</a>` : (v.receiptUrl ? '<span class="muted" style="font-size:12px">Lien invalide.</span>' : "")}
        <span class="grow"></span>
        <label class="inline-check" style="margin:0"><input type="checkbox" data-no-receipt="${v.id}" ${v.noReceipt ? "checked" : ""}/> <span style="font-size:12px">Aucun justificatif nécessaire</span></label>
      </div>
      ${!v.receiptUrl && !v.noReceipt ? '<div class="muted" style="font-size:12px;margin-top:8px">⚠️ Justificatif manquant : cette écriture apparaît dans les rappels tant que le lien n\'est pas renseigné.</div>' : ""}
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

// ----------------------------- Récurrences (factures & tâches) -----------------------------
const FREQS = [{ code: "hebdomadaire", label: "Hebdomadaire" }, { code: "mensuelle", label: "Mensuelle" }, { code: "trimestrielle", label: "Trimestrielle" }, { code: "annuelle", label: "Annuelle" }];
function nextOccurrence(dateStr, freq) {
  const d = new Date(dateStr + "T12:00:00");
  if (freq === "hebdomadaire") d.setDate(d.getDate() + 7);
  else if (freq === "trimestrielle") d.setMonth(d.getMonth() + 3);
  else if (freq === "annuelle") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}
function materializeRecurrence(rec, date) {
  if (rec.kind === "task") {
    state.tasks.push({ id: uid(), title: rec.title || "Tâche récurrente", status: "aFaire", missionId: rec.missionId || null, dueDate: date, createdAt: Date.now(), recurrenceId: rec.id });
  } else {
    state.invoices.push({ id: uid(), title: rec.title || "Facture récurrente", reference: "", direction: rec.direction || "depense", status: rec.direction === "recette" ? "aEmettre" : "aPayer", amount: Number(rec.amount) || 0, vatRate: rec.vatRate == null ? 20 : Number(rec.vatRate), startDate: date, hasDueDate: false, dueDate: "", paymentDate: "", companyId: rec.companyId || null, contactId: null, categoryName: rec.categoryName || "", recurrenceId: rec.id });
  }
}
function generateRecurrences() {
  const today = todayISO(); let created = 0;
  (state.recurrences || []).forEach((rec) => {
    if (!rec.active || !rec.anchorDate) return;
    let occ = rec.lastGenerated ? nextOccurrence(rec.lastGenerated, rec.frequency) : rec.anchorDate;
    let guard = 0;
    while (occ <= today && guard < 600) { materializeRecurrence(rec, occ); rec.lastGenerated = occ; created++; occ = nextOccurrence(occ, rec.frequency); guard++; }
  });
  return created;
}
function recCount(id) { return state.invoices.filter((v) => v.recurrenceId === id).length + state.tasks.filter((t) => t.recurrenceId === id).length; }
function financeRecurrences() {
  const cards = state.recurrences.map((rec) => {
    const freqOpts = FREQS.map((fr) => `<option value="${fr.code}" ${fr.code === rec.frequency ? "selected" : ""}>${fr.label}</option>`).join("");
    const head = `<div class="inline"><strong class="grow">${rec.kind === "task" ? "✅ Tâche" : "€ Facture"} récurrente</strong>
      <label class="inline-check" style="margin:0"><input type="checkbox" data-recfield="active" data-rec="${rec.id}" ${rec.active ? "checked" : ""}/> <span style="font-size:12px">Active</span></label></div>`;
    let fields = `<label class="field"><span>Intitulé</span><input data-recfield="title" data-rec="${rec.id}" value="${esc(rec.title)}"/></label>
      <label class="field"><span>Fréquence</span><select data-recfield="frequency" data-rec="${rec.id}">${freqOpts}</select></label>
      <label class="field"><span>Première échéance</span><input type="date" data-recfield="anchorDate" data-rec="${rec.id}" value="${esc(rec.anchorDate || todayISO())}"/></label>`;
    if (rec.kind === "task") {
      const misOpts = ['<option value="">Aucun projet</option>'].concat(sortedMissions().map((m) => `<option value="${m.id}" ${m.id === rec.missionId ? "selected" : ""}>${esc(m.title || "Sans titre")}</option>`)).join("");
      fields += `<label class="field"><span>Mission</span><select data-recfield="missionId" data-rec="${rec.id}">${misOpts}</select></label>`;
    } else {
      const dirOpts = DIRECTIONS.map((d) => `<option value="${d.code}" ${d.code === rec.direction ? "selected" : ""}>${d.label}</option>`).join("");
      const catOpts = ['<option value="">À catégoriser</option>'].concat(state.categories.map((c) => `<option value="${esc(c.name)}" ${c.name === rec.categoryName ? "selected" : ""}>${esc(c.name)}</option>`)).join("");
      const comOpts = ['<option value="">Aucune</option>'].concat(state.companies.map((c) => `<option value="${c.id}" ${c.id === rec.companyId ? "selected" : ""}>${esc(c.name || "Sans nom")}</option>`)).join("");
      fields += `<label class="field"><span>Sens</span><select data-recfield="direction" data-rec="${rec.id}">${dirOpts}</select></label>
        <label class="field"><span>Montant HT (€)</span><input type="number" data-recfield="amount" data-rec="${rec.id}" value="${rec.amount || 0}"/></label>
        <label class="field"><span>TVA (%)</span><input type="number" data-recfield="vatRate" data-rec="${rec.id}" value="${rec.vatRate == null ? 20 : rec.vatRate}"/></label>
        <label class="field"><span>Catégorie</span><select data-recfield="categoryName" data-rec="${rec.id}">${catOpts}</select></label>
        <label class="field"><span>Société</span><select data-recfield="companyId" data-rec="${rec.id}">${comOpts}</select></label>`;
    }
    return `<div class="card" style="margin-bottom:12px">${head}${fields}
      <div class="inline" style="margin-top:6px"><span class="grow muted" style="font-size:11px">${recCount(rec.id)} élément(s) généré(s)${rec.lastGenerated ? ` · dernier : ${fmtDate(rec.lastGenerated)}` : ""}</span>
        <button class="btn ghost small" data-del-rec="${rec.id}">Supprimer</button></div></div>`;
  }).join("");
  return `<div class="toolbar"><span class="grow muted" style="font-size:12px">Modèles générant automatiquement des factures ou tâches à chaque échéance.</span>
      <button class="btn small" data-add-rec="invoice">+ Facture</button>
      <button class="btn small" data-add-rec="task">+ Tâche</button></div>
    ${state.recurrences.length ? cards : '<div class="center-empty">Aucune récurrence.</div>'}
    <div class="inline" style="margin-top:8px"><button class="btn secondary small" data-gen-rec>↻ Générer les échéances dues</button></div>`;
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

// Bloc « Règlement » d'une facture : compte de l'entreprise ou associé.
function invoicePaymentFields(v) {
  const mode = v.payMode === "associe" ? "associe" : "compte";
  const accs = companyAccounts(v.companyId);
  const accOpts = ['<option value="">— Compte non précisé —</option>'].concat(
    accs.map((a) => `<option value="${a.id}" ${a.id === v.accountId ? "selected" : ""}>${esc(a.name || "Compte")}</option>`)
  ).join("");
  const asso = associates();
  const assoOpts = ['<option value="">— Associé à préciser —</option>'].concat(
    asso.map((c) => `<option value="${c.id}" ${c.id === v.associateId ? "selected" : ""}>${esc(contactName(c))}</option>`)
  ).join("");
  const second = mode === "associe"
    ? `<label class="field"><span>Payée par l'associé</span><select data-pay-assoc="${v.id}" data-rerender>${assoOpts}</select></label>
       ${asso.length ? "" : '<div class="muted" style="font-size:12px">Aucun contact. Crée un contact de catégorie « Associé » dans Contacts.</div>'}
       <div class="muted" style="font-size:12px;margin-top:6px">Cette facture n'impacte pas la trésorerie de la société : elle ${v.direction === "depense" ? "crédite" : "débite"} le compte courant de l'associé.</div>`
    : `<label class="field"><span>Compte de l'entreprise</span><select data-pay-account="${v.id}" data-rerender>${accOpts}</select></label>
       ${accs.length ? "" : '<div class="muted" style="font-size:12px">Aucun compte bancaire pour cette société. Ajoute-les dans Groupe → la société → Comptes bancaires.</div>'}`;
  return `<label class="field"><span>Réglée depuis / vers</span>
      <select data-pay-mode="${v.id}" data-rerender>
        <option value="compte" ${mode === "compte" ? "selected" : ""}>Un compte de l'entreprise</option>
        <option value="associe" ${mode === "associe" ? "selected" : ""}>Un associé (compte courant)</option>
      </select></label>${second}`;
}

// ----------------------------- Compte courant d'associé -----------------------------
function financeCCA() {
  const asso = associates();
  const actifs = asso.filter((c) => Math.abs(ccaBalance(c.id)) > 0.005 || state.ccaMovements.some((m) => m.associateId === c.id) || state.invoices.some((v) => paidByAssociate(v) && v.associateId === c.id));
  const total = actifs.reduce((t, c) => t + ccaBalance(c.id), 0);
  const cards = actifs.map((c) => {
    const solde = ccaBalance(c.id);
    const parSociete = state.companies.map((co) => ({ co, s: ccaBalance(c.id, co.id) })).filter((x) => Math.abs(x.s) > 0.005);
    const lines = ccaLines(c.id).slice(0, 40).map((l) => `<tr>
      <td style="white-space:nowrap">${esc(fmtDate(l.date))}</td>
      <td>${esc(l.label)}<div class="muted" style="font-size:11px">${esc(l.kind)}${l.detail ? " · " + esc(l.detail) : ""}</div></td>
      <td class="num" style="color:${l.amount >= 0 ? "var(--positive)" : "#d23c3c"}">${euros(l.amount)}</td></tr>`).join("");
    return `<div class="card" style="margin-bottom:12px">
      <div class="inline"><strong class="grow">${esc(contactName(c))}</strong>
        <strong style="color:${solde >= 0 ? "var(--positive)" : "#d23c3c"};font-size:17px">${euros(solde)}</strong></div>
      <div class="muted" style="font-size:11px">${solde >= 0 ? "La société doit cette somme à l'associé." : "L'associé doit cette somme à la société."}</div>
      ${parSociete.length > 1 ? `<div style="margin-top:8px">${parSociete.map((x) => `<div class="inline" style="padding:2px 0"><span class="grow muted" style="font-size:12px">${esc(x.co.name || "Société")}</span><span style="font-size:12px">${euros(x.s)}</span></div>`).join("")}</div>` : ""}
      ${lines ? `<div style="overflow-x:auto;margin-top:10px"><table class="bank-table"><thead><tr><th>Date</th><th>Libellé</th><th class="num">Montant</th></tr></thead><tbody>${lines}</tbody></table></div>` : '<div class="muted" style="font-size:12px;margin-top:8px">Aucun mouvement.</div>'}
      <div class="inline" style="margin-top:8px"><button class="btn secondary small" data-add-cca="${c.id}">+ Mouvement</button></div>
    </div>`;
  }).join("");
  return `<div class="toolbar"><span class="grow muted" style="font-size:12px">Avances faites par les associés, apports et remboursements.</span></div>
    <div class="card" style="margin-bottom:14px"><div class="inline"><strong class="grow">Total dû aux associés</strong>
      <strong style="color:${total >= 0 ? "var(--positive)" : "#d23c3c"};font-size:18px">${euros(total)}</strong></div>
      <div class="muted" style="font-size:11px;margin-top:4px">Une facture réglée par un associé alimente automatiquement son compte courant (champ « Règlement » de la facture).</div></div>
    ${actifs.length ? cards : '<div class="center-empty">Aucun mouvement de compte courant.<br>Indique « Un associé » dans le règlement d\'une facture, ou ajoute un mouvement à un associé.</div>'}
    ${!actifs.length && asso.length ? `<div class="inline" style="margin-top:10px">${asso.slice(0, 6).map((c) => `<button class="btn secondary small" data-add-cca="${c.id}">+ Mouvement · ${esc(contactName(c))}</button>`).join(" ")}</div>` : ""}`;
}
function ccaEditor(movementId, associateId) {
  const m = movementId ? state.ccaMovements.find((x) => x.id === movementId) : null;
  const cur = m || { id: null, date: todayISO(), associateId, companyId: (state.companies[0] || {}).id || null, kind: "apport", amount: 0, notes: "" };
  const comOpts = ['<option value="">Aucune société</option>'].concat(state.companies.map((c) => `<option value="${c.id}" ${c.id === cur.companyId ? "selected" : ""}>${esc(c.name || "Sans nom")}</option>`)).join("");
  const kinds = [["apport", "Apport / avance de l'associé (+)"], ["remboursement", "Remboursement à l'associé (−)"], ["autre", "Autre (+)"]];
  showModal(`<div class="modal-head"><strong class="grow">Mouvement de compte courant</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <label class="field"><span>Date</span><input type="date" id="ccaDate" value="${esc(cur.date)}"/></label>
    <label class="field"><span>Nature</span><select id="ccaKind">${kinds.map(([k, l]) => `<option value="${k}" ${k === cur.kind ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field"><span>Montant (€)</span><input type="number" id="ccaAmount" value="${cur.amount || 0}"/></label>
    <label class="field"><span>Société</span><select id="ccaCompany">${comOpts}</select></label>
    <label class="field"><span>Libellé</span><input id="ccaNotes" value="${esc(cur.notes)}"/></label>
    <div class="inline" style="margin-top:12px"><button class="btn" id="ccaSave">Enregistrer</button><span class="grow"></span>
      ${m ? '<button class="btn danger small" id="ccaDel">Supprimer</button>' : ""}</div>`);
  document.querySelector("[data-modal-close]").onclick = closeModal;
  document.getElementById("ccaSave").onclick = () => {
    const o = {
      id: cur.id || uid(), date: document.getElementById("ccaDate").value || todayISO(),
      associateId: cur.associateId || associateId, companyId: document.getElementById("ccaCompany").value || null,
      kind: document.getElementById("ccaKind").value, amount: Math.abs(parseFloat(document.getElementById("ccaAmount").value) || 0),
      notes: document.getElementById("ccaNotes").value
    };
    if (m) Object.assign(m, o); else state.ccaMovements.push(o);
    save(); closeModal(); render();
  };
  const del = document.getElementById("ccaDel");
  if (del) del.onclick = () => { state.ccaMovements = state.ccaMovements.filter((x) => x.id !== movementId); save(); closeModal(); render(); };
}

// ----------------------------- Salaires -----------------------------
const SAL_STATUSES = [{ code: "aPayer", label: "À payer" }, { code: "paye", label: "Payé" }];
const salName = (s) => { const c = s.contactId ? state.contacts.find((x) => x.id === s.contactId) : null; return c ? contactName(c) : (s.name || "Salarié"); };
const salTotal = (s) => (Number(s.gross) || 0) + (Number(s.charges) || 0);
let salaryMonth = "";
function monthLabel(m) { if (!m) return "—"; const d = new Date(m + "-01T12:00:00"); return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); }
function financeSalaires() {
  const months = Array.from(new Set(state.salaries.map((s) => s.month).filter(Boolean))).sort().reverse();
  const cur = salaryMonth || months[0] || new Date().toISOString().slice(0, 7);
  const items = state.salaries.filter((s) => s.month === cur).sort((a, b) => salName(a).localeCompare(salName(b), "fr"));
  const gross = items.reduce((t, s) => t + (Number(s.gross) || 0), 0);
  const charges = items.reduce((t, s) => t + (Number(s.charges) || 0), 0);
  const net = items.reduce((t, s) => t + (Number(s.net) || 0), 0);
  const monthOpts = Array.from(new Set(months.concat([cur]))).sort().reverse()
    .map((m) => `<option value="${m}" ${m === cur ? "selected" : ""}>${monthLabel(m)}</option>`).join("");
  const rows = items.map((s) => {
    const inv = s.invoiceId && state.invoices.some((v) => v.id === s.invoiceId);
    return `<div class="row" style="cursor:default;border-left-color:${s.status === "paye" ? "var(--positive)" : "var(--alert)"}">
      <div class="grow"><div class="r-title">${esc(salName(s))}</div>
        <div class="r-sub">${esc(companyName(s.companyId))} · brut ${euros(s.gross)} · charges ${euros(s.charges)} · net ${euros(s.net)}${inv ? " · écriture générée" : ""}</div></div>
      <div style="text-align:right"><div>${euros(salTotal(s))}</div>
        <span class="badge ${s.status === "paye" ? "terminee" : "aDemarrer"}" style="font-size:10px">${s.status === "paye" ? "Payé" : "À payer"}</span></div>
      <button class="btn ghost small" data-edit-sal="${s.id}">✎</button></div>`;
  }).join("");
  const annee = cur.slice(0, 4);
  const anneeItems = state.salaries.filter((s) => (s.month || "").slice(0, 4) === annee);
  const anneeTotal = anneeItems.reduce((t, s) => t + salTotal(s), 0);
  const nonGen = items.filter((s) => !(s.invoiceId && state.invoices.some((v) => v.id === s.invoiceId))).length;
  return `<div class="toolbar">
      <select id="salMonth" style="width:auto">${monthOpts}</select>
      <span class="grow"></span>
      <button class="btn secondary small" data-sal-month-prev>‹</button>
      <button class="btn secondary small" data-sal-month-next>›</button>
      <button class="btn" data-add-sal>+ Salaire</button></div>
    <div class="card" style="margin-bottom:12px">
      <div class="inline" style="padding:3px 0"><span class="grow">Brut</span><strong>${euros(gross)}</strong></div>
      <div class="inline" style="padding:3px 0"><span class="grow">Charges patronales</span><strong>${euros(charges)}</strong></div>
      <div class="inline" style="padding:3px 0"><span class="grow">Net versé</span><strong>${euros(net)}</strong></div>
      <div class="inline" style="padding:6px 0;border-top:1px solid var(--line);margin-top:4px"><strong class="grow">Coût total employeur</strong>
        <strong style="color:var(--primary);font-size:17px">${euros(gross + charges)}</strong></div>
      <div class="muted" style="font-size:11px;margin-top:4px">Cumul ${annee} : ${euros(anneeTotal)} sur ${anneeItems.length} bulletin(s).</div></div>
    <div class="list">${items.length ? rows : '<div class="center-empty">Aucun salaire pour ce mois.</div>'}</div>
    ${nonGen ? `<div class="inline" style="margin-top:12px"><button class="btn secondary small" data-sal-generate>Générer les ${nonGen} écriture(s) comptable(s) du mois</button></div>
      <div class="muted" style="font-size:11px;margin-top:6px">Crée une facture de charge « Salaires » par bulletin, pour alimenter le compte de résultat et la trésorerie (sans double comptage : un bulletin déjà généré est ignoré).</div>` : ""}`;
}
function salaryEditor(id) {
  const s = id ? state.salaries.find((x) => x.id === id) : null;
  const cur = s || { id: null, contactId: null, name: "", companyId: (state.companies[0] || {}).id || null, month: salaryMonth || new Date().toISOString().slice(0, 7), gross: 0, charges: 0, net: 0, status: "aPayer", paymentDate: "", accountId: null, notes: "" };
  const comOpts = ['<option value="">Aucune société</option>'].concat(state.companies.map((c) => `<option value="${c.id}" ${c.id === cur.companyId ? "selected" : ""}>${esc(c.name || "Sans nom")}</option>`)).join("");
  const ctOpts = ['<option value="">— Saisie libre —</option>'].concat(state.contacts.map((c) => `<option value="${c.id}" ${c.id === cur.contactId ? "selected" : ""}>${esc(contactName(c))}</option>`)).join("");
  const stOpts = SAL_STATUSES.map((x) => `<option value="${x.code}" ${x.code === cur.status ? "selected" : ""}>${x.label}</option>`).join("");
  showModal(`<div class="modal-head"><strong class="grow">Bulletin de salaire</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <label class="field"><span>Salarié (contact)</span><select id="salContact">${ctOpts}</select></label>
    <label class="field"><span>Nom (si hors contacts)</span><input id="salName" value="${esc(cur.name)}"/></label>
    <label class="field"><span>Société</span><select id="salCompany">${comOpts}</select></label>
    <label class="field"><span>Mois</span><input type="month" id="salMonthField" value="${esc(cur.month)}"/></label>
    <div class="inline">
      <label class="field grow"><span>Brut (€)</span><input type="number" id="salGross" value="${cur.gross || 0}"/></label>
      <label class="field grow"><span>Charges (€)</span><input type="number" id="salCharges" value="${cur.charges || 0}"/></label>
    </div>
    <label class="field"><span>Net versé (€)</span><input type="number" id="salNet" value="${cur.net || 0}"/></label>
    <label class="field"><span>Statut</span><select id="salStatus">${stOpts}</select></label>
    <label class="field"><span>Payé le</span><input type="date" id="salPayDate" value="${esc((cur.paymentDate || "").slice(0, 10))}"/></label>
    <label class="field"><span>Notes</span><input id="salNotes" value="${esc(cur.notes)}"/></label>
    <div class="inline" style="margin-top:12px"><button class="btn" id="salSave">Enregistrer</button><span class="grow"></span>
      ${s ? '<button class="btn danger small" id="salDel">Supprimer</button>' : ""}</div>`);
  document.querySelector("[data-modal-close]").onclick = closeModal;
  document.getElementById("salSave").onclick = () => {
    const o = {
      id: cur.id || uid(), contactId: document.getElementById("salContact").value || null,
      name: document.getElementById("salName").value, companyId: document.getElementById("salCompany").value || null,
      month: document.getElementById("salMonthField").value || cur.month,
      gross: parseFloat(document.getElementById("salGross").value) || 0,
      charges: parseFloat(document.getElementById("salCharges").value) || 0,
      net: parseFloat(document.getElementById("salNet").value) || 0,
      status: document.getElementById("salStatus").value,
      paymentDate: document.getElementById("salPayDate").value,
      accountId: cur.accountId || null, notes: document.getElementById("salNotes").value,
      invoiceId: cur.invoiceId || null
    };
    if (s) Object.assign(s, o); else state.salaries.push(o);
    salaryMonth = o.month;
    save(); closeModal(); render();
  };
  const del = document.getElementById("salDel");
  if (del) del.onclick = () => { state.salaries = state.salaries.filter((x) => x.id !== id); save(); closeModal(); render(); };
}
// Crée la facture de charge correspondant à un bulletin (une seule fois).
function salaryGenerate(sal) {
  if (sal.invoiceId && state.invoices.some((v) => v.id === sal.invoiceId)) return false;
  if (!state.categories.some((c) => c.name === "Salaires")) state.categories.push({ id: uid(), name: "Salaires", nature: "charge", sortIndex: state.categories.length });
  const inv = {
    id: uid(), title: `Salaire ${monthLabel(sal.month)} — ${salName(sal)}`, reference: "", direction: "depense",
    status: sal.status === "paye" ? "payee" : "aPayer", amount: salTotal(sal), vatRate: 0,
    startDate: (sal.month || new Date().toISOString().slice(0, 7)) + "-01", hasDueDate: false, dueDate: "",
    paymentDate: sal.status === "paye" ? (sal.paymentDate || (sal.month + "-01")) : "",
    companyId: sal.companyId || null, contactId: sal.contactId || null, categoryName: "Salaires",
    payMode: "compte", accountId: sal.accountId || null, associateId: null, salaryId: sal.id
  };
  state.invoices.push(inv); sal.invoiceId = inv.id;
  return true;
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
    ${grid(card("Clients en retard", String(overdue.length), euros(overdue.reduce((t, v) => t + invTTC(v), 0)), overdue.length ? "#d23c3c" : "#4dc8bb") + card("Fournisseurs à payer", String(toPay.length), euros(toPay.reduce((t, v) => t + invTTC(v), 0)), "#e9db65") + card("Projets en cours", String(missionsEnCours), "", "#18c1d8") + card("Sociétés", String(state.companies.length), `${state.contacts.length} contacts`, "#18c1d8"))}
    ${alerts.length ? `<div class="section-h">Alertes</div><div class="card">${alerts.map((a) => `<div style="padding:4px 0">⚠️ ${esc(a)}</div>`).join("")}</div>` : ""}
    <div class="section-h">Trésorerie prévisionnelle (90 jours)</div>
    <div class="card">${svgLineChart(Array.from({ length: 19 }, (_, i) => ({ x: i * 5, y: treasuryProjected(now, i * 5) })), { color: "#18c1d8", xTicks: [{ x: 0, label: "auj." }, { x: 30, label: "30j" }, { x: 60, label: "60j" }, { x: 90, label: "90j" }] })}</div>
    <div class="section-h">Évolution du CA (12 mois, HT)</div>
    <div class="card">${svgBarChart(last12MonthsCA().map((a) => ({ label: a.label, value: a.value })), { color: "#4dc8bb" })}</div>`;
}

// ----------------------------- Temps -----------------------------
// Période affichée dans l'onglet Temps : semaine ou mois, navigables.
let timeTab = "semaine";
let timeRef = todayISO();   // date de référence (un jour de la semaine / du mois affiché)
const iso = (d) => d.toISOString().slice(0, 10);
// Renvoie la période courante : bornes, libellé, et si elle contient aujourd'hui.
function timeRange() {
  const ref = new Date(timeRef + "T12:00:00");
  if (timeTab === "mois") {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const label = start.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return { start, end, label, sub: "Mois complet", kind: "mois" };
  }
  const { start, end } = weekInterval(ref);
  return {
    start, end,
    label: `${fmtDate(iso(start))} → ${fmtDate(iso(new Date(end - 86400000)))}`,
    sub: "Semaine · lundi → dimanche", kind: "semaine"
  };
}
// Temps par mission sur une période.
function timeBreakdown(start, end) {
  let total = 0; const per = [];
  state.missions.forEach((m) => {
    let s = 0;
    (m.entries || []).forEach((e) => { const d = e.date ? new Date(e.date + "T12:00:00") : null; if (d && d >= start && d < end) s += entryElapsed(e); });
    if (s > 0) { per.push({ id: m.id, title: m.title || "Sans titre", s }); total += s; }
  });
  per.sort((a, b) => b.s - a.s);
  return { total, per };
}
// Découpage d'un mois en semaines (lundi → dimanche) pour la répartition.
function weeksOf(start, end) {
  const out = [];
  let cur = weekInterval(start).start;
  while (cur < end) {
    const wEnd = new Date(cur); wEnd.setDate(cur.getDate() + 7);
    const from = cur < start ? start : cur, to = wEnd > end ? end : wEnd;
    const { total } = timeBreakdown(from, to);
    out.push({ from: new Date(from), to: new Date(to), total });
    cur = wEnd;
  }
  return out;
}
// ----------------------------- Congés (compteur d'heures) -----------------------------
// Règles : +CRÉDIT MENSUEL le 1er de chaque mois ; en fin de semaine, l'écart entre
// les heures travaillées et le quota hebdomadaire est crédité (ou débité).
// Seules les semaines TERMINÉES sont comptées : la semaine en cours est affichée
// à part, en projection, pour ne pas afficher un solde faussement négatif.
function defaultLeave() {
  return { startMonth: new Date().toISOString().slice(0, 7), initialBalance: 0, monthlyCredit: 20, weeklyQuota: 40, hoursPerDay: 8, adjustments: [] };
}
const leaveCfg = () => Object.assign(defaultLeave(), state.leave || {});
// Format signé : 62h30, −32h, +2h30
function fmtH(h) {
  const sign = h < 0 ? "−" : (h > 0 ? "+" : "");
  const a = Math.abs(h), hh = Math.floor(a + 1e-9), mm = Math.round((a - hh) * 60);
  return sign + (mm ? `${hh}h${String(mm).padStart(2, "0")}` : `${hh}h`);
}
const fmtDays = (h, perDay) => (h / (perDay || 8)).toFixed(2).replace(".", ",") + " j";
// Heures travaillées sur un intervalle (d'après l'historique des missions).
function workedHours(start, end) { return timeBreakdown(start, end).total / 3600; }
// Journal chronologique des mouvements, avec solde courant.
function leaveLedger() {
  const cfg = leaveCfg();
  const moves = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ref = new Date(cfg.startMonth + "-01T12:00:00");
  if (isNaN(ref)) return { moves: [], balance: cfg.initialBalance, cfg, current: null };
  // 1er du mois de départ, à minuit (les bornes de semaine le sont aussi :
  // comparer midi et minuit ferait sauter la première semaine).
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);

  // Crédits mensuels : le 1er de chaque mois, du mois de départ au mois courant.
  const cur = new Date(first);
  while (cur <= today) {
    moves.push({ date: iso(new Date(cur.getFullYear(), cur.getMonth(), 1)), kind: "credit",
      label: `Crédit mensuel — ${cur.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}`, delta: cfg.monthlyCredit });
    cur.setMonth(cur.getMonth() + 1);
  }
  // Régularisations hebdomadaires : semaines entièrement écoulées.
  // Si le mois commence en milieu de semaine, on ignore cette semaine incomplète
  // (elle déborderait sur le mois précédent).
  let w = weekInterval(first).start;
  if (w < first) w.setDate(w.getDate() + 7);
  while (true) {
    const wEnd = new Date(w); wEnd.setDate(w.getDate() + 7);
    if (wEnd > today) break;                       // semaine non terminée : on s'arrête
    const worked = workedHours(w, wEnd);
    moves.push({ date: iso(new Date(wEnd.getTime() - 86400000)), kind: "semaine",
      label: `Semaine du ${fmtDate(iso(w))} — ${fmtH(worked).replace(/^\+/, "")} travaillées`,
      delta: worked - cfg.weeklyQuota, worked });
    w = wEnd;
  }
  // Ajustements manuels.
  (cfg.adjustments || []).forEach((a) => moves.push({ date: a.date, kind: "ajust", label: a.note || "Ajustement", delta: Number(a.hours) || 0, id: a.id }));

  moves.sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.kind === "credit" ? -1 : 1));
  let bal = Number(cfg.initialBalance) || 0;
  moves.forEach((m) => { bal += m.delta; m.balance = bal; });

  // Semaine en cours (non encore régularisée) : projection.
  const cw = weekInterval(new Date());
  const current = { start: cw.start, end: cw.end, worked: workedHours(cw.start, cw.end) };
  current.delta = current.worked - cfg.weeklyQuota;
  return { moves, balance: bal, cfg, current };
}
function renderLeave() {
  const { moves, balance, cfg, current } = leaveLedger();
  const rows = [...moves].reverse().slice(0, 80).map((m) => {
    const col = m.delta >= 0 ? "var(--positive)" : "#d23c3c";
    return `<tr><td style="white-space:nowrap">${esc(fmtDate(m.date))}</td>
      <td>${esc(m.label)}</td>
      <td class="num" style="color:${col};font-weight:600">${esc(fmtH(m.delta))}</td>
      <td class="num">${esc(fmtH(m.balance).replace(/^\+/, ""))}</td></tr>`;
  }).join("");
  return `<div class="card" style="background:rgba(24,193,216,.08)">
      <div class="inline"><strong class="grow">Solde de congés</strong>
        <strong style="color:${balance >= 0 ? "var(--positive)" : "#d23c3c"};font-size:22px">${esc(fmtH(balance).replace(/^\+/, ""))}</strong></div>
      <div class="muted" style="font-size:12px;margin-top:2px">soit ${esc(fmtDays(balance, cfg.hoursPerDay))} · ${cfg.monthlyCredit}h créditées le 1er de chaque mois · quota ${cfg.weeklyQuota}h/semaine</div></div>
    <div class="card" style="margin-top:10px">
      <div class="inline"><span class="grow">Semaine en cours <span class="muted" style="font-size:12px">(pas encore régularisée)</span></span>
        <span class="timer">${esc(fmtH(current.worked).replace(/^\+/, ""))} / ${cfg.weeklyQuota}h</span></div>
      <div class="muted" style="font-size:12px;margin-top:3px">À la clôture de la semaine : <strong style="color:${current.delta >= 0 ? "var(--positive)" : "#d23c3c"}">${esc(fmtH(current.delta))}</strong> → solde prévisionnel ${esc(fmtH(balance + current.delta).replace(/^\+/, ""))}</div></div>
    <div class="toolbar" style="margin-top:14px"><span class="grow"></span>
      <button class="btn secondary small" data-leave-adjust>+ Ajustement</button>
      <button class="btn secondary small" data-leave-settings>⚙︎ Paramètres</button></div>
    <div class="section-h">Journal des mouvements</div>
    <div class="card" style="padding:8px"><div style="overflow-x:auto"><table class="bank-table">
      <thead><tr><th>Date</th><th>Mouvement</th><th class="num">Variation</th><th class="num">Solde</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">Aucun mouvement. Vérifie le mois de départ dans les paramètres.</td></tr>'}</tbody></table></div>
      ${moves.length > 80 ? `<div class="muted" style="font-size:11px;margin-top:6px">80 mouvements les plus récents sur ${moves.length}.</div>` : ""}</div>
    <div class="muted" style="font-size:11px;margin-top:10px;line-height:1.5">⚠️ Une semaine sans temps saisi est comptée comme une semaine non travaillée (−${cfg.weeklyQuota}h). Règle le <strong>mois de départ</strong> sur le début réel de ton suivi pour éviter des débits sur des semaines non pointées.</div>`;
}
function leaveSettings() {
  const cfg = leaveCfg();
  showModal(`<div class="modal-head"><strong class="grow">Paramètres des congés</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <label class="field"><span>Mois de départ du suivi</span><input type="month" id="lvStart" value="${esc(cfg.startMonth)}"/></label>
    <label class="field"><span>Solde initial (heures)</span><input type="number" step="0.5" id="lvInit" value="${cfg.initialBalance}"/></label>
    <label class="field"><span>Crédit mensuel (heures)</span><input type="number" step="0.5" id="lvCredit" value="${cfg.monthlyCredit}"/></label>
    <label class="field"><span>Quota hebdomadaire (heures)</span><input type="number" step="0.5" id="lvQuota" value="${cfg.weeklyQuota}"/></label>
    <label class="field"><span>Heures par jour (conversion en jours)</span><input type="number" step="0.5" id="lvDay" value="${cfg.hoursPerDay}"/></label>
    <div class="inline" style="margin-top:12px"><button class="btn" id="lvSave">Enregistrer</button></div>`);
  document.querySelector("[data-modal-close]").onclick = closeModal;
  document.getElementById("lvSave").onclick = () => {
    state.leave = Object.assign(leaveCfg(), {
      startMonth: document.getElementById("lvStart").value || cfg.startMonth,
      initialBalance: parseFloat(document.getElementById("lvInit").value) || 0,
      monthlyCredit: parseFloat(document.getElementById("lvCredit").value) || 0,
      weeklyQuota: parseFloat(document.getElementById("lvQuota").value) || 40,
      hoursPerDay: parseFloat(document.getElementById("lvDay").value) || 8
    });
    save(); closeModal(); render();
  };
}
function leaveAdjust() {
  showModal(`<div class="modal-head"><strong class="grow">Ajustement manuel</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <div class="muted" style="font-size:12px;margin-bottom:8px">Pour une correction ou un congé non reflété par le temps saisi. Valeur négative = débit.</div>
    <label class="field"><span>Date</span><input type="date" id="ajDate" value="${todayISO()}"/></label>
    <label class="field"><span>Heures (+ ou −)</span><input type="number" step="0.5" id="ajH" value="0"/></label>
    <label class="field"><span>Libellé</span><input id="ajNote" placeholder="Ex. Congé posé, régularisation…"/></label>
    <div class="inline" style="margin-top:12px"><button class="btn" id="ajSave">Enregistrer</button></div>`);
  document.querySelector("[data-modal-close]").onclick = closeModal;
  document.getElementById("ajSave").onclick = () => {
    const cfg = leaveCfg();
    cfg.adjustments = (cfg.adjustments || []).concat([{ id: uid(), date: document.getElementById("ajDate").value || todayISO(), hours: parseFloat(document.getElementById("ajH").value) || 0, note: document.getElementById("ajNote").value }]);
    state.leave = cfg; save(); closeModal(); render();
  };
}

function renderTime() {
  const r = timeRange();
  const { total, per } = timeBreakdown(r.start, r.end);
  const tabs = [["semaine", "Semaine"], ["mois", "Mois"], ["conges", "Congés"]]
    .map(([id, lbl]) => `<button class="chip ${timeTab === id ? "active" : ""}" data-ttab="${id}">${lbl}</button>`).join("");
  if (timeTab === "conges") {
    return `<div class="toolbar"><div class="page-title grow" style="margin:0">Temps</div></div>
      <div class="chip-row" style="margin-bottom:12px">${tabs}</div>${renderLeave()}`;
  }
  const bar = (s) => {
    const pct = total > 0 ? Math.round((s / total) * 100) : 0;
    return `<div class="tm-bar"><div style="width:${pct}%"></div></div><span class="tm-pct">${pct}%</span>`;
  };
  const rows = per.length
    ? per.map((p) => `<div class="tm-row"><span class="tm-name">${esc(p.title)}</span>${bar(p.s)}<span class="timer tm-val">${fmtDuration(p.s)}</span></div>`).join("")
    : `<div class="muted">Aucun temps sur cette période.</div>`;
  let weekly = "";
  if (r.kind === "mois") {
    const ws = weeksOf(r.start, r.end).filter((w) => w.total > 0);
    weekly = `<div class="section-h">Par semaine</div><div class="card">${
      ws.length ? ws.map((w) => `<div class="tm-row"><span class="tm-name">${esc(fmtDate(iso(w.from)))} → ${esc(fmtDate(iso(new Date(w.to - 86400000))))}</span>${bar(w.total)}<span class="timer tm-val">${fmtDuration(w.total)}</span></div>`).join("")
        : '<div class="muted">—</div>'}</div>`;
  }
  const moyenne = r.kind === "mois" && per.length
    ? `<div class="muted" style="font-size:11px;margin-top:6px">${per.length} projet(s) · moyenne ${fmtDuration(total / per.length)} par projet</div>` : "";
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Temps</div>
      <button class="btn secondary small" data-export-temps-csv>⬇ CSV</button>
      <button class="btn secondary small" data-export-temps-pdf>📄 PDF</button></div>
    <div class="chip-row" style="margin-bottom:12px">${tabs}</div>
    <div class="toolbar">
      <button class="btn ghost small" data-time-nav="-1" title="Période précédente">‹</button>
      <div class="grow" style="text-align:center">
        <div class="muted" style="font-size:12px">${esc(r.sub)}</div>
        <strong style="text-transform:capitalize">${esc(r.label)}</strong></div>
      <button class="btn ghost small" data-time-nav="1" title="Période suivante">›</button>
      <button class="btn secondary small" data-time-now>${r.kind === "mois" ? "Ce mois" : "Cette semaine"}</button></div>
    <div class="card"><div class="inline"><strong class="grow">Temps total</strong>
      <span class="timer" style="color:var(--primary);font-size:18px">${fmtDuration(total)}</span></div>${moyenne}</div>
    <div class="section-h">Par projet</div><div class="card">${rows}</div>
    ${weekly}`;
}
function weekInterval(date) { const d = new Date(date); d.setHours(0, 0, 0, 0); const day = (d.getDay() + 6) % 7; const start = new Date(d); start.setDate(d.getDate() - day); const end = new Date(start); end.setDate(start.getDate() + 7); return { start, end }; }

// ----------------------------- Tâches -----------------------------
function missionSelect(bind, current) {
  const opts = ['<option value="">Aucun projet</option>'].concat(
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
// Tâches d'une colonne, classées par échéance croissante (sans échéance en dernier).
function tasksOf(code) {
  return state.tasks.filter((t) => (t.status || "aFaire") === code)
    .sort((a, b) => (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31") || (a.createdAt || 0) - (b.createdAt || 0));
}
function renderTasks() {
  const cols = TASK_STATUSES.map((st, idx) => {
    const items = tasksOf(st.code);
    const cards = items.map((t) => {
      const done = st.code === "termine";
      const di = deadlineInfo(t.dueDate, done);
      const projOpts = ['<option value="">— Sans projet —</option>'].concat(sortedMissions().map((m) => `<option value="${m.id}" ${m.id === t.missionId ? "selected" : ""}>${esc(m.title || "Sans titre")}</option>`)).join("");
      const mission = `<select class="flat-input kb-mission" data-task-mission="${t.id}" title="Projet">${projOpts}</select>${t.assignee ? `<div class="kb-mission">👤 ${esc(t.assignee)}</div>` : ""}`;
      return `<div class="kb-card" data-task-card="${t.id}" style="border-left-color:${di.color}">
        <div class="kb-grip" title="Glisser vers une autre colonne">⠿</div>
        <input class="flat-input kb-title" data-taskfield="title" data-t="${t.id}" value="${esc(t.title)}" placeholder="Intitulé de la tâche"/>
        ${mission}
        <div class="kb-dl" style="color:${di.muted ? "var(--muted)" : di.color};font-weight:${di.muted ? 400 : 600}">${di.muted ? "" : "⬤ "}${esc(di.label)}</div>
        <div class="kb-actions">
          <input type="date" data-taskdue="${t.id}" value="${esc(t.dueDate || "")}" title="Échéance"/>
          <span class="grow"></span>
          <button class="btn ghost small" data-task-move="-1" data-t="${t.id}" ${idx === 0 ? "disabled" : ""} title="Colonne précédente">‹</button>
          <button class="btn ghost small" data-task-move="1" data-t="${t.id}" ${idx === TASK_STATUSES.length - 1 ? "disabled" : ""} title="Colonne suivante">›</button>
          <button class="btn ghost small" data-del-task="${t.id}" title="Supprimer">✕</button>
        </div></div>`;
    }).join("");
    return `<div class="kb-col" data-kanban-col="${st.code}">
      <div class="kb-head"><span class="grow">${st.label}</span><span class="kb-count">${items.length}</span></div>
      <div class="kb-body">${cards || '<div class="kb-empty">Aucune tâche</div>'}
        <button class="btn ghost small kb-add" data-add-task="${st.code}">+ Ajouter</button></div>
    </div>`;
  }).join("");
  const legend = `<div class="dl-legend"><span class="muted">Échéance :</span>
    <span class="dl-grad"></span>
    <span class="muted" style="font-size:11px">lointaine → imminente</span></div>`;
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Tâches</div>
      <button class="btn" data-add-task="aFaire">+ Nouvelle tâche</button></div>
    ${legend}
    <div class="muted" style="font-size:11px;margin-bottom:10px">Colonnes classées par échéance la plus proche · glisse une carte (⠿) ou utilise ‹ › pour la déplacer.</div>
    <div class="kb-board">${cols}</div>
    <button class="btn fab" data-add-task="aFaire">+</button>`;
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
      <label class="field"><span>Projet</span>${missionSelect(`actions|${a.id}|missionId`, a.missionId)}</label>
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

// ----------------------------- Agenda Google (lecture seule) -----------------------------
// L'agenda Google alimente Planning (emploi du temps + agenda) et Rendez-vous.
// L'app ne demande que la portée « calendar.readonly » : elle ne modifie jamais l'agenda.
const CAL_CACHE = "op01_calendar";
const CAL_PAST_DAYS = 60;     // profondeur d'historique chargée
// Horizon de la synthèse : jusqu'à cette date incluse. Un horizon fixe finit par
// être dépassé, d'où le plancher : passé cette date, on garde six mois d'avance
// plutôt que de ne plus rien afficher.
const CAL_HORIZON = "2027-06-30";
const CAL_MIN_AHEAD_DAYS = 180;
// Date d'horizon au format ISO (yyyy-mm-dd), pour l'affichage.
function calHorizonISO() {
  const d = calHorizonDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function calHorizonDate() {
  const floor = new Date(); floor.setDate(floor.getDate() + CAL_MIN_AHEAD_DAYS);
  const fixed = new Date(CAL_HORIZON + "T23:59:59");
  return fixed > floor ? fixed : floor;
}
const CAL_FRESH = 5 * 60000;  // au-delà, on redemande l'agenda à Google
const CAL_RETRY = 30 * 60000; // après une erreur, on n'insiste qu'au bout d'une demi-heure
let calendar = loadCalCache();  // { events, at, error }
let calBusy = false;

function loadCalCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CAL_CACHE) || "null");
    if (raw && Array.isArray(raw.events)) return { events: raw.events, at: raw.at || 0, error: null };
  } catch (e) {}
  return { events: [], at: 0, error: null };
}
function saveCalCache() {
  try { localStorage.setItem(CAL_CACHE, JSON.stringify({ events: calendar.events, at: calendar.at })); } catch (e) {}
}
// Les sections qui affichent l'agenda : on ne redessine que si l'une est ouverte.
const calVisible = () => view.section === "planning" || view.section === "rendezvous" || view.section === "dashboard";

const calHHMM = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
const calDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Convertit un événement Google en fiche simple, indépendante de l'API.
function normEvent(e) {
  const st = e.start || {}, en = e.end || {};
  const allDay = !st.dateTime;
  const guests = (e.attendees || [])
    .filter((a) => a && !a.self && !a.resource && (a.email || a.displayName))
    .map((a) => ({ email: (a.email || "").toLowerCase(), name: a.displayName || "", status: a.responseStatus || "" }));
  const org = e.organizer || {};
  return {
    id: e.id,
    date: allDay ? (st.date || "") : calDay(st.dateTime),
    time: allDay ? "" : calHHMM(st.dateTime),
    endTime: (!allDay && en.dateTime) ? calHHMM(en.dateTime) : "",
    allDay,
    mins: (!allDay && st.dateTime && en.dateTime) ? Math.max(0, Math.round((new Date(en.dateTime) - new Date(st.dateTime)) / 60000)) : 0,
    title: e.summary || "(sans titre)",
    location: e.location || "",
    notes: e.description || "",
    link: e.htmlLink || "",
    meet: e.hangoutLink || "",
    guests,
    organizer: org.self ? "" : (org.displayName || org.email || ""),
    mine: !!org.self,
    calName: e.calendarName || ""
  };
}
// Traduit l'erreur Google en cas que l'utilisateur peut corriger lui-même.
function calError(e) {
  const msg = (e && (e.detail || e.message)) || "Erreur inconnue";
  if (/has not been used|SERVICE_DISABLED|is disabled|not been enabled/i.test(msg)) return { code: "api", msg };
  if (/insufficient|scope|ACCESS_TOKEN|unauthorized/i.test(msg) || (e && (e.status === 401 || e.status === 403))) return { code: "scope", msg };
  return { code: "other", msg };
}
// Prochaine tentative autorisée : après une erreur on n'insiste pas à chaque
// rendu, sinon un refus de Google relance une autorisation en boucle.
let calNextTry = 0;
async function loadCalendar(force) {
  if (!(window.DriveSync && DriveSync.listEvents && DriveSync.isConnected())) return;
  // L'agenda n'est lu que si l'utilisateur l'a explicitement relié.
  if (!DriveSync.calendarGranted || !DriveSync.calendarGranted()) {
    if (!calendar.error) { calendar = { events: [], at: calendar.at, error: { code: "off", msg: "" } }; if (calVisible()) render(); }
    return;
  }
  if (calBusy) return;
  if (!force && Date.now() < calNextTry) return;
  if (!force && calendar.at && Date.now() - calendar.at < CAL_FRESH && !calendar.error) return;
  calBusy = true; if (calVisible()) render();
  try {
    const from = new Date(); from.setDate(from.getDate() - CAL_PAST_DAYS);
    const raw = await DriveSync.listEvents(from.toISOString(), calHorizonDate().toISOString());
    calendar = { events: raw.map(normEvent).filter((e) => e.date), at: Date.now(), error: null };
    calNextTry = 0;
    saveCalCache();
  } catch (e) {
    // On garde les événements déjà connus : mieux vaut un agenda un peu daté que rien.
    calendar = { events: calendar.events, at: calendar.at, error: calError(e) };
    // On attend une action de l'utilisateur (« Réessayer ») plutôt que de relancer
    // Google à chaque rendu.
    calNextTry = Date.now() + CAL_RETRY;
  }
  calBusy = false;
  if (calVisible()) render();
}
const calSorted = () => [...calendar.events].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
const calUpcoming = () => { const t = todayISO(); return calSorted().filter((e) => e.date >= t); };
function calWhen(e) {
  if (!e.date) return "";
  if (e.allDay) return fmtDate(e.date) + " · journée entière";
  return fmtDate(e.date) + (e.time ? ` · ${e.time}${e.endTime ? "–" + e.endTime : ""}` : "");
}
const calGuestName = (g) => g.name || g.email || "?";

// Nature de l'événement, déduite du titre et de la description. C'est elle qui
// commande la préparation : un trajet en voiture ne demande rien, un trajet en
// transport demande des billets, un rendez-vous client demande un dossier…
// La comparaison se fait sans accent ni majuscule, sur des mots entiers.
const noAccents = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const EVENT_KINDS = [
  { id: "client", label: "Rendez-vous client", ic: "🤝",
    re: /\b(client|clients|clientele|prospect|prospects|closing|negociation|devis|contrat|proposition commerciale|appel d'offres?|appel d offres?)\b/ },
  { id: "commercial", label: "Événement commercial", ic: "📣",
    re: /\b(salon|foire|congres|forum|networking|afterwork|prospection|demarchage|commercial|commerciale|business|pitch|stand|exposant|convention|meetup)\b/ },
  { id: "transport", label: "Trajet en transport", ic: "🚆",
    re: /\b(avion|vol|aeroport|autocar|bus|taxi|vtc|uber|train|tgv|gare|ferry|bateau|metro|tramway|navette|eurostar|thalys|ouigo|intercites)\b/ },
  { id: "sport", label: "Sport", ic: "🏀",
    re: /\b(match|basket|basketball|foot|football|tennis|entrainement|tournoi|championnat|handball|rugby|volley|padel|squash)\b/ },
  { id: "voiture", label: "Trajet en voiture", ic: "🚗",
    re: /\b(voiture|covoiturage|autoroute|conduite|au volant)\b/ }
];
function calKinds(e) {
  const hay = noAccents((e.title || "") + " " + (e.notes || ""));
  let ids = EVENT_KINDS.filter((k) => k.re.test(hay)).map((k) => k.id);
  // Le trajet en voiture ne demande rien en lui-même : s'il accompagne autre
  // chose (un client, un salon), c'est cette autre nature qui commande.
  if (ids.length > 1) ids = ids.filter((id) => id !== "voiture");
  return ids;
}
const calKindLabel = (id) => { const k = EVENT_KINDS.find((x) => x.id === id); return k ? k.ic + " " + k.label : id; };

// Repères généraux, utilisés seulement quand aucune nature n'est reconnue.
const PREP_WORDS = ["prépa", "préparer", "présentation", "atelier", "workshop",
  "comité", "board", "conseil", "assemblée", "soutenance", "entretien", "revue",
  "review", "bilan", "formation", "séminaire", "ordre du jour", "kick-off", "kickoff", "démo",
  "audit", "restitution", "rapport"];
// Que faut-il préparer ? On renvoie la nature et la liste des choses à faire,
// pour que l'app dise quoi faire plutôt que seulement « à préparer ».
function calPrep(e) {
  const kinds = calKinds(e);
  const has = (id) => kinds.indexOf(id) > -1;
  const todo = [];
  const find = calGuestsToFind(e);
  if (find) todo.push(`trouver ${find} invité${find > 1 ? "s" : ""}`);
  if (has("transport")) todo.push("réserver / récupérer les billets");
  if (has("commercial")) todo.push("préparer les supports commerciaux");
  if (has("client")) todo.push("relire le dossier et préparer l'entretien");
  if (has("sport") && !find) {
    // « un ou deux invités à trouver » : l'équipe n'est pas complète.
    const missing = e.guests.filter((g) => g.status !== "accepted").length;
    if (!e.guests.length) todo.push("trouver des joueurs");
    else if (missing >= 1 && missing <= 2) todo.push(`compléter l'équipe (${missing} invité${missing > 1 ? "s" : ""} à trouver)`);
  }
  // Nature reconnue (y compris « voiture », qui ne demande rien) ou consigne
  // explicite : on s'y tient, sans y ajouter les repères généraux.
  if (kinds.length || find) return { kinds, todo };
  const hay = noAccents((e.title || "") + " " + (e.notes || ""));
  const w = PREP_WORDS.find((x) => hay.indexOf(noAccents(x)) > -1);
  if (w) todo.push(`sujet « ${w} »`);
  const people = calPeople(e);
  // La durée n'est qu'un indice de repli : dès qu'on sait avec qui on est, elle
  // ne dit plus rien — un match de trois heures avec Alix n'est pas à préparer.
  if (e.mins >= 90 && !people.length) todo.push(`durée ${fmtDurationShort(e.mins * 60)}`);
  if (people.length >= 3) todo.push(`${people.length} participants`);
  return { kinds, todo };
}
const calPrepReasons = (e) => calPrep(e).todo;

// Beaucoup d'agendas ne comportent aucun invité Google : l'information est
// écrite à la main dans le titre. On lit donc les parenthèses.
//   « ADA - Orléans (Trouver un invité) » → 1 invité à trouver
//   « ADA - Denain (Alix) »               → rendez-vous avec Alix
const FIND_RE = /\(\s*trouver\s+(un|une|deux|trois|quatre|cinq|\d+)\s+invit\w*\s*\)/;
const NUM_WORDS = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 };
function calGuestsToFind(e) {
  const m = FIND_RE.exec(noAccents(e.title || ""));
  if (!m) return 0;
  return NUM_WORDS[m[1]] || parseInt(m[1], 10) || 1;
}
// Noms écrits dans le titre : entre parenthèses, ou après « avec ».
// On écarte les parenthèses qui ne nomment personne (consignes, lieu, visio…).
const NOT_A_NAME = /trouver|invit|annul|report|visio|tel|distanciel|presentiel|confirm|attente|option|domicile|exterieur/;
function calNamesFromTitle(e) {
  const out = [];
  const push = (chunk) => String(chunk).split(/\s*(?:,|&|\+|\bet\b)\s*/i).forEach((x) => {
    const v = x.trim();
    if (v && v.length <= 40 && !/^\d+$/.test(v)) out.push(v);
  });
  const re = /\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(e.title || ""))) {
    const raw = m[1].trim();
    if (raw && !NOT_A_NAME.test(noAccents(raw))) push(raw);
  }
  const av = /\bavec\s+([^(),;]+)/i.exec(e.title || "");
  if (av) push(av[1]);
  return out;
}
// Personnes rencontrées : invités Google d'abord, noms du titre ensuite.
function calPeople(e) {
  const out = [], seen = {};
  e.guests.forEach((g) => {
    const name = calGuestName(g);
    const key = g.email || noAccents(name);
    if (!key || seen[key]) return;
    // On retient aussi le nom affiché : le titre écrit « (Anne) » là où Google
    // connaît « anne@… », il ne faut pas compter la personne deux fois.
    seen[key] = 1; seen[noAccents(name)] = 1;
    out.push({ key, name, email: g.email });
  });
  calNamesFromTitle(e).forEach((n) => {
    const key = noAccents(n);
    if (!key || seen[key]) return;
    seen[key] = 1; out.push({ key, name: n, email: "" });
  });
  return out;
}

// Un événement solitaire n'est pas forcément un rendez-vous à peupler : un
// trajet, un créneau de travail ou un rappel n'attendent personne. On ne signale
// « invités à trouver » que si l'événement suppose quelqu'un en face.
const MEETING_RE = /\b(rdv|rendez-vous|reunion|point|entretien|call|visio|dejeuner|diner|cafe|brief|debrief|interview|entrevue)\b/;
function calNeedsGuests(e) {
  if (calGuestsToFind(e) > 0) return true;   // consigne explicite dans le titre
  if (e.allDay || e.guests.length) return false;
  const kinds = calKinds(e);
  // Un match se joue à plusieurs ; un rendez-vous client suppose le client.
  if (kinds.indexOf("client") > -1 || kinds.indexOf("sport") > -1) return true;
  // Trajet, salon, conférence : on peut parfaitement y aller seul.
  if (kinds.length) return false;
  return MEETING_RE.test(noAccents(e.title || ""));
}
// Synthèse des événements à venir : avec qui, invités à trouver, préparation.
function calSynthesis() {
  const up = calUpcoming();
  const meetings = up.filter((e) => !e.allDay);
  const people = new Map();
  up.forEach((e) => calPeople(e).forEach((g) => {
    const p = people.get(g.key) || { key: g.key, name: g.name, email: g.email, n: 0, next: null };
    if (!p.email && g.email) p.email = g.email;
    p.n++; if (!p.next) p.next = e;
    people.set(g.key, p);
  }));
  const contacts = [...people.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "fr"));
  const noGuests = meetings.filter(calNeedsGuests);
  const waiting = up.filter((e) => e.guests.length && e.guests.some((g) => g.status === "needsAction" || g.status === "declined"));
  const prep = up.map((e) => ({ e, reasons: calPrep(e).todo })).filter((x) => x.reasons.length);
  return { up, meetings, contacts, noGuests, waiting, prep };
}
// Bandeau d'explication quand l'agenda n'est pas (encore) lisible.
function calNotice(quiet) {
  const err = calendar.error;
  if (!err) return "";
  if (quiet && err.code === "off") return "";
  const box = (title, body, btn) => `<div class="card cal-notice">
    <strong>${title}</strong><div class="muted" style="font-size:13px;margin-top:4px">${body}</div>
    <div style="margin-top:10px">${btn}</div></div>`;
  if (err.code === "off") {
    return box("Relier ton agenda Google",
      "Operations01 peut afficher ici les événements de ton agenda Google, <strong>en lecture seule</strong> : rien n'y sera jamais modifié. Tu peux délier l'agenda à tout moment.",
      '<button class="btn small" data-cal-enable>Relier mon agenda Google</button>');
  }
  if (err.code === "scope") {
    return box("Agenda Google : autorisation à renouveler",
      "Google n'a pas accordé l'accès en lecture à l'agenda. Appuie sur « Relier mon agenda », puis laisse la case « Consulter les événements de votre agenda » cochée.",
      '<button class="btn small" data-cal-enable>Relier mon agenda Google</button>');
  }
  if (err.code === "api") {
    return box("Agenda Google : API à activer",
      "L'API Google Calendar n'est pas encore activée pour le projet Google de l'application. Une fois activée (console Google Cloud → « API et services » → Google Calendar API → Activer), appuie sur « Réessayer ».",
      '<button class="btn small" data-cal-refresh>Réessayer</button>');
  }
  return box("Agenda Google indisponible", esc(err.msg), '<button class="btn small" data-cal-refresh>Réessayer</button>');
}
const calLinked = () => !!(window.DriveSync && DriveSync.calendarGranted && DriveSync.calendarGranted());
function calFooter() {
  if (!calLinked()) return "";
  const when = calendar.at ? new Date(calendar.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : null;
  return `<div class="inline muted" style="font-size:12px;margin-top:12px">
    <span class="grow">${calBusy ? "Lecture de l'agenda Google…" : (when ? `Agenda synchronisé à ${when}.` : "Agenda Google non chargé.")}</span>
    <button class="btn ghost small" data-cal-refresh>↻ Actualiser l'agenda</button>
    <button class="btn ghost small" data-cal-unlink>Délier l'agenda</button></div>`;
}
// Demande d'autorisation de l'agenda : uniquement sur un clic de l'utilisateur.
function enableCalendar() {
  if (!(window.DriveSync && DriveSync.enableCalendar)) return;
  Promise.resolve(DriveSync.enableCalendar()).then((ok) => {
    if (ok === null) return;          // redirection vers Google en cours (iOS)
    calNextTry = 0;
    calendar = { events: calendar.events, at: 0, error: null };
    loadCalendar(true);
    toast("Agenda Google relié ✓");
  }).catch((e) => {
    calNextTry = 0;
    calendar = { events: [], at: calendar.at, error: { code: "off", msg: "" } };
    render();
    alert("Impossible de relier l'agenda : " + e.message
      + "\n\nSur iPhone (Safari), autorise les fenêtres surgissantes pour ce site, puis réessaie.");
  });
}
function unlinkCalendar() {
  if (!(window.DriveSync && DriveSync.disableCalendar)) return;
  DriveSync.disableCalendar();
  calNextTry = 0;
  calendar = { events: [], at: 0, error: { code: "off", msg: "" } };
  saveCalCache();
  render();
  toast("Agenda Google délié.");
}
// Fiche d'un événement (lecture seule) affichée depuis Rendez-vous ou Planning.
function renderCalEventDetail(eid) {
  const e = calendar.events.find((x) => x.id === eid);
  if (!e) { view.detailId = null; return renderRendezvous(); }
  const people = calPeople(e);
  const byEmail = {};
  e.guests.forEach((g) => { byEmail[g.email || noAccents(calGuestName(g))] = g; });
  const toFind = calGuestsToFind(e);
  const guests = people.length
    ? people.map((p) => {
        const g = byEmail[p.key];
        const sub = g ? [g.email || "", g.status ? calStatusLabel(g.status) : ""].filter(Boolean).join(" · ")
                      : "nom lu dans le titre de l'événement";
        return `<div class="row" style="cursor:default;border-left-color:var(--positive)">
          <div class="grow"><div class="r-title">${esc(p.name)}</div>
          <div class="r-sub">${esc(sub)}</div></div></div>`;
      }).join("")
    : `<div class="muted" style="padding:4px 2px;font-size:13px">Personne d'identifié${toFind ? "" : " — ni invité Google, ni nom dans le titre"}.</div>`;
  const prep = calPrep(e);
  const links = [
    e.meet ? `<a class="btn secondary small" href="${esc(e.meet)}" target="_blank" rel="noopener">Rejoindre la visio</a>` : "",
    e.link ? `<a class="btn ghost small" href="${esc(e.link)}" target="_blank" rel="noopener">Ouvrir dans Google Agenda</a>` : ""
  ].filter(Boolean).join(" ");
  return `<button class="back" data-back-rdv>‹ Rendez-vous</button>
    <div class="page-title">${esc(e.title)}</div>
    <div class="muted" style="font-size:12px;margin:-8px 0 12px">Événement de ton agenda Google — lecture seule.</div>
    <div class="card">
      <div><strong>${esc(calWhen(e))}</strong>${e.mins ? ` <span class="muted">· ${fmtDurationShort(e.mins * 60)}</span>` : ""}</div>
      ${e.location ? `<div class="muted" style="margin-top:6px">📍 ${esc(e.location)}</div>` : ""}
      ${e.organizer ? `<div class="muted" style="margin-top:6px">Organisé par ${esc(e.organizer)}</div>` : ""}
      ${e.calName ? `<div class="muted" style="margin-top:6px">Agenda : ${esc(e.calName)}</div>` : ""}
      ${prep.kinds.length ? `<div style="margin-top:8px">${prep.kinds.map((k) => `<span class="cal-kind">${esc(calKindLabel(k))}</span>`).join(" ")}</div>` : ""}
      ${prep.todo.length
        ? `<div style="margin-top:8px"><span class="cal-tag">À préparer</span><ul class="cal-todo">${prep.todo.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`
        : (prep.kinds.length ? `<div class="muted" style="margin-top:8px;font-size:13px">Rien à préparer.</div>` : "")}
      ${links ? `<div class="inline" style="margin-top:10px">${links}</div>` : ""}
    </div>
    ${e.notes ? `<div class="section-h">Description</div><div class="card"><div class="cal-notes">${esc(e.notes)}</div></div>` : ""}
    <div class="section-h">Participants <span class="muted">(${people.length}${toFind ? ` · ${toFind} à trouver` : ""})</span></div>
    <div class="list">${guests}</div>
    <div style="margin-top:18px"><button class="btn secondary small" data-cal-import="${esc(e.id)}">+ Créer un rendez-vous Operations01 à partir de cet événement</button></div>`;
}
function calStatusLabel(s) {
  return s === "accepted" ? "a accepté" : s === "declined" ? "a décliné" : s === "tentative" ? "peut-être" : "sans réponse";
}
// Reprend un événement Google dans les rendez-vous de l'app (pour y ajouter mission/notes).
function importCalEvent(eid) {
  const e = calendar.events.find((x) => x.id === eid);
  if (!e) return;
  const r = {
    id: uid(), title: e.title, date: e.date, time: e.time || "",
    location: e.location || e.meet || "", withName: calPeople(e).map((p) => p.name).join(", "),
    contactId: null, missionId: null, notes: e.notes || "", createdAt: Date.now()
  };
  state.rendezvous.push(r);
  save();
  openDetail("rendezvous", r.id);
  toast("Rendez-vous créé depuis l'agenda ✓");
}
// Synthèse affichée dans Planning.
function renderCalSummary() {
  const s = calSynthesis();
  const notice = calNotice();
  if (!calendar.events.length) {
    const empty = !calLinked() ? "" : `<div class="center-empty">${calBusy ? "Lecture de l'agenda Google…" : "Aucun événement d'agenda chargé."}</div>`;
    return `${notice}${empty}${calFooter()}`;
  }
  const evRow = (e, sub) => `<div class="row" data-cal-open="${esc(e.id)}" style="border-left-color:var(--positive)">
    <span class="ic">🗓️</span>
    <div class="grow"><div class="r-title">${esc(e.title)}</div><div class="r-sub">${esc(sub || calWhen(e))}</div></div>
    <span class="muted">›</span></div>`;
  const people = s.contacts.length
    ? s.contacts.map((p) => `<div class="row" data-cal-open="${esc(p.next ? p.next.id : "")}" style="border-left-color:var(--primary)">
        <div class="grow"><div class="r-title">${esc(p.name)}</div>
          <div class="r-sub">${p.n} rendez-vous à venir${p.next ? ` · prochain le ${esc(fmtDate(p.next.date))}` : ""}</div></div>
        <span class="muted">›</span></div>`).join("")
    : `<div class="muted" style="padding:4px 2px;font-size:13px">Aucun participant dans les événements à venir.
        Google ne connaît des participants que si tu invites les gens par e-mail depuis ton agenda ;
        un rendez-vous noté pour toi seul n'en a aucun — écris alors le nom dans le titre.</div>`;
  const invit = s.noGuests.length
    ? s.noGuests.map((e) => evRow(e, calWhen(e) + " · aucun invité")).join("")
    : '<div class="muted" style="padding:4px 2px;font-size:13px">Tous les rendez-vous à venir ont au moins un invité. 👌</div>';
  const wait = s.waiting.length
    ? s.waiting.map((e) => {
        const n = e.guests.filter((g) => g.status === "needsAction").length;
        const d = e.guests.filter((g) => g.status === "declined").length;
        const bits = [n ? `${n} sans réponse` : null, d ? `${d} a décliné` : null].filter(Boolean).join(" · ");
        return evRow(e, calWhen(e) + " · " + bits);
      }).join("")
    : "";
  const prep = s.prep.length
    ? s.prep.map((x) => evRow(x.e, calWhen(x.e) + " · " + x.reasons.join(" · "))).join("")
    : '<div class="muted" style="padding:4px 2px;font-size:13px">Rien qui demande une préparation particulière.</div>';
  const stat = (n, lbl) => `<div class="cal-stat"><div class="cal-stat-n">${n}</div><div class="cal-stat-l">${lbl}</div></div>`;
  return `${notice}
    <div class="cal-stats">
      ${stat(s.up.length, "événements à venir")}
      ${stat(s.contacts.length, "interlocuteurs")}
      ${stat(s.noGuests.length, "invités à trouver")}
      ${stat(s.prep.length, "à préparer")}
    </div>
    <div class="muted" style="font-size:12px;margin:2px 0 10px">Synthèse des événements d'aujourd'hui jusqu'au ${esc(fmtDate(calHorizonISO()))}.</div>
    <div class="section-h">👥 Avec qui ? <span class="muted">(${s.contacts.length})</span></div>
    <div class="list">${people}</div>
    <div class="section-h">🙋 Invités à trouver <span class="muted">(${s.noGuests.length})</span></div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">Rendez-vous à venir sans aucun participant invité.</div>
    <div class="list">${invit}</div>
    ${s.waiting.length ? `<div class="section-h">⏳ Réponses en attente <span class="muted">(${s.waiting.length})</span></div><div class="list">${wait}</div>` : ""}
    <div class="section-h">📝 À préparer <span class="muted">(${s.prep.length})</span></div>
    <div class="muted" style="font-size:12px;margin-bottom:6px">Ce qu'il reste à faire avant chaque événement : billets, dossier, supports, joueurs manquants…</div>
    <div class="list">${prep}</div>
    ${calFooter()}`;
}

// ----------------------------- Rendez-vous -----------------------------
function rdvWhen(r) {
  if (!r.date) return "Date à définir";
  return fmtDate(r.date) + (r.time ? ` · ${r.time}` : "");
}
function renderRendezvous() {
  if (view.detailId && String(view.detailId).indexOf("gcal:") === 0) return renderCalEventDetail(String(view.detailId).slice(5));
  if (view.detailId) return renderRendezvousDetail(view.detailId);
  const today = todayISO();
  const sorted = [...state.rendezvous].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999") || (a.time || "").localeCompare(b.time || ""));
  const upcoming = sorted.filter((r) => (r.date || "9999") >= today);
  const past = sorted.filter((r) => (r.date || "0") < today).reverse();
  // Événements de l'agenda Google (lecture seule), à côté des rendez-vous saisis ici.
  const gAll = calSorted();
  const gUp = gAll.filter((e) => e.date >= today);
  const gPast = gAll.filter((e) => e.date < today).reverse();
  const gCard = (e) => {
    const who = calPeople(e).map((p) => p.name).join(", ") || e.organizer || "";
    const sub = [calWhen(e), who, e.location ? `📍 ${e.location}` : null].filter(Boolean).join(" · ");
    return `<div class="row" data-cal-open="${esc(e.id)}" style="border-left-color:var(--positive)">
      <span class="ic">🗓️</span>
      <div class="grow"><div class="r-title">${esc(e.title)}</div><div class="r-sub">${esc(sub)}</div></div>
      <span class="muted">›</span></div>`;
  };
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
    ${calNotice()}
    <div class="section-h">À venir <span class="muted">(${upcoming.length})</span></div>
    <div class="list">${upcoming.length ? upcoming.map(card).join("") : '<div class="muted" style="padding:4px 2px">Aucun rendez-vous à venir.</div>'}</div>
    ${calLinked() ? `<div class="section-h">🗓️ Agenda Google · à venir <span class="muted">(${gUp.length})</span></div>
    <div class="list">${gUp.length ? gUp.map(gCard).join("") : `<div class="muted" style="padding:4px 2px;font-size:13px">${calBusy ? "Lecture de l'agenda Google…" : "Aucun événement à venir dans l'agenda Google."}</div>`}</div>` : ""}
    ${past.length ? `<div class="section-h">Passés <span class="muted">(${past.length})</span></div><div class="list">${past.map(card).join("")}</div>` : ""}
    ${calLinked() && gPast.length ? `<div class="section-h">🗓️ Agenda Google · passés <span class="muted">(${gPast.length})</span></div><div class="list">${gPast.slice(0, 60).map(gCard).join("")}</div>` : ""}
    ${calFooter()}
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
      <label class="field"><span>Projet</span>${missionSelect(`rendezvous|${r.id}|missionId`, r.missionId)}</label>
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
  // Agenda Google : uniquement à partir d'aujourd'hui, pour ne pas gonfler « En retard ».
  const today = todayISO();
  calendar.events.forEach((e) => {
    if (!e.date || e.date < today) return;
    const who = calPeople(e).map((p) => p.name).join(", ");
    ev.push({
      date: e.date, time: e.time || "", kind: who ? `Agenda · ${who}` : "Agenda", ic: "🗓️",
      title: e.title, color: "var(--positive)", section: "rendezvous", detailId: "gcal:" + e.id
    });
  });
  return ev.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
}
let planningTab = "grille", planningDate = todayISO();
function renderPlanning() {
  const tabs = [["grille", "Emploi du temps"], ["agenda", "Agenda"], ["synthese", "Synthèse agenda"]]
    .map(([id, lbl]) => `<button class="chip ${planningTab === id ? "active" : ""}" data-ptab="${id}">${lbl}</button>`).join("");
  const body = planningTab === "grille" ? renderTimetable() : planningTab === "synthese" ? renderCalSummary() : renderAgenda();
  return `<div class="page-title">Planning</div><div class="chip-row" style="margin-bottom:14px">${tabs}</div>${body}`;
}
function renderAgenda() {
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
  return `<div class="toolbar"><span class="grow"></span>
      <button class="btn" data-add-rdv>+ Rendez-vous</button></div>
    <div class="muted" style="font-size:12px;margin-bottom:12px">Échéances des tâches et des actions ouvertes, rendez-vous et événements de l'agenda Google — par ordre chronologique.</div>
    ${calNotice()}
    ${empty}${overdueHtml}
    ${upcoming.length ? `<div class="section-h">À venir <span class="muted">(${upcoming.length})</span></div>${groupsHtml}` : ""}
    ${calFooter()}`;
}

// ----------------------------- Emploi du temps (grille + glisser-déposer) -----------------------------
const DAY_START = 390;      // 6h30 en minutes
const DAY_END = 1350;       // 22h30
const SNAP = 5;             // pas de 5 minutes
const DEFAULT_DUR = 45;     // durée par défaut d'un créneau
const MIN_DUR = 5;          // durée minimale
const PX_PER_MIN = 1.05;    // échelle verticale
const snap = (m) => Math.round(m / SNAP) * SNAP;
const clampStart = (m) => Math.max(DAY_START, Math.min(DAY_END - MIN_DUR, m));
function fmtMin(m) { const h = Math.floor(m / 60), mn = m % 60; return `${h}:${String(mn).padStart(2, "0")}`; }
function slotEnd(s) { return (s.start || DAY_START) + (s.duration || DEFAULT_DUR); }
function daySlots(date) { return state.slots.filter((s) => s.date === date).sort((a, b) => (a.start || 0) - (b.start || 0)); }
// Répartition en colonnes des créneaux qui se chevauchent.
function layoutSlots(slots) {
  const out = []; let cluster = [], clusterEnd = -1;
  const flush = () => {
    if (!cluster.length) return;
    const cols = [];
    cluster.forEach((s) => {
      let ci = cols.findIndex((col) => col.every((o) => slotEnd(o) <= s.start || o.start >= slotEnd(s)));
      if (ci === -1) { cols.push([s]); ci = cols.length - 1; } else cols[ci].push(s);
      s._col = ci;
    });
    cluster.forEach((s) => out.push({ s, col: s._col, cols: cols.length }));
    cluster = []; clusterEnd = -1;
  };
  slots.forEach((s) => {
    if (cluster.length && s.start >= clusterEnd) flush();
    cluster.push(s); clusterEnd = Math.max(clusterEnd, slotEnd(s));
  });
  flush();
  return out;
}
function slotTask(s) { return s && s.taskId ? state.tasks.find((t) => t.id === s.taskId) : null; }
function toggleSlotTask(slotId) {
  const s = state.slots.find((x) => x.id === slotId); const t = slotTask(s);
  if (!t) return;
  const done = (t.status || "aFaire") === "termine";
  t.status = done ? "enCours" : "termine";
  save(); render();
  toast(done ? "Tâche rouverte." : "Tâche marquée terminée ✓");
}
// Petit message de confirmation éphémère.
function toast(msg) {
  const old = document.getElementById("toast"); if (old) old.remove();
  const el = document.createElement("div");
  el.id = "toast"; el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { if (el.parentNode) el.remove(); }, 2600);
}
function unscheduledTasks() {
  const planned = new Set(state.slots.filter((s) => s.taskId).map((s) => s.taskId));
  return state.tasks.filter((t) => (t.status || "aFaire") !== "termine" && !planned.has(t.id))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}
// Pseudo-créneaux (non modifiables) construits à partir de l'agenda Google,
// pour que les événements se placent dans la grille sans recouvrir les créneaux.
function calDaySlots(date) {
  return calendar.events
    .filter((e) => e.date === date && !e.allDay && e.time)
    .map((e) => {
      const [h, mn] = e.time.split(":").map(Number);
      const start = clampStart(snap(h * 60 + mn));
      const duration = Math.max(MIN_DUR, Math.min(snap(e.mins || DEFAULT_DUR), DAY_END - start));
      return { id: "gcal:" + e.id, cal: e, start, duration, title: e.title };
    })
    .sort((a, b) => a.start - b.start);
}
const calAllDay = (date) => calendar.events.filter((e) => e.date === date && e.allDay);
function renderTimetable() {
  const date = planningDate, today = todayISO();
  const slots = daySlots(date);
  const gslots = calDaySlots(date);
  const laid = layoutSlots([...slots, ...gslots].sort((a, b) => (a.start || 0) - (b.start || 0)));
  const height = Math.round((DAY_END - DAY_START) * PX_PER_MIN);
  // lignes et libellés horaires
  let lines = "", labels = "";
  for (let m = DAY_START; m <= DAY_END; m += 30) {
    const y = Math.round((m - DAY_START) * PX_PER_MIN);
    const full = m % 60 === 0;
    lines += `<div class="tt-line ${full ? "full" : ""}" style="top:${y}px"></div>`;
    if (full) labels += `<div class="tt-label" style="top:${y}px">${fmtMin(m)}</div>`;
  }
  // créneaux
  const blocks = laid.map(({ s, col, cols }) => {
    const top = Math.round(((s.start || DAY_START) - DAY_START) * PX_PER_MIN);
    const h = Math.max(Math.round((s.duration || DEFAULT_DUR) * PX_PER_MIN), 12);
    const w = 100 / cols, left = col * w;
    if (s.cal) {
      const e = s.cal;
      const who = calPeople(e).map((p) => p.name).join(", ") || e.organizer || "";
      return `<div class="tt-slot tt-cal" data-cal-slot="${esc(e.id)}" style="top:${top}px;height:${h}px;left:calc(${left}% + 2px);width:calc(${w}% - 4px)">
        <div class="tt-slot-t">🗓️ ${esc(e.title)}</div>
        <div class="tt-slot-h">${esc(e.time)}${e.endTime ? "–" + esc(e.endTime) : ""}${who ? " · " + esc(who) : ""}</div></div>`;
    }
    const t = slotTask(s), done = !!t && (t.status || "aFaire") === "termine";
    const color = done ? "var(--positive)" : (s.taskId ? "var(--primary)" : "var(--activity)");
    const tick = t ? `<button class="tt-done" data-slot-done="${s.id}" title="${done ? "Rouvrir la tâche" : "Marquer la tâche terminée"}">${done ? "✓" : "○"}</button>` : "";
    return `<div class="tt-slot${done ? " done" : ""}" data-slot="${s.id}" style="top:${top}px;height:${h}px;left:calc(${left}% + 2px);width:calc(${w}% - 4px);border-left-color:${color}">
      ${tick}<div class="tt-slot-t">${esc(s.title || "Créneau")}</div>
      <div class="tt-slot-h">${fmtMin(s.start)} – ${fmtMin(slotEnd(s))} · ${s.duration} min${done ? " · terminée" : ""}</div>
      <div class="tt-resize" data-resize="${s.id}"></div></div>`;
  }).join("");
  // trait de l'heure courante
  let nowLine = "";
  if (date === today) {
    const n = new Date(); const cur = n.getHours() * 60 + n.getMinutes();
    if (cur >= DAY_START && cur <= DAY_END) nowLine = `<div class="tt-now" style="top:${Math.round((cur - DAY_START) * PX_PER_MIN)}px"></div>`;
  }
  // tâches à planifier
  const chips = unscheduledTasks().map((t) => {
    const c = t.dueDate ? deadlineColor(daysUntil(t.dueDate)) : "var(--line)";
    return `<div class="tt-chip" data-drag-task="${t.id}" style="border-left-color:${c}">${esc(t.title || "Tâche")}${t.dueDate ? `<span class="muted"> · ${fmtDate(t.dueDate)}</span>` : ""}</div>`;
  }).join("");
  const total = slots.reduce((t, s) => t + (s.duration || 0), 0);
  const d = new Date(date + "T12:00:00");
  const dLabel = d.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
  const allDay = calAllDay(date);
  const allDayHtml = allDay.length
    ? `<div class="tt-allday">${allDay.map((e) => `<div class="tt-allday-i" data-cal-slot="${esc(e.id)}">🗓️ ${esc(e.title)}</div>`).join("")}</div>`
    : "";
  const gCount = gslots.length + allDay.length;
  return `<div class="toolbar">
      <button class="btn ghost small" data-day="-1">‹</button>
      <div class="grow" style="text-align:center"><strong style="text-transform:capitalize">${esc(dLabel)}</strong>
        <div class="muted" style="font-size:11px">${slots.length} créneau(x) · ${fmtDuration(total * 60)}${gCount ? ` · ${gCount} événement(s) d'agenda` : ""}</div></div>
      <button class="btn ghost small" data-day="1">›</button>
      <button class="btn secondary small" data-day-today>Aujourd'hui</button>
      <button class="btn small" data-add-slot>+ Créneau</button></div>
    <div class="tt-help muted">Glisse une tâche dans la grille pour la planifier · clique un créneau vide pour en créer un (45 min) · glisse un créneau pour le déplacer, sa base pour le redimensionner (pas de 5 min). Les blocs 🗓️ viennent de ton agenda Google (lecture seule).</div>
    ${calNotice(true)}${allDayHtml}
    <div class="tt-layout">
      <div class="tt-side">
        <div class="section-h" style="margin-top:0">À planifier <span class="muted">(${unscheduledTasks().length})</span></div>
        <div class="tt-chips">${chips || '<div class="muted" style="font-size:12px">Aucune tâche en attente.</div>'}</div>
      </div>
      <div class="tt-wrap">
        <div class="tt-gutter" style="height:${height}px">${labels}</div>
        <div class="tt-grid" id="ttGrid" style="height:${height}px">${lines}${nowLine}${blocks}</div>
      </div>
    </div>`;
}
function slotEditor(id) {
  const s = state.slots.find((x) => x.id === id); if (!s) return;
  const task = s.taskId ? state.tasks.find((t) => t.id === s.taskId) : null;
  const misOpts = ['<option value="">Aucun projet</option>'].concat(sortedMissions().map((m) => `<option value="${m.id}" ${m.id === s.missionId ? "selected" : ""}>${esc(m.title || "Sans titre")}</option>`)).join("");
  showModal(`<div class="modal-head"><strong class="grow">Créneau</strong><button class="btn ghost small" data-modal-close>✕</button></div>
    <label class="field"><span>Intitulé</span><input id="slTitle" value="${esc(s.title)}"/></label>
    <label class="field"><span>Date</span><input type="date" id="slDate" value="${esc(s.date)}"/></label>
    <div class="inline">
      <label class="field grow"><span>Début</span><input type="time" id="slStart" step="300" value="${String(Math.floor(s.start / 60)).padStart(2, "0")}:${String(s.start % 60).padStart(2, "0")}"/></label>
      <label class="field grow"><span>Durée (min)</span><input type="number" id="slDur" min="${MIN_DUR}" step="${SNAP}" value="${s.duration}"/></label>
    </div>
    <label class="field"><span>Projet</span><select id="slMission">${misOpts}</select></label>
    <label class="field"><span>Notes</span><textarea id="slNotes">${esc(s.notes)}</textarea></label>
    ${task ? `<div class="muted" style="font-size:12px">Lié à la tâche « ${esc(task.title || "")} » · statut : <strong>${esc(taskStatusLabel(task.status))}</strong>.</div>` : ""}
    <div class="inline" style="margin-top:12px">
      <button class="btn" id="slSave">Enregistrer</button>
      ${task ? `<button class="btn secondary small" id="slDone">${(task.status || "aFaire") === "termine" ? "↺ Rouvrir la tâche" : "✓ Marquer la tâche terminée"}</button>` : ""}
      <span class="grow"></span>
      <button class="btn danger small" id="slDel">Supprimer</button></div>`);
  document.querySelector("[data-modal-close]").onclick = closeModal;
  document.getElementById("slSave").onclick = () => {
    s.title = document.getElementById("slTitle").value;
    s.date = document.getElementById("slDate").value || s.date;
    const tv = document.getElementById("slStart").value;
    if (tv) { const [h, mn] = tv.split(":").map(Number); s.start = clampStart(snap(h * 60 + mn)); }
    s.duration = Math.max(MIN_DUR, snap(parseInt(document.getElementById("slDur").value, 10) || DEFAULT_DUR));
    if (s.start + s.duration > DAY_END) s.duration = DAY_END - s.start;
    s.missionId = document.getElementById("slMission").value || null;
    s.notes = document.getElementById("slNotes").value;
    save(); closeModal(); render();
  };
  const done = document.getElementById("slDone");
  if (done) done.onclick = () => { closeModal(); toggleSlotTask(id); };
  document.getElementById("slDel").onclick = () => { state.slots = state.slots.filter((x) => x.id !== id); save(); closeModal(); render(); };
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
  c.querySelectorAll("[data-add-mission]").forEach((b) => b.onclick = () => { const m = { id: uid(), title: "", statusCode: "aDemarrer", companyId: null, startDate: todayISO(), createdAt: Date.now(), entries: [] }; state.missions.push(m); save(); openDetail("missions", m.id); });
  c.querySelectorAll("[data-add-contact]").forEach((b) => b.onclick = () => { const x = { id: uid(), firstName: "", lastName: "", organization: "", jobTitle: "", email: "", phone: "", address: "", linkedIn: "", category: "client", notes: "", companyId: null }; state.contacts.push(x); save(); openDetail("contacts", x.id); });
  c.querySelectorAll("[data-add-company]").forEach((b) => b.onclick = () => { const x = { id: uid(), name: "", legalForm: "", role: "filiale", notes: "", initialCashBalance: 0, cashBalanceDate: todayISO(), activities: [] }; state.companies.push(x); save(); openDetail("groupe", x.id); });
  c.querySelectorAll("[data-add-invoice]").forEach((b) => b.onclick = () => { const x = { id: uid(), title: "", reference: "", direction: "recette", status: "aEmettre", amount: 0, vatRate: 20, startDate: todayISO(), hasDueDate: false, dueDate: "", paymentDate: "", companyId: null, contactId: null, categoryName: "", payMode: "compte", accountId: null, associateId: null, receiptUrl: "", noReceipt: false }; state.invoices.push(x); save(); openDetail("finances", x.id); });

  // suppressions
  c.querySelectorAll("[data-del-mission]").forEach((b) => b.onclick = () => { if (confirm("Supprimer ce projet ? Ses tâches sont conservées, sans projet.")) { state.tasks.forEach((t) => { if (t.missionId === b.dataset.delMission) t.missionId = null; }); state.missions = state.missions.filter((m) => m.id !== b.dataset.delMission); save(); go("missions"); } });
  c.querySelectorAll("[data-del-contact]").forEach((b) => b.onclick = () => { if (confirm("Supprimer ce contact ?")) { state.contacts = state.contacts.filter((x) => x.id !== b.dataset.delContact); save(); go("contacts"); } });
  c.querySelectorAll("[data-del-company]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette société ?")) { state.companies = state.companies.filter((x) => x.id !== b.dataset.delCompany); save(); go("groupe"); } });
  c.querySelectorAll("[data-del-invoice]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette facture ?")) { state.invoices = state.invoices.filter((x) => x.id !== b.dataset.delInvoice); save(); view.detailId = null; go("finances"); } });

  // activités (société)
  c.querySelectorAll("[data-add-act]").forEach((b) => b.onclick = () => { const co = state.companies.find((x) => x.id === b.dataset.addAct); if (!co) return; (co.activities = co.activities || []).push({ id: uid(), name: "", detail: "" }); save(); render(); });
  c.querySelectorAll("[data-del-act]").forEach((b) => b.onclick = () => { const co = state.companies.find((x) => x.id === b.dataset.c); if (!co) return; co.activities = (co.activities || []).filter((a) => a.id !== b.dataset.delAct); save(); render(); });
  c.querySelectorAll("[data-actfield]").forEach((el) => { const h = () => { const co = state.companies.find((x) => x.id === el.dataset.c); const a = (co.activities || []).find((z) => z.id === el.dataset.a); if (a) { a[el.dataset.actfield] = el.value; save(); } }; el.addEventListener("change", h); el.addEventListener("blur", h); });

  // onglets Finances
  c.querySelectorAll("[data-ftab]").forEach((b) => b.onclick = () => { financeTab = b.dataset.ftab; render(); });

  // comptes bancaires (fiche société)
  c.querySelectorAll("[data-add-acc]").forEach((b) => b.onclick = () => { state.accounts.push({ id: uid(), companyId: b.dataset.addAcc, name: "", initialBalance: 0, balanceDate: todayISO() }); save(); render(); });
  c.querySelectorAll("[data-del-acc]").forEach((b) => b.onclick = () => {
    const id = b.dataset.delAcc, used = state.invoices.filter((v) => v.accountId === id).length;
    if (!confirm(`Supprimer ce compte ?${used ? `\n${used} facture(s) y sont rattachées : elles repasseront « compte non précisé ».` : ""}`)) return;
    if (used) state.invoices.forEach((v) => { if (v.accountId === id) v.accountId = null; });
    state.accounts = state.accounts.filter((a) => a.id !== id); save(); render();
  });
  c.querySelectorAll("[data-accfield]").forEach((el) => { const h = () => { const a = state.accounts.find((x) => x.id === el.dataset.acc); if (!a) return; a[el.dataset.accfield] = el.type === "number" ? (parseFloat(el.value) || 0) : el.value; save(); if (el.type === "number") render(); }; el.addEventListener("change", h); el.addEventListener("blur", h); });

  // règlement d'une facture
  c.querySelectorAll("[data-pay-mode]").forEach((sel) => sel.onchange = () => { const v = state.invoices.find((x) => x.id === sel.dataset.payMode); if (!v) return; v.payMode = sel.value; if (v.payMode === "associe") v.accountId = null; else v.associateId = null; save(); render(); });
  c.querySelectorAll("[data-pay-account]").forEach((sel) => sel.onchange = () => { const v = state.invoices.find((x) => x.id === sel.dataset.payAccount); if (v) { v.accountId = sel.value || null; save(); render(); } });
  c.querySelectorAll("[data-pay-assoc]").forEach((sel) => sel.onchange = () => { const v = state.invoices.find((x) => x.id === sel.dataset.payAssoc); if (v) { v.associateId = sel.value || null; save(); render(); } });

  // compte courant d'associé
  c.querySelectorAll("[data-add-cca]").forEach((b) => b.onclick = () => ccaEditor(null, b.dataset.addCca));

  // salaires
  const salMonth = c.querySelector("#salMonth"); if (salMonth) salMonth.onchange = () => { salaryMonth = salMonth.value; render(); };
  const shiftMonth = (delta) => { const cur = salaryMonth || (state.salaries.map((s) => s.month).sort().reverse()[0]) || new Date().toISOString().slice(0, 7); const d = new Date(cur + "-01T12:00:00"); d.setMonth(d.getMonth() + delta); salaryMonth = d.toISOString().slice(0, 7); render(); };
  const sp = c.querySelector("[data-sal-month-prev]"); if (sp) sp.onclick = () => shiftMonth(-1);
  const sn = c.querySelector("[data-sal-month-next]"); if (sn) sn.onclick = () => shiftMonth(1);
  const addSal = c.querySelector("[data-add-sal]"); if (addSal) addSal.onclick = () => salaryEditor(null);
  c.querySelectorAll("[data-edit-sal]").forEach((b) => b.onclick = () => salaryEditor(b.dataset.editSal));
  const genSal = c.querySelector("[data-sal-generate]");
  if (genSal) genSal.onclick = () => {
    const month = salaryMonth || (state.salaries.map((s) => s.month).sort().reverse()[0]);
    let n = 0; state.salaries.filter((s) => s.month === month).forEach((s) => { if (salaryGenerate(s)) n++; });
    save(); render(); toast(n ? `${n} écriture(s) générée(s).` : "Rien à générer.");
  };

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
  // Temps : bascule semaine/mois et navigation dans les périodes
  c.querySelectorAll("[data-ttab]").forEach((b) => b.onclick = () => { timeTab = b.dataset.ttab; render(); });
  const tNav = c.querySelectorAll("[data-time-nav]");
  tNav.forEach((b) => b.onclick = () => {
    const step = Number(b.dataset.timeNav);
    const d = new Date(timeRef + "T12:00:00");
    if (timeTab === "mois") d.setMonth(d.getMonth() + step); else d.setDate(d.getDate() + 7 * step);
    timeRef = iso(d); render();
  });
  const tNow = c.querySelector("[data-time-now]"); if (tNow) tNow.onclick = () => { timeRef = todayISO(); render(); };
  const lvS = c.querySelector("[data-leave-settings]"); if (lvS) lvS.onclick = leaveSettings;
  const lvA = c.querySelector("[data-leave-adjust]"); if (lvA) lvA.onclick = leaveAdjust;
  onclick("[data-export-factures]", exportFacturesCSV);

  // outils PDF
  c.querySelectorAll("[data-pdftab]").forEach((b) => b.onclick = () => { pdfTool = b.dataset.pdftab; pdfLog = ""; render(); });
  const pdfAdd = c.querySelector("[data-pdf-add]");
  if (pdfAdd) pdfAdd.onclick = () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".pdf,application/pdf"; inp.multiple = (pdfTool === "fusion");
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      if (!files.length) return;
      if (pdfTool !== "fusion") pdfFiles = [];
      for (const f of files) {
        const buf = new Uint8Array(await f.arrayBuffer());
        pdfFiles.push({ name: f.name, size: buf.length, bytes: buf });
      }
      pdfLog = ""; render();
    };
    inp.click();
  };
  c.querySelectorAll("[data-pdf-del]").forEach((b) => b.onclick = () => { pdfFiles.splice(Number(b.dataset.pdfDel), 1); render(); });
  c.querySelectorAll("[data-pdf-move]").forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.i), j = i + Number(b.dataset.pdfMove);
    if (j < 0 || j >= pdfFiles.length) return;
    const [x] = pdfFiles.splice(i, 1); pdfFiles.splice(j, 0, x); render();
  });
  const pdfClear = c.querySelector("[data-pdf-clear]"); if (pdfClear) pdfClear.onclick = () => { pdfFiles = []; pdfLog = ""; render(); };
  const pdfRun = c.querySelector("[data-pdf-run]");
  if (pdfRun) pdfRun.onclick = () => {
    if (pdfTool === "fusion") pdfMerge(); else pdfToMarkdown();
  };

  // bascule Markdown / PDF du lecteur
  c.querySelectorAll("[data-rkind]").forEach((b) => b.onclick = () => { reader.kind = b.dataset.rkind; saveReader(); render(); });

  // lecteur PDF
  if (view.section === "reader" && reader.kind === "pdf") {
    if (!pdfBusyR && !pdfLib.docs.length && window.DriveSync && DriveSync.isConnected()) refreshPdfs();
    const curP = currentPdf();
    if (curP && (!pdfOpen || pdfOpen.id !== curP.id) && !pdfBusyR && !pdfError) openPdf(curP.id);
    if (pdfOpen) paintPdfPages();
  }
  const pdfrRef = c.querySelector("[data-pdfr-refresh]"); if (pdfrRef) pdfrRef.onclick = () => refreshPdfs();
  const pdfrImp = c.querySelector("[data-pdfr-import]");
  if (pdfrImp) pdfrImp.onclick = () => {
    if (!(window.DriveSync && DriveSync.isConnected())) { alert("Connecte-toi d'abord à Google Drive : les PDF y sont enregistrés pour être disponibles sur tous tes appareils."); return; }
    const inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true; inp.accept = ".pdf,application/pdf";
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      if (!files.length) return;
      pdfBusyR = true; render();
      let added = 0, failed = 0;
      for (const f of files) {
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const id = await DriveSync.uploadPdf(f.name, bytes);
          pdfLib.docs.push({ id, name: f.name, size: bytes.length });
          pdfOrder().push(id);
          if (!state.pdfCurrent) state.pdfCurrent = id;
          added++;
        } catch (e) { failed++; }
      }
      save(); pdfBusyR = false; render();
      toast(added + " PDF ajouté(s) sur le Drive" + (failed ? ` · ${failed} en échec` : ""));
    };
    inp.click();
  };
  c.querySelectorAll("[data-pdfr-open]").forEach((el) => el.onclick = (ev) => {
    if (ev.target.closest("button")) return;
    state.pdfCurrent = el.dataset.pdfrOpen; pdfError = ""; save(); render();
  });
  c.querySelectorAll("[data-pdfr-del]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.pdfrDel;
    const d = pdfLib.docs.find((x) => x.id === id);
    if (!confirm(`Retirer « ${d ? d.name : "ce PDF"} » ? Le fichier sera supprimé de ton Drive.`)) return;
    try { await DriveSync.deleteDoc(id); } catch (e) {}
    pdfLib.docs = pdfLib.docs.filter((x) => x.id !== id);
    state.pdfOrder = pdfOrder().filter((x) => x !== id);
    if (state.pdfCurrent === id) { state.pdfCurrent = pdfLib.docs.length ? orderedPdfs()[0].id : null; pdfOpen = null; pdfPainted = ""; }
    save(); render();
  });
  c.querySelectorAll("[data-pdfr-move]").forEach((b) => b.onclick = () => {
    const ids = orderedPdfs().map((d) => d.id);
    const i = ids.indexOf(b.dataset.d), j = i + Number(b.dataset.pdfrMove);
    if (i < 0 || j < 0 || j >= ids.length) return;
    const [x] = ids.splice(i, 1); ids.splice(j, 0, x);
    state.pdfOrder = ids; save(); render();
  });
  const pdfStep = (dir) => {
    const ids = orderedPdfs().map((d) => d.id);
    const j = ids.indexOf(state.pdfCurrent) + dir;
    if (j < 0 || j >= ids.length) return;
    state.pdfCurrent = ids[j]; pdfError = ""; save(); render();
    const el = document.getElementById("content"); if (el) el.scrollTop = 0;
  };
  const pdfrPrev = c.querySelector("[data-pdfr-prev]"); if (pdfrPrev) pdfrPrev.onclick = () => pdfStep(-1);
  const pdfrNext = c.querySelector("[data-pdfr-next]"); if (pdfrNext) pdfrNext.onclick = () => pdfStep(1);
  const pdfZoomSel = c.querySelector("#pdfZoom");
  if (pdfZoomSel) pdfZoomSel.onchange = () => { reader.pdfZoom = parseFloat(pdfZoomSel.value) || 1; saveReader(); pdfPainted = ""; render(); };
  const pdfPageNo = c.querySelector("#pdfPageNo");
  if (pdfPageNo) {
    pdfPageNo.onchange = () => goToPdfPage(pdfPageNo.value);
    pdfPageNo.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); goToPdfPage(pdfPageNo.value); } };
  }
  c.querySelectorAll("[data-pdf-page]").forEach((b) => b.onclick = () => goToPdfPage(pdfPageNow + Number(b.dataset.pdfPage)));
  // suivi de la page visible pendant le défilement
  const contentEl = document.getElementById("content");
  if (contentEl) contentEl.onscroll = (view.section === "reader" && reader.kind === "pdf" && pdfOpen) ? syncPdfPageNumber : null;

  const pdfrRetry = c.querySelector("[data-pdfr-retry]");
  if (pdfrRetry) pdfrRetry.onclick = () => { pdfError = ""; pdfOpen = null; pdfPainted = ""; const d = currentPdf(); if (d) openPdf(d.id); };
  const pdfrDl = c.querySelector("[data-pdfr-download]");
  if (pdfrDl) pdfrDl.onclick = () => { const d = currentPdf(); if (pdfOpen && d) downloadBytes(d.name, pdfOpen.bytes); };

  // lecteur Markdown — les documents sont des fichiers sur le Drive
  if (view.section === "reader" && !readerBusy && !readerLib.docs.length && window.DriveSync && DriveSync.isConnected()) refreshDocs();
  const mdRef = c.querySelector("[data-md-refresh]"); if (mdRef) mdRef.onclick = () => refreshDocs(true);
  const mdPrint = c.querySelector("[data-md-print]"); if (mdPrint) mdPrint.onclick = printCurrentDoc;
  const mdImp = c.querySelector("[data-md-import]");
  if (mdImp) mdImp.onclick = () => {
    if (!(window.DriveSync && DriveSync.isConnected())) { alert("Connecte-toi d'abord à Google Drive : les documents y sont enregistrés pour être disponibles sur tous tes appareils."); return; }
    const inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true;
    inp.accept = ".md,.markdown,.txt,text/markdown,text/plain";
    inp.onchange = async () => {
      const files = Array.from(inp.files || []);
      if (!files.length) return;
      readerBusy = true; render();
      let added = 0, failed = 0;
      for (const f of files) {
        try {
          const text = await f.text();
          const id = await DriveSync.uploadDoc(f.name, text);
          readerLib.docs.push({ id, name: f.name, size: text.length });
          readerLib.texts[id] = text;
          readerOrder().push(id);
          if (!state.readerCurrent) state.readerCurrent = id;
          added++;
        } catch (e) { failed++; }
      }
      saveCache(); save();
      readerBusy = false; render();
      toast(added + " document(s) ajouté(s) sur le Drive" + (failed ? ` · ${failed} en échec` : ""));
    };
    inp.click();
  };
  c.querySelectorAll("[data-md-open]").forEach((el) => el.onclick = async (ev) => {
    if (ev.target.closest("button")) return;
    state.readerCurrent = el.dataset.mdOpen; save(); render();
    await ensureDocText(state.readerCurrent);
  });
  c.querySelectorAll("[data-md-del]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.mdDel;
    const d = readerLib.docs.find((x) => x.id === id);
    if (!confirm(`Retirer « ${d ? d.name : "ce document"} » ? Le fichier sera supprimé de ton Drive.`)) return;
    try { await DriveSync.deleteDoc(id); } catch (e) {}
    readerLib.docs = readerLib.docs.filter((x) => x.id !== id);
    delete readerLib.texts[id];
    state.readerOrder = readerOrder().filter((x) => x !== id);
    if (state.readerCurrent === id) state.readerCurrent = readerLib.docs.length ? orderedDocs()[0].id : null;
    saveCache(); save(); render();
  });
  c.querySelectorAll("[data-md-move]").forEach((b) => b.onclick = () => {
    const ids = orderedDocs().map((d) => d.id);
    const i = ids.indexOf(b.dataset.d), j = i + Number(b.dataset.mdMove);
    if (i < 0 || j < 0 || j >= ids.length) return;
    const [x] = ids.splice(i, 1); ids.splice(j, 0, x);
    state.readerOrder = ids; save(); render();
  });
  const mdClear = c.querySelector("[data-md-clear]");
  if (mdClear) mdClear.onclick = async () => {
    if (!confirm("Retirer tous les documents ? Les fichiers seront supprimés de ton Drive.")) return;
    readerBusy = true; render();
    for (const d of [...readerLib.docs]) { try { await DriveSync.deleteDoc(d.id); } catch (e) {} }
    readerLib = { docs: [], texts: {} }; state.readerOrder = []; state.readerCurrent = null;
    saveCache(); save(); readerBusy = false; render();
  };
  const step = async (dir) => {
    const ids = orderedDocs().map((d) => d.id);
    const j = ids.indexOf(state.readerCurrent) + dir;
    if (j < 0 || j >= ids.length) return;
    state.readerCurrent = ids[j]; save(); render();
    const el = document.getElementById("content"); if (el) el.scrollTop = 0;
    await ensureDocText(state.readerCurrent);
  };
  const mdPrev = c.querySelector("[data-md-prev]"); if (mdPrev) mdPrev.onclick = () => step(-1);
  const mdNext = c.querySelector("[data-md-next]"); if (mdNext) mdNext.onclick = () => step(1);
  const mdFont = c.querySelector("#mdFont"); if (mdFont) mdFont.onchange = () => { reader.font = mdFont.value; saveReader(); render(); };
  const mdSize = c.querySelector("#mdSize"); if (mdSize) mdSize.onchange = () => { reader.size = Math.max(12, Math.min(28, parseInt(mdSize.value, 10) || 17)); saveReader(); render(); };
  c.querySelectorAll("[data-md-bg]").forEach((b) => b.onclick = () => { reader.bg = b.dataset.mdBg; reader.customBg = ""; saveReader(); render(); });
  const mdCustom = c.querySelector("#mdCustom"); if (mdCustom) mdCustom.onchange = () => { reader.customBg = mdCustom.value; saveReader(); render(); };

  // relances (mails) — et correspondance des projets
  c.querySelectorAll("[data-mail-refresh]").forEach((b) => b.onclick = loadMails);
  if (mailVisible() && !mailLoading && Date.now() - mailLoadedAt > (mailData ? MAIL_FRESH : MAIL_RETRY) && window.DriveSync && DriveSync.isConnected()) loadMails();
  const addMb = c.querySelector("[data-add-mailbox]");
  if (addMb) addMb.onclick = () => addMailbox((document.getElementById("mbLabel") || {}).value, (document.getElementById("mbEmail") || {}).value);
  c.querySelectorAll("[data-del-mailbox]").forEach((b) => b.onclick = () => {
    if (!confirm("Retirer cette boîte ? Le fichier d'analyse reste sur ton Drive.")) return;
    state.mailboxes = (state.mailboxes || []).filter((x) => x.id !== b.dataset.delMailbox); delete mailStore[b.dataset.delMailbox]; save(); render();
  });
  c.querySelectorAll("[data-mailbox-help]").forEach((b) => b.onclick = () => { const mb = (state.mailboxes || []).find((x) => x.id === b.dataset.mailboxHelp); if (mb) mailboxHelp(mb); });

  // ---- Projet : onglets, chronos, gestion, correspondance --------------------
  // Attribut distinct de celui des onglets de Planning : les deux gestionnaires
  // écrivaient sinon sur le même onclick, et le dernier l'emportait.
  c.querySelectorAll("[data-projtab]").forEach((b) => b.onclick = () => { projectTab = b.dataset.projtab; render(); });
  c.querySelectorAll("[data-goto-gestion]").forEach((r) => r.onclick = () => { projectTab = "gestion"; render(); });
  c.querySelectorAll("[data-project-timer]").forEach((b) => b.onclick = () => { const m = findMission(b.dataset.projectTimer); if (!m) return; startProjectTimer(m, null); save(); render(); toast("Chrono lancé sur le projet ▶"); });
  c.querySelectorAll("[data-task-timer]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); if (!m) return;
    const run = (m.entries || []).find((e) => e.taskId === b.dataset.taskTimer && e.timerStartedAt);
    if (run) { stopEntry(run); toast("Chrono arrêté ■"); } else { startProjectTimer(m, b.dataset.taskTimer); toast("Chrono lancé sur la tâche ▶"); }
    save(); render();
  });
  c.querySelectorAll("[data-stop-entry]").forEach((b) => b.onclick = () => { const m = findMission(b.dataset.m); const e = findEntry(m, b.dataset.stopEntry); if (e) { stopEntry(e); save(); render(); } });
  c.querySelectorAll("[data-add-ptask]").forEach((b) => b.onclick = () => {
    state.tasks.push({ id: uid(), title: "", status: "aFaire", missionId: b.dataset.addPtask, section: b.dataset.section || "", assignee: "", progress: 0, origin: "manuel", dueDate: "", createdAt: Date.now() });
    save(); render();
  });
  c.querySelectorAll("[data-import-tasks]").forEach((b) => b.onclick = () => importTasksClick(b.dataset.importTasks));
  c.querySelectorAll("[data-add-section]").forEach((b) => b.onclick = () => {
    const name = (prompt("Nom de la section") || "").trim(); if (!name) return;
    const m = findMission(b.dataset.addSection); if (!m) return;
    m.sections = m.sections || []; if (m.sections.indexOf(name) === -1) m.sections.push(name);
    save(); render();
  });
  c.querySelectorAll("[data-section-name]").forEach((el) => el.onchange = () => {
    const m = findMission(el.dataset.m); if (!m) return;
    const from = el.dataset.sectionName, to = el.value.trim(); if (!to || to === from) { render(); return; }
    m.sections = (m.sections || []).map((x) => (x === from ? to : x));
    if (m.sections.indexOf(to) === -1) m.sections.push(to);
    projectTasks(m).forEach((t) => { if ((t.section || "") === from) t.section = to; });
    save(); render();
  });
  c.querySelectorAll("[data-del-section]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); if (!m) return;
    const name = b.dataset.delSection;
    m.sections = (m.sections || []).filter((x) => x !== name);
    projectTasks(m).forEach((t) => { if ((t.section || "") === name) t.section = ""; });
    save(); render();
  });
  c.querySelectorAll("[data-taskprog]").forEach((el) => el.onchange = () => { const t = state.tasks.find((x) => x.id === el.dataset.taskprog); if (t) { setTaskProgress(t, el.value); save(); render(); } });
  c.querySelectorAll("[data-task-mission]").forEach((el) => el.onchange = () => { const t = state.tasks.find((x) => x.id === el.dataset.taskMission); if (t) { t.missionId = el.value || null; save(); render(); } });
  c.querySelectorAll("[data-mail-task]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); const th = mailThreads().find((x) => x.id === b.dataset.mailTask); if (!m || !th) return;
    state.tasks.push({ id: uid(), title: th.subject || "Mail", status: "aFaire", missionId: m.id, section: "", assignee: "", progress: 0, origin: "mail", mailLink: th.link || "", mailThreadId: th.id, mailSubject: th.subject || "", dueDate: "", createdAt: Date.now() });
    save(); projectTab = "gestion"; render(); toast("Tâche créée à partir du mail ✓");
  });
  c.querySelectorAll("[data-mail-entry]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); const th = mailThreads().find((x) => x.id === b.dataset.mailEntry); if (!m || !th) return;
    m.entries = m.entries || [];
    m.entries.push({ id: uid(), kind: "email", title: th.subject || "Mail", content: th.snippet || "", date: (th.date || "").slice(0, 10) || todayISO(), url: th.link || "", accumulatedSeconds: 0, timerStartedAt: null, createdAt: Date.now() });
    save(); render(); toast("Mail ajouté à l'historique ✓");
  });
  c.querySelectorAll("[data-mail-assign]").forEach((el) => el.onchange = () => {
    const v = el.value; if (!v) return;
    const id = el.dataset.mailAssign;
    if (v === "none") { setMailLink(id, ""); toast("Fil écarté de tous les projets"); }
    else { setMailLink(id, v); const target = findMission(v); toast(v === el.dataset.m ? "Fil classé dans ce projet ✓" : `Fil classé dans « ${target ? target.title : "?"} »`); }
    save(); render();
  });
  c.querySelectorAll("[data-mail-addemail]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); if (!m) return;
    const cur = String(m.mailEmails || "").trim();
    m.mailEmails = cur ? cur.replace(/[,\s]+$/, "") + ", " + b.dataset.mailAddemail : b.dataset.mailAddemail;
    save(); render();
  });
  c.querySelectorAll("[data-mail-exclude]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); if (!m) return;
    m.mailExclude = m.mailExclude || []; if (m.mailExclude.indexOf(b.dataset.mailExclude) === -1) m.mailExclude.push(b.dataset.mailExclude);
    save(); render();
  });

  // recherche globale
  const gs = c.querySelector("#globalSearch");
  if (gs) { gs.oninput = () => { searchQ = gs.value; render(); }; if (searchQ) { gs.focus(); const v = gs.value; try { gs.setSelectionRange(v.length, v.length); } catch (e) {} } }
  c.querySelectorAll("[data-search-open]").forEach((r) => r.onclick = () => { const sec = r.dataset.searchOpen, id = r.dataset.searchId; if (id) openDetail(sec, id); else go(sec); });

  // filtres factures
  const fs = c.querySelector("#factureSearch");
  if (fs) { fs.oninput = () => { factureFilter.q = fs.value; render(); }; if (factureFilter.q) { fs.focus(); const v = fs.value; try { fs.setSelectionRange(v.length, v.length); } catch (e) {} } }
  const fCo = c.querySelector("#factureCompany"); if (fCo) fCo.onchange = () => { factureFilter.companyId = fCo.value; render(); };
  const fSt = c.querySelector("#factureStatus"); if (fSt) fSt.onchange = () => { factureFilter.status = fSt.value; render(); };
  const fFr = c.querySelector("#factureFrom"); if (fFr) fFr.onchange = () => { factureFilter.from = fFr.value; render(); };
  const fTo = c.querySelector("#factureTo"); if (fTo) fTo.onchange = () => { factureFilter.to = fTo.value; render(); };
  const fNr = c.querySelector("[data-facture-noreceipt]"); if (fNr) fNr.onclick = () => { factureFilter.noReceipt = !factureFilter.noReceipt; render(); };
  const fRe = c.querySelector("[data-facture-reset]"); if (fRe) fRe.onclick = () => { factureFilter = { q: "", companyId: "", status: "", from: "", to: "", noReceipt: false }; render(); };
  c.querySelectorAll("[data-no-receipt]").forEach((cb) => cb.onchange = () => { const v = state.invoices.find((x) => x.id === cb.dataset.noReceipt); if (v) { v.noReceipt = cb.checked; save(); render(); } });

  // récurrences
  c.querySelectorAll("[data-add-rec]").forEach((b) => b.onclick = () => { state.recurrences.push({ id: uid(), kind: b.dataset.addRec, active: true, title: "", frequency: "mensuelle", anchorDate: todayISO(), lastGenerated: null, direction: "depense", amount: 0, vatRate: 20, categoryName: "", companyId: null, missionId: null }); save(); render(); });
  c.querySelectorAll("[data-del-rec]").forEach((b) => b.onclick = () => { if (confirm("Supprimer cette récurrence ? Les éléments déjà générés sont conservés.")) { state.recurrences = state.recurrences.filter((x) => x.id !== b.dataset.delRec); save(); render(); } });
  c.querySelectorAll("[data-recfield]").forEach((el) => { const h = () => { const rec = state.recurrences.find((x) => x.id === el.dataset.rec); if (!rec) return; const f = el.dataset.recfield; if (el.type === "checkbox") rec[f] = el.checked; else if (el.type === "number") rec[f] = parseFloat(el.value) || 0; else rec[f] = el.value; save(); if (f === "active") render(); }; el.addEventListener("change", h); if (el.tagName === "INPUT" && el.type !== "checkbox") el.addEventListener("blur", h); });
  const genRec = c.querySelector("[data-gen-rec]"); if (genRec) genRec.onclick = () => { const n = generateRecurrences(); save(); render(); alert(n ? `${n} échéance(s) générée(s).` : "Aucune échéance due pour l'instant."); };

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

  // Saisie / correction manuelle du temps d'un élément d'historique
  const durInputs = (el) => {
    const body = el.closest(".entry-body") || document;
    const h = body.querySelector(`[data-dur-h][data-e="${el.dataset.e}"]`);
    const mn = body.querySelector(`[data-dur-m][data-e="${el.dataset.e}"]`);
    return { h, mn };
  };
  const applyDuration = (el, seconds) => {
    const m = findMission(el.dataset.m), e = findEntry(m, el.dataset.e);
    if (!e) return;
    setEntryDuration(e, seconds);
    save(); render();
  };
  c.querySelectorAll("[data-dur-h],[data-dur-m]").forEach((el) => {
    const h = () => {
      const { h: hi, mn } = durInputs(el);
      const secs = (parseInt(hi && hi.value, 10) || 0) * 3600 + (parseInt(mn && mn.value, 10) || 0) * 60;
      applyDuration(el, secs);
    };
    el.addEventListener("change", h);
  });
  c.querySelectorAll("[data-dur-add]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m), e = findEntry(m, b.dataset.e);
    if (!e) return;
    applyDuration(b, entryElapsed(e) + Number(b.dataset.durAdd) * 60);
  });
  c.querySelectorAll("[data-dur-zero]").forEach((b) => b.onclick = () => applyDuration(b, 0));
  c.querySelectorAll("[data-del-entry]").forEach((b) => b.onclick = () => { const m = findMission(b.dataset.m); if (!m) return; m.entries = m.entries.filter((e) => e.id !== b.dataset.delEntry); save(); render(); });
  c.querySelectorAll("[data-mview]").forEach((b) => b.onclick = () => { missionView = b.dataset.mview; render(); });
  const mSort = c.querySelector("#missionSort"); if (mSort) mSort.onchange = () => { missionSort = mSort.value; render(); };
  c.querySelectorAll("[data-mission-move]").forEach((b) => b.onclick = (ev) => {
    ev.stopPropagation();
    const m = findMission(b.dataset.m); if (!m) return;
    const i = STATUSES.findIndex((s) => s.code === (m.statusCode || "aDemarrer"));
    const j = Math.max(0, Math.min(STATUSES.length - 1, i + Number(b.dataset.missionMove)));
    if (j !== i) { m.statusCode = STATUSES[j].code; save(); render(); }
  });
  const stopAll = c.querySelector("[data-stop-all]");
  if (stopAll) stopAll.onclick = () => {
    let n = 0;
    state.missions.forEach((m) => (m.entries || []).forEach((e) => {
      if (e.timerStartedAt) { e.accumulatedSeconds = (e.accumulatedSeconds || 0) + (Date.now() - e.timerStartedAt) / 1000; e.timerStartedAt = null; n++; }
    }));
    save(); render(); toast(`${n} chronomètre(s) arrêté(s).`);
  };

  // Tâches
  c.querySelectorAll("[data-add-task]").forEach((b) => b.onclick = () => { const st = b.dataset.addTask || "aFaire"; state.tasks.push({ id: uid(), title: "", status: st, missionId: null, dueDate: "", createdAt: Date.now() }); save(); render(); });
  c.querySelectorAll("[data-taskfield]").forEach((el) => { const h = () => { const t = state.tasks.find((x) => x.id === el.dataset.t); if (t) { t[el.dataset.taskfield] = el.value; save(); } }; el.addEventListener("change", h); el.addEventListener("blur", h); });
  c.querySelectorAll("[data-taskdue]").forEach((el) => el.onchange = () => { const t = state.tasks.find((x) => x.id === el.dataset.taskdue); if (t) { t.dueDate = el.value; save(); render(); } });
  c.querySelectorAll("[data-task-status]").forEach((sel) => sel.onchange = () => { const t = state.tasks.find((x) => x.id === sel.dataset.taskStatus); if (t) { t.status = sel.value; save(); render(); } });
  // Kanban : déplacement d'une colonne à l'autre par les flèches
  c.querySelectorAll("[data-task-move]").forEach((b) => b.onclick = () => {
    const t = state.tasks.find((x) => x.id === b.dataset.t); if (!t) return;
    const i = TASK_STATUSES.findIndex((s) => s.code === (t.status || "aFaire"));
    const j = Math.max(0, Math.min(TASK_STATUSES.length - 1, i + Number(b.dataset.taskMove)));
    if (j !== i) { t.status = TASK_STATUSES[j].code; save(); render(); }
  });
  wireKanban(c);
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
  c.querySelectorAll("[data-ptab]").forEach((b) => b.onclick = () => { planningTab = b.dataset.ptab; render(); });

  // ---- Agenda Google -----------------------------------------------------
  if (calVisible() && !calBusy && window.DriveSync && DriveSync.isConnected()) loadCalendar(false);
  c.querySelectorAll("[data-cal-open]").forEach((r) => r.onclick = () => {
    const id = r.dataset.calOpen; if (id) openDetail("rendezvous", "gcal:" + id);
  });
  c.querySelectorAll("[data-cal-slot]").forEach((el) => el.addEventListener("click", (ev) => {
    ev.stopPropagation(); openDetail("rendezvous", "gcal:" + el.dataset.calSlot);
  }));
  c.querySelectorAll("[data-cal-refresh]").forEach((b) => b.onclick = () => loadCalendar(true));
  c.querySelectorAll("[data-cal-enable]").forEach((b) => b.onclick = () => enableCalendar());
  c.querySelectorAll("[data-cal-unlink]").forEach((b) => b.onclick = () => unlinkCalendar());
  const calImp = c.querySelector("[data-cal-import]");
  if (calImp) calImp.onclick = () => importCalEvent(calImp.dataset.calImport);
  wireTimetable(c);
}

// ---- Kanban : glisser-déposer d'une carte vers une autre colonne ----
// Glisser-déposer générique entre colonnes d'un tableau (tâches, missions…).
//   cardAttr : attribut portant l'identifiant de la carte
//   colAttr  : attribut portant le code de la colonne
//   label    : libellé affiché pendant le glissement
//   current  : code de colonne actuel d'un identifiant
//   onDrop   : appelé si la carte change de colonne
function wireBoardDnD(c, cardAttr, colAttr, label, current, onDrop) {
  const cols = Array.from(c.querySelectorAll("[" + colAttr + "]"));
  if (!cols.length) return;
  const colCode = (el) => el.getAttribute(colAttr);
  c.querySelectorAll("[" + cardAttr + "]").forEach((card) => {
    card.addEventListener("pointerdown", (ev) => {
      // on ne démarre pas de glissement depuis un champ ou un bouton
      if (ev.target.closest("input,select,textarea,button,a")) return;
      const id = card.getAttribute(cardAttr);
      const txt = label(id);
      if (txt == null) return;
      ev.preventDefault(); card.setPointerCapture(ev.pointerId);
      const ghost = document.createElement("div");
      ghost.className = "tt-ghost"; ghost.textContent = txt;
      ghost.style.left = ev.clientX + 8 + "px"; ghost.style.top = ev.clientY + 8 + "px";
      document.body.appendChild(ghost);
      let moved = false;
      const highlight = (el) => cols.forEach((k) => k.classList.toggle("kb-over", k === el));
      const colAt = (x, y) => cols.find((k) => { const r = k.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; }) || null;
      const onMove = (e) => {
        moved = true;
        ghost.style.left = e.clientX + 8 + "px"; ghost.style.top = e.clientY + 8 + "px";
        highlight(colAt(e.clientX, e.clientY));
      };
      const onUp = (e) => {
        card.removeEventListener("pointermove", onMove); card.removeEventListener("pointerup", onUp); card.removeEventListener("pointercancel", onUp);
        ghost.remove(); highlight(null);
        if (!moved) return;
        const target = colAt(e.clientX, e.clientY);
        if (target && colCode(target) !== current(id)) onDrop(id, colCode(target));
      };
      card.addEventListener("pointermove", onMove); card.addEventListener("pointerup", onUp); card.addEventListener("pointercancel", onUp);
    });
  });
}
function wireKanban(c) {
  // tableau des tâches
  wireBoardDnD(c, "data-task-card", "data-kanban-col",
    (id) => { const t = state.tasks.find((x) => x.id === id); return t ? (t.title || "Tâche") : null; },
    (id) => { const t = state.tasks.find((x) => x.id === id); return t ? (t.status || "aFaire") : ""; },
    (id, code) => { const t = state.tasks.find((x) => x.id === id); if (t) { t.status = code; save(); render(); } });
  // tableau des missions
  wireBoardDnD(c, "data-mission-card", "data-mission-col",
    (id) => { const m = findMission(id); return m ? (m.title || "Projet") : null; },
    (id) => { const m = findMission(id); return m ? (m.statusCode || "aDemarrer") : ""; },
    (id, code) => { const m = findMission(id); if (m) { m.statusCode = code; save(); render(); } });
}

// ---- Emploi du temps : glisser-déposer, redimensionnement, création ----
function wireTimetable(c) {
  const grid = c.querySelector("#ttGrid");
  c.querySelectorAll("[data-day]").forEach((b) => b.onclick = () => { const d = new Date(planningDate + "T12:00:00"); d.setDate(d.getDate() + Number(b.dataset.day)); planningDate = d.toISOString().slice(0, 10); render(); });
  const todayBtn = c.querySelector("[data-day-today]"); if (todayBtn) todayBtn.onclick = () => { planningDate = todayISO(); render(); };
  const addSlot = c.querySelector("[data-add-slot]");
  if (addSlot) addSlot.onclick = () => { const s = newSlot(planningDate, defaultFreeStart(planningDate), DEFAULT_DUR, "Créneau"); save(); render(); slotEditor(s.id); };
  if (!grid) return;

  const minFromY = (clientY) => {
    const r = grid.getBoundingClientRect();
    return clampStart(snap(DAY_START + (clientY - r.top) / PX_PER_MIN));
  };

  // Cocher / décocher la tâche liée directement sur le créneau
  grid.querySelectorAll("[data-slot-done]").forEach((b) => {
    b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    b.addEventListener("click", (ev) => { ev.stopPropagation(); toggleSlotTask(b.dataset.slotDone); });
  });

  // Déplacer / redimensionner un créneau existant
  grid.querySelectorAll("[data-slot]").forEach((el) => {
    const id = el.dataset.slot;
    el.addEventListener("pointerdown", (ev) => {
      if (ev.target.hasAttribute("data-slot-done")) return;   // clic sur la pastille ✓
      const s = state.slots.find((x) => x.id === id); if (!s) return;
      const resizing = ev.target.hasAttribute("data-resize");
      ev.preventDefault(); el.setPointerCapture(ev.pointerId);
      const y0 = ev.clientY, start0 = s.start, dur0 = s.duration;
      let moved = false;
      const onMove = (e) => {
        const dm = snap((e.clientY - y0) / PX_PER_MIN);
        if (Math.abs(e.clientY - y0) > 3) moved = true;
        if (resizing) {
          const dur = Math.max(MIN_DUR, Math.min(dur0 + dm, DAY_END - start0));
          el.style.height = Math.max(Math.round(dur * PX_PER_MIN), 12) + "px";
          el.dataset.tmpDur = dur;
        } else {
          const st = Math.max(DAY_START, Math.min(start0 + dm, DAY_END - dur0));
          el.style.top = Math.round((st - DAY_START) * PX_PER_MIN) + "px";
          el.dataset.tmpStart = st;
        }
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove); el.removeEventListener("pointerup", onUp); el.removeEventListener("pointercancel", onUp);
        if (!moved) { slotEditor(id); return; }
        if (resizing && el.dataset.tmpDur) s.duration = Number(el.dataset.tmpDur);
        else if (!resizing && el.dataset.tmpStart) s.start = Number(el.dataset.tmpStart);
        save(); render();
      };
      el.addEventListener("pointermove", onMove); el.addEventListener("pointerup", onUp); el.addEventListener("pointercancel", onUp);
    });
  });

  // Cliquer une zone vide → nouveau créneau de 45 min
  grid.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-slot],[data-cal-slot]")) return;
    const st = minFromY(ev.clientY);
    const s = newSlot(planningDate, Math.min(st, DAY_END - DEFAULT_DUR), DEFAULT_DUR, "Créneau");
    save(); render(); slotEditor(s.id);
  });

  // Glisser une tâche depuis le panneau vers la grille
  c.querySelectorAll("[data-drag-task]").forEach((chip) => {
    chip.addEventListener("pointerdown", (ev) => {
      const t = state.tasks.find((x) => x.id === chip.dataset.dragTask); if (!t) return;
      ev.preventDefault(); chip.setPointerCapture(ev.pointerId);
      const ghost = document.createElement("div");
      ghost.className = "tt-ghost"; ghost.textContent = t.title || "Tâche";
      ghost.style.left = ev.clientX + 8 + "px"; ghost.style.top = ev.clientY + 8 + "px";
      document.body.appendChild(ghost);
      let moved = false;
      const onMove = (e) => { moved = true; ghost.style.left = e.clientX + 8 + "px"; ghost.style.top = e.clientY + 8 + "px"; };
      const onUp = (e) => {
        chip.removeEventListener("pointermove", onMove); chip.removeEventListener("pointerup", onUp); chip.removeEventListener("pointercancel", onUp);
        ghost.remove();
        const r = grid.getBoundingClientRect();
        if (moved && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          const st = Math.min(minFromY(e.clientY), DAY_END - DEFAULT_DUR);
          newSlot(planningDate, st, DEFAULT_DUR, t.title || "Tâche", t.id, t.missionId || null);
          if ((t.status || "aFaire") === "aFaire") t.status = "enCours";
          save(); render();
        }
      };
      chip.addEventListener("pointermove", onMove); chip.addEventListener("pointerup", onUp); chip.addEventListener("pointercancel", onUp);
    });
  });
}
function newSlot(date, start, duration, title, taskId, missionId) {
  const s = { id: uid(), date, start: clampStart(snap(start)), duration: Math.max(MIN_DUR, snap(duration)), title: title || "Créneau", taskId: taskId || null, missionId: missionId || null, notes: "", createdAt: Date.now() };
  if (s.start + s.duration > DAY_END) s.duration = DAY_END - s.start;
  state.slots.push(s);
  return s;
}
// Premier créneau libre de la journée (sinon 9h).
function defaultFreeStart(date) {
  const slots = daySlots(date);
  let t = Math.max(DAY_START, 540);
  for (const s of slots) { if (t + DEFAULT_DUR <= s.start) break; t = Math.max(t, slotEnd(s)); }
  return Math.min(t, DAY_END - DEFAULT_DUR);
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
  (data.invoices || []).forEach((v) => state.invoices.push({ id: uid(), title: v.title || "", reference: v.reference || "", direction: v.direction === "depense" ? "depense" : "recette", status: (INV_STATUSES.some((x) => x.code === v.status) ? v.status : "aEmettre"), amount: Number(v.amount) || 0, vatRate: v.vatRate == null ? 20 : Number(v.vatRate), startDate: (v.startDate || "").slice(0, 10) || todayISO(), hasDueDate: !!v.hasDueDate, dueDate: (v.dueDate || "").slice(0, 10), paymentDate: (v.paymentDate || "").slice(0, 10), companyId: compByName[v.companyName] || null, contactId: contactByName[v.contactName] || null, categoryName: v.categoryName || "", payMode: v.payMode === "associe" ? "associe" : "compte", accountId: null, associateId: contactByName[v.associateName] || null, receiptUrl: v.receiptUrl || "", noReceipt: !!v.noReceipt }));
  const missionByTitle = {};
  // En mode « ajouter », une tâche peut viser un projet déjà présent.
  state.missions.forEach((m) => { if (m.title) missionByTitle[m.title] = m.id; });
  (data.missions || []).forEach((m, i) => { const nm = { id: uid(), title: m.title || "", statusCode: normStatus(m.statusCode || m.status), companyId: compByName[m.companyName] || null, startDate: (m.startDate || "").slice(0, 10), createdAt: Date.now() + i, entries: (m.entries || []).map((e) => ({ id: uid(), kind: normKind(e.kind), title: e.title || "", content: e.content || "", date: (e.date || "").slice(0, 10) || todayISO(), url: e.url || e.urlString || "", accumulatedSeconds: Number(e.accumulatedSeconds) || 0, timerStartedAt: null, createdAt: Date.now() })) }; state.missions.push(nm); if (nm.title) missionByTitle[nm.title] = nm.id; });
  (data.tasks || []).forEach((t) => state.tasks.push({ id: uid(), title: t.title || "", status: (TASK_STATUSES.some((s) => s.code === t.status) ? t.status : "aFaire"), missionId: missionByTitle[t.missionTitle] || null, dueDate: (t.dueDate || "").slice(0, 10), section: t.section || "", assignee: t.assignee || "", progress: Number(t.progress) || 0, notes: t.notes || "", origin: t.origin || "manuel", createdAt: Date.now() }));
  (data.actions || []).forEach((a) => state.actions.push({ id: uid(), title: a.title || "", projectName: a.projectName || "", missionId: missionByTitle[a.missionTitle] || null, request: a.request || "", contactId: null, recipientName: a.recipientName || "", recipientEmail: a.recipientEmail || "", dueDate: (a.dueDate || "").slice(0, 10), reminderDaily: a.reminderDaily !== false, closed: !!a.closed, closedAt: a.closedAt || null, createdAt: Date.now() }));
  (data.rendezvous || []).forEach((r) => state.rendezvous.push({ id: uid(), title: r.title || "", date: (r.date || "").slice(0, 10), time: r.time || "", location: r.location || "", contactId: null, withName: r.withName || "", missionId: missionByTitle[r.missionTitle] || null, notes: r.notes || "", createdAt: Date.now() }));
  const accByKey = {};
  (data.accounts || []).forEach((a) => { const na = { id: uid(), companyId: compByName[a.companyName] || null, name: a.name || "", initialBalance: Number(a.initialBalance) || 0, balanceDate: (a.balanceDate || "").slice(0, 10) || todayISO() }; state.accounts.push(na); if (na.name) accByKey[(a.companyName || "") + "|" + na.name] = na.id; });
  const assoByName = {}; state.contacts.forEach((c) => { assoByName[contactName(c)] = c.id; });
  (data.ccaMovements || []).forEach((m) => state.ccaMovements.push({ id: uid(), date: (m.date || "").slice(0, 10) || todayISO(), associateId: assoByName[m.associateName] || null, companyId: compByName[m.companyName] || null, kind: ["apport", "remboursement", "autre"].indexOf(m.kind) > -1 ? m.kind : "apport", amount: Math.abs(Number(m.amount) || 0), notes: m.notes || "" }));
  (data.salaries || []).forEach((s) => state.salaries.push({ id: uid(), contactId: assoByName[s.contactName] || null, name: s.name || "", companyId: compByName[s.companyName] || null, month: (s.month || "").slice(0, 7) || new Date().toISOString().slice(0, 7), gross: Number(s.gross) || 0, charges: Number(s.charges) || 0, net: Number(s.net) || 0, status: s.status === "paye" ? "paye" : "aPayer", paymentDate: (s.paymentDate || "").slice(0, 10), accountId: null, notes: s.notes || "", invoiceId: null }));
  (data.slots || []).forEach((s) => state.slots.push({ id: uid(), date: (s.date || "").slice(0, 10) || todayISO(), start: clampStart(snap(Number(s.start) || DAY_START)), duration: Math.max(MIN_DUR, snap(Number(s.duration) || DEFAULT_DUR)), title: s.title || "Créneau", taskId: null, missionId: missionByTitle[s.missionTitle] || null, notes: s.notes || "", createdAt: Date.now() }));
  (data.recurrences || []).forEach((r) => state.recurrences.push({ id: uid(), kind: r.kind === "task" ? "task" : "invoice", active: r.active !== false, title: r.title || "", frequency: (FREQS.some((f) => f.code === r.frequency) ? r.frequency : "mensuelle"), anchorDate: (r.anchorDate || "").slice(0, 10) || todayISO(), lastGenerated: (r.lastGenerated || "").slice(0, 10) || null, direction: r.direction === "recette" ? "recette" : "depense", amount: Number(r.amount) || 0, vatRate: r.vatRate == null ? 20 : Number(r.vatRate), categoryName: r.categoryName || "", companyId: compByName[r.companyName] || null, missionId: missionByTitle[r.missionTitle] || null }));

  save();
  alert(`Import terminé : ${state.companies.length} société(s), ${state.contacts.length} contact(s), ${state.invoices.length} facture(s), ${state.missions.length} projet(s).`);
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
  // IMPORTANT : tout le HTML est écrit en UNE fois. Un « innerHTML += » ultérieur
  // reconstruirait les nœuds et supprimerait les gestionnaires de clic déjà posés.
  const connected = window.DriveSync && DriveSync.isConnected();
  const reauth = connected && DriveSync.needsAuth();
  const main = connected
    ? `<div style="font-size:12px">☁︎ <strong>Drive</strong> · <span id="driveStatus" class="muted">${reauth ? "reconnexion nécessaire" : "synchronisé"}</span></div>
       <button class="btn ${reauth ? "" : "ghost"} small" id="driveReconnect" style="width:100%;margin-top:6px">Reconnecter</button>
       <button class="btn ghost small" id="driveBackups" style="width:100%;margin-top:6px">🛟 Sauvegardes</button>`
    : `<button class="btn secondary small" id="driveConnect" style="width:100%">Se connecter à Google Drive</button>`;
  el.innerHTML = main
    + `<div class="app-version"><span>Version ${APP_VERSION}</span><button class="btn ghost small" id="appUpdate">↻ Mettre à jour</button></div>`;
  // Les gestionnaires sont attachés APRÈS l'écriture complète du HTML.
  const bk = el.querySelector("#driveBackups"); if (bk) bk.onclick = openBackups;
  const rb = el.querySelector("#driveReconnect"); if (rb) rb.onclick = reconnectDrive;
  const cn = el.querySelector("#driveConnect"); if (cn) cn.onclick = connectDrive;
  const up = el.querySelector("#appUpdate"); if (up) up.onclick = forceUpdate;
}
// Vide le cache local du navigateur et recharge la dernière version publiée.
async function forceUpdate() {
  try {
    if (window.caches && caches.keys) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {}
  // paramètre unique pour contourner le cache HTTP de Safari
  location.replace(location.pathname + "?maj=" + Date.now());
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
// Reconnexion depuis le bouton : ouvre la fenêtre Google (obligatoire sur Safari,
// qui bloque le renouvellement silencieux). L'appel part directement du clic.
function reconnectDrive() {
  if (!(window.DriveSync && DriveSync.configured())) { alert("Google Drive n'est pas configuré (identifiant client manquant dans config.js)."); return; }
  const p = DriveSync.reconnect();
  p.then((remote) => {
    if (remote === null && DriveSync.needsAuth() === false) return; // redirection en cours
    if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) {
      state = Object.assign(blankState(), remote);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } else DriveSync.push(state);
    renderDriveBar(); render(); loadMails(); loadCalendar(true);
    toast("Google Drive reconnecté ✓");
  }).catch((e) => {
    renderDriveBar();
    alert("Reconnexion impossible : " + e.message
      + "\n\nSur iPhone (Safari) :\n• autorise les fenêtres surgissantes pour ce site (Réglages → Safari → Bloquer les pop-up : désactivé) ;\n• puis appuie de nouveau sur « Reconnecter ».\n\nTes données restent enregistrées sur l'appareil : rien n'est perdu.");
  });
}
async function connectDrive() {
  if (!(window.DriveSync && DriveSync.configured())) { alert("Google Drive n'est pas configuré (identifiant client manquant dans config.js)."); return; }
  try {
    const remote = await DriveSync.connect();
    if (remote === null && !DriveSync.isConnected()) return; // redirection vers Google en cours
    if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) { state = Object.assign(blankState(), remote); localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    if (generateRecurrences() > 0) save(); else DriveSync.push(state);
    renderDriveBar(); render();
    loadMails(); loadCalendar(true);
  } catch (e) { alert("Connexion Google Drive impossible : " + e.message); }
}

// ----------------------------- Graphiques (SVG, sans librairie) -----------------------------
function fmtK(v) { const a = Math.abs(v); if (a >= 1000) return (v / 1000).toFixed(a >= 10000 ? 0 : 1).replace(".", ",") + "k"; return Math.round(v) + ""; }
function svgLineChart(series, opts) {
  opts = opts || {}; const w = opts.w || 560, h = opts.h || 170, pad = { l: 46, r: 14, t: 12, b: 24 }, color = opts.color || "#18c1d8";
  if (series.length < 2) return '<div class="muted" style="font-size:12px">Pas assez de données.</div>';
  const xs = series.map((p) => p.x), ys = series.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0); if (minY === maxY) maxY = minY + 1;
  const X = (x) => pad.l + (maxX === minX ? 0 : (x - minX) / (maxX - minX)) * (w - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  const line = series.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const z = Y(0);
  const area = `${X(minX).toFixed(1)},${z.toFixed(1)} ${line} ${X(maxX).toFixed(1)},${z.toFixed(1)}`;
  const yl = [maxY, 0, minY].filter((v, i, a) => a.indexOf(v) === i);
  const grid = yl.map((v) => `<line x1="${pad.l}" y1="${Y(v).toFixed(1)}" x2="${w - pad.r}" y2="${Y(v).toFixed(1)}" stroke="var(--line)"/><text x="${pad.l - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtK(v)}</text>`).join("");
  const xl = (opts.xTicks || []).map((t) => `<text x="${X(t.x).toFixed(1)}" y="${h - 7}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(t.label)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:100%;height:auto" preserveAspectRatio="xMidYMid meet">
    ${grid}<polygon points="${area}" fill="${color}" opacity="0.14"/>
    <polyline points="${line}" fill="none" stroke="${color}" stroke-width="2.5"/>${xl}</svg>`;
}
function svgBarChart(series, opts) {
  opts = opts || {}; const w = opts.w || 560, h = opts.h || 170, pad = { l: 46, r: 14, t: 12, b: 26 }, color = opts.color || "#4dc8bb";
  if (!series.length) return '<div class="muted" style="font-size:12px">Pas de données.</div>';
  const ys = series.map((s) => s.value);
  let minY = Math.min(...ys, 0), maxY = Math.max(...ys, 0); if (minY === maxY) maxY = minY + 1;
  const n = series.length, bw = (w - pad.l - pad.r) / n;
  const Y = (y) => pad.t + (1 - (y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  const z = Y(0);
  const bars = series.map((s, i) => { const x = pad.l + i * bw + bw * 0.15, bwi = bw * 0.7; const yTop = Y(Math.max(s.value, 0)); const hh = Math.abs(Y(s.value) - z); return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bwi.toFixed(1)}" height="${Math.max(hh, 1).toFixed(1)}" rx="2" fill="${color}"/><text x="${(x + bwi / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="var(--muted)">${esc(s.label)}</text>`; }).join("");
  const yl = [maxY, 0].filter((v, i, a) => a.indexOf(v) === i);
  const grid = yl.map((v) => `<line x1="${pad.l}" y1="${Y(v).toFixed(1)}" x2="${w - pad.r}" y2="${Y(v).toFixed(1)}" stroke="var(--line)"/><text x="${pad.l - 5}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--muted)">${fmtK(v)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:100%;height:auto">${grid}${bars}</svg>`;
}
function last12MonthsCA() {
  const now = new Date(); const arr = []; const idx = {};
  for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; idx[key] = arr.length; arr.push({ key, label: d.toLocaleDateString("fr-FR", { month: "short" }), value: 0 }); }
  state.invoices.filter((v) => v.direction === "recette").forEach((v) => { const k = (v.startDate || "").slice(0, 7); if (k in idx) arr[idx[k]].value += (v.amount || 0); });
  return arr;
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
  const r = timeRange();
  const { total, per } = timeBreakdown(r.start, r.end);
  const rows = per.map((p) => `<tr><td>${esc(p.title)}</td><td class="num">${(p.s / 3600).toFixed(2).replace(".", ",")}</td><td class="num">${fmtDuration(p.s)}</td></tr>`).join("");
  const titre = r.kind === "mois" ? `Mois de ${r.label}` : `Semaine du ${fmtDate(iso(r.start))} au ${fmtDate(iso(new Date(r.end - 86400000)))}`;
  return `<div class="rep-date">${esc(titre)}</div>
    <table class="rep-table"><thead><tr><th>Projet</th><th class="num">Heures</th><th class="num">Durée</th></tr></thead><tbody>
    ${rows || '<tr><td colspan="3">Aucun temps sur cette période.</td></tr>'}
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
      ${line("Projets en cours", state.missions.filter((m) => m.statusCode === "enCours").length)}</tbody></table>`;
}
// --- CSV ---
function csvCell(s) { return '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"'; }
const csvNum = (v) => (+v || 0).toFixed(2).replace(".", ",");
function downloadFile(name, content, type) { const blob = new Blob([content], { type }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
function contactNameById(id) { const c = state.contacts.find((x) => x.id === id); return c ? contactName(c) : ""; }
function exportFacturesCSV() {
  const H = ["Date", "Intitulé", "Société", "Catégorie", "Nature", "Sens", "Statut", "Montant HT", "TVA %", "Montant TTC", "Échéance", "Payée le", "Tiers", "Justificatif"];
  const rows = [...state.invoices].sort((a, b) => (b.startDate || "").localeCompare(a.startDate || "")).map((v) => [
    v.startDate || "", v.title || "", companyName(v.companyId), v.categoryName || "", invNature(v), v.direction === "recette" ? "Recette" : "Dépense", invStatusLabel(v.status),
    csvNum(v.amount), v.vatRate == null ? "" : v.vatRate, csvNum(invTTC(v)), v.dueDate || "", v.paymentDate || "", contactNameById(v.contactId), v.receiptUrl || (v.noReceipt ? "(non requis)" : "MANQUANT")]);
  const csv = "﻿" + [H, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
  downloadFile("operations01-factures.csv", csv, "text/csv;charset=utf-8");
}
function exportTempsCSV() {
  const r = timeRange();
  const { total, per } = timeBreakdown(r.start, r.end);
  const H = ["Projet", "Heures", "Durée"];
  const rows = per.map((p) => [p.title, (p.s / 3600).toFixed(2).replace(".", ","), fmtDuration(p.s)]);
  rows.push(["TOTAL", (total / 3600).toFixed(2).replace(".", ","), fmtDuration(total)]);
  const entete = [[r.kind === "mois" ? "Mois" : "Semaine", r.label, ""]];
  const csv = "\ufeff" + [...entete, [], H, ...rows].map((x) => x.map(csvCell).join(";")).join("\r\n");
  downloadFile(`operations01-temps-${r.kind}.csv`, csv, "text/csv;charset=utf-8");
}


// ----------------------------- Chronos live -----------------------------
setInterval(() => {
  document.querySelectorAll("[data-entry-time]").forEach((span) => {
    const id = span.dataset.entryTime;
    for (const m of state.missions) { const e = (m.entries || []).find((x) => x.id === id); if (e && e.timerStartedAt) span.textContent = fmtDuration(entryElapsed(e)); }
  });
  document.querySelectorAll("[data-total]").forEach((span) => { const m = findMission(span.dataset.total); if (m && (m.entries || []).some((e) => e.timerStartedAt)) span.textContent = fmtDuration(missionTotal(m)); });
  // compteur « Temps » du menu : suit le chrono en cours
  if (state.missions.some((m) => (m.entries || []).some((e) => e.timerStartedAt))) {
    const el = document.getElementById("navCount-time");
    if (el) el.textContent = fmtDurationShort(weekWorkedSeconds());
  }
}, 1000);

// ----------------------------- Installation (PWA) -----------------------------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; document.getElementById("installBanner").style.display = "flex"; });
document.getElementById("installBtn").onclick = () => { document.getElementById("installBanner").style.display = "none"; if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } };
document.getElementById("installClose").onclick = () => { document.getElementById("installBanner").style.display = "none"; };

// ----------------------------- Démarrage -----------------------------
if (generateRecurrences() > 0) save();
render();
renderDriveBar();
if (window.DriveSync) DriveSync.onStatus((s) => {
  const el = document.getElementById("driveStatus");
  if (el) el.textContent = s;
  // le bouton « Reconnecter » apparaît/disparaît selon l'état
  if (s === "reconnexion nécessaire" || s === "connecté") renderDriveBar();
});

// Reconnexion automatique à Google Drive (silencieuse) au lancement.
// Le script Google est chargé en différé : on attend qu'il soit prêt.
(function autoReconnect(tries) {
  tries = tries || 0;
  if (!window.DriveSync) return;
  // On attend le script Google, mais sans jamais rester bloqué : au-delà de ~10 s
  // on lance quand même autoConnect, qui basculera sur « reconnexion nécessaire ».
  if (!DriveSync.ready() && tries < 25) { setTimeout(() => autoReconnect(tries + 1), 400); return; }
  DriveSync.autoConnect().then((remote) => {
    if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) {
      state = Object.assign(blankState(), remote);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    }
    if (generateRecurrences() > 0) save();
    renderDriveBar(); render(); loadMails(); loadCalendar(true);
  }).catch(() => { renderDriveBar(); });
})();
