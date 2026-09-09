/**
 * Operations01 — Relais entre le pipeline « assistants » (Mac mini) et Google Drive.  Version 2.
 * Trois fichiers, tous CRÉÉS PAR LA WEB APP (portée drive.file) ; ce script écrit dedans.
 *   operations01-evenements.json : événements classés + propositions de l'assistant
 *   operations01-assistant.json  : brief du matin, estimations de durée par tâche
 *   operations01-data.json       : lu (jamais écrit) pour exporter tâches, projets, rendez-vous, temps
 * MISE À JOUR : script.google.com → projet « Operations01 relais » → remplacer le code → SECRET →
 *   Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer (l'URL ne change pas).
 * API (toujours HTTP 200, tester "ok") :
 *   GET  ?secret=…                  → { ok, service, version }
 *   GET  ?secret=…&action=export    → { ok, data:{…}, evenements:[{id,statut,traiteLe}], assistant:{estimations} }
 *   POST { secret, evenements:[…] } → fusion par id ; existant : seul « proposition » peut être mis à jour
 *   POST { secret, action:"assistant", brief:{…}, estimations:{ id:{…} } } → brief remplacé, estimations fusionnées
 *
 * Le relais ne modifie jamais un événement existant SAUF son champ « proposition » ;
 * il ne touche jamais « accepteeMin » d'une estimation. L'app reste maître de tout
 * ce que Grégory décide. Les temps passés (chronos) sont dans missions[].entries.
 */
var SECRET = "";
var VERSION = 2;
var FICHIER_EVENEMENTS = "operations01-evenements.json";
var FICHIER_ASSISTANT = "operations01-assistant.json";
var FICHIER_DATA = "operations01-data.json";
var EXPORT_CLES = ["missions", "tasks", "actions", "rendezvous", "recurrences", "slots"];
var CONSERVER_JOURS = 30;
var MAX_EVENEMENTS = 1000;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!SECRET || p.secret !== SECRET) return reponse({ ok: false, erreur: "secret invalide" });
  if (p.action !== "export") return reponse({ ok: true, service: "relais-evenements", version: VERSION });
  var data = lireJson(FICHIER_DATA) || {};
  var exporte = {};
  EXPORT_CLES.forEach(function (k) { if (Array.isArray(data[k])) exporte[k] = data[k]; });
  var ev = (lireJson(FICHIER_EVENEMENTS) || {}).evenements || [];
  var assistant = lireJson(FICHIER_ASSISTANT) || {};
  return reponse({
    ok: true, version: VERSION, exporteLe: new Date().toISOString(),
    data: exporte,
    evenements: ev.map(function (x) { return { id: x.id, statut: x.statut, traiteLe: x.traiteLe || null }; }),
    assistant: { estimations: assistant.estimations || {} }
  });
}

function doPost(e) {
  var corps;
  try { corps = JSON.parse(e.postData.contents); } catch (err) { return reponse({ ok: false, erreur: "JSON invalide" }); }
  var secret = (e.parameter && e.parameter.secret) || corps.secret;
  if (!SECRET || secret !== SECRET) return reponse({ ok: false, erreur: "secret invalide" });
  return corps.action === "assistant" ? posterAssistant(corps) : posterEvenements(corps);
}

function posterEvenements(corps) {
  var entrants = Array.isArray(corps.evenements) ? corps.evenements : [];
  var fichier = trouver(FICHIER_EVENEMENTS);
  if (!fichier) return reponse({ ok: false, erreur: "fichier absent : ouvrir une fois l'onglet « À traiter » dans Operations01" });
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (err) { data = {}; }
    var liste = Array.isArray(data.evenements) ? data.evenements : [];
    var parId = {}; liste.forEach(function (x) { if (x && x.id) parId[x.id] = x; });
    var ajoutes = 0, existants = 0, propositions = 0, maintenant = new Date().toISOString();
    entrants.forEach(function (ev) {
      if (!ev || !ev.id) return;
      delete ev.contenu;
      var deja = parId[ev.id];
      if (deja) {
        existants++;
        if (ev.proposition && (!deja.proposition || (ev.proposition.genereeLe || "") > (deja.proposition.genereeLe || ""))) {
          deja.proposition = ev.proposition; propositions++;
        }
        return;
      }
      ev.statut = "nouveau"; ev.recuParRelaisLe = maintenant;
      parId[ev.id] = ev; liste.push(ev); ajoutes++;
    });
    var horizon = Date.now() - CONSERVER_JOURS * 864e5;
    liste = liste.filter(function (x) { return x.statut === "nouveau" || new Date(x.recu_le || 0).getTime() >= horizon; });
    liste.sort(function (a, b) { return String(b.recu_le || "").localeCompare(String(a.recu_le || "")); });
    if (liste.length > MAX_EVENEMENTS) liste = liste.slice(0, MAX_EVENEMENTS);
    data.evenements = liste; data.updatedAt = Date.now(); data.generatedAt = maintenant;
    fichier.setContent(JSON.stringify(data));
    return reponse({ ok: true, ajoutes: ajoutes, existants: existants, propositions: propositions, total: liste.length });
  } finally { verrou.releaseLock(); }
}

function posterAssistant(corps) {
  var fichier = trouver(FICHIER_ASSISTANT);
  if (!fichier) return reponse({ ok: false, erreur: "fichier absent : ouvrir une fois le tableau de bord de l'assistant dans Operations01" });
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (err) { data = {}; }
    var maintenant = new Date().toISOString();
    if (corps.brief) { data.brief = corps.brief; data.brief.recuLe = maintenant; }
    var n = 0;
    if (corps.estimations && typeof corps.estimations === "object") {
      data.estimations = data.estimations || {};
      Object.keys(corps.estimations).forEach(function (id) {
        var e = corps.estimations[id]; if (!e) return;
        var deja = data.estimations[id] || {};
        data.estimations[id] = { assistantMin: e.assistantMin, confiance: e.confiance, base: e.base || null,
                                 genereeLe: maintenant, accepteeMin: deja.accepteeMin || null, accepteeLe: deja.accepteeLe || null };
        n++;
      });
    }
    data.updatedAt = Date.now(); data.generatedAt = maintenant;
    fichier.setContent(JSON.stringify(data));
    return reponse({ ok: true, brief: !!corps.brief, estimations: n });
  } finally { verrou.releaseLock(); }
}

function trouver(nom) { var it = DriveApp.getFilesByName(nom); return it.hasNext() ? it.next() : null; }
function lireJson(nom) { var f = trouver(nom); if (!f) return null; try { return JSON.parse(f.getBlob().getDataAsString() || "{}"); } catch (e) { return null; } }
function reponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
