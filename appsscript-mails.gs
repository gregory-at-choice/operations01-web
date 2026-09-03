/**
 * Operations01 — Analyse des e-mails (façon CRM Folk) + index de correspondance.
 *
 * Ce script tourne dans VOTRE compte Google. Chaque heure, il :
 *   1. lit vos contacts depuis « operations01-data.json » (Drive), s'il y a accès ;
 *   2. analyse votre Gmail et repère :
 *        📩 les mails NON LUS reçus d'un contact connu,
 *        ⏰ les fils où vous avez écrit en dernier sans réponse depuis 7 jours,
 *        🆕 les expéditeurs qui ne sont pas encore dans vos contacts,
 *        📅 les rendez-vous des 7 prochains jours avec un contact ;
 *   3. dresse un INDEX des fils de discussion récents (expéditeur, destinataires,
 *      objet, date, court extrait, lien) : la web app s'en sert pour afficher la
 *      correspondance de chaque projet ;
 *   4. écrit le résultat dans le fichier d'analyse (Drive), que la web app lit.
 *
 * ── Boîte PRINCIPALE (le compte relié à la web app) ─────────────────────────
 *   Laissez FICHIER_MAILS_ID vide. Ouvrez une fois l'onglet « Relances » dans la
 *   web app (connectée à Drive) : cela crée « operations01-mails.json ».
 *
 * ── Boîte SECONDAIRE (un autre compte Google) ───────────────────────────────
 *   Dans la web app : Relances → Boîtes mail → « + Ajouter une boîte ». L'app
 *   crée un fichier d'analyse pour cette boîte, le partage avec ce compte, et
 *   vous donne son IDENTIFIANT. Collez-le ci-dessous dans FICHIER_MAILS_ID,
 *   puis installez ce script depuis ce compte-là (https://script.google.com).
 *
 * INSTALLATION (une seule fois, dans chaque compte) :
 *   1. https://script.google.com → Nouveau projet.
 *   2. Collez tout ce fichier (remplacez le code par défaut).
 *   3. Exécutez « installerAnalyseMails » et autorisez l'accès (Gmail + Drive).
 *   Pour tester tout de suite : exécutez « analyserMails ».
 *
 * Confidentialité : tout reste dans vos comptes Google. Le fichier d'analyse
 * contient expéditeur / destinataires / objet / date / lien, et un extrait de
 * EXTRAIT_CARACTERES caractères du dernier message (0 pour ne rien extraire).
 */

var FICHIER_MAILS_ID = "";        // vide = boîte principale (fichier trouvé par son nom)
var DATA_FILE = "operations01-data.json";
var MAILS_FILE = "operations01-mails.json";
var FREQUENCE_MINUTES = 15;       // passage toutes les N minutes (1, 5, 10, 15 ou 30 ; 60 = toutes les heures)
var RELANCE_JOURS = 7;            // relance suggérée après N jours sans réponse
var MAX_THREADS = 80;             // plafond de sécurité par recherche (alertes)
var INDEX_JOURS = 120;            // profondeur de l'index de correspondance
var INDEX_MAX = 400;              // nombre maximal de fils indexés
var EXTRAIT_CARACTERES = 160;     // longueur de l'extrait conservé (0 = aucun)
// Dossier de rangement des fichiers JSON de l'app (boîte principale uniquement).
// La web app n'a le droit d'écrire que « là où elle est » (portée drive.file) :
// c'est ce script, qui a accès à tout le Drive, qui range ses fichiers.
var DOSSIER_JSON = "soft/src-json";
var MOI = "";                     // adresse du compte courant, fixée à l'exécution (liens Gmail)

function installerAnalyseMails() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "analyserMails") ScriptApp.deleteTrigger(t);
  });
  var t = ScriptApp.newTrigger("analyserMails").timeBased();
  if ([1, 5, 10, 15, 30].indexOf(FREQUENCE_MINUTES) > -1) { t.everyMinutes(FREQUENCE_MINUTES).create(); Logger.log("Analyse des mails installée : toutes les " + FREQUENCE_MINUTES + " minutes."); }
  else { t.everyHours(1).create(); Logger.log("Analyse des mails installée : toutes les heures."); }
}

function analyserMails() {
  var cible = FICHIER_MAILS_ID ? fichierParId(FICHIER_MAILS_ID) : trouverFichier(MAILS_FILE);
  if (!cible) {
    Logger.log(FICHIER_MAILS_ID
      ? "Fichier d'analyse introuvable : vérifiez FICHIER_MAILS_ID et que la web app l'a partagé avec ce compte."
      : "« " + MAILS_FILE + " » introuvable : ouvrez d'abord l'onglet Relances dans la web app.");
    return;
  }
  // Les contacts sont facultatifs : une boîte secondaire n'y a pas forcément accès.
  var data = lireFichier(DATA_FILE) || lireFichierPartage(DATA_FILE) || {};
  var contacts = data.contacts || [];
  var parEmail = {};
  contacts.forEach(function (c) { if (c.email) parEmail[String(c.email).toLowerCase().trim()] = c; });
  var moi = String(Session.getActiveUser().getEmail() || "").toLowerCase();
  MOI = moi;

  var unread = [], relance = [], nouveau = [], rdvPrep = [];
  var vusNouveaux = {};

  // 📩 / 🆕 — non lus récents de la boîte de réception
  GmailApp.search("is:unread in:inbox newer_than:30d", 0, MAX_THREADS).forEach(function (th) {
    var msgs = th.getMessages(); var last = msgs[msgs.length - 1];
    var email = extraireEmail(last.getFrom());
    var item = { from: email, name: nomExpediteur(last.getFrom()) || email, subject: th.getFirstMessageSubject(), date: last.getDate().toISOString(), link: lienThread(th) };
    if (parEmail[email]) { item.name = contactNom(parEmail[email]); unread.push(item); }
    else if (email && email !== moi && !vusNouveaux[email]) { vusNouveaux[email] = true; nouveau.push(item); }
  });

  // ⏰ — fils envoyés, je suis le dernier, > N jours, destinataire = contact
  var limite = Date.now() - RELANCE_JOURS * 86400000;
  GmailApp.search("in:sent newer_than:60d", 0, MAX_THREADS).forEach(function (th) {
    var msgs = th.getMessages(); var last = msgs[msgs.length - 1];
    if (extraireEmail(last.getFrom()) !== moi) return;      // quelqu'un a répondu après moi
    if (last.getDate().getTime() > limite) return;          // trop récent
    var dests = String(last.getTo() || "").split(",").map(extraireEmail);
    var c = null;
    for (var i = 0; i < dests.length; i++) { if (parEmail[dests[i]]) { c = parEmail[dests[i]]; break; } }
    if (!c) return;
    relance.push({ from: c.email, name: contactNom(c), subject: th.getFirstMessageSubject(), date: last.getDate().toISOString(), link: lienThread(th), jours: Math.floor((Date.now() - last.getDate().getTime()) / 86400000) });
  });

  // 📅 — rendez-vous des 7 prochains jours avec un contact
  var today = dateISO(0), dans7 = dateISO(7);
  (data.rendezvous || []).forEach(function (r) {
    var d = String(r.date || "").slice(0, 10);
    if (d < today || d > dans7) return;
    var c = null;
    if (r.contactId) c = premier(contacts, function (x) { return x.id === r.contactId; });
    if (!c && r.withName) c = premier(contacts, function (x) { return contactNom(x).toLowerCase() === String(r.withName).toLowerCase(); });
    var item = { subject: r.title || "Rendez-vous", date: d, name: r.withName || (c ? contactNom(c) : "") };
    if (c && c.email) { var th = GmailApp.search("from:" + c.email + " OR to:" + c.email, 0, 1); if (th.length) item.link = lienThread(th[0]); }
    rdvPrep.push(item);
  });

  // 🗂 — index des fils récents, pour la correspondance par projet.
  // Incrémental : l'index précédent est conservé et seuls les fils ayant reçu un
  // message depuis le dernier passage (marge d'une heure) sont relus. Un passage
  // toutes les 15 minutes reste ainsi léger pour les quotas Gmail.
  var precedent = lireJsonDe(cible) || {};
  var index = {};
  (precedent.threads || []).forEach(function (t) { if (t && t.id) index[t.id] = t; });
  var complet = !Object.keys(index).length || !precedent.generatedAt;
  var requete = "newer_than:" + INDEX_JOURS + "d -in:spam -in:trash";
  if (!complet) requete += " after:" + Math.floor((new Date(precedent.generatedAt).getTime() - 3600000) / 1000);
  var relus = 0;
  GmailApp.search(requete, 0, INDEX_MAX).forEach(function (th) {
    relus++;
    var msgs = th.getMessages(); if (!msgs.length) return;
    var last = msgs[msgs.length - 1];
    var parts = {};
    msgs.forEach(function (m) {
      [m.getFrom(), m.getTo(), m.getCc()].forEach(function (s) {
        String(s || "").split(",").forEach(function (x) { var e = extraireEmail(x); if (e && e !== moi) parts[e] = nomExpediteur(x) || parts[e] || ""; });
      });
    });
    var people = Object.keys(parts).map(function (e) { return { email: e, name: parts[e] }; });
    var extrait = "";
    if (EXTRAIT_CARACTERES > 0) {
      try { extrait = String(last.getPlainBody() || "").replace(/\s+/g, " ").trim().slice(0, EXTRAIT_CARACTERES); } catch (e) { extrait = ""; }
    }
    index[th.getId()] = {
      id: th.getId(),
      subject: th.getFirstMessageSubject() || "(sans objet)",
      from: extraireEmail(last.getFrom()),
      fromName: nomExpediteur(last.getFrom()) || extraireEmail(last.getFrom()),
      people: people,
      date: last.getDate().toISOString(),
      count: msgs.length,
      unread: th.isUnread(),
      mine: extraireEmail(last.getFrom()) === moi,
      snippet: extrait,
      link: lienThread(th)
    };
  });
  // État lu / non lu de tous les fils indexés : une seule recherche, sans lire les messages.
  var nonLus = {};
  GmailApp.search("is:unread newer_than:" + INDEX_JOURS + "d -in:spam -in:trash", 0, 500).forEach(function (th) { nonLus[th.getId()] = true; });
  var horizon = Date.now() - INDEX_JOURS * 86400000;
  var threads = Object.keys(index).map(function (id) { var t = index[id]; t.unread = !!nonLus[id]; return t; })
    .filter(function (t) { return new Date(t.date).getTime() >= horizon; })
    .sort(function (x, y) { return String(y.date).localeCompare(String(x.date)); })
    .slice(0, INDEX_MAX);

  var out = { updatedAt: Date.now(), generatedAt: new Date().toISOString(), mailbox: moi,
    unread: unread, relance: relance, nouveau: nouveau, rdvPrep: rdvPrep, threads: threads };
  cible.setContent(JSON.stringify(out));
  Logger.log(unread.length + " non lus, " + relance.length + " à relancer, " + nouveau.length + " nouveaux, " + rdvPrep.length + " RDV, " + threads.length + " fils indexés (" + relus + " relus" + (complet ? ", index complet" : "") + ").");
  try { rangerFichiersJson(); } catch (e) { Logger.log("Rangement des JSON impossible : " + e); }
}

// Range dans DOSSIER_JSON tous les fichiers « operations01-*.json » que possède ce
// compte (données, sauvegardes, conflits, analyses de mails). Boîte principale
// seulement : les boîtes secondaires n'ont pas ces fichiers.
function rangerFichiersJson() {
  if (FICHIER_MAILS_ID || !DOSSIER_JSON) return;
  var dossier = dossierParChemin(DOSSIER_JSON);
  var it = DriveApp.searchFiles("title contains 'operations01-' and mimeType = 'application/json' and trashed = false and 'me' in owners");
  var n = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (!/^operations01-.*\.json$/.test(f.getName())) continue;
    var parents = f.getParents(), deja = false;
    while (parents.hasNext()) { if (parents.next().getId() === dossier.getId()) { deja = true; break; } }
    if (deja) continue;
    f.moveTo(dossier); n++;
  }
  if (n) Logger.log(n + " fichier(s) JSON rangé(s) dans « " + DOSSIER_JSON + " ».");
}
// Dossier désigné par un chemin « a/b/c » depuis la racine du Drive ; créé s'il manque.
function dossierParChemin(chemin) {
  var cur = DriveApp.getRootFolder();
  chemin.split("/").forEach(function (nom) {
    if (!nom) return;
    var it = cur.getFoldersByName(nom);
    cur = it.hasNext() ? it.next() : cur.createFolder(nom);
  });
  return cur;
}

// ---- Utilitaires ----
function extraireEmail(s) { var m = String(s || "").match(/<([^>]+)>/); return (m ? m[1] : String(s || "")).toLowerCase().trim(); }
function nomExpediteur(s) { var m = String(s || "").match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : ""; }
function contactNom(c) { return ((c.firstName || "") + " " + (c.lastName || "")).trim() || c.email || "Contact"; }
// « ?authuser=adresse » ouvre le fil dans ce compte-ci, et non dans le premier
// compte connecté du navigateur (« /u/0/ »).
function lienThread(th) {
  var base = MOI ? "https://mail.google.com/mail/?authuser=" + encodeURIComponent(MOI) : "https://mail.google.com/mail/u/0/";
  return base + "#all/" + th.getId();
}
function premier(arr, f) { for (var i = 0; i < arr.length; i++) if (f(arr[i])) return arr[i]; return null; }
function dateISO(dec) { var d = new Date(); d.setDate(d.getDate() + (dec || 0)); return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd"); }
function trouverFichier(name) { var it = DriveApp.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function fichierParId(id) { try { return DriveApp.getFileById(id); } catch (e) { return null; } }
function lireJsonDe(fichier) { try { return JSON.parse(fichier.getBlob().getDataAsString("UTF-8")); } catch (e) { return null; } }
function lireFichier(name) { var f = trouverFichier(name); if (!f) return null; try { return JSON.parse(f.getBlob().getDataAsString("UTF-8")); } catch (e) { return null; } }
// Sur une boîte secondaire, le fichier de données peut avoir été partagé en lecture.
function lireFichierPartage(name) {
  try {
    var it = DriveApp.searchFiles("title = '" + name + "' and sharedWithMe and trashed = false");
    if (!it.hasNext()) return null;
    return JSON.parse(it.next().getBlob().getDataAsString("UTF-8"));
  } catch (e) { return null; }
}
