/* Operations01 — web app (PWA). Données stockées localement dans le navigateur.
   Première version : Missions (liste + détail), historique typé avec chronomètre,
   et un récapitulatif Temps. Les autres sections arrivent ensuite. */

"use strict";

// ----------------------------- Données -----------------------------
const STORE_KEY = "operations01";

const STATUSES = [
  { code: "enCours",   label: "En cours",    rank: 0 },
  { code: "aDemarrer", label: "À démarrer",  rank: 1 },
  { code: "enPause",   label: "En pause",    rank: 2 },
  { code: "terminee",  label: "Terminée",    rank: 3 },
];
const statusLabel = (c) => (STATUSES.find((s) => s.code === c) || STATUSES[1]).label;
const statusRank  = (c) => (STATUSES.find((s) => s.code === c) || STATUSES[1]).rank;

const KINDS = [
  { code: "note",        label: "Note",     ic: "📝" },
  { code: "email",       label: "E-mail",   ic: "✉️" },
  { code: "visio",       label: "Visio",    ic: "🎥" },
  { code: "action",      label: "Action",   ic: "✅" },
  { code: "deliverable", label: "Livrable", ic: "📦" },
];
const kindMeta = (c) => KINDS.find((k) => k.code === c) || KINDS[0];

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { missions: [] };
}
function save() {
  state.updatedAt = Date.now();
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
  if (window.DriveSync && DriveSync.isConnected()) DriveSync.push(state);
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ----------------------------- Utilitaires -----------------------------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`;
  if (m > 0) return `${m}min ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function validURL(u) {
  try { const x = new URL(u); return !!x.protocol; } catch (e) { return false; }
}

// Temps écoulé d'une entrée (cumul + session en cours)
function entryElapsed(e) {
  const running = e.timerStartedAt ? (Date.now() - e.timerStartedAt) / 1000 : 0;
  return (e.accumulatedSeconds || 0) + running;
}
function missionTotal(m) {
  return (m.entries || []).reduce((t, e) => t + entryElapsed(e), 0);
}

// ----------------------------- Navigation -----------------------------
const SECTIONS = [
  { id: "missions",  label: "Missions",       ic: "🏁", fn: renderMissions },
  { id: "time",      label: "Temps",          ic: "⏱️", fn: renderTime },
  { id: "planning",  label: "Planning",       ic: "📊", fn: () => stub("Planning") },
  { id: "finances",  label: "Finances",       ic: "€",  fn: () => stub("Finances") },
  { id: "contacts",  label: "Contacts",       ic: "👥", fn: () => stub("Contacts") },
  { id: "groupe",    label: "Groupe",         ic: "🏢", fn: () => stub("Groupe") },
  { id: "dashboard", label: "Tableau de bord", ic: "🎛️", fn: () => stub("Tableau de bord") },
];

let view = { section: "missions", missionId: null };

function go(section) { view = { section, missionId: null }; render(); }
function openMission(id) { view = { section: "missions", missionId: id }; render(); }

// ----------------------------- Rendu principal -----------------------------
function render() {
  renderNav();
  const content = document.getElementById("content");
  const sec = SECTIONS.find((s) => s.id === view.section) || SECTIONS[0];
  if (view.section === "missions" && view.missionId) {
    content.innerHTML = renderMissionDetail(view.missionId);
  } else {
    content.innerHTML = sec.fn();
  }
  wire();
}

function renderNav() {
  const sidebar = document.getElementById("sidebar");
  sidebar.querySelectorAll(".nav-item").forEach((n) => n.remove());
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.className = "nav-item" + (s.id === view.section ? " active" : "");
    b.innerHTML = `<span class="ic">${s.ic}</span> ${s.label}`;
    b.onclick = () => go(s.id);
    sidebar.appendChild(b);
  });
  const tabbar = document.getElementById("tabbar");
  tabbar.innerHTML = "";
  SECTIONS.slice(0, 5).forEach((s) => {
    const b = document.createElement("button");
    b.className = s.id === view.section ? "active" : "";
    b.innerHTML = `<span class="ic">${s.ic}</span>${s.label}`;
    b.onclick = () => go(s.id);
    tabbar.appendChild(b);
  });
}

function stub(name) {
  return `<div class="page-title">${esc(name)}</div>
    <div class="center-empty">Cette section arrivera dans une prochaine version de la web app.<br>
    Pour l'instant, <strong>Missions</strong> et <strong>Temps</strong> sont disponibles.</div>`;
}

// ----------------------------- Missions -----------------------------
function sortedMissions() {
  return [...state.missions].sort((a, b) => {
    const r = statusRank(a.statusCode) - statusRank(b.statusCode);
    if (r !== 0) return r;
    return (a.title || "").localeCompare(b.title || "", "fr", { sensitivity: "base" });
  });
}

function renderMissions() {
  const items = sortedMissions();
  const rows = items.map((m) => {
    const total = missionTotal(m);
    const sub = [
      `${(m.entries || []).length} élément(s)`,
      total > 0 ? `⏱ ${fmtDuration(total)}` : null,
    ].filter(Boolean).join(" · ");
    return `<div class="row" data-open="${m.id}" style="border-left-color:var(--primary)">
      <div class="grow">
        <div class="r-title">${esc(m.title || "Nouvelle mission")}</div>
        <div class="r-sub">${esc(sub)}</div>
      </div>
      <span class="badge ${m.statusCode}">${statusLabel(m.statusCode)}</span>
    </div>`;
  }).join("");
  const empty = `<div class="center-empty">Aucune mission.<br>Touchez « + » pour en créer une.</div>`;
  return `<div class="toolbar"><div class="page-title grow" style="margin:0">Missions</div>
      <button class="btn secondary small" data-import>Importer</button>
      <button class="btn secondary small" data-export>Exporter</button>
      <button class="btn" data-add-mission>+ Nouvelle mission</button></div>
    <div class="list">${items.length ? rows : empty}</div>
    <button class="btn fab" data-add-mission title="Nouvelle mission">+</button>`;
}

function renderMissionDetail(id) {
  const m = state.missions.find((x) => x.id === id);
  if (!m) return renderMissions();
  const statusOpts = STATUSES.map(
    (s) => `<option value="${s.code}" ${s.code === m.statusCode ? "selected" : ""}>${s.label}</option>`
  ).join("");

  const entries = [...(m.entries || [])].sort((a, b) =>
    (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)
  );
  const entriesHtml = entries.length
    ? entries.map((e) => renderEntry(m.id, e)).join("")
    : `<div class="muted" style="padding:8px 2px">Aucun élément. Ajoutez une note, un e-mail, une visio…</div>`;

  const kindButtons = KINDS.map(
    (k) => `<button class="chip" data-add-entry="${k.code}" data-m="${m.id}">${k.ic} ${k.label}</button>`
  ).join("");

  return `
    <button class="back" data-back>‹ Missions</button>
    <div class="toolbar">
      <input class="grow" data-field="title" data-m="${m.id}" value="${esc(m.title)}" placeholder="Intitulé de la mission" style="font-size:20px;font-weight:700"/>
      <select data-field="statusCode" data-m="${m.id}" style="width:auto">${statusOpts}</select>
    </div>

    <div class="section-h">Historique de la mission</div>
    <div class="list">${entriesHtml}</div>
    <div class="chip-row" style="margin-top:12px">${kindButtons}</div>

    <div class="section-h">Suivi du temps</div>
    <div class="card">
      <div class="inline"><strong class="grow">Temps total</strong>
        <span class="timer ${(m.entries||[]).some(e=>e.timerStartedAt)?"running":""}" data-total="${m.id}">${fmtDuration(missionTotal(m))}</span>
      </div>
    </div>

    <div style="margin-top:22px">
      <button class="btn danger small" data-del-mission="${m.id}">Supprimer la mission</button>
    </div>
  `;
}

function renderEntry(mid, e) {
  const k = kindMeta(e.kind);
  const running = !!e.timerStartedAt;
  const open = e._open ? "block" : "none";
  const urlLink = validURL(e.url)
    ? `<a class="btn ghost small" href="${esc(e.url)}" target="_blank" rel="noopener">↗ Ouvrir</a>`
    : (e.url ? `<span class="muted" style="font-size:12px">Lien invalide</span>` : "");
  const kindOpts = KINDS.map((x) => `<option value="${x.code}" ${x.code===e.kind?"selected":""}>${x.ic} ${x.label}</option>`).join("");
  return `<div class="entry">
    <div class="entry-head" data-toggle="${e.id}" data-m="${mid}">
      <span class="ic">${k.ic}</span>
      <div class="grow">
        <div class="r-title">${esc(e.title || k.label)}</div>
        <div class="r-sub">${k.label} · ${fmtDate(e.date)}${entryElapsed(e)>0?` · ⏱ <span class="timer ${running?"running":""}" data-entry-time="${e.id}">${fmtDuration(entryElapsed(e))}</span>`:""}${running?" 🔴":""}</div>
      </div>
      <span class="muted">${e._open ? "▾" : "▸"}</span>
    </div>
    <div class="entry-body" style="display:${open}">
      <label class="field"><span>Type</span>
        <select data-efield="kind" data-m="${mid}" data-e="${e.id}">${kindOpts}</select></label>
      <label class="field"><span>Titre</span>
        <input data-efield="title" data-m="${mid}" data-e="${e.id}" value="${esc(e.title)}" placeholder="Titre"/></label>
      <label class="field"><span>Date</span>
        <input type="date" data-efield="date" data-m="${mid}" data-e="${e.id}" value="${esc(e.date || todayISO())}"/></label>
      <label class="field"><span>Détails</span>
        <textarea data-efield="content" data-m="${mid}" data-e="${e.id}" placeholder="Détails…">${esc(e.content)}</textarea></label>
      <label class="field"><span>Lien (Gmail, Drive, Meet…)</span>
        <input data-efield="url" data-m="${mid}" data-e="${e.id}" value="${esc(e.url)}" placeholder="https://…" inputmode="url"/></label>
      <div class="inline" style="margin-top:6px">
        <button class="btn ${running?"danger":"secondary"} small" data-timer="${e.id}" data-m="${mid}">
          ${running ? "■ Arrêter le chrono" : "▶ Démarrer le chrono"}
        </button>
        ${urlLink}
        <span class="grow"></span>
        <button class="btn ghost small" data-del-entry="${e.id}" data-m="${mid}">Supprimer</button>
      </div>
    </div>
  </div>`;
}

// ----------------------------- Temps (récap) -----------------------------
function renderTime() {
  // agrège toutes les entrées par mission, sur la semaine courante (lundi→dimanche)
  const { start, end } = weekInterval(new Date());
  let total = 0;
  const perMission = [];
  state.missions.forEach((m) => {
    let s = 0;
    (m.entries || []).forEach((e) => {
      const d = e.date ? new Date(e.date + "T12:00:00") : null;
      if (d && d >= start && d < end) s += entryElapsed(e);
    });
    if (s > 0) { perMission.push({ title: m.title || "Sans titre", s }); total += s; }
  });
  perMission.sort((a, b) => b.s - a.s);
  const rows = perMission.length
    ? perMission.map((p) => `<div class="inline" style="padding:6px 0"><span class="grow">${esc(p.title)}</span><span class="timer">${fmtDuration(p.s)}</span></div>`).join("")
    : `<div class="muted">Aucun temps cette semaine. Datez vos entrées d'historique et lancez un chrono.</div>`;
  const label = `${fmtDate(start.toISOString())} → ${fmtDate(new Date(end - 86400000).toISOString())}`;
  return `<div class="page-title">Temps</div>
    <div class="card">
      <div class="muted" style="font-size:13px">Semaine · lundi → dimanche</div>
      <div style="font-weight:600;margin:2px 0 10px">${label}</div>
      <div class="inline"><strong class="grow">Temps total</strong><span class="timer" style="color:var(--primary);font-size:18px">${fmtDuration(total)}</span></div>
    </div>
    <div class="section-h">Par mission</div>
    <div class="card">${rows}</div>`;
}
function weekInterval(date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // 0 = lundi
  const start = new Date(d); start.setDate(d.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 7);
  return { start, end };
}

// ----------------------------- Interactions -----------------------------
function findMission(id) { return state.missions.find((m) => m.id === id); }
function findEntry(m, id) { return (m.entries || []).find((e) => e.id === id); }

function wire() {
  const c = document.getElementById("content");

  c.querySelectorAll("[data-add-mission]").forEach((b) => b.onclick = () => {
    const m = { id: uid(), title: "", statusCode: "aDemarrer", createdAt: Date.now(), entries: [] };
    state.missions.push(m); save(); openMission(m.id);
  });
  c.querySelectorAll("[data-open]").forEach((r) => r.onclick = () => openMission(r.dataset.open));
  const back = c.querySelector("[data-back]"); if (back) back.onclick = () => go("missions");
  c.querySelectorAll("[data-import]").forEach((b) => b.onclick = importClick);
  c.querySelectorAll("[data-export]").forEach((b) => b.onclick = exportJSON);

  // champs mission
  c.querySelectorAll("[data-field]").forEach((el) => {
    const handler = () => { const m = findMission(el.dataset.m); if (!m) return; m[el.dataset.field] = el.value; save(); if (el.dataset.field === "statusCode") { /* pas de re-render pour garder le focus */ } };
    el.addEventListener("change", handler);
    el.addEventListener("blur", handler);
  });

  // ajouter une entrée
  c.querySelectorAll("[data-add-entry]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); if (!m) return;
    const e = { id: uid(), kind: b.dataset.addEntry, title: "", content: "", date: todayISO(), url: "", accumulatedSeconds: 0, timerStartedAt: null, createdAt: Date.now(), _open: true };
    m.entries.push(e); save(); render();
  });

  // déplier / replier une entrée
  c.querySelectorAll("[data-toggle]").forEach((h) => h.onclick = (ev) => {
    if (ev.target.closest("a,button,input,select,textarea")) return;
    const m = findMission(h.dataset.m); const e = findEntry(m, h.dataset.toggle);
    if (e) { e._open = !e._open; render(); }
  });

  // champs d'entrée
  c.querySelectorAll("[data-efield]").forEach((el) => {
    const handler = () => { const m = findMission(el.dataset.m); const e = findEntry(m, el.dataset.e); if (!e) return; e[el.dataset.efield] = el.value; save(); if (el.dataset.efield === "kind") render(); };
    el.addEventListener("change", handler);
    el.addEventListener("blur", handler);
  });

  // chrono
  c.querySelectorAll("[data-timer]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); const e = findEntry(m, b.dataset.timer); if (!e) return;
    if (e.timerStartedAt) { e.accumulatedSeconds = (e.accumulatedSeconds || 0) + (Date.now() - e.timerStartedAt) / 1000; e.timerStartedAt = null; }
    else { e.timerStartedAt = Date.now(); }
    save(); render();
  });

  // suppressions
  c.querySelectorAll("[data-del-entry]").forEach((b) => b.onclick = () => {
    const m = findMission(b.dataset.m); if (!m) return;
    m.entries = m.entries.filter((e) => e.id !== b.dataset.delEntry); save(); render();
  });
  c.querySelectorAll("[data-del-mission]").forEach((b) => b.onclick = () => {
    if (!confirm("Supprimer définitivement cette mission ?")) return;
    state.missions = state.missions.filter((m) => m.id !== b.dataset.delMission); save(); go("missions");
  });
}

// mise à jour en direct des chronos qui tournent (chaque seconde)
setInterval(() => {
  document.querySelectorAll("[data-entry-time]").forEach((span) => {
    const id = span.dataset.entryTime;
    for (const m of state.missions) {
      const e = (m.entries || []).find((x) => x.id === id);
      if (e && e.timerStartedAt) { span.textContent = fmtDuration(entryElapsed(e)); }
    }
  });
  document.querySelectorAll("[data-total]").forEach((span) => {
    const m = findMission(span.dataset.total);
    if (m && (m.entries || []).some((e) => e.timerStartedAt)) span.textContent = fmtDuration(missionTotal(m));
  });
}, 1000);

// ----------------------------- Installation (PWA) -----------------------------
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); deferredPrompt = e;
  document.getElementById("installBanner").style.display = "flex";
});
document.getElementById("installBtn").onclick = async () => {
  document.getElementById("installBanner").style.display = "none";
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
};
document.getElementById("installClose").onclick = () => {
  document.getElementById("installBanner").style.display = "none";
};

// ----------------------------- Import / Export (pont de données) -----------------------------
function normStatus(c) { return STATUSES.some((s) => s.code === c) ? c : "aDemarrer"; }
function normKind(c) { return KINDS.some((k) => k.code === c) ? c : "note"; }

function importClick() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".json,application/json";
  inp.onchange = () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => importJSON(String(r.result));
    r.readAsText(f);
  };
  inp.click();
}

function importJSON(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { alert("Fichier JSON invalide."); return; }
  const incoming = Array.isArray(data) ? data : (data.missions || []);
  if (!incoming.length) { alert("Aucune mission trouvée dans ce fichier."); return; }
  incoming.forEach((m) => {
    state.missions.push({
      id: uid(),
      title: m.title || "",
      statusCode: normStatus(m.statusCode || m.status),
      createdAt: Date.now(),
      entries: (m.entries || []).map((e) => ({
        id: uid(),
        kind: normKind(e.kind),
        title: e.title || "",
        content: e.content || "",
        date: (e.date || "").slice(0, 10) || todayISO(),
        url: e.url || e.urlString || "",
        accumulatedSeconds: Number(e.accumulatedSeconds) || 0,
        timerStartedAt: null,
        createdAt: Date.now(),
      })),
    });
  });
  save();
  alert(incoming.length + " mission(s) importée(s). Vos données existantes n'ont pas été supprimées.");
  go("missions");
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ missions: state.missions }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "operations01-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

// ----------------------------- Google Drive (UI) -----------------------------
function renderDriveBar() {
  const el = document.getElementById("driveBar");
  if (!el) return;
  const cfgOk = window.OPERATIONS01_CONFIG && OPERATIONS01_CONFIG.googleClientId;
  if (!cfgOk) {
    el.innerHTML = `<div class="muted" style="font-size:11px;line-height:1.4">Google Drive non configuré.<br>Voir README → « Google Drive ».</div>`;
    return;
  }
  if (window.DriveSync && DriveSync.isConnected()) {
    el.innerHTML = `<div style="font-size:12px">☁︎ <strong>Drive</strong> · <span id="driveStatus" class="muted">synchronisé</span></div>`;
  } else {
    el.innerHTML = `<button class="btn secondary small" id="driveConnect" style="width:100%">Se connecter à Google Drive</button>`;
    const b = document.getElementById("driveConnect");
    if (b) b.onclick = connectDrive;
  }
}

async function connectDrive() {
  if (!(window.DriveSync && DriveSync.ready())) {
    alert("Google Drive n'est pas disponible ici (identifiant client manquant, ou app non hébergée en HTTPS).");
    return;
  }
  try {
    const remote = await DriveSync.connect();
    if (remote && (remote.updatedAt || 0) > (state.updatedAt || 0)) {
      // le fichier Drive est plus récent : on le charge
      state = remote;
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } else {
      // le local est plus récent (ou Drive vide) : on pousse le local vers Drive
      DriveSync.push(state);
    }
    renderDriveBar();
    render();
  } catch (e) {
    alert("Connexion Google Drive impossible : " + e.message);
  }
}

// ----------------------------- Démarrage -----------------------------
render();
renderDriveBar();
if (window.DriveSync) {
  DriveSync.onStatus((s) => {
    const el = document.getElementById("driveStatus");
    if (el) el.textContent = s;
  });
}
