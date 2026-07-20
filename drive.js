/* Sauvegarde des données sur Google Drive (fichier operations01-data.json).
   Utilise Google Identity Services (jeton d'accès) + l'API Drive REST via fetch.
   Portée demandée : drive.file (l'app n'accède qu'au fichier qu'elle crée).
   Le localStorage reste le cache local (hors ligne) ; Drive est la copie durable. */
(function () {
  const cfg = window.OPERATIONS01_CONFIG || {};
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const FILE_NAME = cfg.driveFileName || "operations01-data.json";

  let tokenClient = null;
  let accessToken = null;
  let fileId = null;
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
    return (j.files && j.files[0]) ? j.files[0].id : null;
  }

  async function createFile(content) {
    const boundary = "op01" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name: FILE_NAME, mimeType: "application/json" });
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}` +
      `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}` +
      `\r\n--${boundary}--`;
    const r = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { "Content-Type": "multipart/related; boundary=" + boundary },
      body
    });
    return (await r.json()).id;
  }

  async function updateFile(id, content) {
    await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: content
    });
  }

  async function download(id) {
    return await (await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text();
  }

  // Se connecter : demande le jeton, trouve (ou pas) le fichier et renvoie l'état distant (ou null).
  async function connect() {
    setStatus("connexion…");
    await getToken();
    fileId = await findFile();
    let remote = null;
    if (fileId) { try { remote = JSON.parse(await download(fileId)); } catch (e) { remote = null; } }
    setStatus("connecté");
    return remote;
  }

  // Enregistrer l'état sur Drive (débrouillé, différé de 0,8 s pour regrouper les saisies).
  function push(state) {
    if (!accessToken) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        setStatus("sauvegarde…");
        const content = JSON.stringify(state);
        if (!fileId) fileId = await createFile(content);
        else await updateFile(fileId, content);
        setStatus("synchronisé");
      } catch (e) { setStatus("erreur de synchronisation"); }
    }, 800);
  }

  window.DriveSync = {
    ready,
    onStatus: (fn) => listeners.push(fn),
    connect,
    push,
    isConnected: () => !!accessToken
  };
})();
