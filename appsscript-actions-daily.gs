/**
 * Operations01 — Rappels quotidiens (Actions + Rendez-vous).
 *
 * Chaque matin à 9h, ce script Google Apps Script :
 *   1. lit le fichier « operations01-data.json » de votre Google Drive
 *      (le même que celui de la web app) ;
 *   2. envoie à chaque interlocuteur un rappel pour chaque ACTION encore
 *      ouverte (option « rappel quotidien » activée) ;
 *   3. vous envoie à vous-même un récapitulatif des RENDEZ-VOUS du lendemain.
 *
 * INSTALLATION (à faire une seule fois) :
 *   1. Ouvrez https://script.google.com et créez un nouveau projet.
 *   2. Collez tout ce fichier (remplacez le code par défaut).
 *   3. Menu de fonctions → choisissez « installerDeclencheurQuotidien »,
 *      cliquez « Exécuter » et autorisez l'accès (Drive + Gmail).
 *
 * Si vous aviez déjà installé la version précédente : recollez ce code,
 * enregistrez, puis relancez « installerDeclencheurQuotidien » une fois.
 * (L'ancien déclencheur est remplacé, pas de doublon.)
 *
 * Pour tester tout de suite : exécutez « envoyerRappelsQuotidiens ».
 */

// Nom du fichier de données sur le Drive (identique à la config de la web app).
var NOM_FICHIER = "operations01-data.json";

/**
 * Crée (ou recrée) le déclencheur quotidien à 9h.
 * À lancer une seule fois après avoir collé le script.
 */
function installerDeclencheurQuotidien() {
  // Supprime les anciens déclencheurs de ce script pour éviter les doublons.
  var aSupprimer = ["envoyerRappelsQuotidiens", "envoyerRappelsActions"];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (aSupprimer.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("envoyerRappelsQuotidiens")
    .timeBased()
    .everyDays(1)
    .atHour(9) // 9h, fuseau horaire du projet Apps Script
    .create();
  Logger.log("Déclencheur quotidien installé : envoi chaque jour vers 9h (actions + rendez-vous).");
}

/** Fonction lancée chaque matin par le déclencheur : enchaîne les deux rappels. */
function envoyerRappelsQuotidiens() {
  var data = lireDonnees();
  if (!data) {
    Logger.log("Fichier " + NOM_FICHIER + " introuvable sur le Drive.");
    return;
  }
  envoyerRappelsActions(data);
  envoyerRappelsRendezvous(data);
}

/**
 * Envoie un rappel pour chaque Action ouverte.
 * @param {Object=} data  Données déjà chargées (sinon lues depuis le Drive).
 */
function envoyerRappelsActions(data) {
  data = data || lireDonnees();
  if (!data) { Logger.log("Données introuvables."); return; }

  var actions = (data.actions || []).filter(function (a) {
    return a && !a.closed && a.reminderDaily !== false && a.recipientEmail;
  });
  var envoyes = 0;
  actions.forEach(function (a) {
    var email = String(a.recipientEmail).trim();
    if (!validerEmail(email)) return;

    var projet = a.projectName || nomMission(data, a.missionId) || "";
    var objet = "Rappel — " + (a.title || "Document / information à transmettre");
    var lignes = [];
    lignes.push("Bonjour " + (a.recipientName || "") + ",");
    lignes.push("");
    lignes.push("Ceci est un rappel concernant l'élément suivant, toujours en attente :");
    lignes.push("");
    lignes.push("• Objet : " + (a.title || "—"));
    if (projet) lignes.push("• Projet : " + projet);
    if (a.request) lignes.push("• À transmettre : " + a.request);
    if (a.dueDate) lignes.push("• Échéance souhaitée : " + a.dueDate);
    lignes.push("");
    lignes.push("Merci de votre retour.");
    lignes.push("");
    lignes.push("— Rappel automatique Operations01");

    MailApp.sendEmail(email, objet, lignes.join("\n"));
    envoyes++;
  });
  Logger.log(envoyes + " rappel(s) d'action envoyé(s).");
}

/**
 * Vous envoie (au propriétaire du script) un récapitulatif des rendez-vous
 * du lendemain. Rien n'est envoyé s'il n'y en a pas.
 * @param {Object=} data  Données déjà chargées (sinon lues depuis le Drive).
 */
function envoyerRappelsRendezvous(data) {
  data = data || lireDonnees();
  if (!data) { Logger.log("Données introuvables."); return; }

  var demain = dateISO(1); // date du lendemain (yyyy-MM-dd), fuseau du script
  var rdvs = (data.rendezvous || []).filter(function (r) {
    return r && (r.date || "").slice(0, 10) === demain;
  }).sort(function (a, b) { return (a.time || "").localeCompare(b.time || ""); });

  if (!rdvs.length) { Logger.log("Aucun rendez-vous demain."); return; }

  var moi = Session.getActiveUser().getEmail();
  if (!validerEmail(moi)) { Logger.log("E-mail du propriétaire indisponible."); return; }

  var lignes = [];
  lignes.push("Bonjour,");
  lignes.push("");
  lignes.push("Rappel de vos rendez-vous de demain (" + demain + ") :");
  lignes.push("");
  rdvs.forEach(function (r) {
    var avec = r.withName || "";
    var details = [r.time || "", avec, r.location ? "📍 " + r.location : ""].filter(Boolean).join(" · ");
    lignes.push("• " + (r.title || "Rendez-vous") + (details ? "  —  " + details : ""));
    if (r.notes) lignes.push("    " + r.notes);
  });
  lignes.push("");
  lignes.push("— Rappel automatique Operations01");

  MailApp.sendEmail(moi, "Vos rendez-vous de demain (" + rdvs.length + ")", lignes.join("\n"));
  Logger.log(rdvs.length + " rendez-vous rappelé(s) à " + moi + ".");
}

/** Lit et parse le fichier JSON depuis le Drive. Renvoie null si absent. */
function lireDonnees() {
  var it = DriveApp.getFilesByName(NOM_FICHIER);
  if (!it.hasNext()) return null;
  try {
    return JSON.parse(it.next().getBlob().getDataAsString("UTF-8"));
  } catch (e) {
    Logger.log("JSON invalide : " + e);
    return null;
  }
}

/** Retrouve le titre d'une mission à partir de son identifiant. */
function nomMission(data, missionId) {
  if (!missionId) return "";
  var m = (data.missions || []).filter(function (x) { return x.id === missionId; })[0];
  return m ? (m.title || "") : "";
}

/** Date décalée de "decalageJours" par rapport à aujourd'hui, au format yyyy-MM-dd. */
function dateISO(decalageJours) {
  var d = new Date();
  d.setDate(d.getDate() + (decalageJours || 0));
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/** Validation e-mail simple. */
function validerEmail(e) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}
