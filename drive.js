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
  // Portée de base : l'app n'accède qu'aux fichiers qu'elle crée.
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  // Portée facultative, demandée seulement si l'utilisateur relie son agenda.
  // Elle n'est JAMAIS ajoutée d'office : sinon la session existante (qui ne porte
  // que drive.file) deviendrait insuffisante et Google redemanderait sans cesse
  // l'autorisation au lancement.
  const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
  const CAL_KEY = "op01_calendarScope";
  const calGranted = () => { try { return localStorage.getItem(CAL_KEY) === "1"; } catch (e) { return false; } };
  // Portée facultative : lecture des mails (jamais d'envoi, de déplacement ni de
  // suppression), demandée seulement si l'utilisateur relie sa boîte Gmail.
  const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const GMAIL_KEY = "op01_gmailScope";
  const gmailGranted = () => { try { return localStorage.getItem(GMAIL_KEY) === "1"; } catch (e) { return false; } };
  const askedScope = () => [SCOPE, calGranted() ? CAL_SCOPE : "", gmailGranted() ? GMAIL_SCOPE : ""].filter(Boolean).join(" ");
  const FILE_NAME = cfg.driveFileName || "operations01-data.json";
  const BACKUP_PREFIX = "operations01-backup-";
  const CONFLICT_PREFIX = "operations01-conflit-";
  const KEEP_BACKUPS = 14;
  const LAST_BACKUP_KEY = "op01_lastBackupDate";

  const SESSION_KEY = "op01_driveSession"; // mémorise qu'on a déjà autorisé l'app

  let tokenClient = null;
  let tokenClientScope = null;  // portée avec laquelle tokenClient a été créé
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

  // --- Jeton mémorisé sur l'appareil ---
  // Un jeton Google vaut une heure. Le garder sur l'appareil évite de redemander
  // quoi que ce soit à chaque réouverture de l'app : on passe du MacBook au
  // téléphone et retour sans coupure. Portée drive.file : il ne donne accès
  // qu'aux fichiers de l'app. `hint` est l'adresse du compte Google, pour que
  // les renouvellements ne demandent jamais de choisir un compte.
  const TOKEN_KEY = "op01_driveToken";
  let loginHint = null;
  function adoptToken(tok, expiresIn, scope) {
    accessToken = tok;
    // marge de 2 min pour renouveler avant l'expiration réelle
    tokenExpiry = Date.now() + Math.max(60, (Number(expiresIn) || 3600) - 120) * 1000;
    needsAuth = false; rememberSession();
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: tok, exp: tokenExpiry, scope: scope || askedScope(), hint: loginHint })); } catch (e) {}
  }
  function dropToken() {
    accessToken = null; tokenExpiry = 0;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ hint: loginHint })); } catch (e) {}
  }
  const scopeCovers = (s) => askedScope().split(" ").every((x) => String(s || "").split(" ").indexOf(x) !== -1);
  (function restoreToken() {
    try {
      const j = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (!j) return;
      loginHint = j.hint || null;
      if (j.t && j.exp > Date.now() + 30000 && scopeCovers(j.scope)) { accessToken = j.t; tokenExpiry = j.exp; }
    } catch (e) {}
  })();

  // --- Autorisation par redirection pleine page (indispensable sur iOS/Safari) ---
  // Safari isole le stockage tiers : la fenêtre surgissante de Google s'ouvre mais
  // ne rend jamais la main. On quitte donc l'app vers Google, qui nous renvoie
  // ensuite avec le jeton dans le fragment d'URL. Aucune pop-up n'est impliquée.
  // En mode silencieux (prompt=none), Google renvoie le jeton sans rien afficher
  // tant que la session Google de l'appareil est ouverte : c'est le renouvellement
  // « invisible » sur Safari, où le renouvellement en arrière-plan est bloqué.
  const STATE_KEY = "op01_oauth_state";
  const MAIL_FAIL_KEY = "op01_mailSilentFail";      // dernier refus silencieux pour une boîte supplémentaire
  let mailBack = null;                              // retour de Google pour une boîte supplémentaire
  const SILENT_AT_KEY = "op01_silentAuthAt";      // dernière tentative silencieuse (anti-boucle)
  const SILENT_FAIL_KEY = "op01_silentAuthFail";  // dernier refus de Google en silencieux
  const SILENT_RETRY = 10 * 60000;                // pas deux tentatives silencieuses en moins de 10 min
  const SILENT_FAIL_COOLDOWN = 60 * 60000;        // après un refus, on laisse la main à l'utilisateur 1 h
  const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  function redirectURI() {
    if (typeof location === "undefined") return "";
    return location.origin + location.pathname.replace(/index\.html$/, "");
  }
  let redirecting = false;
  const beforeRedirect = [];
  function startRedirectAuth(silent) {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36) + (silent ? ".s" : "");
    try { localStorage.setItem(STATE_KEY, nonce); if (silent) localStorage.setItem(SILENT_AT_KEY, String(Date.now())); } catch (e) {}
    const p = new URLSearchParams({
      client_id: cfg.googleClientId,
      redirect_uri: redirectURI(),
      response_type: "token",
      scope: askedScope(),
      include_granted_scopes: "true",
      state: nonce,
      prompt: silent ? "none" : "consent"
    });
    if (loginHint) p.set("login_hint", loginHint);
    redirecting = true;
    // Si la page ne part pas (navigation bloquée), on ne reste pas figé sur cet état.
    setTimeout(() => { redirecting = false; }, 20000);
    beforeRedirect.forEach((fn) => { try { fn(); } catch (e) {} });
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
  }
  // Au chargement : récupère le jeton renvoyé par Google, s'il y en a un.
  let redirectError = null;
  function consumeRedirectToken() {
    if (typeof location === "undefined") return false;
    if (!location.hash || (location.hash.indexOf("access_token=") === -1 && location.hash.indexOf("error=") === -1)) return false;
    const p = new URLSearchParams(location.hash.replace(/^#/, ""));
    const tok = p.get("access_token");
    let saved = null;
    try { saved = localStorage.getItem(STATE_KEY); localStorage.removeItem(STATE_KEY); } catch (e) {}
    if (saved && p.get("state") !== saved) return false;
    const st = p.get("state") || "";
    const silent = /\.s$/.test(st);
    const clean = () => { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { location.hash = ""; } };
    // Retour d'une autorisation pour une boîte Gmail supplémentaire (« .m » / « .ms ») :
    // le jeton n'est PAS celui de la session principale. L'adresse de la boîte est
    // demandée à Gmail juste après (voir mailLinkPending).
    if (/\.ms?$/.test(st)) {
      mailBack = { tok, expiresIn: p.get("expires_in"), silent: /\.ms$/.test(st), error: tok ? null : (p.get("error") || "refus") };
      if (!tok && mailBack.silent) { try { localStorage.setItem(MAIL_FAIL_KEY, String(Date.now())); } catch (e) {} }
      clean();
      return false;
    }
    if (!tok) {
      // Google a refusé (session fermée, plusieurs comptes…) : en silencieux on
      // n'insiste pas pendant une heure, l'utilisateur reprend la main.
      redirectError = p.get("error") || "refus";
      if (silent) { try { localStorage.setItem(SILENT_FAIL_KEY, String(Date.now())); } catch (e) {} }
      needsAuth = true; clean();
      return false;
    }
    adoptToken(tok, p.get("expires_in"), p.get("scope") || askedScope());
    try { localStorage.removeItem(SILENT_FAIL_KEY); } catch (e) {}
    clean();
    return true;
  }
  const cameBackFromGoogle = consumeRedirectToken();
  function canSilentRedirect() {
    if (!hasSession() || typeof location === "undefined" || !cfg.googleClientId) return false;
    let at = 0, fail = 0;
    try { at = Number(localStorage.getItem(SILENT_AT_KEY)) || 0; fail = Number(localStorage.getItem(SILENT_FAIL_KEY)) || 0; } catch (e) {}
    const now = Date.now();
    return now - at > SILENT_RETRY && now - fail > SILENT_FAIL_COOLDOWN;
  }
  // L'app dit si c'est le bon moment pour recharger la page (pas de saisie en
  // cours, pas de fenêtre ouverte). Sinon on réessaie un peu plus tard.
  let silentGate = () => true;
  let silentTimer = null;
  let silentPending = false;   // redirection silencieuse décidée, en attente d'un moment calme
  const authInProgress = () => redirecting || silentPending;
  function requestSilentAuth() {
    if (redirecting) return true;
    if (!canSilentRedirect()) { silentPending = false; needsAuth = true; setStatus("reconnexion nécessaire"); return false; }
    if (silentGate()) { silentPending = false; setStatus("reconnexion…"); startRedirectAuth(true); return true; }
    silentPending = true;
    clearTimeout(silentTimer); silentTimer = setTimeout(requestSilentAuth, 15000);
    setStatus("reconnexion…");
    return true;
  }

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
      // La portée peut changer en cours de session (agenda relié) : dans ce cas
      // le client de jeton doit être reconstruit, sinon Google redonne un jeton
      // avec l'ancienne portée.
      if (!tokenClient || tokenClientScope !== askedScope()) {
        tokenClientScope = askedScope();
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: cfg.googleClientId, scope: tokenClientScope, callback: () => {}
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
          adoptToken(resp.access_token, resp.expires_in, resp.scope || tokenClientScope);
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
        const req = { prompt: interactive ? "consent" : "" };
        if (loginHint) req.hint = loginHint;   // pas de choix de compte au renouvellement
        tokenClient.requestAccessToken(req);
      } catch (e) { needsAuth = true; done(e); }
    });
    if (!interactive) tokenPromise = p;
    return p;
  }

  // Renouvellement sans intervention : d'abord en arrière-plan (fonctionne sur
  // Chrome), sinon par redirection silencieuse (Safari, iPhone). Sur iOS on va
  // directement à la redirection : la demande en arrière-plan y reste sans réponse.
  async function silentRenew(force) {
    if (!force && accessToken && Date.now() < tokenExpiry) return accessToken;
    if (!hasSession()) throw new Error("Non connecté.");
    if (!isIOS() && ready()) {
      try { return await getToken(false); } catch (e) { /* on passe à la redirection */ }
    }
    if (requestSilentAuth()) throw new Error("Renouvellement en cours.");
    throw new Error("Reconnexion nécessaire.");
  }

  // Garantit un jeton valide (renouvellement silencieux si expiré/proche de l'expiration).
  async function ensureToken(interactive) {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    if (!interactive) return await silentRenew();
    return await getToken(true);
  }
  // Renouvellement anticipé : quelques minutes avant l'expiration, pendant que
  // tout marche encore, plutôt qu'au moment où une sauvegarde échoue.
  const RENEW_AHEAD = 4 * 60000;
  setInterval(() => {
    if (!hasSession() || !accessToken || redirecting) return;
    if (tokenExpiry - Date.now() < RENEW_AHEAD) silentRenew(true).catch(() => {});
  }, 60000);

  // Reconnexion déclenchée par un clic : on repart d'un état propre.
  // Sur iOS/Safari on passe directement par la redirection (la pop-up n'aboutit pas).
  async function reconnect() {
    dropToken(); tokenPromise = null;
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
    const remote = await readRemote();
    setStatus("connecté");
    if (pending) { retries = 0; schedule(200); }
    return remote;
  }

  // Lit l'état distant. Renvoie null seulement s'il n'y a PAS de fichier ;
  // si le fichier existe mais ne peut pas être lu, on lève une erreur : le
  // distant reste « inconnu » et rien ne doit l'écraser à l'aveugle.
  async function readRemote() {
    await discoverHint();
    const f = await findFile();
    fileId = f ? f.id : null;
    lastModifiedTime = null;
    if (!fileId) return null;
    let remote;
    try { remote = JSON.parse(await download(fileId)); }
    catch (e) { throw new Error("Lecture du fichier Drive impossible : " + (e && e.message ? e.message : e)); }
    lastModifiedTime = f.modifiedTime;
    return remote;
  }

  // Tout appel réseau est borné dans le temps : une requête qui reste en suspens
  // (réseau mobile capricieux) ne doit pas figer la synchronisation.
  const FETCH_TIMEOUT = 15000;
  // `tokenOverride` : jeton d'une boîte Gmail supplémentaire (voir plus bas) ; dans
  // ce cas un refus d'authentification n'est pas rejoué, il est signalé (« reauth »).
  async function api(url, opts, retried, tokenOverride) {
    const o = opts || {};
    const tok = tokenOverride || await ensureToken(false);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, FETCH_TIMEOUT) : null;
    let r;
    try {
      r = await fetch(url, Object.assign({}, o, {
        signal: ctrl ? ctrl.signal : undefined,
        headers: Object.assign({ Authorization: "Bearer " + tok }, o.headers || {})
      }));
    } finally { if (timer) clearTimeout(timer); }
    // Un 403 n'est pas forcément un problème de jeton : « API non activée »,
    // « quota dépassé »… Jeter le jeton dans ces cas-là relance une autorisation
    // Google à chaque appel, en boucle. On ne rejoue que sur un vrai refus
    // d'authentification.
    let authProblem = r.status === 401;
    if (r.status === 403 && !authProblem) {
      try {
        const j = await r.clone().json();
        const m = (j.error && (j.error.message || "")) || "";
        authProblem = /insufficient authentication scopes|invalid credentials|invalid_token|access token/i.test(m);
      } catch (e) {}
    }
    if (authProblem && tokenOverride) {
      const err = new Error("Autorisation de cette boîte à renouveler."); err.code = "reauth"; err.status = r.status; throw err;
    }
    if (authProblem && !retried) {
      // jeton révoqué ou expiré côté Google : on en redemande un et on rejoue une fois
      dropToken();
      await silentRenew();
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

  // Adresse du compte Google (une fois par appareil) : sert d'indice à Google
  // pour renouveler le jeton sans jamais demander de choisir un compte.
  async function discoverHint() {
    if (loginHint || !accessToken) return;
    try {
      const r = await api("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)");
      const j = await r.json();
      const mail = j && j.user && j.user.emailAddress;
      if (mail) { loginHint = mail; adoptToken(accessToken, Math.round((tokenExpiry - Date.now()) / 1000) + 120, tokenClientScope); }
    } catch (e) {}
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
  const EMPTY_MAILS = () => JSON.stringify({ updatedAt: 0, unread: [], relance: [], nouveau: [], rdvPrep: [], threads: [] });
  async function readMails() { return readMailbox(MAILS_FILE); }

  // Chaque boîte mail a son propre fichier d'analyse, rempli par le script
  // Apps Script installé dans le compte correspondant. L'app crée le fichier
  // (portée drive.file), puis le partage avec ce compte pour qu'il puisse y écrire.
  async function readMailbox(fileName) {
    if (!accessToken) return null;
    const f = await findByName(fileName);
    if (!f) {
      try { await createNamed(fileName, EMPTY_MAILS()); } catch (e) {}
      return null;
    }
    try { const j = JSON.parse(await download(f.id)); j._fileId = f.id; return j; } catch (e) { return null; }
  }
  // Crée le fichier d'une boîte (s'il n'existe pas) et renvoie son identifiant.
  async function ensureMailbox(fileName) {
    const f = await findByName(fileName);
    if (f) return f.id;
    const made = await createNamed(fileName, EMPTY_MAILS());
    return made.id;
  }
  // Partage un fichier créé par l'app avec un autre compte (en écriture), sans
  // e-mail de notification : c'est l'utilisateur lui-même, sur un autre compte.
  async function shareFile(id, email, role) {
    await api(`https://www.googleapis.com/drive/v3/files/${id}/permissions?sendNotificationEmail=false&fields=id`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: role || "writer", type: "user", emailAddress: email })
    });
  }
  // Identifiant du fichier de données (pour le partager en lecture avec une
  // autre boîte : son script peut alors connaître les contacts).
  async function dataFileId() {
    if (fileId) return fileId;
    const f = await findFile();
    return f ? f.id : null;
  }

  // ---- Événements à traiter (pipeline « assistants » du Mac mini) ----------
  // Même mécanisme que les mails : l'app crée le fichier (portée drive.file),
  // et c'est le script relais Apps Script (appsscript-relais-evenements.gs)
  // qui y fusionne les événements reçus en POST depuis le Mac mini.
  const EVENTS_FILE = "operations01-evenements.json";
  const EMPTY_EVENTS = () => JSON.stringify({ updatedAt: 0, evenements: [] });
  async function ensureEvenements() {
    const f = await findByName(EVENTS_FILE);
    if (f) return f.id;
    const made = await createNamed(EVENTS_FILE, EMPTY_EVENTS());
    return made.id;
  }
  async function readEvenements() {
    if (!accessToken) return null;
    const f = await findByName(EVENTS_FILE);
    if (!f) {
      try { await createNamed(EVENTS_FILE, EMPTY_EVENTS()); } catch (e) {}
      return null;
    }
    try { const j = JSON.parse(await download(f.id)); j._fileId = f.id; j._modifiedTime = f.modifiedTime; return j; } catch (e) { return null; }
  }
  // Réécrit le fichier. L'appelant le relit juste avant, pour ne pas écraser un
  // ajout du relais survenu entre-temps.
  async function writeEvenements(id, data) {
    const copy = Object.assign({}, data); delete copy._fileId; delete copy._modifiedTime;
    return updateFile(id, JSON.stringify(copy));
  }
  // Date de dernière modification d'un fichier (pour vérifier, juste avant
  // d'écrire, que personne n'a écrit depuis notre lecture).
  async function fileModifiedTime(id) { const m = await getMeta(id); return (m && m.modifiedTime) || null; }

  // ---- Assistant (brief du matin, estimations de durée) ---------------------
  // Même mécanisme : fichier créé par l'app, rempli par le relais.
  const ASSISTANT_FILE = "operations01-assistant.json";
  const EMPTY_ASSISTANT = () => JSON.stringify({ updatedAt: 0, brief: null, estimations: {} });
  async function readAssistant() {
    if (!accessToken) return null;
    const f = await findByName(ASSISTANT_FILE);
    if (!f) {
      try { await createNamed(ASSISTANT_FILE, EMPTY_ASSISTANT()); } catch (e) {}
      return null;
    }
    try { const j = JSON.parse(await download(f.id)); j._fileId = f.id; return j; } catch (e) { return null; }
  }
  async function writeAssistant(id, data) {
    const copy = Object.assign({}, data); delete copy._fileId;
    return updateFile(id, JSON.stringify(copy));
  }
  // Banque : relevés et factures lus sur le Drive par le script « Operations01 banque ».
  // Fichier créé par l'app (vide) ; le script le remplit à chaque passage.
  const BANQUE_FILE = "operations01-banque.json";
  const EMPTY_BANQUE = () => JSON.stringify({ updatedAt: 0, version: 0, releves: [], factures: [], erreurs: [] });
  async function readBanque() {
    if (!accessToken) return null;
    const f = await findByName(BANQUE_FILE);
    if (!f) {
      try { await createNamed(BANQUE_FILE, EMPTY_BANQUE()); } catch (e) {}
      return { updatedAt: 0, version: 0, releves: [], factures: [], erreurs: [], _fresh: true };
    }
    try { const j = JSON.parse(await download(f.id)); j._fileId = f.id; j._modifiedTime = f.modifiedTime; return j; } catch (e) { return null; }
  }

  // ---- Agenda Google (lecture seule) -------------------------------------
  // Les occurrences des séries sont dépliées (singleEvents) pour que chaque
  // événement affiché dans Planning corresponde à une date réelle.
  // Relie l'agenda : demande explicite de l'utilisateur, jamais au lancement.
  // On repart d'un jeton neuf, car l'ancien ne porte que drive.file.
  async function enableCalendar() {
    try { localStorage.setItem(CAL_KEY, "1"); } catch (e) {}
    dropToken(); tokenPromise = null; tokenClient = null; tokenClientScope = null;
    if (isIOS()) { setStatus("redirection vers Google…"); startRedirectAuth(); return null; }
    try { await getToken(true); return true; }
    catch (e) { disableCalendar(); throw e; }
  }
  function disableCalendar() {
    try { localStorage.removeItem(CAL_KEY); } catch (e) {}
    tokenClient = null; tokenClientScope = null;
  }

  // ---- Gmail (lecture seule) ---------------------------------------------
  // Relie la boîte : demande explicite de l'utilisateur, jamais au lancement.
  async function enableGmail() {
    try { localStorage.setItem(GMAIL_KEY, "1"); } catch (e) {}
    dropToken(); tokenPromise = null; tokenClient = null; tokenClientScope = null;
    if (isIOS()) { setStatus("redirection vers Google…"); startRedirectAuth(); return null; }
    try { await getToken(true); return true; }
    catch (e) { disableGmail(); throw e; }
  }
  function disableGmail() {
    try { localStorage.removeItem(GMAIL_KEY); } catch (e) {}
    tokenClient = null; tokenClientScope = null;
  }
  // Corps des messages : base64url → octets → texte selon le jeu de caractères de la partie.
  function b64urlBytes(s) {
    s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const bin = atob(s); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const b64std = (s) => { s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return s; };
  function decodeText(bytes, charset) {
    try { return new TextDecoder(charset || "utf-8").decode(bytes); }
    catch (e) { return new TextDecoder("utf-8").decode(bytes); }
  }
  function headerOf(headers, name) {
    const h = (headers || []).find((x) => x && x.name && x.name.toLowerCase() === String(name).toLowerCase());
    return h ? String(h.value || "") : "";
  }
  function partCharset(part) {
    const m = /charset="?([\w.:-]+)"?/i.exec(headerOf(part.headers, "Content-Type"));
    return m ? m[1].toLowerCase() : "utf-8";
  }
  // Parcourt les parties MIME : premier texte HTML, premier texte brut, pièces jointes
  // (avec leur Content-ID pour les images intégrées).
  function walkParts(payload, out) {
    if (!payload) return;
    const mime = String(payload.mimeType || "").toLowerCase();
    if (payload.parts && payload.parts.length) { payload.parts.forEach((p) => walkParts(p, out)); return; }
    const body = payload.body || {}, fname = payload.filename || "";
    if (fname || (body.attachmentId && !/^text\//.test(mime))) {
      out.attachments.push({ id: body.attachmentId || "", name: fname || "pièce jointe", size: Number(body.size) || 0, mime, cid: headerOf(payload.headers, "Content-ID").replace(/^<|>$/g, "") });
      return;
    }
    if (!body.data) return;
    const text = decodeText(b64urlBytes(body.data), partCharset(payload));
    if (mime === "text/html") { if (!out.html) out.html = text; }
    else if (mime === "text/plain" || !mime) { if (!out.text) out.text = text; }
  }
  // ---- Boîtes Gmail supplémentaires ----
  // La session principale (Drive, agenda, Gmail) est celle du compte de l'app.
  // Pour lire les mails des autres comptes (Icarus, Majandco, Gmail perso), un jeton
  // Gmail lecture seule est demandé par boîte, avec choix de compte explicite, et
  // mémorisé sur l'appareil comme le jeton principal. { adresse: { t, exp } }
  const GMAIL_ACCOUNTS_KEY = "op01_gmailAccounts";
  let gmailAccounts = (() => { try { return JSON.parse(localStorage.getItem(GMAIL_ACCOUNTS_KEY) || "{}") || {}; } catch (e) { return {}; } })();
  const saveGmailAccounts = () => { try { localStorage.setItem(GMAIL_ACCOUNTS_KEY, JSON.stringify(gmailAccounts)); } catch (e) {} };
  const gmailAccountList = () => Object.keys(gmailAccounts);
  const gmailAccountValid = (email) => { const a = gmailAccounts[email]; return !!(a && a.t && a.exp > Date.now()); };
  function removeGmailAccount(email) { delete gmailAccounts[email]; saveGmailAccounts(); }
  function setGmailAccountToken(email, tok, expiresIn) {
    gmailAccounts[email] = { t: tok, exp: Date.now() + Math.max(60, (Number(expiresIn) || 3600) - 120) * 1000 };
    saveGmailAccounts();
  }
  async function gmailProfile(tok) {
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: "Bearer " + tok } });
    if (!r.ok) throw new Error("Profil Gmail illisible (HTTP " + r.status + ")");
    const j = await r.json();
    return String(j.emailAddress || "").toLowerCase();
  }
  // Jeton d'une boîte via le script Google (ordinateur). interactive = ajout ou
  // reconnexion (fenêtre Google, doit partir d'un clic) ; sinon renouvellement discret.
  function requestMailToken(hint, interactive) {
    return new Promise((resolve, reject) => {
      if (!ready()) { reject(new Error("Script Google indisponible.")); return; }
      let settled = false;
      const done = (err, resp) => { if (settled) return; settled = true; if (err) reject(err); else resolve(resp); };
      const client = google.accounts.oauth2.initTokenClient({ client_id: cfg.googleClientId, scope: GMAIL_SCOPE, callback: () => {} });
      client.callback = (resp) => { if (resp && resp.access_token) done(null, resp); else done(new Error("Autorisation Google refusée.")); };
      client.error_callback = () => done(new Error(interactive ? "Fenêtre Google fermée ou bloquée." : "Renouvellement silencieux impossible."));
      setTimeout(() => done(new Error(interactive ? "La fenêtre Google n'a pas répondu." : "Renouvellement silencieux sans réponse.")), interactive ? POPUP_TIMEOUT : SILENT_TIMEOUT);
      const req = { prompt: interactive ? (hint ? "consent" : "select_account consent") : "" };
      if (hint) req.hint = hint;
      try { client.requestAccessToken(req); } catch (e) { done(e); }
    });
  }
  // Redirection pleine page (iOS) : état marqué « .m » (ajout / reconnexion) ou « .ms » (renouvellement invisible).
  function startMailRedirect(hint, silent) {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36) + (silent ? ".ms" : ".m");
    try { localStorage.setItem(STATE_KEY, nonce); if (silent) localStorage.setItem(SILENT_AT_KEY, String(Date.now())); } catch (e) {}
    const p = new URLSearchParams({ client_id: cfg.googleClientId, redirect_uri: redirectURI(), response_type: "token", scope: GMAIL_SCOPE, state: nonce,
      prompt: silent ? "none" : (hint ? "consent" : "select_account consent") });
    if (hint) p.set("login_hint", hint);
    redirecting = true;
    setTimeout(() => { redirecting = false; }, 20000);
    beforeRedirect.forEach((fn) => { try { fn(); } catch (e) {} });
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + p.toString());
  }
  // Ajoute (ou reconnecte) une boîte : clic de l'utilisateur. Renvoie l'adresse
  // reliée, ou null quand une redirection est en cours (iOS).
  async function addGmailAccount(hint) {
    if (isIOS()) { setStatus("redirection vers Google…"); startMailRedirect(hint || null, false); return null; }
    const resp = await requestMailToken(hint || null, true);
    const email = await gmailProfile(resp.access_token);
    setGmailAccountToken(email, resp.access_token, resp.expires_in);
    return email;
  }
  // Retour de redirection pour une boîte : l'adresse est lue dans Gmail, le jeton rangé.
  const mailLinkPending = (mailBack && mailBack.tok)
    ? gmailProfile(mailBack.tok).then((email) => { setGmailAccountToken(email, mailBack.tok, mailBack.expiresIn); return email; }).catch(() => null)
    : Promise.resolve(null);
  function canMailSilentRedirect() {
    let at = 0, fail = 0;
    try { at = Number(localStorage.getItem(SILENT_AT_KEY)) || 0; fail = Number(localStorage.getItem(MAIL_FAIL_KEY)) || 0; } catch (e) {}
    const now = Date.now();
    return !redirecting && now - at > SILENT_RETRY && now - fail > SILENT_FAIL_COOLDOWN;
  }
  // Jeton valable pour une boîte, renouvelé discrètement si possible ; sinon erreur
  // « reauth » (bouton « Reconnecter la boîte ») ou « renewing » (redirection partie).
  async function gmailTokenFor(email) {
    if (gmailAccountValid(email)) return gmailAccounts[email].t;
    if (!gmailAccounts[email]) { const e = new Error("Boîte non reliée."); e.code = "off"; throw e; }
    if (!isIOS() && ready()) {
      try { const resp = await requestMailToken(email, false); setGmailAccountToken(email, resp.access_token, resp.expires_in); return resp.access_token; }
      catch (e) { /* on passe au bouton */ }
    } else if (isIOS() && canMailSilentRedirect() && silentGate()) {
      startMailRedirect(email, true);
      const e = new Error("Renouvellement en cours."); e.code = "renewing"; throw e;
    }
    const e = new Error("Autorisation de la boîte " + email + " à renouveler."); e.code = "reauth"; throw e;
  }
  // Lit un message par son Message-ID (celui que le Mac mini transmet dans external_id).
  // `email` : boîte supplémentaire ; sans lui, la boîte du compte principal.
  async function readMail(externalId, email) {
    if (!hasSession()) throw new Error("Non connecté.");
    let tok = null;
    if (email) { tok = await gmailTokenFor(email); }
    else if (!gmailGranted()) { const e = new Error("Gmail non relié."); e.code = "off"; throw e; }
    const id = String(externalId || "").trim().replace(/^<|>$/g, "");
    if (!id) { const e = new Error("Message sans identifiant."); e.code = "notfound"; throw e; }
    const q = encodeURIComponent("rfc822msgid:" + id);
    let r;
    try { r = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=1`, null, false, tok); }
    catch (e) { if (e.code === "reauth" && email) { gmailAccounts[email].exp = 0; saveGmailAccounts(); } throw e; }
    const j = await r.json();
    const m = j && j.messages && j.messages[0];
    if (!m) { const e = new Error("Message introuvable dans cette boîte."); e.code = "notfound"; throw e; }
    const r2 = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`, null, false, tok);
    const msg = await r2.json();
    const out = { id: msg.id, threadId: msg.threadId, html: "", text: "", attachments: [], headers: {}, labels: msg.labelIds || [], account: email || loginHint || "" };
    ["From", "To", "Cc", "Date", "Subject"].forEach((h) => { out.headers[h.toLowerCase()] = headerOf(msg.payload && msg.payload.headers, h); });
    walkParts(msg.payload, out);
    return out;
  }
  // Recherche Gmail (même syntaxe que la barre de recherche Gmail), avec les pièces
  // jointes de chaque message. Sert à retrouver les justificatifs des opérations bancaires.
  async function searchMails(q, max, email) {
    if (!hasSession()) throw new Error("Non connecté.");
    let tok = null;
    if (email) tok = await gmailTokenFor(email);
    else if (!gmailGranted()) { const e = new Error("Gmail non relié."); e.code = "off"; throw e; }
    const n = Math.max(1, Math.min(20, Number(max) || 8));
    const r = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${n}`, null, false, tok);
    const j = await r.json();
    const out = [];
    for (const m of (j.messages || [])) {
      const r2 = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`, null, false, tok);
      const msg = await r2.json();
      const item = { id: msg.id, threadId: msg.threadId, snippet: msg.snippet || "", headers: {}, attachments: [], html: "", text: "", internalDate: Number(msg.internalDate) || 0, account: email || loginHint || "" };
      ["From", "Subject", "Date"].forEach((h) => { item.headers[h.toLowerCase()] = headerOf(msg.payload && msg.payload.headers, h); });
      walkParts(msg.payload, item);
      delete item.html; delete item.text;   // seuls les en-têtes et les pièces jointes servent ici
      out.push(item);
    }
    return out;
  }
  // Dossier de l'app sur le Drive (portée drive.file : l'app ne voit que ce qu'elle a créé).
  const folderIds = {};
  async function ensureFolder(name) {
    if (folderIds[name]) return folderIds[name];
    const q = encodeURIComponent(`name='${String(name).replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
    const j = await r.json();
    let id = j.files && j.files[0] && j.files[0].id;
    if (!id) {
      const r2 = await api("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name, mimeType: "application/vnd.google-apps.folder" }) });
      id = (await r2.json()).id;
    }
    folderIds[name] = id;
    return id;
  }
  // Dépose un fichier binaire (PDF, image) dans un dossier de l'app. Renvoie { id, url }.
  async function uploadToFolder(name, bytes, mime, folderName) {
    const parent = folderName ? await ensureFolder(folderName) : null;
    const type = mime || "application/pdf";
    const boundary = "op01" + Math.random().toString(36).slice(2);
    const metaObj = { name: name, mimeType: type }; if (parent) metaObj.parents = [parent];
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metaObj)}` +
      `\r\n--${boundary}\r\nContent-Type: ${type}\r\nContent-Transfer-Encoding: base64\r\n\r\n${bytesToBase64(bytes)}` +
      `\r\n--${boundary}--`;
    const r = await api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body
    });
    const j = await r.json();
    return { id: j.id, url: j.webViewLink || `https://drive.google.com/file/d/${j.id}/view` };
  }
  // Pièce jointe : octets + base64 standard (pour les images intégrées en data:).
  async function readAttachment(msgId, attId, email) {
    const tok = email ? await gmailTokenFor(email) : null;
    const r = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(attId)}`, null, false, tok);
    const j = await r.json();
    return { bytes: b64urlBytes(j.data || ""), b64: b64std(j.data || "") };
  }

  // Google renvoie les événements par pages : sur une fenêtre de plusieurs mois,
  // s'arrêter à la première page tronquerait silencieusement l'agenda. On suit
  // les pages jusqu'au bout, avec une limite haute par sécurité.
  const CAL_MAX_EVENTS = 2500;

  // Les agendas de l'utilisateur, hors ceux qu'il a décochés dans Google.
  // Ne lire que « primary » laisserait de côté les jours fériés, les agendas
  // partagés et les agendas repris d'un collègue.
  // Tous les agendas du compte sont lus (les siens et ceux partagés avec lui), sauf ceux
  // décochés dans l'app (liste mémorisée sur l'appareil). La case « afficher » de Google
  // Agenda n'est plus prise en compte : elle masquait des agendas sans que rien ne le dise.
  const CAL_OFF_KEY = "op01_cal_off";
  const calOffIds = () => { try { return JSON.parse(localStorage.getItem(CAL_OFF_KEY) || "[]") || []; } catch (e) { return []; } };
  let calList = [];
  async function listCalendars(all) {
    if (!hasSession() || !calGranted()) return [];
    const r = await api("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250");
    const j = await r.json();
    calList = (j.items || []).filter((c) => c.id).map((c) => ({ id: c.id, summary: c.summary || c.id, primary: !!c.primary, selected: c.selected !== false }));
    if (all) return calList;
    const off = calOffIds();
    return calList.filter((c) => off.indexOf(c.id) === -1);
  }
  function setCalendarOff(id, off) {
    const cur = calOffIds().filter((x) => x !== id);
    if (off) cur.push(id);
    try { localStorage.setItem(CAL_OFF_KEY, JSON.stringify(cur)); } catch (e) {}
  }

  async function eventsOf(calId, fromISO, toISO, out, seen) {
    let pageToken = null;
    do {
      const p = new URLSearchParams({
        timeMin: fromISO,
        timeMax: toISO,
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250"
      });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await api("https://www.googleapis.com/calendar/v3/calendars/"
        + encodeURIComponent(calId) + "/events?" + p.toString());
      const j = await r.json();
      (j.items || []).forEach((e) => {
        if (e.status === "cancelled") return;
        // Un même événement peut figurer sur deux agendas (invitation partagée).
        const key = e.id + "|" + ((e.start && (e.start.dateTime || e.start.date)) || "");
        if (seen[key]) return;
        seen[key] = 1;
        e.calendarId = calId;
        e.calendarName = j.summary || "";
        out.push(e);
      });
      pageToken = j.nextPageToken || null;
    } while (pageToken && out.length < CAL_MAX_EVENTS);
  }

  async function listEvents(fromISO, toISO) {
    if (!hasSession() || !calGranted()) return [];
    let cals = [];
    try { cals = await listCalendars(); } catch (e) { cals = []; }
    // Repli : si la liste des agendas est inaccessible, on lit au moins le principal.
    const ids = cals.length ? cals.map((c) => c.id) : ["primary"];
    const out = [], seen = {};
    let firstError = null;
    for (let i = 0; i < ids.length && out.length < CAL_MAX_EVENTS; i++) {
      // Un agenda en erreur (droits retirés, agenda supprimé) ne doit pas
      // empêcher de lire les autres.
      try { await eventsOf(ids[i], fromISO, toISO, out, seen); }
      catch (e) { if (!firstError) firstError = e; }
    }
    // En revanche, si rien n'a pu être lu, c'est une panne à expliquer
    // (API désactivée, autorisation insuffisante) : on la laisse remonter.
    if (!out.length && firstError) throw firstError;
    return out;
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
    const remote = await readRemote();
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
    catch (e) {
      if (authInProgress()) { setStatus("reconnexion…"); return null; }
      needsAuth = true; setStatus("reconnexion nécessaire"); return null;
    }
  }
  async function doAutoConnect() {
    if (!hasSession()) return null;
    // Retour de Google par redirection : le jeton est déjà en main, pas besoin de GIS.
    if (cameBackFromGoogle) {
      try {
        setStatus("connexion…");
        const remote = await readRemote();
        setStatus("connecté");
        return remote;
      } catch (e) { needsAuth = true; setStatus("reconnexion nécessaire"); return null; }
    }
    // Jeton mémorisé encore valable : aucune demande à Google. Sinon,
    // renouvellement silencieux (arrière-plan, ou redirection invisible).
    try { return await connect(true); }
    catch (e) {
      if (authInProgress()) { setStatus("reconnexion…"); return null; }
      needsAuth = true; setStatus("reconnexion nécessaire"); return null;
    }
  }

  // Enregistrer l'état sur Drive. L'état est mis en file : en cas d'échec
  // (jeton expiré, réseau coupé), on retente automatiquement avec un délai
  // croissant — rien n'est perdu, plus besoin de relancer l'application.
  function push(state) {
    pending = state;
    schedule(800);
  }
  // Quand Drive porte un état plus récent que le nôtre (autre appareil), on
  // l'adopte au lieu de l'écraser : l'app est prévenue par ces écouteurs.
  const remoteListeners = [];
  function onRemote(fn) { remoteListeners.push(fn); }
  // Après chaque synchronisation réussie, l'app reçoit le contenu désormais sur
  // Drive (sa « base » pour la prochaine fusion).
  const syncedListeners = [];
  function onSynced(fn) { syncedListeners.push(fn); }
  const synced = (content) => syncedListeners.forEach((fn) => { try { fn(content); } catch (e) {} });
  // Fusion fournie par l'app : (distant, local) → état fusionné.
  let merger = null;
  function setMerger(fn) { merger = fn; }
  function schedule(delay) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flush, delay);
  }
  // Relecture à la demande : si un autre appareil a écrit depuis notre dernière
  // synchro, on fusionne tout de suite (sans attendre une modification locale).
  // Quand rien n'a changé, cela ne coûte qu'un appel de métadonnées.
  async function refresh(state) {
    if (!hasSession() || !fileId || !lastModifiedTime || pending || flushing) return false;
    let meta;
    try { meta = await getMeta(fileId); } catch (e) { return false; }
    if (!meta.modifiedTime || meta.modifiedTime === lastModifiedTime) return false;
    pending = state;
    await flush();
    return true;
  }
  let flushing = false;
  async function flush() {
    if (!pending) return;
    if (!hasSession()) return;
    if (flushing) { schedule(500); return; }
    flushing = true;
    try { await doFlush(); } finally { flushing = false; }
  }
  async function doFlush() {
    let content = JSON.stringify(pending);
    try {
      setStatus("sauvegarde…");
      if (!fileId) {
        const f = await findFile();                       // le fichier existe peut-être déjà
        if (f) { fileId = f.id; lastModifiedTime = null; } // contenu jamais lu : distant inconnu
      }
      if (!fileId) {
        const f = await createNamed(FILE_NAME, content);
        fileId = f.id; lastModifiedTime = f.modifiedTime;
      } else {
        // Avant d'écrire, on s'assure de ne pas écraser le travail d'un autre
        // appareil : si le fichier a changé depuis notre dernière lecture/écriture,
        // ou si on ne l'a jamais lu, on le relit et le plus récent l'emporte.
        let changed = false;
        if (lastModifiedTime) {
          const meta = await getMeta(fileId);
          changed = !!(meta.modifiedTime && meta.modifiedTime !== lastModifiedTime);
        }
        if (changed || !lastModifiedTime) {
          const remoteContent = await download(fileId);   // en cas d'échec : reprise plus tard, sans écraser
          let remote = null;
          try { remote = JSON.parse(remoteContent); } catch (e) {}
          if (remote) {
            if (changed) {
              // Un autre appareil a écrit entre-temps : copies de sûreté des deux versions avant fusion.
              setStatus("fusion avec un autre appareil…");
              try { await createNamed(CONFLICT_PREFIX + stampStr() + "-local.json", content); } catch (e) {}
              try { await createNamed(CONFLICT_PREFIX + stampStr() + ".json", remoteContent); } catch (e) {}
            }
            const merged = merger ? merger(remote, pending)
              : ((remote.updatedAt || 0) > (pending.updatedAt || 0) ? remote : pending);
            const mergedContent = JSON.stringify(merged);
            if (mergedContent !== content) {
              // Le résultat diffère de ce que l'app voulait écrire : elle l'adopte.
              pending = merged; content = mergedContent;
              remoteListeners.forEach((fn) => { try { fn(merged); } catch (e) {} });
            }
            if (mergedContent === remoteContent) {
              // Drive a déjà exactement cet état : rien à écrire.
              try { const meta = await getMeta(fileId); lastModifiedTime = meta.modifiedTime || null; } catch (e) { lastModifiedTime = null; }
              if (pending && JSON.stringify(pending) === content) pending = null;
              retries = 0; synced(content);
              setStatus(pending ? "sauvegarde…" : "synchronisé");
              if (pending) schedule(300);
              return;
            }
          }
        }
        const res = await updateFile(fileId, content);
        lastModifiedTime = res && res.modifiedTime ? res.modifiedTime : lastModifiedTime;
      }
      synced(content);
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
    cameBack: () => cameBackFromGoogle || !!mailBack,
    redirecting: () => redirecting,
    lastRedirectError: () => redirectError,
    onBeforeRedirect: (fn) => beforeRedirect.push(fn),
    setSilentGate: (fn) => { silentGate = fn; },
    tokenExpiresIn: () => (accessToken ? Math.max(0, tokenExpiry - Date.now()) : 0),
    hasPending: () => !!pending,
    autoConnect,
    reconnect,
    onRemote,
    onSynced,
    setMerger,
    refresh,
    flushNow: flush,
    fileExists: () => !!fileId,
    listBackups,
    restore,
    backupNow,
    readMails,
    readMailbox,
    ensureMailbox,
    shareFile,
    dataFileId,
    ensureEvenements,
    readEvenements,
    writeEvenements,
    fileModifiedTime,
    readAssistant,
    writeAssistant,
    readBanque,
    listEvents,
    listCalendars,
    calendars: () => calList,
    calendarOff: (id) => calOffIds().indexOf(id) > -1,
    setCalendarOff,
    calendarGranted: calGranted,
    enableCalendar,
    disableCalendar,
    gmailGranted,
    enableGmail,
    disableGmail,
    readMail,
    readAttachment,
    searchMails,
    uploadToFolder,
    account: () => loginHint || "",
    gmailAccounts: gmailAccountList,
    gmailAccountValid,
    addGmailAccount,
    removeGmailAccount,
    mailLinkPending: () => mailLinkPending,
    cameBackMail: () => !!mailBack,
    listDocs,
    uploadDoc,
    readDoc,
    deleteDoc,
    listPdfs,
    uploadPdf,
    readBinary
  };
})();
