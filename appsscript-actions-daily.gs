/**
 * Operations01 — Rappels quotidiens des Actions ouvertes.
 *
 * Ce script Google Apps Script lit le fichier « operations01-data.json »
 * stocké sur votre Google Drive (le même que celui utilisé par la web app)
 * et envoie chaque matin à 9h un e-mail de rappel au destinataire de chaque
 * Action encore ouverte (dont l'option « rappel quotidien » est active).
 *
 * INSTALLATION (à faire une seule fois) :
 *   1. Ouvrez https://script.google.com et créez un nouveau projet.
 *   2. Collez tout ce fichier dans l'éditeur (remplacez le code par défaut).
 *   3. Menu « Exécuter » → choisissez la fonction « installerDeclencheurQuotidien »
 *      puis autorisez l'accès (Drive + Gmail) quand Google le demande.
 *   4. C'est terminé : à partir de demain 9h, les rappels partent tout seuls.
 *
 * Pour tester tout de suite : exécutez « envoyerRappelsActions » manuellement.
 */

// Nom du fichier de données sur le Drive (identique à la config de la web app).
var NOM_FICHIER = "operations01-data.json";

/**
 * Crée (ou recrée) le déclencheur quotidien à 9h.
 * À lancer une seule fois après avoir collé le script.
 */
function installerDeclencheurQuotidien() {
  // Supprime les anciens déclencheurs de cette fonction pour éviter les doublons.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "envoyerRappelsActions") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("envoyerRappelsActions")
    .timeBased()
    .everyDays(1)
    .atHour(9) // 9h, fuseau horaire du projet Apps Script
    .create();
  Logger.log("Déclencheur quotidien installé : envoi chaque jour vers 9h.");
}

/**
 * Lit le fichier Drive et envoie un rappel pour chaque Action ouverte.
 */
function envoyerRappelsActions() {
  var data = lireDonnees();
  if (!data) {
    Logger.log("Fichier " + NOM_FICHIER + " introuvable sur le Drive.");
    return;
  }
  var actions = (data.actions || []).filter(function (a) {
    return a && !a.closed && a.reminderDaily !== false && a.recipientEmail;
  });
  if (!actions.length) {
    Logger.log("Aucune action ouverte à rappeler.");
    return;
  }

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
  Logger.log(envoyes + " rappel(s) envoyé(s).");
}

/** Lit et parse le fichier JSON depuis le Drive. Renvoie null si absent. */
function lireDonnees() {
  var it = DriveApp.getFilesByName(NOM_FICHIER);
  if (!it.hasNext()) return null;
  var fichier = it.next();
  try {
    return JSON.parse(fichier.getBlob().getDataAsString("UTF-8"));
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

/** Validation e-mail simple. */
function validerEmail(e) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}
