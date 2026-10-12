/**
 * Operations01 — Relais entre le pipeline « assistants » (Mac mini) et Google Drive.  Version 5.
 * Trois fichiers, tous CRÉÉS PAR LA WEB APP (portée drive.file) ; ce script écrit dedans.
 *   operations01-evenements.json : événements classés + propositions de l'assistant
 *   operations01-assistant.json  : brief du matin, estimations de durée par tâche
 *   operations01-data.json       : lu (jamais écrit) pour exporter tâches, projets, rendez-vous, temps
 * Et le dossier « Correspondances » du Drive (créé par appsscript-correspondances.gs) : un .md par
 * interlocuteur ; le relais y ajoute les SMS / iMessage / WhatsApp envoyés par le Mac mini, et le
 * sert à l'assistant pour étayer ses propositions de réponse.
 * MISE À JOUR : script.google.com → projet « Operations01 relais » → remplacer le code → SECRET →
 *   Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer (l'URL ne change pas).
 * API (toujours HTTP 200, tester "ok") :
 *   GET  ?secret=…                                → { ok, service, version }
 *   GET  ?secret=…&action=export                  → { ok, data:{…}, evenements:[{id,statut,traiteLe}], assistant:{estimations} }
 *        data contient aussi evEdits (réponses corrigées par Grégory : { idEvt: {reponse, original, at…} }),
 *        evDecisions (tâches créées depuis un message : projet, échéance, temps alloué, étapes, et ce qui
 *        était proposé) et evLearn.senderMission (expéditeur → projet) : matière à apprentissage.
 *   GET  ?secret=…&action=correspondances         → { ok, cles:{ cle:{nom,url,n,dernier,canaux} } }   (index)
 *   GET  ?secret=…&action=correspondance&cle=…    → { ok, nom, cle, entrees:[…], markdown }           (un interlocuteur ;
 *        cle = adresse e-mail ou téléphone ; &depuis=AAAA-MM-JJ et &max=N limitent les entrées)
 *   POST { secret, evenements:[…] }               → fusion par id ; existant : seul « proposition » peut être mis à jour
 *   POST { secret, action:"assistant", brief:{…}, estimations:{ id:{…} } } → brief remplacé, estimations fusionnées
 *   POST { secret, action:"correspondance", entrees:[…] } → archive des messages hors Gmail (voir posterCorrespondance)
 *
 * Le relais ne modifie jamais un événement existant SAUF son champ « proposition » ;
 * il ne touche jamais « accepteeMin » d'une estimation. L'app reste maître de tout
 * ce que Grégory décide. Les temps passés (chronos) sont dans missions[].entries.
 *
 * Proposition de réponse étayée (écrite par le Mac mini dans ev.proposition) :
 *   { reponse: "texte prêt à envoyer", genereePar: "modèle", genereeLe: ISO,
 *     contexte: [ { source: "correspondance"|"projet"|"evenement"|"tache"|"document",
 *                   titre: "Éric Chenneveau · 28/09 · Point d'étape", date: ISO, extrait: "…", lien: "https://…" } ],
 *     tache: {…}, processus: [...] }   ← inchangés
 */
var SECRET = "";
var VERSION = 5;
var FICHIER_EVENEMENTS = "operations01-evenements.json";
var FICHIER_ASSISTANT = "operations01-assistant.json";
var FICHIER_DATA = "operations01-data.json";
var EXPORT_CLES = ["missions", "tasks", "actions", "rendezvous", "recurrences", "slots"];
var EXPORT_OBJETS = ["evEdits", "evDecisions", "evLearn", "evSteps"];   // corrections et décisions de Grégory (apprentissage)
var CONSERVER_JOURS = 30;
var MAX_EVENEMENTS = 3000;   // ~95 événements par jour : 1000 ne couvrait que dix jours
var DOSSIER_CORRESPONDANCES = "Correspondances";   // dossier à la racine du Drive (créé par appsscript-correspondances.gs)
var MAX_CARACTERES = 4000;

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!SECRET || p.secret !== SECRET) return reponse({ ok: false, erreur: "secret invalide" });
  if (p.action === "correspondances") return reponse(indexCorrespondances());
  if (p.action === "correspondance") return reponse(lireCorrespondance(p.cle, p.depuis, p.max));
  if (p.action !== "export") return reponse({ ok: true, service: "relais-evenements", version: VERSION });
  var data = lireJson(FICHIER_DATA) || {};
  var exporte = {};
  EXPORT_CLES.forEach(function (k) { if (Array.isArray(data[k])) exporte[k] = data[k]; });
  EXPORT_OBJETS.forEach(function (k) { if (data[k] && typeof data[k] === "object") exporte[k] = data[k]; });
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
  if (corps.action === "assistant") return posterAssistant(corps);
  if (corps.action === "correspondance") return posterCorrespondance(corps);
  return posterEvenements(corps);
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

// ---- Correspondances (SMS, iMessage, WhatsApp… envoyés par le Mac mini ; Gmail est traité par
//      appsscript-correspondances.gs dans chaque compte). Une entrée par message reçu :
//   { id: "sms:<identifiant stable>", cle: "+33612345678" | "adresse@x.fr", nom: "Éric Chenneveau",
//     canal: "sms"|"imessage"|"whatsapp"|"chat"|…, compte: "messages-mac-mini", sens: "recu"|"envoye",
//     date: ISO (réception), sujet: "SMS" (ou premier mots), message: "texte reçu",
//     reponse: "ce que j'ai vraiment envoyé ensuite" | "", reponseLe: ISO | "", lien: "" }
// Fusion par id : renvoyer plus tard la même entrée avec la réponse remplit « Ma réponse ».
function posterCorrespondance(corps) {
  var entrees = Array.isArray(corps.entrees) ? corps.entrees : [];
  var dossier = dossierCorrespondances(); if (!dossier) return reponse({ ok: false, erreur: "dossier « " + DOSSIER_CORRESPONDANCES + " » absent : installer appsscript-correspondances.gs dans la boîte principale" });
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var donnees = sousDossier(dossier, "_données"), index = lireIndex(donnees), contacts = contactsParCle();
    var parCle = {}, ignorees = 0;
    var moi = mesCles(contacts);
    entrees.forEach(function (e) {
      if (!e || !e.id || !e.cle) { ignorees++; return; }
      var brute = normaliserCle(e.cle), c = contacts[brute];
      var cle = c ? c.cle : brute;   // un contact de l'app avec e-mail ET téléphone : un seul fichier, sous son adresse
      if (moi[cle] || moi[brute]) { ignorees++; return; }   // mes propres numéros et adresses ne sont pas des interlocuteurs
      var g = parCle[cle] || (parCle[cle] = { nom: "", entrees: [] });
      var nom = (c && c.nom) || String(e.nom || "").trim() || (index[cle] && index[cle].nom) || cle;
      if (!g.nom || (c && g.nom !== c.nom)) g.nom = nom;
      g.entrees.push({ id: String(e.id), canal: e.canal || "sms", compte: e.compte || "", sens: e.sens === "envoye" ? "envoye" : "recu",
        date: e.date || new Date().toISOString(), sujet: e.sujet || "", de: nom, deAdresse: brute,
        message: tronquer(e.message), reponse: tronquer(e.reponse), reponseLe: e.reponseLe || "", lien: e.lien || "" });
    });
    var maj = 0;
    Object.keys(parCle).forEach(function (cle) { if (fusionnerInterlocuteur(dossier, donnees, cle, parCle[cle].nom, parCle[cle].entrees, index)) maj++; });
    ecrireIndex(donnees, index);
    return reponse({ ok: true, interlocuteurs: maj, entrees: entrees.length - ignorees, ignorees: ignorees });
  } finally { verrou.releaseLock(); }
}
function indexCorrespondances() {
  var dossier = dossierCorrespondances(); if (!dossier) return { ok: false, erreur: "dossier absent" };
  return { ok: true, version: VERSION, cles: lireIndex(sousDossier(dossier, "_données")) };
}
function lireCorrespondance(cle, depuis, max) {
  cle = normaliserCle(cle); if (!cle) return { ok: false, erreur: "cle manquante" };
  var dossier = dossierCorrespondances(); if (!dossier) return { ok: false, erreur: "dossier absent" };
  var donnees = sousDossier(dossier, "_données");
  var contact = contactsParCle()[cle]; if (contact) cle = contact.cle;
  var f = fichierDans(donnees, cle.replace(/[\\\/:*?"<>|]/g, "_") + ".json");
  if (!f) {
    // Téléphone saisi autrement (espaces, 06 au lieu de +336) : on cherche par chiffres.
    var index = lireIndex(donnees), chiffres = cle.replace(/\D/g, "").slice(-9);
    var trouvee = chiffres.length === 9 ? Object.keys(index).filter(function (k) { return k.replace(/\D/g, "").slice(-9) === chiffres; })[0] : null;
    if (trouvee) { cle = trouvee; f = fichierDans(donnees, cle.replace(/[\\\/:*?"<>|]/g, "_") + ".json"); }
  }
  if (!f) return { ok: true, cle: cle, nom: "", entrees: [], markdown: "", vide: true };
  var j = lireJsonDe(f) || {};
  var entrees = (j.entrees || []).filter(function (e) { return !depuis || String(e.date || "") >= String(depuis); });
  var n = Number(max) || 0; if (n > 0 && entrees.length > n) entrees = entrees.slice(entrees.length - n);
  return { ok: true, cle: cle, nom: j.nom || cle, total: (j.entrees || []).length, entrees: entrees, markdown: rendreMarkdown(j.nom || cle, cle, entrees, { maintenant: j.misAJour }) };
}
function normaliserCle(c) {
  c = String(c || "").trim().toLowerCase();
  if (c.indexOf("@") > -1) return c;
  var d = c.replace(/[^\d+]/g, "");
  if (/^0\d{9}$/.test(d)) d = "+33" + d.slice(1);
  if (/^33\d{9}$/.test(d)) d = "+" + d;
  return d || c;
}
function tronquer(t) { t = String(t || "").replace(/\r\n?/g, "\n").trim(); return t.length > MAX_CARACTERES ? t.slice(0, MAX_CARACTERES).replace(/\s+\S*$/, "") + " […]" : t; }
// Contacts de l'app : adresse ou téléphone → { nom: « Prénom Nom », cle: clé canonique (l'adresse si elle existe) }.
function contactsParCle() {
  var data = lireJson(FICHIER_DATA) || {}, out = {};
  (data.contacts || []).forEach(function (c) {
    var n = ((c.firstName || "") + " " + (c.lastName || "")).trim(); if (!n) return;
    var email = String(c.email || "").toLowerCase().trim(), tel = c.phone ? normaliserCle(c.phone) : "";
    var canon = email || tel; if (!canon) return;
    if (email) out[email] = { nom: n, cle: canon };
    if (tel) out[tel] = { nom: n, cle: canon };
  });
  return out;
}
// Mes propres clés : le compte courant, les boîtes secondaires déclarées dans l'app, et le téléphone
// ou l'adresse de ma propre fiche contact (celle qui porte l'adresse du compte).
function mesCles(contacts) {
  var out = {}, moi = String(Session.getActiveUser().getEmail() || "").toLowerCase();
  if (moi) out[moi] = true;
  var data = lireJson(FICHIER_DATA) || {};
  (data.mailboxes || []).forEach(function (b) { if (b.email) out[String(b.email).toLowerCase()] = true; });
  Object.keys(contacts || {}).forEach(function (k) { if (out[contacts[k].cle]) out[k] = true; });
  return out;
}
function dossierCorrespondances() { var it = DriveApp.getRootFolder().getFoldersByName(DOSSIER_CORRESPONDANCES); return it.hasNext() ? it.next() : null; }
function sousDossier(d, nom) { var it = d.getFoldersByName(nom); return it.hasNext() ? it.next() : d.createFolder(nom); }
function fichierDans(d, nom) { var it = d.getFilesByName(nom); return it.hasNext() ? it.next() : null; }
function lireJsonDe(fichier) { try { return JSON.parse(fichier.getBlob().getDataAsString("UTF-8")); } catch (e) { return null; } }
function lireIndex(donnees) { var f = fichierDans(donnees, "index.json"); var j = f ? lireJsonDe(f) : null; return (j && j.cles) || {}; }
function ecrireIndex(donnees, index) {
  var f = fichierDans(donnees, "index.json");
  var actuel = f ? ((lireJsonDe(f) || {}).cles || {}) : {};
  Object.keys(index).forEach(function (k) { actuel[k] = index[k]; });
  var contenu = JSON.stringify({ version: VERSION, misAJour: new Date().toISOString(), cles: actuel });
  if (f) f.setContent(contenu); else donnees.createFile("index.json", contenu, "application/json");
}
// (copie à l'identique de appsscript-correspondances.gs — garder les deux fichiers synchrones)
function nomFichierSur(nom) {
  var n = String(nom || "").replace(/[\\\/:*?"<>|#%{}$!'`@]+/g, " ").replace(/\s+/g, " ").trim();
  return (n || "Sans nom").slice(0, 80);
}

function fmtDateFr(iso) {
  var d = new Date(iso); if (!iso || isNaN(d)) return "";
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function citer(texte) {
  return String(texte || "").split("\n").map(function (l) { return "> " + l; }).join("\n");
}

function fusionnerEntrees(anciennes, nouvelles) {
  var parId = {};
  (anciennes || []).forEach(function (e) { if (e && e.id) parId[e.id] = e; });
  var ajout = 0, maj = 0;
  (nouvelles || []).forEach(function (e) {
    if (!e || !e.id) return;
    var d = parId[e.id];
    if (!d) { parId[e.id] = e; ajout++; return; }
    if ((e.reponse && !d.reponse) || (e.message && e.message.length > (d.message || "").length) || (e.reponse && e.reponse.length > (d.reponse || "").length)) { parId[e.id] = e; maj++; }
  });
  var liste = Object.keys(parId).map(function (k) { return parId[k]; });
  liste.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  return { entrees: liste, ajout: ajout, maj: maj };
}

var CANAUX = { mail: "e-mail", sms: "SMS", imessage: "iMessage", whatsapp: "WhatsApp", messages: "Messages", chat: "Google Chat", bluesky: "Bluesky", linkedin: "LinkedIn" };

function rendreMarkdown(nom, cle, entrees, infos) {
  infos = infos || {};
  var adresses = {}, canaux = {}, comptes = {};
  entrees.forEach(function (e) { if (e.deAdresse) adresses[e.deAdresse] = 1; if (e.canal) canaux[e.canal] = 1; if (e.compte) comptes[e.compte] = 1; });
  var lignes = ["# " + nom, "", "<!-- correspondance · clé : " + cle + " · généré par Operations01, ne pas modifier à la main (régénéré à chaque passage) -->", ""];
  var meta = [];
  if (Object.keys(adresses).length) meta.push("Adresses : " + Object.keys(adresses).join(", "));
  if (Object.keys(canaux).length) meta.push("Canaux : " + Object.keys(canaux).map(function (c) { return CANAUX[c] || c; }).join(", "));
  if (Object.keys(comptes).length) meta.push("Mes comptes : " + Object.keys(comptes).join(", "));
  meta.push(entrees.length + " message" + (entrees.length > 1 ? "s" : "") + " · mis à jour le " + fmtDateFr(infos.maintenant || new Date().toISOString()));
  lignes.push(meta.join("  \n"), "");
  entrees.forEach(function (e) {
    var jour = String(e.date || "").slice(0, 10);
    lignes.push("## " + jour + " · " + (e.sujet || "(sans objet)"));
    lignes.push("<!-- id:" + e.id + " -->");
    if (e.sens === "envoye") {
      lignes.push("**Mon message** à " + (e.de || e.deAdresse || "?") + " · " + (CANAUX[e.canal] || e.canal || "") + " · " + fmtDateFr(e.reponseLe || e.date) + (e.compte ? " · depuis " + e.compte : ""));
      lignes.push("", citer(e.reponse), "");
    } else {
      lignes.push("**De** " + (e.de || e.deAdresse || "?") + " · " + (CANAUX[e.canal] || e.canal || "") + " · reçu le " + fmtDateFr(e.date) + (e.compte ? " · sur " + e.compte : ""));
      lignes.push("", citer(e.message), "");
      if (e.reponse) lignes.push("**Ma réponse** (" + fmtDateFr(e.reponseLe || "") + ") :", "", citer(e.reponse), "");
      else lignes.push("**Ma réponse** : — (pas de réponse envoyée)", "");
    }
    if (e.lien) lignes.push("[Ouvrir](" + e.lien + ")", "");
  });
  return lignes.join("\n");
}

function fusionnerInterlocuteur(dossier, donnees, cle, nom, nouvelles, index) {
  var nomJson = cle.replace(/[\\\/:*?"<>|]/g, "_") + ".json";
  var fJson = fichierDans(donnees, nomJson);
  var ancien = fJson ? (lireJsonDe(fJson) || {}) : {};
  var fusion = fusionnerEntrees(ancien.entrees, nouvelles);
  if (!fusion.ajout && !fusion.maj && fJson && index[cle] && index[cle].fichierId) return false;
  var nomFinal = (index[cle] && index[cle].nom && !nom) ? index[cle].nom : (nom || ancien.nom || cle);
  var json = { cle: cle, nom: nomFinal, entrees: fusion.entrees, misAJour: new Date().toISOString() };
  if (fJson) fJson.setContent(JSON.stringify(json)); else donnees.createFile(nomJson, JSON.stringify(json), "application/json");
  var md = rendreMarkdown(nomFinal, cle, fusion.entrees, { maintenant: json.misAJour });
  var nomMd = nomFichierSur(nomFinal) + ".md";
  var fMd = null;
  if (index[cle] && index[cle].fichierId) { try { fMd = DriveApp.getFileById(index[cle].fichierId); if (fMd.isTrashed()) fMd = null; } catch (e) { fMd = null; } }
  if (!fMd) fMd = fichierDans(dossier, nomMd);
  if (fMd) { if (fMd.getName() !== nomMd) { try { fMd.setName(nomMd); } catch (e) {} } fMd.setContent(md); }
  else fMd = dossier.createFile(nomMd, md, "text/markdown");
  var canaux = {}; fusion.entrees.forEach(function (e) { if (e.canal) canaux[e.canal] = 1; });
  index[cle] = { nom: nomFinal, fichierId: fMd.getId(), url: "https://drive.google.com/file/d/" + fMd.getId() + "/view", n: fusion.entrees.length,
    dernier: fusion.entrees.length ? fusion.entrees[fusion.entrees.length - 1].date : "", canaux: Object.keys(canaux), misAJour: json.misAJour };
  return true;
}

function trouver(nom) { var it = DriveApp.getFilesByName(nom); return it.hasNext() ? it.next() : null; }
function lireJson(nom) { var f = trouver(nom); if (!f) return null; try { return JSON.parse(f.getBlob().getDataAsString() || "{}"); } catch (e) { return null; } }
function reponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
