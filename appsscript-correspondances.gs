/**
 * Operations01 — Archive des correspondances (Gmail → Drive).  Version 1.
 *
 * Ce script tourne dans VOTRE compte Google et construit, sur le Drive, le dossier
 * « Correspondances » : UN FICHIER .md PAR INTERLOCUTEUR, avec pour chaque message
 * la date, le sujet, le texte reçu, puis MA RÉPONSE (celle réellement envoyée).
 *
 *   Correspondances/
 *     Éric Chenneveau.md            ← lisible tel quel (Drive, Obsidian, l'app Documents…)
 *     Paul Seignolle.md
 *     _données/
 *       index.json                  ← clé (adresse ou téléphone) → nom, fichier, nombre de messages
 *       eric.chenneveau@free.fr.json ← les entrées brutes, d'où le .md est régénéré
 *
 * Le relais du Mac mini (appsscript-relais-evenements.gs, version 3) écrit dans les mêmes
 * fichiers pour les SMS / iMessage / WhatsApp, et sert ces archives à l'assistant pour
 * étayer ses propositions de réponse.
 *
 * ── Boîte PRINCIPALE (le compte relié à la web app) ──────────────────────────
 *   Laissez DOSSIER_CORRESPONDANCES_ID vide : le dossier « Correspondances » est créé à la
 *   racine du Drive et partagé en écriture avec les boîtes secondaires déclarées dans l'app
 *   (Relances → Boîtes mail). Le journal d'exécution affiche son IDENTIFIANT.
 *
 * ── Boîte SECONDAIRE (un autre compte Google) ────────────────────────────────
 *   Collez l'identifiant du dossier dans DOSSIER_CORRESPONDANCES_ID, puis installez ce
 *   script depuis ce compte-là (https://script.google.com).
 *
 * INSTALLATION (une fois par compte) :
 *   1. https://script.google.com → Nouveau projet (ou le projet « Operations01 mails »,
 *      fichier + → Script, nommé « correspondances »).
 *   2. Collez tout ce fichier.
 *   3. Exécutez « installerCorrespondances » et autorisez l'accès (Gmail + Drive).
 *   Pour tester tout de suite : exécutez « archiverCorrespondances ».
 *
 * Fonctionnement : toutes les FREQUENCE_MINUTES, (1) les fils qui ont bougé depuis le
 * dernier passage sont relus ; (2) l'historique est remonté par tranches de
 * MAX_FILS_PAR_PASSAGE fils, du plus récent vers ARCHIVE_DEPUIS, jusqu'à épuisement.
 * Sont ignorés : newsletters et notifications automatiques (no-reply, désinscription),
 * et les messages entre mes propres adresses.
 *
 * Confidentialité : tout reste dans vos comptes Google. Les textes sont tronqués à
 * MAX_CARACTERES caractères et débarrassés des citations (« Le … a écrit : »).
 */

var DOSSIER_CORRESPONDANCES_ID = "";   // vide = boîte principale (dossier créé à la racine)
var DOSSIER_NOM = "Correspondances";
var DATA_FILE = "operations01-data.json";
var FREQUENCE_MINUTES = 15;            // 1, 5, 10, 15, 30 ; 60 = toutes les heures
var ARCHIVE_DEPUIS = "2026-01-01";     // remonter l'historique jusqu'à cette date (les messages plus anciens ne sont pas archivés)
var MAX_FILS_PAR_PASSAGE = 60;         // historique : fils relus par passage (quota Gmail)
var MAX_FILS_RECENTS = 150;            // fils ayant bougé depuis le dernier passage
var MAX_CARACTERES = 4000;             // longueur maximale conservée par message
var DUREE_MAX_MS = 4.5 * 60 * 1000;    // garde-fou : Apps Script coupe à 6 minutes
var VERSION = 2;

var MOI = "";          // adresse du compte courant
var MES_ADRESSES = {}; // adresse → true (compte + alias)

function installerCorrespondances() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "archiverCorrespondances") ScriptApp.deleteTrigger(t);
  });
  var t = ScriptApp.newTrigger("archiverCorrespondances").timeBased();
  if ([1, 5, 10, 15, 30].indexOf(FREQUENCE_MINUTES) > -1) { t.everyMinutes(FREQUENCE_MINUTES).create(); Logger.log("Archive des correspondances installée : toutes les " + FREQUENCE_MINUTES + " minutes."); }
  else { t.everyHours(1).create(); Logger.log("Archive des correspondances installée : toutes les heures."); }
  archiverCorrespondances();
}

function archiverCorrespondances() {
  var debut = Date.now();
  var dossier = dossierCorrespondances();
  if (!dossier) return;
  MOI = String(Session.getActiveUser().getEmail() || "").toLowerCase();
  MES_ADRESSES = {}; MES_ADRESSES[MOI] = true;
  try { GmailApp.getAliases().forEach(function (a) { MES_ADRESSES[String(a).toLowerCase()] = true; }); } catch (e) {}
  var donnees = sousDossier(dossier, "_données");
  var contacts = contactsParAdresse();
  var etatFichier = fichierDans(donnees, "_etat-" + MOI + ".json");
  var etat = etatFichier ? (lireJsonDe(etatFichier) || {}) : {};
  var maintenant = new Date();

  var parCle = {};      // cle → { nom, entrees: [] } (accumulé ce passage)
  var fils = 0, messages = 0;
  var traiterFil = function (th) {
    fils++;
    var res = entreesDuFil(th, contacts);
    res.forEach(function (x) {
      var g = parCle[x.cle] || (parCle[x.cle] = { nom: x.nom, entrees: [] });
      if (!g.nom && x.nom) g.nom = x.nom;
      g.entrees.push(x.entree); messages++;
    });
  };

  // 1) Fils ayant bougé depuis le dernier passage (marge d'une heure).
  if (etat.dernierPassage) {
    var depuis = Math.floor((new Date(etat.dernierPassage).getTime() - 3600000) / 1000);
    GmailApp.search("after:" + depuis + " -in:spam -in:trash -in:chats", 0, MAX_FILS_RECENTS).forEach(traiterFil);
  }
  // 2) Historique, du plus récent vers le plus ancien, par tranches.
  var curseur = etat.curseurAvant || null;   // "yyyy/MM/dd" : tout ce qui est plus ancien reste à faire
  var historiqueFini = !!etat.historiqueFini;
  if (!historiqueFini && Date.now() - debut < DUREE_MAX_MS) {
    var req = "-in:spam -in:trash -in:chats after:" + ARCHIVE_DEPUIS.replace(/-/g, "/") + (curseur ? " before:" + curseur : "");
    var lot = GmailApp.search(req, 0, MAX_FILS_PAR_PASSAGE);
    var plusAncien = null;
    lot.forEach(function (th) {
      if (Date.now() - debut > DUREE_MAX_MS) return;
      traiterFil(th);
      var d = th.getLastMessageDate();
      if (!plusAncien || d < plusAncien) plusAncien = d;
    });
    if (lot.length < MAX_FILS_PAR_PASSAGE) historiqueFini = true;
    if (plusAncien) {
      // « before: » est exclusif au jour près : on recule au jour du plus ancien fil lu,
      // + 1 jour pour ne pas perdre les fils du même jour (ils seront relus, sans doublon).
      var j = new Date(plusAncien.getTime() + 86400000);
      var nouveauCurseur = Utilities.formatDate(j, Session.getScriptTimeZone(), "yyyy/MM/dd");
      if (nouveauCurseur === curseur) { j = new Date(plusAncien.getTime()); nouveauCurseur = Utilities.formatDate(j, Session.getScriptTimeZone(), "yyyy/MM/dd"); }
      curseur = nouveauCurseur;
    }
  }

  // 3) Écriture : un .json + un .md par interlocuteur, puis l'index.
  var cles = Object.keys(parCle), ecrits = 0;
  var index = lireIndex(donnees);
  cles.forEach(function (cle) {
    if (Date.now() - debut > DUREE_MAX_MS + 60000) return;   // on finit au prochain passage (les fils seront relus)
    var g = parCle[cle];
    var r = fusionnerInterlocuteur(dossier, donnees, cle, g.nom, g.entrees, index);
    if (r) ecrits++;
  });
  ecrireIndex(donnees, index);

  etat.dernierPassage = maintenant.toISOString();
  etat.curseurAvant = curseur; etat.historiqueFini = historiqueFini; etat.version = VERSION;
  etat.compte = MOI;
  if (etatFichier) etatFichier.setContent(JSON.stringify(etat)); else donnees.createFile("_etat-" + MOI + ".json", JSON.stringify(etat), "application/json");
  Logger.log(fils + " fil(s) lus, " + messages + " message(s), " + ecrits + " interlocuteur(s) mis à jour · historique " + (historiqueFini ? "complet" : "en cours (avant " + curseur + ")") + " · dossier " + dossier.getId());
}

// ---- Lecture d'un fil Gmail : une entrée par message reçu d'un tiers (avec ma réponse qui suit),
//      et une entrée par message que j'ai envoyé sans répondre à personne (fil que j'ouvre).
function entreesDuFil(th, contacts) {
  var out = [];
  var msgs;
  try { msgs = th.getMessages(); } catch (e) { return out; }
  if (!msgs.length) return out;
  var sujet = th.getFirstMessageSubject() || "(sans objet)";
  var lien = lienThread(th);
  var infos = msgs.map(function (m) {
    var de = extraireEmail(m.getFrom());
    return { m: m, de: de, deNom: nomExpediteur(m.getFrom()), moi: !!MES_ADRESSES[de], date: m.getDate() };
  });
  for (var i = 0; i < infos.length; i++) {
    var x = infos[i];
    if (x.moi) {
      // Mon message qui n'est pas une réponse à un tiers juste avant : fil que j'ouvre.
      if (i > 0 && !infos[i - 1].moi) continue;
      var dests = destinatairesTiers(x.m);
      if (!dests.length) continue;
      var texte = texteUtile(x.m);
      if (!texte) continue;
      dests.forEach(function (d) {
        out.push({ cle: d.email, nom: nomInterlocuteur(d.email, d.nom, contacts), entree: {
          id: "mail:" + x.m.getId() + ":" + d.email, canal: "mail", compte: MOI, sens: "envoye", date: x.date.toISOString(),
          sujet: sujet, de: nomInterlocuteur(d.email, d.nom, contacts), deAdresse: d.email, message: "", reponse: texte, reponseLe: x.date.toISOString(), lien: lien } });
      });
      continue;
    }
    if (estAutomatique(x.m, x.de)) continue;
    var recu = texteUtile(x.m);
    if (!recu && !x.m.getAttachments().length) continue;
    // Ma première réponse après ce message (avant le message suivant du tiers).
    var rep = null;
    for (var j = i + 1; j < infos.length; j++) { if (infos[j].moi) { rep = infos[j]; break; } if (infos[j].de === x.de) break; }
    out.push({ cle: x.de, nom: nomInterlocuteur(x.de, x.deNom, contacts), entree: {
      id: "mail:" + x.m.getId(), canal: "mail", compte: MOI, sens: "recu", date: x.date.toISOString(),
      sujet: sujet, de: nomInterlocuteur(x.de, x.deNom, contacts), deAdresse: x.de,
      message: recu || "(pièce jointe sans texte)", reponse: rep ? texteUtile(rep.m) : "", reponseLe: rep ? rep.date.toISOString() : "", lien: lien } });
  }
  return out;
}
function destinatairesTiers(m) {
  var vus = {}, out = [];
  [m.getTo(), m.getCc()].forEach(function (s) {
    String(s || "").split(",").forEach(function (x) {
      var e = extraireEmail(x); if (!e || MES_ADRESSES[e] || vus[e]) return;
      vus[e] = true; out.push({ email: e, nom: nomExpediteur(x) });
    });
  });
  return out.slice(0, 6);
}
// Newsletters, notifications, robots : pas des interlocuteurs.
function estAutomatique(m, de) {
  if (/^(no-?reply|ne-?pas-?repondre|noreply|donotreply|notification|notifications|newsletter|news|info|mailer-daemon|postmaster|bounce|alert|alerts|support|contact|hello|bonjour|team|equipe|marketing|billing|facture|invoice)[@.+_-]/i.test(de)) return true;
  try { if (m.getHeader("List-Unsubscribe") || m.getHeader("List-Id") || /bulk|list|auto-?replied|auto-?generated/i.test(m.getHeader("Precedence") + " " + m.getHeader("Auto-Submitted"))) return true; } catch (e) {}
  return false;
}
function texteUtile(m) {
  var brut = "";
  try { brut = String(m.getPlainBody() || ""); } catch (e) { brut = ""; }
  return nettoyerCorps(brut, MAX_CARACTERES);
}
function nomInterlocuteur(email, nomHeader, contacts) {
  var c = contacts[email];
  if (c) return c;
  var n = String(nomHeader || "").replace(/^['"\s]+|['"\s]+$/g, "");
  if (n && n.indexOf("@") === -1) return n;
  return email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, function (x) { return x.toUpperCase(); });
}

// ---- Fonctions pures (partagées avec le relais ; testables hors Apps Script) ----
// Retire citations, en-têtes de transfert et signature ; tronque.
function nettoyerCorps(texte, max) {
  var t = String(texte || "").replace(/\r\n?/g, "\n");
  var coupes = [
    /^\s*Le\s.{3,80}?\s(a|à)\sécrit\s?:\s*$/m, /^\s*On\s.{3,80}?\swrote\s?:\s*$/m,
    /^\s*-{2,}\s*(Message d'origine|Original Message|Message transféré|Forwarded message)\s*-{2,}\s*$/mi,
    /^\s*(De|From)\s?:\s.+\n\s*(Envoyé|Sent|Date)\s?:/m, /^\s*_{8,}\s*$/m,
    /^\s*Envoyé de mon iPhone\s*$/m, /^\s*Sent from my iPhone\s*$/m, /^\s*Envoyé à partir de Outlook/m, /^\s*Get Outlook for/mi,
    /^\s*--\s*$/m, /^\s*Cordialement,?\s*$/m, /^\s*Bien cordialement,?\s*$/m, /^\s*Bien à (vous|toi),?\s*$/m, /^\s*Best regards,?\s*$/mi
  ];
  var fin = t.length;
  coupes.forEach(function (re) { var m = re.exec(t); if (m && m.index < fin && m.index > 0) fin = m.index; });
  t = t.slice(0, fin);
  t = t.split("\n").filter(function (l) { return !/^\s*>/.test(l); }).join("\n");
  t = t.replace(/\[image:[^\]]*\]/gi, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (max && t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + " […]";
  return t;
}
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
// Fusion d'entrées par id ; l'entrée la plus complète (réponse présente) l'emporte ; tri par date.
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
// Le fichier .md d'un interlocuteur, régénéré à partir de ses entrées.
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

// ---- Drive : fusion d'un interlocuteur (json + md) et index ----
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
function lireIndex(donnees) { var f = fichierDans(donnees, "index.json"); var j = f ? lireJsonDe(f) : null; return (j && j.cles) || {}; }
function ecrireIndex(donnees, index) {
  var f = fichierDans(donnees, "index.json");
  // Un autre compte a pu écrire entre-temps : on repart de sa version et on y pose nos clés.
  // Un index présent mais illisible (lecture tronquée, écriture concurrente) n'est JAMAIS écrasé :
  // on le laisse tel quel, on le signale, et reconstruireIndex() le refait à partir des fichiers.
  var lu = f ? lireJsonDe(f) : null;
  if (f && (!lu || typeof lu.cles !== "object")) { Logger.log("index.json présent mais illisible : non réécrit (lancer reconstruireIndex())."); return false; }
  var actuel = (lu && lu.cles) || {};
  Object.keys(index).forEach(function (k) { actuel[k] = index[k]; });
  var contenu = JSON.stringify({ version: VERSION, misAJour: new Date().toISOString(), cles: actuel });
  if (f) f.setContent(contenu); else donnees.createFile("index.json", contenu, "application/json");
  return true;
}
// Reconstruit index.json à partir de tous les fichiers _données/<clé>.json (à lancer à la main une fois,
// ou après un incident). Les clés déjà présentes et lisibles sont conservées puis mises à jour.
// Une relance ne relit que les fichiers absents de l'index (reconstruireIndexComplet() relit tout).
function reconstruireIndexComplet() { reconstruireIndex(true); }
function reconstruireIndex(complet) {
  var dossier = dossierCorrespondances(); if (!dossier) { Logger.log("Dossier des correspondances introuvable."); return; }
  var donnees = sousDossier(dossier, "_données"), debut = Date.now();
  var f = fichierDans(donnees, "index.json"), lu = f ? lireJsonDe(f) : null, cles = (lu && lu.cles) || {};
  var avant = Object.keys(cles).length, n = 0, sansMd = 0, sautes = 0, restants = 0;
  var dejaNoms = {}; Object.keys(cles).forEach(function (k) { dejaNoms[k.replace(/[\\\/:*?"<>|]/g, "_") + ".json"] = 1; });
  var it = donnees.getFiles();
  while (it.hasNext()) {
    var fj = it.next(), nomF = fj.getName();
    if (!/\.json$/i.test(nomF) || nomF === "index.json" || nomF.indexOf("_etat-") === 0) continue;
    if (!complet && dejaNoms[nomF]) { sautes++; continue; }
    if (Date.now() - debut > 5 * 60000) { restants++; continue; }
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
}
function dossierCorrespondances() {
  if (DOSSIER_CORRESPONDANCES_ID) {
    try { return DriveApp.getFolderById(DOSSIER_CORRESPONDANCES_ID); }
    catch (e) { Logger.log("Dossier introuvable : vérifiez DOSSIER_CORRESPONDANCES_ID et que la boîte principale l'a partagé avec ce compte."); return null; }
  }
  var racine = DriveApp.getRootFolder(), it = racine.getFoldersByName(DOSSIER_NOM);
  var d = it.hasNext() ? it.next() : racine.createFolder(DOSSIER_NOM);
  partagerAvecBoitesSecondaires(d);
  return d;
}
// Les boîtes secondaires déclarées dans l'app (Relances → Boîtes mail) reçoivent le droit d'écrire.
function partagerAvecBoitesSecondaires(d) {
  var data = lireFichier(DATA_FILE); if (!data) return;
  var editeurs = {}; try { d.getEditors().forEach(function (u) { editeurs[String(u.getEmail()).toLowerCase()] = 1; }); } catch (e) {}
  (data.mailboxes || []).forEach(function (b) {
    var e = String(b.email || "").toLowerCase(); if (!e || editeurs[e]) return;
    try { d.addEditor(e); Logger.log("Dossier partagé avec " + e); } catch (err) { Logger.log("Partage impossible avec " + e + " : " + err); }
  });
}
function sousDossier(d, nom) { var it = d.getFoldersByName(nom); return it.hasNext() ? it.next() : d.createFolder(nom); }
function fichierDans(d, nom) { var it = d.getFilesByName(nom); return it.hasNext() ? it.next() : null; }
function contactsParAdresse() {
  var data = lireFichier(DATA_FILE) || lireFichierPartage(DATA_FILE) || {};
  var out = {};
  (data.contacts || []).forEach(function (c) {
    var e = String(c.email || "").toLowerCase().trim(); if (!e) return;
    var n = ((c.firstName || "") + " " + (c.lastName || "")).trim();
    if (n) out[e] = n;
  });
  return out;
}

// ---- Utilitaires ----
function extraireEmail(s) { var m = String(s || "").match(/<([^>]+)>/); return (m ? m[1] : String(s || "")).toLowerCase().trim(); }
function nomExpediteur(s) { var m = String(s || "").match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : ""; }
function lienThread(th) {
  var base = MOI ? "https://mail.google.com/mail/?authuser=" + encodeURIComponent(MOI) : "https://mail.google.com/mail/u/0/";
  return base + "#all/" + th.getId();
}
function trouverFichier(name) { var it = DriveApp.getFilesByName(name); return it.hasNext() ? it.next() : null; }
function lireJsonDe(fichier) { try { return JSON.parse(fichier.getBlob().getDataAsString("UTF-8")); } catch (e) { return null; } }
function lireFichier(name) { var f = trouverFichier(name); if (!f) return null; try { return JSON.parse(f.getBlob().getDataAsString("UTF-8")); } catch (e) { return null; } }
function lireFichierPartage(name) {
  try {
    var it = DriveApp.searchFiles("title = '" + name + "' and sharedWithMe and trashed = false");
    if (!it.hasNext()) return null;
    return JSON.parse(it.next().getBlob().getDataAsString("UTF-8"));
  } catch (e) { return null; }
}
