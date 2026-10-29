/**
 * Operations01 — Relais entre le pipeline « assistants » (Mac mini) et Google Drive.  Version 11.
 * Trois fichiers, tous CRÉÉS PAR LA WEB APP (portée drive.file) ; ce script écrit dedans.
 *   operations01-evenements.json : événements classés + propositions de l'assistant
 *   operations01-assistant.json  : brief du matin, estimations de durée par tâche
 *   operations01-data.json       : lu (jamais écrit) pour exporter tâches, projets, rendez-vous, temps
 * Et le dossier « Correspondances » du Drive (créé par appsscript-correspondances.gs) : un .md par
 * interlocuteur ; le relais y ajoute les SMS / iMessage / WhatsApp envoyés par le Mac mini, et le
 * sert à l'assistant pour étayer ses propositions de réponse.
 * MISE À JOUR : script.google.com → projet « Operations01 relais » → remplacer le code (le SECRET est dans les propriétés du script) →
 *   Déployer → Gérer les déploiements → ✏️ → Nouvelle version → Déployer (l'URL ne change pas).
 * API (toujours HTTP 200, tester "ok") :
 *   GET  ?secret=…                                → { ok, service, version }
 *   GET  ?secret=…&action=export                  → { ok, data:{…}, evenements:[{id,statut,traiteLe}], assistant:{estimations} }
 *        data.contacts : id, prénom, nom, organisation, fonction, e-mail, téléphone, catégorie (jamais IBAN ni notes).
 *        data.evRequests : demandes de réponse faites dans l'app (« ✨ Proposer une réponse ») :
 *        { idEvt: { type:"reponse", at: ISO, note, expediteur, source, sujet, urgence } } — à servir en priorité ;
 *        une demande est satisfaite dès qu'une proposition avec genereeLe > at est postée.
 *        data contient aussi evEdits (réponses corrigées par Grégory : { idEvt: {reponse, original, at…} }),
 *        evDecisions (tâches créées depuis un message : projet, échéance, temps alloué, étapes, et ce qui
 *        était proposé) et evLearn.senderMission (expéditeur → projet) : matière à apprentissage.
 *   GET  ?secret=…&action=agenda&jours=7          → { ok, du, au, evenements:[…], jours:{ "AAAA-MM-JJ": { libres:[["12:00","14:00"]…], midi, soir } } }
 *        tous les agendas Google du compte principal (y compris ceux partagés : Icarus, perso, Majandco en
 *        occupé/libre), pour proposer de vrais créneaux dans une réponse (déjeuner, rendez-vous, visio).
 *   GET  ?secret=…&action=correspondances         → { ok, cles:{ cle:{nom,url,n,dernier,canaux} } }   (index)
 *   GET  ?secret=…&action=correspondance&cle=…    → { ok, nom, cle, entrees:[…], markdown }           (un interlocuteur ;
 *        cle = adresse e-mail ou téléphone ; &depuis=AAAA-MM-JJ et &max=N limitent les entrées)
 *   POST { secret, evenements:[…] }               → fusion par id ; existant : « proposition » peut être mise à jour,
 *        « contenu » ajouté s'il manquait, et pour les canaux hors mail « expediteur.nom » (y compris "" pour
 *        effacer) et « sujet » corrigés s'ils sont fournis. Le texte (contenu) est conservé pour les canaux hors mail (3000 car.).
 *   POST { secret, action:"retirer", ids:[…] }    → retire du fichier les événements listés, SEULEMENT s'ils sont
 *        encore « nouveau » (jamais ceux que Grégory a traités ou ignorés). Pour réparer un envoi par erreur.
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
// Le secret vit dans les propriétés du script (Paramètres du projet → Propriétés du script → SECRET) :
// recoller le code ne l'efface plus. À défaut, la valeur SECRET_CODE ci-dessous.
var SECRET_CODE = "";
var SECRET = (function () { try { return PropertiesService.getScriptProperties().getProperty("SECRET") || SECRET_CODE; } catch (e) { return SECRET_CODE; } })();
var VERSION = 22;
var FICHIER_EVENEMENTS = "operations01-evenements.json";
var FICHIER_ASSISTANT = "operations01-assistant.json";
var FICHIER_DATA = "operations01-data.json";
var EXPORT_CLES = ["missions", "tasks", "actions", "rendezvous", "recurrences", "slots", "pushSubscriptions", "recordings", "lexique"];   // v12 : abonnements aux notifications poussées ; v14 : enregistrements audio ; v18 : lexique des transcriptions
var EXPORT_OBJETS = ["evEdits", "evDecisions", "evLearn", "evSteps", "evRequests"];   // corrections et décisions de Grégory (apprentissage)
var CONSERVER_JOURS = 30;
var MAX_EVENEMENTS = 3000;   // ~95 événements par jour : 1000 ne couvrait que dix jours
var DOSSIER_CORRESPONDANCES = "Correspondances";   // dossier à la racine du Drive (créé par appsscript-correspondances.gs)
var MAX_CARACTERES = 4000;
var MAX_CONTENU = 3000;        // texte conservé pour un SMS / iMessage / WhatsApp
var FICHIER_TRANSCRIPTIONS = "operations01-transcriptions.json";   // v14 : créé par l'app, tenu par le relais
var AUDIO_MAX_OCTETS = 45 * 1024 * 1024;
var FICHIER_LIVRAISONS = "operations01-livraisons.json";   // v17 : documents livrés à l'app (notes de lecture, comptes rendus)
var LIVRAISONS_JOURS = 45;
var LIVRAISON_MAX_CARACTERES = 400000;
var DOSSIER_ENREGISTREMENTS = "Enregistrements choice";   // v15 : créé par l'app ; Dictaphone y dépose aussi des fichiers

function doGet(e) {
  var p = (e && e.parameter) || {};
  // Sans paramètre : la version seulement (contrôle après déploiement), rien d'autre n'est lisible sans secret.
  if (!p.secret && !p.action) return reponse({ ok: true, service: "relais-evenements", version: VERSION });
  if (!SECRET || p.secret !== SECRET) return reponse({ ok: false, erreur: "secret invalide" });
  if (p.action === "stamp" || p.action === "export") verifierIndex();   // v22 : index vide ou absent → reconstruit par tranches, dans l'appel
  if (p.action === "agenda") return reponse(lireAgenda(Number(p.jours) || 7));
  if (p.action === "correspondances") return reponse(indexCorrespondances());
  if (p.action === "correspondance") return reponse(lireCorrespondance(p.cle, p.depuis, p.max));
  if (p.action === "audio") return reponse(lireAudio(p.id));
  if (p.action === "transcriptions") return reponse(listerTranscriptions());
  if (p.action === "audios") return reponse(listerAudios());
  if (p.action === "stamp") return reponse(stamp());
  if (p.action !== "export") return reponse({ ok: true, service: "relais-evenements", version: VERSION });
  var data = lireJson(FICHIER_DATA) || {};
  var exporte = {};
  EXPORT_CLES.forEach(function (k) { if (Array.isArray(data[k])) exporte[k] = data[k]; });
  // Contacts : de quoi nommer un expéditeur (téléphone, adresse), sans coordonnées bancaires ni notes.
  exporte.contacts = (data.contacts || []).map(function (c) {
    return { id: c.id, firstName: c.firstName || "", lastName: c.lastName || "", organization: c.organization || "", jobTitle: c.jobTitle || "", email: c.email || "", phone: c.phone || "", category: c.category || "", companyId: c.companyId || null };
  });
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
  if (corps.action === "retirer") return posterRetrait(corps);
  if (corps.action === "transcription") return posterTranscription(corps);
  if (corps.action === "audio") return posterAudio(corps);
  if (corps.action === "document") return posterDocument(corps);
  return posterEvenements(corps);
}

// ---- v14 : enregistrements audio (réunions, notes vocales) et transcriptions ----
// L'app dépose l'audio sur le Drive (dossier « Enregistrements choice ») et décrit l'enregistrement dans
// data.recordings (exporté). Le Mac mini télécharge l'audio ici, transcrit, résume, puis poste le résultat.
function lireAudio(id) {
  if (!id) return { ok: false, erreur: "id manquant" };
  var f; try { f = DriveApp.getFileById(id); } catch (e) { return { ok: false, erreur: "fichier introuvable" }; }
  var b = f.getBlob(), octets = b.getBytes();
  if (octets.length > AUDIO_MAX_OCTETS) return { ok: false, erreur: "fichier trop volumineux pour le relais (" + octets.length + " octets)" };
  return { ok: true, id: id, nom: f.getName(), mime: b.getContentType(), taille: octets.length, base64: Utilities.base64Encode(octets) };
}
// Fichiers audio du dossier (ceux de l'app et ceux déposés depuis Dictaphone ou l'app Drive) : le Mac mini
// transcrit ceux qui ne figurent ni dans data.recordings (fileId) ni dans les transcriptions (id "drive:<fileId>").
function listerAudios() {
  var it = DriveApp.getRootFolder().getFoldersByName(DOSSIER_ENREGISTREMENTS);
  if (!it.hasNext()) return { ok: true, dossier: null, fichiers: [] };
  var d = it.next(), files = d.getFiles(), out = [];
  while (files.hasNext()) {
    var f = files.next(), mime = f.getMimeType() || "";
    if (!/^audio\/|^video\/|mp4|m4a|webm|ogg|mpeg|wav|aac/i.test(mime + " " + f.getName())) continue;
    out.push({ id: f.getId(), nom: f.getName(), mime: mime, taille: f.getSize(), creeLe: f.getDateCreated().toISOString(), modifieLe: f.getLastUpdated().toISOString() });
  }
  out.sort(function (a, b) { return b.creeLe.localeCompare(a.creeLe); });
  return { ok: true, dossier: { id: d.getId(), url: d.getUrl() }, fichiers: out };
}
// v16 : dépôt d'un audio par le Mac mini (mémo Dictaphone arrivé par iCloud) dans le dossier, pour que
// Grégory puisse l'écouter depuis l'app (« Écouter sur le Drive »). Base64, 45 Mo au plus par appel.
function posterAudio(corps) {
  if (!corps.base64 || !corps.nom) return reponse({ ok: false, erreur: "nom et base64 requis" });
  var it = DriveApp.getRootFolder().getFoldersByName(DOSSIER_ENREGISTREMENTS);
  var d = it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(DOSSIER_ENREGISTREMENTS);
  var octets; try { octets = Utilities.base64Decode(corps.base64); } catch (e) { return reponse({ ok: false, erreur: "base64 invalide" }); }
  if (octets.length > AUDIO_MAX_OCTETS) return reponse({ ok: false, erreur: "fichier trop volumineux" });
  var deja = d.getFilesByName(corps.nom);
  if (deja.hasNext()) { var f0 = deja.next(); return reponse({ ok: true, id: f0.getId(), deja: true }); }
  var f = d.createFile(Utilities.newBlob(octets, corps.mime || "audio/mp4", corps.nom));
  return reponse({ ok: true, id: f.getId(), taille: octets.length });
}
// v17 : un document produit par le Mac mini (Markdown) ; l'app en fait un document du lecteur et prévient.
// { cle: "nyt-2026-10-27", titre, nom: "….md", texte, message, tache, compteRendu, genereLe }
function posterDocument(corps) {
  if (!corps.cle || !corps.texte) return reponse({ ok: false, erreur: "cle et texte requis" });
  if (String(corps.texte).length > LIVRAISON_MAX_CARACTERES) return reponse({ ok: false, erreur: "texte trop long" });
  var fichier = trouver(FICHIER_LIVRAISONS);
  if (!fichier) return reponse({ ok: false, erreur: "fichier absent : ouvrir une fois « Documents » dans Operations01" });
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (err) { data = {}; }
    data.documents = data.documents || {};
    var maintenant = new Date().toISOString();
    data.documents[corps.cle] = { cle: corps.cle, titre: corps.titre || corps.cle, nom: corps.nom || (corps.cle + ".md"), texte: String(corps.texte), message: corps.message || "", tache: corps.tache || "",
      compteRendu: corps.compteRendu || null, genereLe: corps.genereLe || maintenant, recuLe: maintenant };
    var horizon = Date.now() - LIVRAISONS_JOURS * 86400000;
    Object.keys(data.documents).forEach(function (k) { var x = data.documents[k]; if (x && x.recuLe && new Date(x.recuLe).getTime() < horizon) delete data.documents[k]; });
    data.updatedAt = Date.now();
    fichier.setContent(JSON.stringify(data));
    return reponse({ ok: true, cle: corps.cle });
  } finally { verrou.releaseLock(); }
}
function listerTranscriptions() {
  var fichier = trouver(FICHIER_TRANSCRIPTIONS); if (!fichier) return { ok: true, transcriptions: {} };
  var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (e) { data = {}; }
  var t = data.transcriptions || {}, out = {};
  Object.keys(t).forEach(function (id) { out[id] = { genereeLe: t[id].genereeLe || "", modele: t[id].modele || "" }; });
  return { ok: true, transcriptions: out };
}
function posterTranscription(corps) {
  if (!corps.id) return reponse({ ok: false, erreur: "id de l'enregistrement manquant" });
  var fichier = trouver(FICHIER_TRANSCRIPTIONS);
  if (!fichier) return reponse({ ok: false, erreur: "fichier absent : ouvrir une fois « Réunions » dans Operations01" });
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (err) { data = {}; }
    data.transcriptions = data.transcriptions || {};
    var maintenant = new Date().toISOString();
    data.transcriptions[corps.id] = { texte: String(corps.texte || ""), resume: String(corps.resume || ""), decisions: Array.isArray(corps.decisions) ? corps.decisions : [],
      actions: Array.isArray(corps.actions) ? corps.actions : [], questions: Array.isArray(corps.questions) ? corps.questions : [], modele: corps.modele || "", langue: corps.langue || "fr",
      dureeSec: Number(corps.dureeSec) || 0, genereeLe: corps.genereeLe || maintenant, recuLe: maintenant };
    data.updatedAt = Date.now();
    fichier.setContent(JSON.stringify(data));
    return reponse({ ok: true, id: corps.id });
  } finally { verrou.releaseLock(); }
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
      // Le texte est conservé pour les SMS, iMessage, WhatsApp, Chat… (l'app l'affiche) ; pas pour les
      // mails, que l'app lit dans Gmail.
      if (ev.source === "mail" || !ev.contenu) delete ev.contenu; else ev.contenu = String(ev.contenu).slice(0, MAX_CONTENU);
      var deja = parId[ev.id];
      if (deja) {
        existants++;
        if (ev.proposition && (!deja.proposition || (ev.proposition.genereeLe || "") > (deja.proposition.genereeLe || ""))) {
          deja.proposition = ev.proposition; propositions++;
        }
        if (ev.contenu && !deja.contenu) deja.contenu = ev.contenu;   // rattrapage du texte des messages déjà reçus
        // Hors mail : nom du carnet d'adresses et sujet court corrigés après coup (les anciens portaient le numéro).
        if (ev.source !== "mail" && deja.source !== "mail") {
          if (ev.expediteur && Object.prototype.hasOwnProperty.call(ev.expediteur, "nom")) { deja.expediteur = deja.expediteur || {}; deja.expediteur.nom = ev.expediteur.nom || ""; }   // "" efface un numéro pris pour un nom
          if (ev.sujet) deja.sujet = ev.sujet;
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

// Retire des événements envoyés par erreur : uniquement ceux encore « nouveau ».
function posterRetrait(corps) {
  var ids = Array.isArray(corps.ids) ? corps.ids.map(String) : [];
  var fichier = trouver(FICHIER_EVENEMENTS);
  if (!fichier) return reponse({ ok: false, erreur: "fichier absent" });
  var verrou = LockService.getScriptLock(); verrou.waitLock(20000);
  try {
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (err) { data = {}; }
    var liste = Array.isArray(data.evenements) ? data.evenements : [];
    var cibles = {}; ids.forEach(function (id) { cibles[id] = true; });
    var retires = 0, conserves = 0;
    liste = liste.filter(function (x) {
      if (!x || !cibles[x.id]) return true;
      if (x.statut === "nouveau") { retires++; return false; }
      conserves++; return true;   // traité ou ignoré par Grégory : on ne touche pas
    });
    data.evenements = liste; data.updatedAt = Date.now(); data.generatedAt = new Date().toISOString();
    fichier.setContent(JSON.stringify(data));
    return reponse({ ok: true, retires: retires, conserves: conserves, total: liste.length });
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
    // v12 : notifications poussées — clé publique VAPID du Mac mini et abonnements qu'il ne peut plus joindre.
    if (corps.push && typeof corps.push === "object") {
      var dejaPush = data.push || {};
      data.push = { publicKey: corps.push.publicKey || dejaPush.publicKey || "", invalides: Array.isArray(corps.push.invalides) ? corps.push.invalides : (dejaPush.invalides || []), majLe: maintenant };
    }
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
    return reponse({ ok: true, brief: !!corps.brief, estimations: n, push: !!corps.push });
  } finally { verrou.releaseLock(); }
}

// ---- Agenda : occupations et créneaux libres des prochains jours, tous agendas confondus ----
var AGENDA_JOUR_DEBUT = 8, AGENDA_JOUR_FIN = 22;   // fenêtre de journée pour calculer les créneaux libres (le soir compris)
var AGENDA_IGNORER = /férié|holiday|routine|lecture\s*$|^\s*nrp\s*$/i;  // agendas ou événements qui n'occupent pas vraiment (NRP = libre)
function lireAgenda(jours) {
  jours = Math.max(1, Math.min(31, jours || 7));
  var tz = Session.getScriptTimeZone();
  var debut = new Date(); debut.setHours(0, 0, 0, 0);
  var fin = new Date(debut.getTime() + jours * 864e5);
  var evenements = [];
  CalendarApp.getAllCalendars().forEach(function (cal) {
    var nomCal = cal.getName() || cal.getId();
    if (AGENDA_IGNORER.test(nomCal)) return;
    var liste; try { liste = cal.getEvents(debut, fin); } catch (e) { return; }
    liste.forEach(function (ev) {
      var titre = ev.getTitle() || "(sans titre)";
      var statut = ""; try { statut = String(ev.getMyStatus() || ""); } catch (e) {}
      if (/NO|DECLINED/i.test(statut)) return;
      var journee = ev.isAllDayEvent();
      var d = ev.getStartTime(), f = ev.getEndTime();
      evenements.push({ agenda: nomCal, titre: titre, journee: journee, lieu: ev.getLocation() || "",
        date: Utilities.formatDate(d, tz, "yyyy-MM-dd"), debut: journee ? "" : Utilities.formatDate(d, tz, "HH:mm"), fin: journee ? "" : Utilities.formatDate(f, tz, "HH:mm"),
        debutISO: d.toISOString(), finISO: f.toISOString(), optionnel: AGENDA_IGNORER.test(titre) || /tentative|MAYBE/i.test(statut), statut: statut });
    });
  });
  evenements.sort(function (a, b) { return a.debutISO.localeCompare(b.debutISO); });
  return { ok: true, version: VERSION, du: Utilities.formatDate(debut, tz, "yyyy-MM-dd"), au: Utilities.formatDate(new Date(fin.getTime() - 1), tz, "yyyy-MM-dd"),
    evenements: evenements, jours: creneauxLibres(evenements, debut, jours, tz) };
}
// Pour chaque jour : plages libres entre AGENDA_JOUR_DEBUT h et AGENDA_JOUR_FIN h (hors événements optionnels
// et journées entières), et deux raccourcis : midi (12 h–14 h libre d'au moins 75 min) et soir (19 h–22 h libre).
function creneauxLibres(evenements, debut, jours, tz) {
  var out = {};
  for (var j = 0; j < jours; j++) {
    var jour = new Date(debut.getTime() + j * 864e5), cle = Utilities.formatDate(jour, tz, "yyyy-MM-dd");
    var occ = evenements.filter(function (e) { return !e.optionnel && !e.journee && e.date === cle; })
      .map(function (e) { return [minutes(e.debut), minutes(e.fin)]; }).sort(function (a, b) { return a[0] - b[0]; });
    var libres = [], cur = AGENDA_JOUR_DEBUT * 60, finJ = AGENDA_JOUR_FIN * 60;
    occ.forEach(function (o) { if (o[0] > cur) libres.push([cur, Math.min(o[0], finJ)]); cur = Math.max(cur, o[1]); });
    if (cur < finJ) libres.push([cur, finJ]);
    libres = libres.filter(function (l) { return l[1] - l[0] >= 30; });
    var libre = function (a, b, min) { return libres.some(function (l) { return Math.min(l[1], b) - Math.max(l[0], a) >= min; }); };
    out[cle] = { libres: libres.map(function (l) { return [hhmm(l[0]), hhmm(l[1])]; }), midi: libre(12 * 60, 14 * 60, 75), soir: libre(19 * 60, 22 * 60, 90), occupe: occ.length,
      journee: evenements.filter(function (e) { return e.journee && e.date === cle && !e.optionnel; }).map(function (e) { return e.titre; }) };
  }
  return out;
}
function minutes(hm) { var m = String(hm || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function hhmm(m) { return (m / 60 < 10 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 < 10 ? "0" : "") + (m % 60); }

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
// Index partagé (relais v20 / correspondances v3) : index.json est la base, reconstruite à la main
// (reconstruireIndex) ; chaque compte qui écrit tient son propre fichier index-<compte>.json. Plus aucune
// écriture concurrente sur un même fichier par les trois boîtes. Lecture : fusion de tous les
// index*.json, la clé la plus récemment mise à jour l'emporte. Un fichier vide ou illisible est ignoré
// (il ne bloque plus les écritures : avant, un index.json vidé par une écriture interrompue restait vide).
function fichiersIndex(donnees) {
  var out = [], it = donnees.getFiles();
  while (it.hasNext()) { var f = it.next(), n = f.getName(); if (/^index(-.*)?\.json$/i.test(n)) out.push(f); }
  out.sort(function (a, b) { return a.getName() === "index.json" ? -1 : b.getName() === "index.json" ? 1 : a.getName() < b.getName() ? -1 : 1; });
  return out;
}
function lireIndex(donnees) {
  var cles = {}, quand = {};
  fichiersIndex(donnees).forEach(function (f) {
    var j = lireJsonDe(f); if (!j || typeof j.cles !== "object") return;
    Object.keys(j.cles).forEach(function (k) {
      var m = String((j.cles[k] && j.cles[k].misAJour) || "");
      if (!(k in cles) || m >= String(quand[k] || "")) { cles[k] = j.cles[k]; quand[k] = m; }
    });
  });
  return cles;
}
function ecrireIndex(donnees, index) {
  var nom = nomIndexPerso(), f = fichierDans(donnees, nom);
  var lu = f ? lireJsonDe(f) : null, actuel = (lu && typeof lu.cles === "object") ? lu.cles : {};
  Object.keys(index).forEach(function (k) { actuel[k] = index[k]; });
  var contenu = JSON.stringify({ version: VERSION, compte: nom, misAJour: new Date().toISOString(), cles: actuel });
  if (f) f.setContent(contenu); else donnees.createFile(nom, contenu, "application/json");
  return true;
}
function nomIndexPerso() { return "index-relais.json"; }
// Reconstruit index.json à partir de tous les fichiers _données/<clé>.json (à lancer à la main une fois,
// ou après un incident). Les clés déjà présentes et lisibles sont conservées puis mises à jour.
// Une relance ne relit que les fichiers absents de l'index (reconstruireIndexComplet() relit tout).
// v22 : si index.json manque ou est vide (écriture interrompue), il est reconstruit par tranches de
// 20 s dans les appels du Mac mini eux-mêmes (stamp/export, toutes les minutes), sans déclencheur ni
// service supplémentaire. reconstruireIndex() reprend là où elle s'est arrêtée : une dizaine d'appels
// suffisent pour 600 fichiers. Une fois complet, vérification au plus une fois par heure (cache).
var RECONSTRUCTION_TRANCHE_MS = 20000;
function verifierIndex() {
  try {
    var cache = CacheService.getScriptCache(); if (cache.get("indexVerifie")) return;
    var dossier = dossierCorrespondances(); if (!dossier) return;
    var f = fichierDans(sousDossier(dossier, "_données"), "index.json");
    if (!cache.get("indexEnCours") && f && f.getSize() > 0) { cache.put("indexVerifie", "1", 3600); return; }
    var r = reconstruireIndex(false, RECONSTRUCTION_TRANCHE_MS);
    if (r && r.restants > 0) cache.put("indexEnCours", "1", 1800);
    else { cache.remove("indexEnCours"); cache.put("indexVerifie", "1", 3600); }
  } catch (e) { Logger.log("verifierIndex : " + e); }
}
function reconstruireIndexComplet() { reconstruireIndex(true); }
function reconstruireIndex(complet, budgetMs) {
  var dossier = dossierCorrespondances(); if (!dossier) { Logger.log("Dossier des correspondances introuvable."); return null; }
  var donnees = sousDossier(dossier, "_données"), debut = Date.now();
  var f = fichierDans(donnees, "index.json"), lu = f ? lireJsonDe(f) : null, cles = (lu && lu.cles) || {};
  var avant = Object.keys(cles).length, n = 0, sansMd = 0, sautes = 0, restants = 0;
  var dejaNoms = {}; Object.keys(cles).forEach(function (k) { dejaNoms[k.replace(/[\\\/:*?"<>|]/g, "_") + ".json"] = 1; });
  var it = donnees.getFiles();
  while (it.hasNext()) {
    var fj = it.next(), nomF = fj.getName();
    if (!/\.json$/i.test(nomF) || nomF === "index.json" || nomF.indexOf("_etat-") === 0) continue;
    if (!complet && dejaNoms[nomF]) { sautes++; continue; }
    if (Date.now() - debut > (budgetMs || 5 * 60000)) { restants++; continue; }
    var j = lireJsonDe(fj); if (!j || !j.cle || !Array.isArray(j.entrees)) continue;
    var nom = j.nom || j.cle, fMd = null;
    if (cles[j.cle] && cles[j.cle].fichierId) { try { fMd = DriveApp.getFileById(cles[j.cle].fichierId); if (fMd.isTrashed()) fMd = null; } catch (e) { fMd = null; } }
    if (!fMd) fMd = fichierDans(dossier, nomFichierSur(nom) + ".md");
    if (!fMd) { sansMd++; continue; }
    var canaux = {}; j.entrees.forEach(function (e) { if (e && e.canal) canaux[e.canal] = 1; });
    cles[j.cle] = { nom: nom, fichierId: fMd.getId(), url: "https://drive.google.com/file/d/" + fMd.getId() + "/view", n: j.entrees.length,
      dernier: j.entrees.length ? j.entrees[j.entrees.length - 1].date : "", canaux: Object.keys(canaux), misAJour: j.misAJour || "" };
    n++;
  }
  var contenu = JSON.stringify({ version: VERSION, misAJour: new Date().toISOString(), cles: cles });
  if (f) f.setContent(contenu); else donnees.createFile("index.json", contenu, "application/json");
  Logger.log("Index reconstruit : " + n + " fichier(s) lus, " + sautes + " déjà indexés, " + Object.keys(cles).length + " clé(s) (" + avant + " avant), " + sansMd + " sans fichier .md" + (restants ? ", " + restants + " restant(s) : relancer reconstruireIndex()." : "."));
  return { lus: n, cles: Object.keys(cles).length, restants: restants };
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

// v19 : dates de dernière modification des fichiers, sans en lire le contenu. Le Mac mini
// interroge « stamp » chaque minute et ne demande l'export complet que si `data` a changé.
function stamp() {
  var out = { ok: true, version: VERSION, maintenant: new Date().toISOString() };
  [["data", FICHIER_DATA], ["evenements", FICHIER_EVENEMENTS], ["assistant", FICHIER_ASSISTANT]].forEach(function (c) {
    var f = trouver(c[1]); out[c[0]] = f ? f.getLastUpdated().toISOString() : null;
  });
  return out;
}
function trouver(nom) { var it = DriveApp.getFilesByName(nom); return it.hasNext() ? it.next() : null; }
function lireJson(nom) { var f = trouver(nom); if (!f) return null; try { return JSON.parse(f.getBlob().getDataAsString() || "{}"); } catch (e) { return null; } }
function reponse(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
