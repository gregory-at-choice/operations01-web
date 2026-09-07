/**
 * Operations01 — Relais des événements du pipeline « assistants » (Mac mini) vers Google Drive.
 * Reçoit en POST des événements déjà classés et les fusionne dans « operations01-evenements.json »,
 * fichier CRÉÉ PAR LA WEB APP (portée drive.file). Même mécanisme que appsscript-mails.gs.
 *
 * INSTALLATION (compte Google relié à la web app) :
 *   1. https://script.google.com → Nouveau projet → coller ce fichier.
 *   2. Renseigner SECRET (= OPERATIONS01_RELAIS_SECRET dans infra/.env du Mac mini).
 *   3. Déployer → Nouveau déploiement → Application web → Exécuter en tant que : moi ; Accès : Tout le monde
 *      → copier l'URL (…/exec) dans infra/.env (OPERATIONS01_RELAIS_URL).
 *   4. Dans la web app, ouvrir une fois l'onglet « À traiter » (crée le fichier).
 *   Test : ouvrir l'URL dans un navigateur → {"ok":true,"service":"relais-evenements"}.
 *
 * Entrée (POST JSON) : { "secret": "…", "evenements": [ {…} ] } — le secret peut aussi venir en ?secret=…
 * Réponse (toujours HTTP 200 côté Apps Script, tester le champ "ok") :
 *   { ok:true, ajoutes:n, existants:m, total:t } ou { ok:false, erreur:"…" }
 *
 * Le relais n'écrase JAMAIS un événement déjà présent (même id) : la web app est
 * maître du statut. Il purge les événements traités/ignorés de plus de CONSERVER_JOURS.
 * Jamais de contenu complet des messages : sujet + résumé seulement.
 */
var SECRET = "";                  // à renseigner — vide = relais désactivé
var FICHIER = "operations01-evenements.json";
var CONSERVER_JOURS = 30;
var MAX_EVENEMENTS = 1000;

function doPost(e) {
  var corps;
  try { corps = JSON.parse(e.postData.contents); } catch (err) { return reponse({ ok: false, erreur: "JSON invalide" }); }
  var secret = (e.parameter && e.parameter.secret) || corps.secret;
  if (!SECRET || secret !== SECRET) return reponse({ ok: false, erreur: "secret invalide" });
  var entrants = Array.isArray(corps.evenements) ? corps.evenements : [];

  var it = DriveApp.getFilesByName(FICHIER);
  if (!it.hasNext()) return reponse({ ok: false, erreur: "fichier absent : ouvrir une fois l'onglet « À traiter » dans Operations01" });
  var fichier = it.next();

  var verrou = LockService.getScriptLock();
  verrou.waitLock(20000);
  try {
    var data;
    try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (err) { data = {}; }
    var liste = Array.isArray(data.evenements) ? data.evenements : [];
    var parId = {};
    liste.forEach(function (x) { if (x && x.id) parId[x.id] = x; });

    var ajoutes = 0, existants = 0, maintenant = new Date().toISOString();
    entrants.forEach(function (ev) {
      if (!ev || !ev.id) return;
      if (parId[ev.id]) { existants++; return; }
      delete ev.contenu;
      ev.statut = "nouveau";
      ev.recuParRelaisLe = maintenant;
      parId[ev.id] = ev; liste.push(ev); ajoutes++;
    });

    var horizon = Date.now() - CONSERVER_JOURS * 864e5;
    liste = liste.filter(function (x) { return x.statut === "nouveau" || new Date(x.recu_le || 0).getTime() >= horizon; });
    liste.sort(function (a, b) { return String(b.recu_le || "").localeCompare(String(a.recu_le || "")); });
    if (liste.length > MAX_EVENEMENTS) liste = liste.slice(0, MAX_EVENEMENTS);

    data.evenements = liste;
    data.updatedAt = Date.now();
    data.generatedAt = maintenant;
    fichier.setContent(JSON.stringify(data));
    return reponse({ ok: true, ajoutes: ajoutes, existants: existants, total: liste.length });
  } finally {
    verrou.releaseLock();
  }
}

function doGet() { return reponse({ ok: true, service: "relais-evenements" }); }

function reponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
