/* Sauvegarde des données sur Google Drive (fichier operations01-data.json).
   Utilise Google Identity Services (jeton d'accès) + l'API Drive REST via fetch.
   Portée demandée : drive.file (l'app n'accède qu'au fichier qu'elle crée).
   Le localStorage reste le cache local (hors ligne) ; Drive est la copie durable.

   Sécurité des données :
   - sauvegarde quotidienne automatique (copies datées, 14 conservées) ;
   - détection de conflit entre appareils : avant d'écraser, si le fichier distant
     a changé depuis la dernière synchro, la version distante est copiée dans une
     sauvegarde « conflit » — on ne perd jamais le travail d'un autre appareil. */
(function () {
  const cfg = window.OPERATIONS01_CONFIG || {};
  // drive.file : l'app n'accède qu'aux fichiers qu'elle crée.
  // calendar.readonly : lecture seule de l'agenda Google (affichage dans Planning).
  const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly";
  const FILE_NAME = cfg.driveFileName || "operations01-data.json";
  const BACKUP_PREFIX = "operations01-backup-";
  const CONFLICT_PREFIX = "operations01-conflit-";
  const KEEP_BACKUPS = 14;
  const LAST_BACKUP_KEY = "op01_lastBackupDate";

  const SESSION_KEY = "op01_driveSession"; // mémorise qu'on a déjà autorisé l'app

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;         // date (ms) d'expiration du jeton, avec marge
  let tokenPromise = null;     // demande de jeton en cours (évite les doublons)
  let needsAuth = false;       // vrai si seule une action de l'utilisateur peut débloquer
  let fileId = null;
  let lastModifiedTime = null; // modifiedTime Drive connu après notre dernière lecture/écriture
  let pushTimer = null;
  let pending = null;          // dernier état à écrire (conservé tant que non écrit)
  let retries = 0;
  const listeners = [];
  const setStatus = (s) => listeners.forEach((fn) => fn(s));

  function ready() {
    return !!cfg.googleClientId && window.google && google.accounts && google.accounts.oauth2;
  }
  const hasSession = () => { try { return localStorage.getItem(SESSION_KEY) === "1"; } catch (e) { return false; } }
  const rememberSession = () => { try { localStorage.setItem(SESSION_KEY, "1"); } catch (e) {} };

  // --- Autorisation par redirection pleine page (indispensable sur iOS/Safari) ---
  // Safari isole le stockage tiers : la fenêtre surgissante de Google s'ouvre mais
  // ne rend jamais la main. On quitte donc l'app vers Google, qui nous renvoie
  // ensuite avec le jeton dans le fragment d'URL. Aucune pop-up n'est impliquée.
  const STATE_KEY = "op01_oauth_state";
  const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  function redirectURI() {
    if (typeof location === "undefined") return "";
    return location.origin + location.pathname.replace(/index\.html$/, "");
  }
  function startRedirectAuth() {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(STATE_KEY, nonce); } catch (e) {}
    const p = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: redirectURI(),
      response_type: "token",
      scope: SCOPE,
      include_granted_scopes: "true",
      state: nonce,
      prompt: "consent"
    });
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
  }
  // Au chargement : récupère le jeton renvoyé par Google, s'il y en a un.
  function consumeRedirectToken() {
    if (typeof location === "undefined") return false;
    if (!location.hash || location.hash.indexOf("access_token=") === -1) return false;
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    const tok = p.get("access_token");
    let saved = null;
    try { saved = localStorage.getItem(STATE_KEY); localStorage.removeItem(STATE_KEY); } catch (e) {}
    if (!tok || (saved && p.get("state") !== saved)) return false;
    accessToken = tok;
    tokenExpiry = Date.now() + Math.max(60, (Number(p.get("expires_in")) || 3600) - 120) * 1000;
    needsAuth = false; rememberSession();
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; }
    return true;
  }
  const cameBackFromGoogle = consumeRedirectToken();

  // Demande un jeton.
  //   interactive = false → renouvellement silencieux (aucune fenêtre).
  //   interactive = true  → fenêtre Google (doit partir d'un clic de l'utilisateur).
  // Sur iOS/Safari, la demande silencieuse peut rester sans réponse (protection
  // anti-traçage) : on la borne dans le temps et une demande interactive n'attend
  // JAMAIS une demande silencieuse en cours — sinon le bouton « Reconnecter »
  // resterait bloqué sur une promesse qui ne se résout pas.
  const SILENT_TIMEOUT = 8000;
  const POPUP_TIMEOUT = 25000;
  function getToken(interactive) {
    if (!interactive && tokenPromise) return tokenPromise;
    if (interactive) tokenPromise = null;   // on abandonne toute demande silencieuse en cours
    // `p` est déclaré avant d'être construit : la fonction `done` ci-dessous s'y
    // réfère, et un rappel Google qui répondrait immédiatement la lirait sinon
    // avant son initialisation (erreur silencieuse, demande de jeton bloquée).
    let p;
    p = new Promise((resolve, reject) => {
      if (!ready()) { reject(new Error("Google Drive indisponible (identifiant manquant ou script Google bloqué).")); return; }
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId, scope: SCOPE, callback: () => {}
        });
      }
      let settled = false;
      const done = (err, tok) => {
        if (settled) return;
        settled = true;
        if (!interactive && tokenPromise === p) tokenPromise = null;
        if (err) reject(err); else resolve(tok);
      };
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) {
          accessToken = resp.access_token;
          // marge de 2 min pour renouveler avant l'expiration réelle
          tokenExpiry = Date.now() + Math.max(60, (Number(resp.expires_in) || 3600) - 120) * 1000;
          needsAuth = false; rememberSession();
          done(null, accessToken);
        } else { needsAuth = true; done(new Error("Autorisation Google refusée.")); }
      };
      tokenClient.error_callback = () => { needsAuth = true; done(new Error(interactive ? "Fenêtre Google fermée ou bloquée." : "Renouvellement silencieux impossible.")); };
      // Aucune demande ne doit rester en suspens : la fenêtre Google peut ne jamais
      // rendre la main (Safari), auquel cas on bascule sur la redirection.
      setTimeout(() => { if (!settled) { needsAuth = true; done(new Error(interactive ? "La fenêtre Google n'a pas répondu." : "Renouvellement silencieux sans réponse.")); } },
        interactive ? POPUP_TIMEOUT : SILENT_TIMEOUT);
      try {
        // Un clic explicite force l'affichage de la fenêtre Google : c'est le seul
        // moyen fiable de se ré-autoriser sur Safari.
        tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
      } catch (e) { needsAuth = true; done(e); }
    });
    if (!interactive) tokenPromise = p;
    return p;
  }

  // Garantit un jeton valide (renouvellement silencieux si expiré/proche de l'expiration).
  async function ensureToken(interactive) {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    if (!interactive && !hasSession()) throw new Error("Non connecté.");
    return await getToken(!!interactive);
  }

  // Reconnexion déclenchée par un clic : on repart d'un état propre.
  // Sur iOS/Safari on passe directement par la redirection (la pop-up n'aboutit pas).
  async function reconnect() {
    accessToken = null; tokenExpiry = 0; tokenPromise = null;
    if (isIOS()) { setStatus("redirection vers Google…"); startRedirectAuth(); return null; }
    try {
      await getToken(true);
    } catch (e) {
      // la fenêtre n'a pas abouti : on bascule sur la redirection pleine page
      setStatus("redirection vers Google…");
      startRedirectAuth();
      return null;
    }
    needsAuth = false;
    const f = await findFile();
    fileId = f ? f.id : null;
    lastModifiedTime = f ? f.modifiedTime : null;
    let remote = null;
    if (fileId) { try { remote = JSON.parse(await download(fileId)); } catch (e) { remote = null; } }
    setStatus("connecté");
    if (pending) { retries = 0; schedule(200); }
    return remote;
  }

  // Tout appel réseau est borné dans le temps : une requête qui reste en suspens
  // (réseau mobile capricieux) ne doit pas figer la synchronisation.
  const FETCH_TIMEOUT = 15000;
  async function api(url, opts, retried) {
    const o = opts || {};
    await ensureToken(false);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT) : null;
    let r;
    try {
      r = await fetch(url, Object.assign({}, o, {
        signal: ctrl ? ctrl.signal : undefined,
        headers: Object.assign({ Authorization: "Bearer " + accessToken }, o.headers || {})
      }));
    } finally { if (timer) clearTimeout(timer); }
    if ((r.status === 401 || r.status === 403) && !retried) {
      // jeton révoqué ou expiré côté Google : on en redemande un et on rejoue une fois
      accessToken = null; tokenExpiry = 0;
      await getToken(false);
      return api(url, opts, true);
    }
    if (!r.ok) {
      // On remonte le message de Google : c'est lui qui explique les cas
      // particuliers (« Calendar API has not been used… », portée manquante, etc.).
      let detail = "";
      try { const j = await r.clone().json(); detail = (j.error && (j.error.message || j.error.status)) || ""; } catch (e) {}
      const err = new Error(detail ? detail + " (HTTP " + r.status + ")" : "API Google " + r.status);
      err.status = r.status;
      err.detail = detail;
      throw err;
    }
    return r;
  }

  async function findFile() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)`);
    const j = await r.json();
    return (j.files && j.files[0]) ? j.files[0] : null;
  }

  // Crée un fichier de nom donné (data ou sauvegarde). Renvoie {id, modifiedTime}.
  async function createNamed(name, content, mime) {
    const type = mime || "application/json";
    const boundary = "op01" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: name, mimeType: type });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}` +
      `\r\n--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\n\r\n${content}` +
      `\r\n--${boundary}--`;
    const r = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body
    });
    return await r.json();
  }

  async function updateFile(id, content) {
    const r = await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=modifiedTime`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: content
    });
    return await r.json(); // { modifiedTime }
  }

  async function getMeta(id) {
    const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=modifiedTime`);
    return await r.json();
  }

  async function download(id) {
    return await (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text();
  }

  async function findByName(name) {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)`);
    const j = await r.json();
    return (j.files && j.files[0]) ? j.files[0] : null;
  }

  // Lit le fichier d'alertes mail (rempli par le script Apps Script).
  // Portée drive.file : l'app doit avoir créé le fichier pour le voir ; on le crée
  // vide s'il n'existe pas encore, afin que le script puisse ensuite le remplir.
  const MAILS_FILE = "operations01-mails.json";
  async function readMails() {
    if (!accessToken) return null;
    const f = await findByName(MAILS_FILE);
    if (!f) {
      try { await createNamed(MAILS_FILE, JSON.stringify({ updatedAt: 0, unread: [], relance: [], nouveau: [], rdvPrep: [] })); } catch (e) {}
      return null;
    }
    try { return JSON.parse(await download(f.id)); } catch (e) { return null; }
  }

  // ---- Agenda Google (lecture seule) -------------------------------------
  // Les occurrences des séries sont dépliées (singleEvents) pour que chaque
  // événement affiché dans Planning corresponde à une date réelle.
  async function listEvents(fromISO, toISO) {
    if (!hasSession()) return [];
    const p = new URLSearchParams({
      timeMin: fromISO,
      timeMax: toISO,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      fields: "items(id,summary,description,location,start,end,attendees(email,displayName,self,organizer,responseStatus),organizer(email,displayName,self),hangoutLink,htmlLink,status,eventType)"
    });
    const r = await api("https://www.googleapis.com/calendar/v3/calendars/primary/events?" + p.toString());
    const j = await r.json();
    return (j.items || []).filter((e) => e.status !== "cancelled");
  }

  async function deleteFile(id) {
    await api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: "DELETE" });
  }

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const stampStr = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // Liste les sauvegardes (backup + conflit), les plus récentes d'abord.
  async function listBackups() {
    if (!accessToken) return [];
    const q = encodeURIComponent(`(name contains '${BACKUP_PREFIX}' or name contains '${CONFLICT_PREFIX}') and trashed=false`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)`);
    const j = await r.json();
    return j.files || [];
  }

  // Supprime les sauvegardes quotidiennes au-delà des KEEP_BACKUPS plus récentes.
  async function pruneBackups() {
    try {
      const all = await listBackups();
      const daily = all.filter((f) => f.name.indexOf(BACKUP_PREFIX) === 0);
      const toDelete = daily.slice(KEEP_BACKUPS);
      for (const f of toDelete) { try { await deleteFile(f.id); } catch (e) {} }
    } catch (e) {}
  }

  // Crée une sauvegarde datée (une par jour max, sauf label explicite).
  async function dailyBackup(content) {
    try {
      const today = todayStr();
      if (localStorage.getItem(LAST_BACKUP_KEY) === today) return;
      await createNamed(BACKUP_PREFIX + today + ".json", content);
      localStorage.setItem(LAST_BACKUP_KEY, today);
      pruneBackups();
    } catch (e) {}
  }

  // Sauvegarde manuelle immédiate.
  async function backupNow(state) {
    if (!accessToken) throw new Error("Non connecté à Google Drive.");
    await createNamed(BACKUP_PREFIX + stampStr() + ".json", JSON.stringify(state));
  }

  // Restaure une sauvegarde : renvoie l'état parsé.
  async function restore(id) {
    if (!accessToken) throw new Error("Non connecté à Google Drive.");
    return JSON.parse(await download(id));
  }

  // Se connecter : demande le jeton, trouve (ou pas) le fichier et renvoie l'état distant (ou null).
  async function connect(silent) {
    // Première connexion sur iOS : redirection pleine page (pas de pop-up).
    if (!silent && isIOS() && !accessToken) { setStatus("redirection vers Google…"); startRedirectAuth(); return null; }
    setStatus(silent ? "reconnexion…" : "connexion…");
    await ensureToken(!silent);
    const f = await findFile();
    fileId = f ? f.id : null;
    lastModifiedTime = f ? f.modifiedTime : null;
    let remote = null;
    if (fileId) { try { remote = JSON.parse(await download(fileId)); } catch (e) { remote = null; } }
    setStatus("connecté");
    return remote;
  }

  // Reconnexion automatique au démarrage : silencieuse, sans fenêtre Google.
  // Renvoie l'état distant, ou null si l'utilisateur ne s'est jamais connecté.
  // Garde-fou global : quoi qu'il arrive, la reconnexion automatique se termine
  // et laisse l'utilisateur reprendre la main (statut + bouton « Reconnecter »).
  const AUTOCONNECT_TIMEOUT = 12000;
  async function autoConnect() {
    if (!hasSession()) return null;
    const guard = new Promise((_, rej) => setTimeout(() => rej(new Error("délai dépassé")), AUTOCONNECT_TIMEOUT));
    try { return await Promise.race([doAutoConnect(), guard]); }
    catch (e) { needsAuth = true; setStatus("reconnexion nécessaire"); return null; }
  }
  async function doAutoConnect() {
    if (!hasSession()) return null;
    // Retour de Google par redirection : le jeton est déjà en main, pas besoin de GIS.
    if (cameBackFromGoogle) {
      try {
        setStatus("connexion…");
        const f = await findFile();
        fileId = f ? f.id : null; lastModifiedTime = f ? f.modifiedTime : null;
        let remote = null;
        if (fileId) { try { remote = JSON.parse(await download(fileId)); } catch (e) { remote = null; } }
        setStatus("connecté");
        return remote;
      } catch (e) { needsAuth = true; setStatus("reconnexion nécessaire"); return null; }
    }
    // Script Google absent (bloqué par Safari, hors ligne…) : la redirection reste
    // possible, on demande donc simplement à l'utilisateur de se reconnecter.
    if (!ready()) { needsAuth = true; setStatus("reconnexion nécessaire"); return null; }
    try { return await connect(true); }
    catch (e) { needsAuth = true; setStatus("reconnexion nécessaire"); return null; }
  }

  // Enregistrer l'état sur Drive. L'état est mis en file : en cas d'échec
  // (jeton expiré, réseau coupé), on retente automatiquement avec un délai
  // croissant — rien n'est perdu, plus besoin de relancer l'application.
  function push(state) {
    pending = state;
    schedule(800);
  }
  function schedule(delay) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, delay);
  }
  async function flush() {
    if (!pending) return;
    if (!hasSession()) return;
    const content = JSON.stringify(pending);
    try {
      setStatus("sauvegarde…");
      if (!fileId) {
        const f = await findFile();                       // le fichier existe peut-être déjà
        if (f) { fileId = f.id; lastModifiedTime = f.modifiedTime; }
      }
      if (!fileId) {
        const f = await createNamed(FILE_NAME, content);
        fileId = f.id; lastModifiedTime = f.modifiedTime;
      } else {
        // Détection de conflit : le fichier distant a-t-il changé depuis notre dernière synchro ?
        try {
          const meta = await getMeta(fileId);
          if (lastModifiedTime && meta.modifiedTime && meta.modifiedTime !== lastModifiedTime) {
            // Un autre appareil a écrit : on sauvegarde la version distante avant d'écraser.
            setStatus("conflit détecté — sauvegarde du distant…");
            try { const remoteContent = await download(fileId); await createNamed(CONFLICT_PREFIX + stampStr() + ".json", remoteContent); } catch (e) {}
          }
        } catch (e) {}
        const res = await updateFile(fileId, content);
        lastModifiedTime = res && res.modifiedTime ? res.modifiedTime : lastModifiedTime;
      }
      if (pending && JSON.stringify(pending) === content) pending = null; // rien de neuf entre-temps
      retries = 0;
      dailyBackup(content);
      setStatus(pending ? "sauvegarde…" : "synchronisé");
      if (pending) schedule(300);
    } catch (e) {
      retries++;
      const delay = Math.min(60000, 2000 * Math.pow(2, Math.min(retries, 5)));
      setStatus(needsAuth ? "reconnexion nécessaire" : (navigator.onLine === false ? "hors ligne — reprise auto" : "reprise dans " + Math.round(delay / 1000) + " s"));
      schedule(delay);
    }
  }
  // Reprise immédiate quand la connexion revient ou quand on rouvre l'app.
  window.addEventListener("online", () => { retries = 0; if (pending) schedule(200); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !hasSession()) return;
    ensureToken(false).then(() => { if (pending) { retries = 0; schedule(200); } }).catch(() => {});
  });

  // --- Bibliothèque de documents (.md) : un fichier Drive par document ---
  // Stockés à part du fichier de données pour ne pas l'alourdir, mais bien
  // sur le Drive : ils suivent donc d'un appareil et d'un navigateur à l'autre.
  const DOC_PREFIX = "operations01-doc-";
  const PDF_PREFIX = "operations01-pdf-";
  async function listDocs(prefix) {
    const P = prefix || DOC_PREFIX;
    if (!hasSession()) return [];
    const q = encodeURIComponent(`name contains '${P}' and trashed=false`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&orderBy=name&pageSize=200&fields=files(id,name,size,modifiedTime)`);
    const j = await r.json();
    return (j.files || []).map((f) => ({
      id: f.id,
      name: String(f.name).indexOf(P) === 0 ? String(f.name).slice(P.length) : f.name,
      size: Number(f.size) || 0,
      modifiedTime: f.modifiedTime
    }));
  }
  async function uploadDoc(name, text) {
    const f = await createNamed(DOC_PREFIX + name, text, "text/markdown");
    return f.id;
  }
  const readDoc = (id) => download(id);
  const deleteDoc = (id) => deleteFile(id);

  // --- Fichiers binaires (PDF) : multipart avec contenu encodé en base64 ---
  function bytesToBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;   // par tranches, pour ne pas saturer la pile d'appels
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  async function uploadBinary(name, bytes, mime, prefix) {
    const type = mime || "application/pdf";
    const boundary = "op01" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: (prefix || PDF_PREFIX) + name, mimeType: type });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}` +
      `\r\n--${boundary}\r\nContent-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n\r\n${bytesToBase64(bytes)}` +
      `\r\n--${boundary}--`;
    const r = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body
    });
    return (await r.json()).id;
  }
  async function readBinary(id) {
    const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const listPdfs = () => listDocs(PDF_PREFIX);
  const uploadPdf = (name, bytes) => uploadBinary(name, bytes, "application/pdf", PDF_PREFIX);

  window.DriveSync = {
    ready,
    // La redirection ne dépend pas du script Google : un identifiant client suffit.
    configured: () => !!cfg.googleClientId,
    redirectAuth: startRedirectAuth,
    redirectURI,
    onStatus: (fn) => listeners.push(fn),
    connect,
    push,
    // « connecté » au sens de l'app : une session existe, même si le jeton
    // est momentanément expiré (il sera renouvelé silencieusement).
    isConnected: () => !!accessToken || hasSession(),
    needsAuth: () => needsAuth,
    hasPending: () => !!pending,
    autoConnect,
    reconnect,
    listBackups,
    restore,
    backupNow,
    readMails,
    listEvents,
    listDocs,
    uploadDoc,
    readDoc,
    deleteDoc,
    listPdfs,
    uploadPdf,
    readBinary
  };
})();
