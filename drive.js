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
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const FILE_NAME = cfg.driveFileName || "operations01-data.json";
  const BACKUP_PREFIX = "operations01-backup-";
  const CONFLICT_PREFIX = "operations01-conflit-";
  const KEEP_BACKUPS = 14;
  const LAST_BACKUP_KEY = "op01_lastBackupDate";

  let tokenClient = null;
  let accessToken = null;
  let fileId = null;
  let lastModifiedTime = null; // modifiedTime Drive connu après notre dernière lecture/écriture
  let pushTimer = null;
  const listeners = [];
  const setStatus = (s) => listeners.forEach((fn) => fn(s));

  function ready() {
    return !!cfg.googleClientId && window.google && google.accounts && google.accounts.oauth2;
  }

  function getToken() {
    return new Promise((resolve, reject) => {
      if (!ready()) { reject(new Error("Google Drive indisponible (identifiant manquant ou script Google bloqué).")); return; }
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId, scope: SCOPE, callback: () => {}
        });
      }
      tokenClient.callback = (resp) => {
        if (resp && resp.access_token) { accessToken = resp.access_token; resolve(accessToken); }
        else reject(new Error("Autorisation Google refusée."));
      };
      tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
    });
  }

  async function api(url, opts) {
    const o = opts || {};
    const r = await fetch(url, Object.assign({}, o, {
      headers: Object.assign({ Authorization: "Bearer " + accessToken }, o.headers || {})
    }));
    if (!r.ok) throw new Error("Drive API " + r.status);
    return r;
  }

  async function findFile() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,modifiedTime)`);
    const j = await r.json();
    return (j.files && j.files[0]) ? j.files[0] : null;
  }

  // Crée un fichier de nom donné (data ou sauvegarde). Renvoie {id, modifiedTime}.
  async function createNamed(name, content) {
    const boundary = "op01" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: name, mimeType: "application/json" });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}` +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}` +
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
  async function connect() {
    setStatus("connexion…");
    await getToken();
    const f = await findFile();
    fileId = f ? f.id : null;
    lastModifiedTime = f ? f.modifiedTime : null;
    let remote = null;
    if (fileId) { try { remote = JSON.parse(await download(fileId)); } catch (e) { remote = null; } }
    setStatus("connecté");
    return remote;
  }

  // Enregistrer l'état sur Drive (différé de 0,8 s pour regrouper les saisies).
  function push(state) {
    if (!accessToken) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        setStatus("sauvegarde…");
        const content = JSON.stringify(state);
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
        dailyBackup(content);
        setStatus("synchronisé");
      } catch (e) { setStatus("erreur de synchronisation"); }
    }, 800);
  }

  window.DriveSync = {
    ready,
    onStatus: (fn) => listeners.push(fn),
    connect,
    push,
    isConnected: () => !!accessToken,
    listBackups,
    restore,
    backupNow,
    readMails
  };
})();
