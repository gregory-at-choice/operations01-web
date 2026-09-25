/**
 * Operations01 — Banque. Lit les relevés de compte (PDF Société Générale) et les factures
 * (PDF) déjà rangés sur le Google Drive, en extrait le texte, et écrit le résultat dans
 * operations01-banque.json — fichier CRÉÉ PAR LA WEB APP (portée drive.file) ; ce script
 * écrit dedans. Aucun fichier n'est déplacé ni modifié ; les PDF ne sont que lus.
 *
 * INSTALLATION (une fois) :
 *   1. script.google.com → Nouveau projet → nommer « Operations01 banque » → coller ce code.
 *   2. À gauche, « Services » (+) → « Drive API » → Ajouter (sert à extraire le texte des PDF).
 *   3. Exécuter la fonction « parcourir » une première fois → autoriser le script.
 *   4. Exécuter « installerDeclencheur » : le script repasse ensuite chaque heure tout seul.
 *   Le fichier operations01-banque.json est créé par l'app : ouvrir une fois Finances → Banque.
 *
 * CE QUI EST LU :
 *   - Relevés : les PDF des dossiers DOSSIERS_RELEVES (identifiants Drive, sous-dossiers inclus)
 *     dont le nom commence par « releve_ » (Société Générale) ou contient « Extrait de comptes »
 *     (Crédit Mutuel), plus tous les « releve_… » ailleurs sur le Drive. La banque est reconnue
 *     au contenu du PDF. Seuls les relevés de la période RELEVES_DU → RELEVES_AU sont lus.
 *   - Factures : les PDF (et photos JPEG/PNG, lues par OCR) des dossiers listés dans DOSSIERS_FACTURES
 *     et du dossier DOSSIER_JUSTIFICATIFS_ID (sous-dossiers inclus). Trois sources y convergent :
 *     les factures rangées sur le Drive, les reçus joints aux mails (déposés par le script dans
 *     « Reçus mails ») et les factures papier, numérisées puis déposées dans ce dossier.
 *   Chaque PDF n'est analysé qu'une fois (puis de nouveau s'il change). Au plus MAX_PAR_PASSAGE
 *   nouveaux fichiers par passage : le rattrapage initial se fait en plusieurs heures.
 *
 * FORMAT ÉCRIT (lu par l'app) :
 *   { version, parcouruLe, restant, comptes:[{compte,titulaire}],
 *     releves:[{ fileId, nom, url, compte, titulaire, du, au, soldeDebut, soldeFin, totalDebit, totalCredit,
 *                equilibre, ecart, ops:[{ id, date, valeur, nature, detail, montant, doute }] }],
 *     factures:[{ fileId, nom, url, dossier, date, montant, devise, montants, fournisseur, extrait }],
 *     erreurs:[{ fileId, nom, erreur }] }
 *   montant : négatif = débit, positif = crédit. Dates en AAAA-MM-JJ.
 */
var VERSION = 9;
var FICHIER_BANQUE = "operations01-banque.json";
var PREFIXE_RELEVES = "releve_";
// Dossiers de relevés (identifiants Drive : la partie après /folders/ dans l'adresse du dossier).
var DOSSIERS_RELEVES = ["1A1A3CEj11AppDRtLXEId_zcNLuSmzmjP", "1IKRnxvvM2OKHDimxMAxOMpoSIbDuOa87"];
function estReleve(nom) { return nom.indexOf(PREFIXE_RELEVES) === 0 || /extrait de comptes/i.test(nom); }
// Date du relevé d'après le nom : « …_28022026.pdf » (SG), « … au 2026-07-31.pdf » ou « 2505_… » (CM).
function dateReleveDuNom(nom) {
  var m = /_(\d{2})(\d{2})(\d{4})\.pdf$/i.exec(nom); if (m) return m[3] + "-" + m[2] + "-" + m[1];
  m = / au (\d{4}-\d{2}-\d{2})/.exec(nom); if (m) return m[1];
  m = /^(\d{2})(\d{2})_/.exec(nom); if (m) return "20" + m[1] + "-" + m[2] + "-28";
  return null;
}
function releveDansPeriode(d) {
  var date = dateReleveDuNom(d.nom) || d.creeLe;
  return date >= RELEVES_DU && date <= RELEVES_AU;
}
var DOSSIERS_FACTURES = ["FACTURES", "factures", "Facture MAJ", "FACTURATION_CLIENTS", "FACTURATION_CHOICE", "Comptable", "Factures-CXS-TBP"];
// Factures clients (celles que CHOICE émet) : les dossiers dont le nom contient FACTURATION. Elles
// reçoivent en plus une lecture dédiée (numéro, client, HT, TVA, TTC, échéance) que l'app importe
// en produits. VERSION_CLIENTS ne relit que ces fichiers-là quand cette lecture change.
var DOSSIERS_CLIENTS_RE = /FACTURATION/i;
var VERSION_CLIENTS = 2;
// Même principe pour les relevés : VERSION_RELEVES ne relit que les relevés quand leur lecture change.
var VERSION_RELEVES = 2;
function estFactureClient(dossier) { return DOSSIERS_CLIENTS_RE.test(String(dossier || "").split("/")[0]); }
// Justificatifs rapprochés depuis l'app : l'app (portée drive.file) les dépose dans son propre
// dossier « Justificatifs choice » ; à chaque passage, le script les range dans le dossier
// ci-dessous (identifiant Drive). Déplacer un fichier ne change pas son lien.
var DOSSIER_JUSTIFICATIFS_ID = "1QeYC-urT3UNnalK1up-namQfJxcnqOYx";
var DOSSIER_APP_JUSTIFICATIFS = "Justificatifs choice";
// Reçus reçus par mail : les PDF joints aux mails (hors envoyés) depuis MAILS_DEPUIS sont déposés
// dans le sous-dossier « Reçus mails » du dossier Justificatifs, puis analysés comme des factures
// (montant, date, fournisseur). L'app propose alors, pour chaque opération, les documents dont
// le montant est exact au centime, en tenant compte de la date et du nom.
var LIRE_MAILS = true;
var MAILS_DEPUIS = "2025/12/01";           // format Gmail (aaaa/mm/jj)
var MAILS_MAX_PAR_PASSAGE = 25;            // pièces jointes déposées par passage
var MAILS_TAILLE_MAX = 6 * 1024 * 1024;
var DOSSIER_RECUS_MAILS = "Reçus mails";
function expediteurCourt(de) {
  var m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(String(de || ""));
  var nom = m ? m[1] : String(de || "").replace(/<[^>]+>/g, "").trim();
  if (!nom || nom.indexOf("@") > -1) { var ma = /@([\w.-]+)/.exec(String(de || "")); nom = ma ? ma[1].replace(/\.(com|fr|net|org|io|co)$/, "").split(".").pop() : nom; }
  return nom.replace(/[\/\\:*?"<>|]+/g, " ").trim().slice(0, 40);
}
// Alertes bancaires reçues par mail (SG « Alertes », CM « Alertes Web ») : chaque mail est lu, et
// s'il contient un montant et une opération, elle est déposée comme opération PROVISOIRE, en
// attendant le relevé qui la confirmera. Le texte est conservé (400 caractères) pour vérifier la lecture.
var LIRE_ALERTES = true;
var ALERTES_EXPEDITEURS = ["socgen.com", "societegenerale.fr", "sg.fr", "particuliers.sg.fr", "professionnels.sg.fr", "creditmutuel.fr", "creditmutuel.com", "cmut.fr", "e-i.com"];
var ALERTES_DEPUIS = "2026/09/01";
var ALERTES_MAX = 400;
function importerAlertes(data) {
  if (!LIRE_ALERTES || typeof GmailApp === "undefined") return 0;
  data.alertes = Array.isArray(data.alertes) ? data.alertes : [];
  data.alertesVues = data.alertesVues || {};
  var q = "(" + ALERTES_EXPEDITEURS.map(function (d) { return "from:" + d; }).join(" OR ") + ") -in:sent -in:trash after:" + ALERTES_DEPUIS;
  var threads = GmailApp.search(q, 0, 100), n = 0;
  threads.forEach(function (t) {
    t.getMessages().forEach(function (msg) {
      var id = msg.getId(); if (data.alertesVues[id]) return;
      data.alertesVues[id] = 1;
      var a = parserAlerte(msg.getSubject(), msg.getPlainBody(), msg.getFrom(), Utilities.formatDate(msg.getDate(), "Europe/Paris", "yyyy-MM-dd"));
      a.mail = id; data.alertes.push(a); n++;
    });
  });
  data.alertes.sort(function (a, b) { return (b.dateMail || "").localeCompare(a.dateMail || ""); });
  data.alertes = data.alertes.slice(0, ALERTES_MAX);
  if (n) Logger.log(n + " alerte(s) bancaire(s) lue(s).");
  return n;
}
var ALERTE_DEBIT_RE = /d[ée]bit|paiement|pr[ée]l[èe]vement|retrait|virement (?:[ée]mis|effectu[ée]|envoy[ée])|achat|carte/i;
var ALERTE_CREDIT_RE = /cr[ée]dit|virement (?:re[çc]u|en votre faveur)|remise|versement|encaissement/i;
function parserAlerte(sujet, corps, de, dateMail) {
  var t = normaliser(sujet + "\n" + String(corps || "")).replace(/\r/g, "");
  var a = { sujet: String(sujet || "").slice(0, 120), de: String(de || "").slice(0, 80), dateMail: dateMail, banque: /creditmutuel|cmut|e-i\.com/i.test(de) ? "CM" : /socgen|societegenerale|sg\.fr/i.test(de) ? "SG" : "", date: null, montant: null, sens: null, libelle: "", compteFin: null, texte: t.slice(0, 400) };
  var mm = /(-?\s?\d{1,3}(?:[ \u00a0.]?\d{3})*(?:,\d{2})?)\s?(?:€|EUR|euros?)/i.exec(t);
  if (mm) { var v = nombreLibre(mm[1].replace(/\s/g, "")); if (v != null) a.montant = Math.abs(v); }
  if (a.montant == null) return a;
  var ds = datesDans(t.slice(0, 600));
  if (ds.length) a.date = ds[0].iso;
  else { var md = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t); if (md) { var y = +dateMail.slice(0, 4); a.date = isoDate(y, +md[2], +md[1]) || null; if (a.date && a.date > dateMail) a.date = isoDate(y - 1, +md[2], +md[1]); } }
  if (!a.date) a.date = dateMail;
  var around = t.slice(0, 600);
  a.sens = (/-\s?\d/.test(mm[0]) || ALERTE_DEBIT_RE.test(around)) && !ALERTE_CREDIT_RE.test(around) ? "debit" : ALERTE_CREDIT_RE.test(around) ? "credit" : "debit";
  var mc = /\b(\d{11})\b/.exec(t) || /(?:\.{2,}|\*{2,}|x{2,}|X{2,})\s?(\d{4})\b/.exec(t) || /compte[^\n\d]{0,30}(\d{4})\b/i.exec(t);
  if (mc) a.compteFin = mc[1].slice(-4);
  var ml = /(?:chez|aupr[èe]s de|libell[ée]\s*:?|b[ée]n[ée]ficiaire\s*:?|de la part de|[ée]metteur\s*:?|\d{1,2}\/\d{1,2}(?:\/\d{4})?\s*:)\s*([^\n.]{3,80})/i.exec(t);
  a.libelle = (ml ? ml[1] : String(sujet || "")).replace(/\s+(a [ée]t[ée]|sur (votre|le|ton|vos)|de votre|du compte|depuis) .*$/i, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return a;
}
function importerRecusMails(data) {
  if (!LIRE_MAILS || !DOSSIER_JUSTIFICATIFS_ID || typeof GmailApp === "undefined") return 0;
  var parent; try { parent = DriveApp.getFolderById(DOSSIER_JUSTIFICATIFS_ID); } catch (e) { return 0; }
  var it = parent.getFoldersByName(DOSSIER_RECUS_MAILS);
  var dossier = it.hasNext() ? it.next() : parent.createFolder(DOSSIER_RECUS_MAILS);
  data.mailsVus = data.mailsVus || {};   // "idMessage|nomPièce" → identifiant du fichier déposé
  var n = 0, start = 0, q = "has:attachment filename:pdf -in:sent -in:trash after:" + MAILS_DEPUIS;
  while (n < MAILS_MAX_PAR_PASSAGE) {
    var threads = GmailApp.search(q, start, 50);
    if (!threads.length) break;
    start += threads.length;
    for (var i = 0; i < threads.length && n < MAILS_MAX_PAR_PASSAGE; i++) {
      var msgs = threads[i].getMessages();
      for (var j = 0; j < msgs.length && n < MAILS_MAX_PAR_PASSAGE; j++) {
        var msg = msgs[j];
        if (msg.isInTrash()) continue;
        var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
        for (var k = 0; k < atts.length && n < MAILS_MAX_PAR_PASSAGE; k++) {
          var a = atts[k];
          if (!/pdf/i.test(a.getContentType() || "") && !/\.pdf$/i.test(a.getName() || "")) continue;
          if (a.getSize() > MAILS_TAILLE_MAX) continue;
          var cle = msg.getId() + "|" + a.getName();
          if (data.mailsVus[cle]) continue;
          var jour = Utilities.formatDate(msg.getDate(), "Europe/Paris", "yyyy-MM-dd");
          var nom = jour + " " + expediteurCourt(msg.getFrom()) + " - " + a.getName();
          try {
            var f = dossier.createFile(a.copyBlob().setName(nom));
            f.setDescription(JSON.stringify({ mail: msg.getId(), de: msg.getFrom(), sujet: msg.getSubject(), date: jour }));
            data.mailsVus[cle] = f.getId(); n++;
          } catch (e) { Logger.log("Dépôt impossible (" + nom + ") : " + e); data.mailsVus[cle] = "erreur"; }
        }
      }
    }
  }
  if (n) Logger.log(n + " reçu(s) de mail déposé(s) dans « " + DOSSIER_RECUS_MAILS + " ».");
  return n;
}
function rangerJustificatifs() {
  if (!DOSSIER_JUSTIFICATIFS_ID) return 0;
  var cible; try { cible = DriveApp.getFolderById(DOSSIER_JUSTIFICATIFS_ID); } catch (e) { Logger.log("Dossier des justificatifs introuvable : " + e); return 0; }
  var n = 0, it = DriveApp.getFoldersByName(DOSSIER_APP_JUSTIFICATIFS);
  while (it.hasNext()) {
    var src = it.next(); if (src.getId() === cible.getId()) continue;
    var fs = src.getFiles();
    while (fs.hasNext()) { var f = fs.next(); try { f.moveTo(cible); n++; } catch (e) { Logger.log("Déplacement impossible (" + f.getName() + ") : " + e); } }
  }
  if (n) Logger.log(n + " justificatif(s) rangé(s) dans le dossier Justificatifs.");
  return n;
}
// Relevés : seule la période ci-dessous est lue (date du relevé, lue dans le nom du fichier ;
// à défaut, date de création du fichier).
var RELEVES_DU = "2026-01-01";
var RELEVES_AU = "2026-12-31";
// Factures : fichiers créés avant cette date ignorés (les factures de fin 2025 peuvent être
// payées en 2026, d'où une marge de deux mois).
var DEPUIS = "2025-11-01";
var MAX_PAR_PASSAGE = 40;                  // fichiers analysés par passage (≈ 15 s chacun)
var DUREE_MAX_MS = 20 * 60 * 1000;         // on s'arrête avant la limite d'exécution de Google (30 min)
var PROFONDEUR_MAX = 6;

// ----------------------------------------------------------------------------
// Passage principal (déclencheur horaire ou exécution manuelle)
// ----------------------------------------------------------------------------
function parcourir() {
  // Un seul passage à la fois : si un autre tourne (déclencheur horaire), on s'arrête sans bruit.
  var verrou = LockService.getScriptLock();
  if (!verrou.tryLock(30000)) { Logger.log("Un autre passage est en cours : celui-ci s'arrête, le suivant reprendra."); return; }
  try {
    try { rangerJustificatifs(); } catch (e) { Logger.log("Rangement des justificatifs : " + e); }
    var fichier = trouver(FICHIER_BANQUE);
    if (!fichier) throw new Error("Fichier " + FICHIER_BANQUE + " absent : ouvrir une fois Finances → Banque dans Operations01.");
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (e) { data = {}; }
    data.version = VERSION;
    data.releves = Array.isArray(data.releves) ? data.releves : [];
    data.factures = Array.isArray(data.factures) ? data.factures : [];
    data.erreurs = Array.isArray(data.erreurs) ? data.erreurs : [];
    try { importerRecusMails(data); } catch (e) { Logger.log("Reçus des mails : " + String(e && e.message || e)); }
    try { importerAlertes(data); } catch (e) { Logger.log("Alertes bancaires : " + String(e && e.message || e)); }
    // Un fichier est (re)lu s'il est nouveau, modifié, ou analysé par une version antérieure du script.
    var connus = {}, vc = {};
    var cle = function (x) { return x.mt + "|" + (x.v || 0); };
    data.releves.forEach(function (r) { connus[r.fileId] = cle(r); vc[r.fileId] = r.vr || 0; });
    data.factures.forEach(function (f) { connus[f.fileId] = cle(f); vc[f.fileId] = f.vc || 0; });
    data.erreurs.forEach(function (e) { connus[e.fileId] = cle(e); });

    var vus = {}, aFaire = [];
    listerReleves().forEach(function (f) { vus[f.id] = true; if (connus[f.id] !== f.mt + "|" + VERSION || (connus[f.id] && vc[f.id] !== VERSION_RELEVES)) aFaire.push(f); });
    try { listerExports().forEach(function (f) { vus[f.id] = true; if (connus[f.id] !== f.mt + "|" + VERSION) aFaire.push(f); }); } catch (e) { Logger.log("Exports CSV : " + e); }
    // Les factures sont secondaires : si Drive refuse l'inventaire (erreur passagère), on garde
    // celles déjà connues et on passe quand même les relevés.
    var facturesOk = true, vusF = {};
    try { listerFactures().forEach(function (f) { vusF[f.id] = true; if (connus[f.id] !== f.mt + "|" + VERSION || (estFactureClient(f.dossier) && connus[f.id] && vc[f.id] !== VERSION_CLIENTS)) aFaire.push(f); }); }
    catch (e) { facturesOk = false; Logger.log("Inventaire des factures impossible ce passage (" + String(e && e.message || e) + ") : relevés seuls."); }
    // Les relevés d'abord : ce sont eux qui comptent, les factures suivent.
    // Ordre : relevés, puis factures clients, puis le reste (les plus récents d'abord).
    var rang = function (x) { return x.type === "releve" || x.type === "export" ? 0 : estFactureClient(x.dossier) ? 1 : 2; };
    aFaire.sort(function (a, b) { return rang(a) - rang(b) || (b.mt || "").localeCompare(a.mt || ""); });
    // Fichiers disparus (corbeille, déplacés hors des dossiers) : retirés.
    data.releves = data.releves.filter(function (r) { return vus[r.fileId]; });
    if (facturesOk) data.factures = data.factures.filter(function (f) { return vusF[f.fileId]; });
    data.erreurs = data.erreurs.filter(function (e) { return e.type === "releve" ? vus[e.fileId] : (!facturesOk || vusF[e.fileId]); });

    var lot = aFaire.slice(0, MAX_PAR_PASSAGE), debut = Date.now(), faits = 0;
    lot.forEach(function (f) {
      if (Date.now() - debut > DUREE_MAX_MS) return;   // le reste attend le passage suivant
      faits++;
      retirer(data, f.id);
      var texte = "";
      try {
        if (f.type === "export") {
          texte = texteDuFichier(f.fichier);
          var x0 = parserExport(texte, f.nom, f.compte);
          x0.fileId = f.id; x0.nom = f.nom; x0.url = f.url; x0.mt = f.mt; x0.v = VERSION; x0.vr = VERSION_RELEVES; x0.nbOps = x0.ops.length;
          x0.texte = String(texte || "").slice(0, 30000);
          data.releves.push(x0);
          return;
        }
        texte = texteDuPdf(f.fichier);
        if (f.type === "releve") {
          var r = parserReleve(texte, f.nom);
          r.fileId = f.id; r.nom = f.nom; r.url = f.url; r.mt = f.mt; r.v = VERSION; r.vr = VERSION_RELEVES;
          r.texte = String(texte || "").slice(0, 30000);   // texte extrait, conservé pour vérifier la lecture
          data.releves.push(r);
        } else {
          var x = parserFacture(texte, f.nom, f.dossier);
          x.fileId = f.id; x.nom = f.nom; x.url = f.url; x.dossier = f.dossier; x.mt = f.mt; x.creeLe = f.creeLe; x.v = VERSION;
          if (estFactureClient(f.dossier)) {
            var c = parserFactureClient(texte, f.nom);
            x.client = c; x.vc = VERSION_CLIENTS;
            if (c.ttc != null) x.montant = c.ttc;
            if (c.date) x.date = c.date;
            if (c.client) x.fournisseur = c.client;
          }
          if (f.mail) { x.mail = f.mail; if (!x.date) x.date = f.mail.date; if (!x.fournisseur || x.fournisseur === f.nom.replace(/\.pdf$/i, "").replace(/[_\-]+/g, " ").slice(0, 60)) x.fournisseur = expediteurCourt(f.mail.de) || x.fournisseur; }
          data.factures.push(x);
        }
      } catch (e) {
        data.erreurs.push({ fileId: f.id, nom: f.nom, url: f.url, mt: f.mt, type: f.type, v: VERSION, erreur: String(e && e.message || e), texte: String(texte || "").slice(0, 30000) });
      }
    });
    epurerExports(data);
    data.releves.sort(function (a, b) { return (b.au || "").localeCompare(a.au || ""); });
    data.factures.sort(function (a, b) { return (b.date || b.creeLe || "").localeCompare(a.date || a.creeLe || ""); });
    data.comptes = comptesDe(data.releves);
    data.restant = aFaire.length - faits;
    data.parcouruLe = new Date().toISOString();
    data.updatedAt = Date.now();
    fichier.setContent(JSON.stringify(data));
    Logger.log("Banque : " + faits + " fichier(s) analysé(s), " + data.restant + " restant(s), " + data.releves.length + " relevés, " + data.factures.length + " factures.");
  } finally { verrou.releaseLock(); }
}

function installerDeclencheur() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "parcourir") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("parcourir").timeBased().everyHours(1).create();
  Logger.log("Déclencheur installé : « parcourir » toutes les heures.");
}

function retirer(data, id) {
  ["releves", "factures", "erreurs"].forEach(function (k) { data[k] = data[k].filter(function (x) { return x.fileId !== id; }); });
}
function comptesDe(releves) {
  var m = {};
  releves.forEach(function (r) { if (r.compte && !m[r.compte]) m[r.compte] = { compte: r.compte, titulaire: r.titulaire || "" }; });
  return Object.keys(m).map(function (k) { return m[k]; });
}

// ----------------------------------------------------------------------------
// Inventaire des fichiers
// ----------------------------------------------------------------------------
function descripteur(f, type, dossier) {
  var d = { id: f.getId(), nom: f.getName(), url: f.getUrl(), mt: f.getLastUpdated().toISOString(), creeLe: f.getDateCreated().toISOString().slice(0, 10), type: type, dossier: dossier || "", fichier: f };
  try { var desc = f.getDescription(); if (desc && desc.charAt(0) === "{") { var m = JSON.parse(desc); if (m && m.mail) d.mail = m; } } catch (e) {}
  return d;
}
// ----------------------------------------------------------------------------
// Exports CSV / OFX déposés à la main (dossier « Exports banque » sur le Drive, un sous-dossier par
// numéro de compte, ex. « Exports banque/00020909761/ »). Lus comme des relevés provisoires : quand
// le relevé PDF de la période arrive, les opérations qu'il confirme sont retirées de l'export.
// ----------------------------------------------------------------------------
var DOSSIER_EXPORTS = "Exports banque";
function listerExports() {
  var out = [], it = DriveApp.getFoldersByName(DOSSIER_EXPORTS);
  while (it.hasNext()) collecterExports(it.next(), null, 0, out);
  return out;
}
function collecterExports(dossier, compte, prof, out) {
  if (prof > 3 || dossier.isTrashed()) return;
  var m = /(\d{11})/.exec(dossier.getName()); if (m) compte = m[1];
  var fichiers = avecReprise(function () { var l = [], fs = dossier.getFiles(); while (fs.hasNext()) l.push(fs.next()); return l; }, "dossier " + dossier.getName());
  fichiers.forEach(function (f) {
    if (f.isTrashed() || !/\.(csv|txt|tsv|ofx|qif)$/i.test(f.getName())) return;
    var d = descripteur(f, "export", dossier.getName()); d.compte = compte; out.push(d);
  });
  var sous = avecReprise(function () { var l = [], it = dossier.getFolders(); while (it.hasNext()) l.push(it.next()); return l; }, "sous-dossiers de " + dossier.getName());
  sous.forEach(function (sd) { collecterExports(sd, compte, prof + 1, out); });
}
function texteDuFichier(fichier) {
  var blob = fichier.getBlob(), bytes = blob.getBytes(), t;
  try { t = Utilities.newBlob(bytes).getDataAsString("UTF-8"); } catch (e) { t = ""; }
  if (!t || /\uFFFD/.test(t)) { try { t = Utilities.newBlob(bytes).getDataAsString("ISO-8859-1"); } catch (e2) {} }
  return String(t || "").replace(/^\uFEFF/, "");
}
function csvSplit(l, sep) {
  var out = [], cur = "", q = false;
  for (var i = 0; i < l.length; i++) {
    var ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(function (x) { return x.trim(); });
}
function csvSep(l) { var c = { ";": (l.match(/;/g) || []).length, "\t": (l.match(/\t/g) || []).length, ",": (l.match(/,/g) || []).length }; return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; })[0]; }
function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function parserExport(texte, nom, compteDossier) {
  var r = { banque: "", csv: true, compte: compteDossier || null, titulaire: "", du: null, au: null, soldeDebut: null, soldeFin: null, totalDebit: 0, totalCredit: 0, ops: [], equilibre: null, ecart: null };
  var t = String(texte || "");
  var mc = /\b(\d{11})\b/.exec(t.slice(0, 2000)) || /(\d{11})/.exec(nom); if (mc && !r.compte) r.compte = mc[1];
  var lignes = t.split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ""; });
  var rows = [];
  if (/<OFX>|<STMTTRN>/i.test(t)) {
    t.split(/<STMTTRN>/i).slice(1).forEach(function (b) {
      var g = function (tag) { var m = new RegExp("<" + tag + ">([^<\\r\\n]*)", "i").exec(b); return m ? m[1].trim() : ""; };
      var amt = parseFloat(g("TRNAMT").replace(",", ".")), dt = g("DTPOSTED").slice(0, 8);
      if (isFinite(amt) && dt.length === 8) rows.push({ date: dt.slice(0, 4) + "-" + dt.slice(4, 6) + "-" + dt.slice(6, 8), label: (g("NAME") + " " + g("MEMO")).trim() || "Opération", amount: amt });
    });
    var ma = /<ACCTID>([^<]+)/i.exec(t); if (ma && !r.compte) r.compte = ma[1].trim().slice(-11);
  } else {
    var hi = -1, sep = ";", cols = [];
    for (var i = 0; i < Math.min(lignes.length, 30); i++) {
      var d = csvSep(lignes[i]), cells = csvSplit(lignes[i], d).map(sansAccents);
      if (cells.some(function (c) { return c.indexOf("date") > -1; }) && cells.some(function (c) { return /montant|debit|credit/.test(c); })) { hi = i; sep = d; cols = cells; break; }
    }
    if (hi < 0) throw new Error("Export non reconnu : pas de ligne d'en-tête avec Date et Montant / Débit / Crédit.");
    var find = function (keys) { for (var k = 0; k < keys.length; k++) { for (var j = 0; j < cols.length; j++) if (cols[j].indexOf(keys[k]) > -1) return j; } return -1; };
    var iDate = find(["date de comptab", "date d'ope", "date ope", "date operation", "date"]), iVal = find(["date de valeur", "date val"]);
    var iLabel = find(["libelle", "description", "nature", "motif", "intitule", "operation"]), iDetail = find(["detail", "informations complementaires", "commentaire"]);
    var iAmount = find(["montant"]), iDebit = find(["debit"]), iCredit = find(["credit"]);
    for (var n = hi + 1; n < lignes.length; n++) {
      var c = csvSplit(lignes[n], sep); if (c.length < 2) continue;
      var ds = datesDans(c[iDate] || ""); if (!ds.length) continue;
      var amount = null;
      if (iAmount > -1 && (c[iAmount] || "").trim() !== "") amount = nombreLibre(c[iAmount].replace(/[€ ]/g, ""));
      else { var deb = iDebit > -1 && c[iDebit] ? nombreLibre(c[iDebit].replace(/[€ ]/g, "")) : null, cred = iCredit > -1 && c[iCredit] ? nombreLibre(c[iCredit].replace(/[€ ]/g, "")) : null; amount = cred != null && cred !== 0 ? Math.abs(cred) : (deb != null && deb !== 0 ? -Math.abs(deb) : null); }
      if (amount == null) continue;
      var dv = iVal > -1 ? datesDans(c[iVal] || "") : [];
      rows.push({ date: ds[0].iso, valeur: dv.length ? dv[0].iso : ds[0].iso, label: ((iLabel > -1 ? c[iLabel] : "") + " " + (iDetail > -1 ? c[iDetail] : "")).replace(/\s+/g, " ").trim() || "Opération", amount: amount });
    }
  }
  var byKey = {};
  rows.forEach(function (x) {
    var mots = x.label.split(" "), nature = [], k = 0;
    for (; k < mots.length && k < 3; k++) { if (!/^[A-Z][A-Z.'\-]*$/.test(mots[k])) break; nature.push(mots[k]); }
    var key = (r.compte || "?") + "-" + x.date + "-" + x.amount.toFixed(2); byKey[key] = (byKey[key] || 0) + 1;
    r.ops.push({ id: key + "-x" + byKey[key], date: x.date, valeur: x.valeur || x.date, nature: nature.join(" ") || x.label.slice(0, 30), detail: x.label.slice(0, 400), tiers: "", montant: x.amount, doute: false, csv: true });
    if (x.amount < 0) r.totalDebit += -x.amount; else r.totalCredit += x.amount;
  });
  r.ops.sort(function (a, b) { return a.date.localeCompare(b.date); });
  if (r.ops.length) { r.du = r.ops[0].date; r.au = r.ops[r.ops.length - 1].date; }
  r.totalDebit = Math.round(r.totalDebit * 100) / 100; r.totalCredit = Math.round(r.totalCredit * 100) / 100;
  if (!r.ops.length) throw new Error("Export sans opération lisible.");
  return r;
}
// Les opérations d'un export déjà présentes sur un relevé PDF du même compte (même date à ± 3 j, même montant) sont retirées.
function epurerExports(data) {
  var pdf = data.releves.filter(function (r) { return !r.csv; });
  data.releves.forEach(function (r) {
    if (!r.csv) return;
    r.ops = (r.ops || []).filter(function (o) {
      return !pdf.some(function (p) { return p.compte === r.compte && (p.ops || []).some(function (q) { return Math.abs(q.montant - o.montant) < 0.005 && Math.abs(new Date(q.date) - new Date(o.date)) <= 3 * 86400000; }); });
    });
    r.confirmees = (r.nbOps || r.ops.length) - r.ops.length;
  });
  data.releves = data.releves.filter(function (r) { return !r.csv || r.ops.length; });
}
function listerReleves() {
  var out = [], vus = {};
  // 1. Les dossiers de relevés, sous-dossiers (années) inclus.
  DOSSIERS_RELEVES.forEach(function (id) {
    var dossier; try { dossier = DriveApp.getFolderById(id); } catch (e) { return; }
    collecterReleves(dossier, 0, out, vus);
  });
  // 2. Les « releve_… » rangés ailleurs sur le Drive.
  var it = DriveApp.searchFiles("title contains '" + PREFIXE_RELEVES + "' and mimeType = 'application/pdf' and trashed = false");
  while (it.hasNext()) {
    var f = it.next();
    if (vus[f.getId()] || f.getName().indexOf(PREFIXE_RELEVES) !== 0) continue;
    vus[f.getId()] = true;
    var d = descripteur(f, "releve", "");
    if (!releveDansPeriode(d)) continue;
    out.push(d);
  }
  return out;
}
function collecterReleves(dossier, prof, out, vus) {
  if (prof > PROFONDEUR_MAX || dossier.isTrashed()) return;
  var fichiers = avecReprise(function () { var l = [], fs = dossier.getFilesByType("application/pdf"); while (fs.hasNext()) l.push(fs.next()); return l; }, "dossier " + dossier.getName());
  fichiers.forEach(function (f) {
    if (vus[f.getId()] || f.isTrashed() || !estReleve(f.getName())) return;   // IBAN, conditions générales… : ignorés
    vus[f.getId()] = true;
    var d = descripteur(f, "releve", dossier.getName());
    if (!releveDansPeriode(d)) return;
    out.push(d);
  });
  var sousDossiers = avecReprise(function () { var l = [], it = dossier.getFolders(); while (it.hasNext()) l.push(it.next()); return l; }, "sous-dossiers de " + dossier.getName());
  sousDossiers.forEach(function (sd) { collecterReleves(sd, prof + 1, out, vus); });
}
function listerFactures() {
  var out = [], vus = {};
  DOSSIERS_FACTURES.forEach(function (nom) {
    var it = DriveApp.getFoldersByName(nom);
    while (it.hasNext()) collecterPdf(it.next(), nom, 0, out, vus);
  });
  // Le dossier des justificatifs rapprochés est aussi une source de factures.
  if (DOSSIER_JUSTIFICATIFS_ID) { try { var dj = DriveApp.getFolderById(DOSSIER_JUSTIFICATIFS_ID); collecterPdf(dj, dj.getName(), 0, out, vus); } catch (e) {} }
  return out;
}
function collecterPdf(dossier, chemin, prof, out, vus) {
  if (prof > PROFONDEUR_MAX || dossier.isTrashed()) return;
  // Le filtre de date est fait par Drive : les dossiers volumineux ne sont plus parcourus fichier par fichier.
  var fichiers = avecReprise(function () {
    var liste = [], fs = dossier.searchFiles("(mimeType = 'application/pdf' or mimeType = 'image/jpeg' or mimeType = 'image/png') and trashed = false and modifiedDate > '" + DEPUIS + "T00:00:00'");
    while (fs.hasNext()) liste.push(fs.next());
    return liste;
  }, "dossier " + chemin);
  fichiers.forEach(function (f) {
    if (vus[f.getId()]) return;
    if (estReleve(f.getName())) return;   // un relevé rangé là : déjà couvert
    vus[f.getId()] = true;
    var d = descripteur(f, "facture", chemin);
    if (d.creeLe < DEPUIS) return;
    out.push(d);
  });
  var sousDossiers = avecReprise(function () { var l = [], it = dossier.getFolders(); while (it.hasNext()) l.push(it.next()); return l; }, "sous-dossiers de " + chemin);
  sousDossiers.forEach(function (sd) { collecterPdf(sd, chemin + "/" + sd.getName(), prof + 1, out, vus); });
}

// ----------------------------------------------------------------------------
// Texte d'un PDF : conversion temporaire en Google Doc (service avancé Drive), puis suppression.
// ----------------------------------------------------------------------------
function texteDuPdf(fichier) { return avecReprise(function () { return texteDuPdfUneFois(fichier); }, "lecture de " + fichier.getName()); }
function texteDuPdfUneFois(fichier) {
  var id = null;
  try {
    var nom = "tmp-operations01-" + fichier.getId();
    if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.create) {         // Drive API v3
      id = Drive.Files.create({ name: nom, mimeType: "application/vnd.google-apps.document" }, fichier.getBlob(), { ocrLanguage: "fr" }).id;
    } else if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.insert) { // Drive API v2
      id = Drive.Files.insert({ title: nom, mimeType: "application/vnd.google-apps.document" }, fichier.getBlob(), { ocr: true, ocrLanguage: "fr" }).id;
    } else {
      throw new Error("Service « Drive API » non ajouté (menu Services, à gauche de l'éditeur).");
    }
    return DocumentApp.openById(id).getBody().getText();
  } finally {
    if (id) { try { Drive.Files.remove(id); } catch (e) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e2) {} } }
  }
}

// ----------------------------------------------------------------------------
// Relevé Société Générale (professionnels). Texte issu de la conversion du PDF.
// ----------------------------------------------------------------------------
// Montants SG : « 4.754,84 » ou « 207,88 ». L'espace n'est PAS un séparateur de milliers ici
// (« MANDAT RBA549 445,20 » doit donner 445,20), et un montant ne colle jamais à une lettre.
var MONTANT_RE = /(?:^|[^\dA-Za-z,])(\d{1,3}(?:\.\d{3})*,\d{2})(\*?)(?=$|[^\d%])/g;
function nombre(s) { return Math.round(parseFloat(String(s).replace(/[ . ]/g, "").replace(",", ".")) * 100) / 100; }
function isoDe(jjmmaaaa) { var m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(jjmmaaaa); return m ? m[3] + "-" + m[2] + "-" + m[1] : null; }
function normaliser(t) { return String(t || "").replace(/\r/g, "").replace(/ /g, " ").replace(/[ \t]+/g, " "); }

// Supprime en-têtes et pieds de page répétés (ils contiennent des montants : capital social, téléphones…).
function nettoyerReleveSG(t) {
  return t
    .replace(/NB GSY[\s\S]*?Page \d+\/\d+/g, " ")
    .replace(/Date Valeur Nature de l'op[ée]ration D[ée]bit Cr[ée]dit/g, " ")
    .replace(/suite >>>/g, " ")
    .replace(/1 Depuis l'[ée]tranger[\s\S]*?(Cedex 09|CEDEX 09|contacts utiles ?»\.?)/g, " ")
    .replace(/Votre compte est [ée]ligible[\s\S]*$/, " ");
}
// Détails contenant des montants qui ne sont PAS le montant de l'opération.
function sansDetailsChiffres(s) {
  return s
    .replace(/(CAPITAL AMORTI|INTERETS|ASSURANCE|CAPITAL RESTANT|MONTANT NT|MONTANT HT|TVA A [\d,]+ ?%)\s*:\s*\d[\d . ]*,\d{2}( EUR)?/g, " ")
    .replace(/DATE PREVISIONNELLE DE FIN\s*:\s*\d\d\/\d\d\/\d{4}/g, " ");
}
function parserReleveSG(texte, nomFichier) {
  var t = normaliser(texte);
  var r = { banque: "SG", compte: null, titulaire: "", du: null, au: null, soldeDebut: null, soldeFin: null, totalDebit: null, totalCredit: null, ops: [], equilibre: null, ecart: null };
  var mn = /^releve_(.+?)_(\d{9,12})_(\d{2})(\d{2})(\d{4})/.exec(nomFichier || "");
  if (mn) { r.titulaire = mn[1].replace(/_/g, " "); r.compte = mn[2]; r.au = mn[5] + "-" + mn[4] + "-" + mn[3]; }
  var mc = /n° ?\d{5} ?\d{5} ?(\d{11}) ?\d{2}/.exec(t); if (mc) r.compte = mc[1];
  var mp = /du (\d\d\/\d\d\/\d{4}) au (\d\d\/\d\d\/\d{4})/.exec(t); if (mp) { r.du = isoDe(mp[1]); r.au = isoDe(mp[2]); }
  if (!r.titulaire) { var mt = /\n((?:SAS|SASU|SARL|EURL|SCI|SA|SNC) [A-Z0-9&' \-]+?) (?:Du lundi|\n)/.exec(t); if (mt) r.titulaire = mt[1].trim(); }
  var corps = nettoyerReleveSG(t);
  var ms = /SOLDE PR[ÉE]C[ÉE]DENT AU (\d\d\/\d\d\/\d{4})\s*([+-])?\s*(\d[\d .]*,\d{2})/.exec(corps);
  if (ms) r.soldeDebut = (ms[2] === "-" ? -1 : 1) * nombre(ms[3]);
  var mf = /NOUVEAU SOLDE AU (\d\d\/\d\d\/\d{4})\s*([+-])?\s*(\d[\d .]*,\d{2})/.exec(corps);
  if (mf) r.soldeFin = (mf[2] === "-" ? -1 : 1) * nombre(mf[3]);
  var mtot = /TOTAUX DES MOUVEMENTS\s*(\d[\d .]*,\d{2})(?:\s+(\d[\d .]*,\d{2}))?/.exec(corps);
  var totaux = mtot ? [nombre(mtot[1]), mtot[2] ? nombre(mtot[2]) : null] : null;
  if (!ms) throw new Error("Relevé non reconnu (pas de « SOLDE PRÉCÉDENT »).");
  var debut = ms.index + ms[0].length;
  var fin = mtot ? mtot.index : (mf ? mf.index : corps.length);
  var zone = corps.slice(debut, fin);
  // Découpage : une opération commence par « date valeur » (deux dates jj/mm/aaaa).
  var PAIRE = /(\d\d\/\d\d\/\d{4}) (\d\d\/\d\d\/\d{4}) /g;
  var starts = [], m;
  while ((m = PAIRE.exec(zone)) !== null) starts.push({ i: m.index, len: m[0].length, date: isoDe(m[1]), valeur: isoDe(m[2]) });
  var n = 0;
  starts.forEach(function (s, k) {
    var seg = zone.slice(s.i + s.len, k + 1 < starts.length ? starts[k + 1].i : zone.length).replace(/\s+/g, " ").trim();
    var mots = seg.split(" ");
    var nature = [], i = 0;
    for (; i < mots.length && i < 4; i++) {
      var w = mots[i];
      if (/^\d[\d .]*,\d{2}\*?$/.test(w) || /^(DE:|POUR|POUR:|MOTIF:|CAPITAL|MONTANT|PGE|AU|-CION|CHEZ:|REF:)$/.test(w) || /^DE:/.test(w)) break;
      nature.push(w);
    }
    var detail = mots.slice(i).join(" ");
    var propre = sansDetailsChiffres(seg);
    var montants = [], etoiles = [], mm; MONTANT_RE.lastIndex = 0;
    while ((mm = MONTANT_RE.exec(propre)) !== null) {
      montants.push(nombre(mm[1]));
      if (mm[2]) etoiles.push(nombre(mm[1]));   // « 1,32* » : l'astérisque marque le montant de l'opération
      else if (/^\s*(EUR|USD|GBP|CHF|ZAR|CAD)\b/.test(propre.slice(mm.index + mm[0].length))) montants.pop();   // « 11,99 EUR ETATS-UNIS » : montant en devise, pas l'opération
    }
    if (!montants.length && !etoiles.length) return;   // ligne sans montant : suite de détail, ignorée
    var montant = etoiles.length ? etoiles[etoiles.length - 1] : montants[montants.length - 1];
    var distincts = montants.filter(function (x, j) { return montants.indexOf(x) === j; });
    var nat = nature.join(" ");
    var credit = /RECU|REMISE|VERSEMENT|REMBOURSEMENT|ANNUL|REGUL|CREDIT/.test(nat.toUpperCase()) && !/EMIS/.test(nat.toUpperCase());
    n++;
    r.ops.push({
      id: (r.compte || "?") + "-" + s.date + "-" + String(montant.toFixed(2)) + "-" + n,
      date: s.date, valeur: s.valeur, nature: nat,
      detail: detail.replace(/\d[\d .]*,\d{2}\*?/g, function (x) { return x; }).slice(0, 400),
      montant: credit ? montant : -montant,
      doute: distincts.length > 1
    });
  });
  // Contrôle : solde début + crédits − débits = solde fin. Sinon on tente de corriger le sens
  // d'une seule opération (celle dont le retournement explique exactement l'écart).
  var somme = function () { return r.ops.reduce(function (t2, o) { return t2 + o.montant; }, 0); };
  if (r.soldeDebut != null && r.soldeFin != null) {
    var ecart = Math.round((r.soldeDebut + somme() - r.soldeFin) * 100) / 100;
    if (Math.abs(ecart) > 0.011) {
      for (var q = 0; q < r.ops.length; q++) {
        if (Math.abs(Math.round(2 * r.ops[q].montant * 100) / 100 - ecart) < 0.011) { r.ops[q].montant = -r.ops[q].montant; r.ops[q].doute = true; break; }
      }
      ecart = Math.round((r.soldeDebut + somme() - r.soldeFin) * 100) / 100;
    }
    r.equilibre = Math.abs(ecart) <= 0.011;
    r.ecart = r.equilibre ? 0 : ecart;
  }
  var deb = r.ops.filter(function (o) { return o.montant < 0; }).reduce(function (t2, o) { return t2 - o.montant; }, 0);
  var cre = r.ops.filter(function (o) { return o.montant > 0; }).reduce(function (t2, o) { return t2 + o.montant; }, 0);
  r.totalDebit = Math.round(deb * 100) / 100; r.totalCredit = Math.round(cre * 100) / 100;
  if (totaux) { r.totauxReleve = totaux; }
  return r;
}

// ----------------------------------------------------------------------------
// Relevé Crédit Mutuel (Eurocompte Pro), tel que Google convertit le PDF en texte.
// Deux mises en page cohabitent, parfois dans le même relevé :
//   - « en lignes » : « date  date valeur  libellé  montant  [commerçant CARTE 8519] », le
//     commerçant pouvant être rejeté à la ligne suivante ;
//   - « en colonnes » : les dates d'un bloc sur quelques lignes (colonne date puis colonne
//     date valeur), puis les libellés (un ou deux lignes par opération), puis les montants
//     débités, un par ligne. Les crédits n'ont pas de montant dans cette colonne : ils sont
//     après « Total des mouvements », avec le total des crédits.
// Le sens des opérations est déduit du libellé puis vérifié avec les totaux et les soldes.
// ----------------------------------------------------------------------------
var MOIS_LONG = { janvier: "01", "février": "02", fevrier: "02", mars: "03", avril: "04", mai: "05", juin: "06", juillet: "07", "août": "08", aout: "08", septembre: "09", octobre: "10", novembre: "11", "décembre": "12", decembre: "12" };
var CM_CREDIT_RE = /^(VIR|VRST|VERSEMENT|REM\b|REMISE|REMBOURSEMENT|RBT|ANNUL|REGUL|CREDIT|DEPOT|AVOIR)/;
var CM_NATURE_RE = /^(\d+ PAIEMENTS?|PAIEMENTS?|FRAIS|FACT|VIR|PRLV|PRELEVEMENT|PRELEVT|REMISE|REM\b|VRST|VERSEMENT|COTIS[A-Z]*|COMMISSION|ECHEANCE|RETRAIT|CHEQUE|CHQ|AVOIR|REGUL[A-Z]*|ANNUL[A-Z]*|INTERETS|AGIOS|ABONNEMENT|RBT|REMBOURSEMENT|CREDIT|DEPOT)\b/;
var CM_SKIP_RE = /^(Information sur la protection|\(GE\)|\(GD\)|www\.|<<Suite|Page \d|CAISSE DE CREDIT MUTUEL|TVA intracommunautaire|Pour toute demande|RELEVE ET INFORMATIONS|C\/C EUROCOMPTE|Date Date valeur|€$|Vous disposez|Attention|Alerte|Info :|Votre Caisse|Fraude|IBAN :|\.{10,})/;
var CM_DATE_RE = /\d\d\/\d\d\/\d{4}/g;
var CM_AMOUNT_LINE_RE = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
var CM_SOLDE_RE = /SOLDE (CREDITEUR|DEBITEUR) AU (\d\d\/\d\d\/\d{4})(?:\s+(\d{1,3}(?:\.\d{3})*,\d{2}))?/;
function cmNettoyerLigne(l) {
  return String(l || "").replace(/UN\.\d{8}\.[\d.]+ X \d \S/g, " ").replace(/DONT TVA \d[\d.,]*\s?EUR/g, " ").replace(/\s+/g, " ").trim();
}
// Une opération à partir de son libellé (mise en page en colonnes : montant et dates viennent après).
function cmNouvelleOp(libelle) {
  var mots = libelle.split(" "), nature = [], i = 0;
  if (/^\d+$/.test(mots[0] || "") && /^PAIEMENTS?$/.test(mots[1] || "")) { nature = [mots[0], mots[1]]; i = 2; }
  else for (; i < mots.length && i < 4; i++) { if (!/^[A-Z][A-Z.'\-]*$/.test(mots[i])) break; nature.push(mots[i]); }
  return { nature: nature.join(" "), detail: mots.slice(i).join(" "), tiers: "", montant: null, date: null, valeur: null, doute: false, credit: CM_CREDIT_RE.test(nature.join(" ")) };
}
function cmAttacher(op, l) {
  var t = l.replace(/\bCARTE \d{4}\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return;
  op.tiers = op.tiers ? op.tiers + " " + t : t;
}
// Opération « en ligne » : « libellé … montant [commerçant] » (sans les deux dates).
function cmOpEnLigne(seg, date, valeur) {
  var montants = [], mm; MONTANT_RE.lastIndex = 0;
  while ((mm = MONTANT_RE.exec(seg)) !== null) montants.push({ v: nombre(mm[1]), end: mm.index + mm[0].length - (mm[2] ? 1 : 0) });
  if (!montants.length) { var o0 = cmNouvelleOp(seg); o0.date = date; o0.valeur = valeur; o0.doute = true; return o0; }
  var last = montants[montants.length - 1];
  var libelle = seg.slice(0, last.end).replace(/\d{1,3}(?:\.\d{3})*,\d{2}$/, "").trim();
  var op = cmNouvelleOp(libelle);
  op.montant = last.v; op.date = date; op.valeur = valeur;
  cmAttacher(op, seg.slice(last.end));
  return op;
}
function parserReleveCM(texte, nomFichier) {
  var t = normaliser(texte);
  var r = { banque: "CM", compte: null, titulaire: "", du: null, au: null, soldeDebut: null, soldeFin: null, totalDebit: null, totalCredit: null, ops: [], equilibre: null, ecart: null };
  var mc = /N° ?(\d{8,14})/.exec(t); if (mc) r.compte = mc[1];
  var mt = /PRO (.+?) au \d{4}-\d{2}-\d{2}/.exec(nomFichier || "") || /Extrait de comptes(?: Compte)? (.+?)(?:\.pdf| pdf)?$/i.exec(nomFichier || "");
  if (mt) r.titulaire = mt[1].replace(/_/g, " ").trim();
  var ma = /BANCAIRES Caisse \d+ (\d{1,2})(?:er)? ([a-zéû]+) (\d{4})/i.exec(t);
  if (ma && MOIS_LONG[ma[2].toLowerCase()]) r.au = ma[3] + "-" + MOIS_LONG[ma[2].toLowerCase()] + "-" + (ma[1].length < 2 ? "0" : "") + ma[1];
  var lignes = t.split("\n").map(cmNettoyerLigne);
  var iTot = -1, iDeb = -1, iHead = -1, iFin = -1;
  for (var i = 0; i < lignes.length; i++) {
    if (iHead < 0 && /^Date Date valeur/.test(lignes[i])) iHead = i;
    if (iTot < 0 && /^Total des mouvements/.test(lignes[i])) iTot = i;
    if (iDeb < 0 && iTot < 0 && CM_SOLDE_RE.test(lignes[i])) iDeb = i;
    if (iTot >= 0 && i > iTot && CM_SOLDE_RE.test(lignes[i])) { iFin = i; break; }
  }
  if (iDeb < 0 && iFin < 0) throw new Error("Relevé Crédit Mutuel non reconnu (pas de « SOLDE … AU »).");
  if (iTot < 0) iTot = iFin >= 0 ? iFin : lignes.length;
  if (iDeb >= 0) {
    var md = CM_SOLDE_RE.exec(lignes[iDeb]);
    if (md[3]) r.soldeDebut = (md[1] === "DEBITEUR" ? -1 : 1) * nombre(md[3]);
    var d0 = new Date(isoDe(md[2]) + "T12:00:00Z"); d0.setUTCDate(d0.getUTCDate() + 1); r.du = d0.toISOString().slice(0, 10);
  }
  if (iFin >= 0) { var mf = CM_SOLDE_RE.exec(lignes[iFin]); if (mf[3]) r.soldeFin = (mf[1] === "DEBITEUR" ? -1 : 1) * nombre(mf[3]); if (!r.au) r.au = isoDe(mf[2]); }
  // Totaux et crédits : entre « Total des mouvements » et le solde final.
  var apres = [], creditsBloc = [], datesBloc = [];
  for (var j = iTot + 1; j < (iFin >= 0 ? iFin : lignes.length); j++) {
    var lj = lignes[j]; if (!lj || CM_SKIP_RE.test(lj)) continue;
    (lj.match(CM_DATE_RE) || []).forEach(function (d) { datesBloc.push(d); });
    var am = lj.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
    am.forEach(function (a) { apres.push(nombre(a)); });
  }
  var totaux = null;
  if (apres.length >= 2) { totaux = [apres[0], apres[apres.length - 1]]; creditsBloc = apres.slice(1, apres.length - 1); }
  else if (apres.length === 1) totaux = [apres[0], 0];
  var sommeBloc = creditsBloc.reduce(function (a, b) { return a + b; }, 0);
  if (!totaux || Math.abs(sommeBloc - totaux[1]) > 0.011) creditsBloc = [];   // ex. « 9.421,71 0,00 » : solde déplacé, pas un crédit
  // Zone des opérations.
  var zone = [];
  for (var k = (iHead >= 0 ? iHead + 1 : 0); k < iTot; k++) { if (k === iDeb) continue; var lk = lignes[k]; if (!lk || CM_SKIP_RE.test(lk)) continue; zone.push(lk); }
  var ops = [], cur = null, mode = "row", dateTokens = [], colOps = [], colAmounts = [];
  var creditsRestants = creditsBloc.slice();
  function flushColumn() {
    var N = colOps.length;
    if (!N) { dateTokens = []; colAmounts = []; return; }
    var tokens = dateTokens.slice();
    if (tokens.length < 2 * N && datesBloc.length) tokens = tokens.concat(datesBloc);   // dates rejetées après les totaux
    var dates, valeurs;
    if (tokens.length === 2 * N) {
      var ordonne = true;
      for (var q = 1; q < N; q++) if (isoDe(tokens[q]) < isoDe(tokens[q - 1])) { ordonne = false; break; }
      if (ordonne) { dates = tokens.slice(0, N); valeurs = tokens.slice(N, 2 * N); }
      else { var tri = tokens.slice().sort(function (a, b) { return isoDe(a).localeCompare(isoDe(b)); }); dates = []; valeurs = []; for (var q2 = 0; q2 < N; q2++) { dates.push(tri[2 * q2]); valeurs.push(tri[2 * q2 + 1]); } }
    } else { var tri2 = tokens.slice().sort(function (a, b) { return isoDe(a).localeCompare(isoDe(b)); }); dates = tri2.slice(0, N); valeurs = dates; }
    var nCred = Math.max(0, N - colAmounts.length), credIdx = [];
    colOps.forEach(function (o, idx) { if (credIdx.length < nCred && o.credit) credIdx.push(idx); });
    for (var z = N - 1; z >= 0 && credIdx.length < nCred; z--) if (credIdx.indexOf(z) === -1) credIdx.push(z);
    var ai = 0;
    colOps.forEach(function (o, idx) {
      o.date = isoDe(dates[idx] || "") || (ops.length ? ops[ops.length - 1].date : r.du); o.valeur = isoDe(valeurs[idx] || "") || o.date;
      if (credIdx.indexOf(idx) > -1) { o.credit = true; o.montant = creditsRestants.length ? creditsRestants.shift() : null; if (o.montant == null) o.doute = true; }
      else { o.credit = false; o.montant = colAmounts[ai++]; if (o.montant == null) { o.montant = 0; o.doute = true; } }
      ops.push(o);
    });
    colOps = []; colAmounts = []; dateTokens = [];
  }
  var PAIRE_DEBUT = /^\d\d\/\d\d\/\d{4} \d\d\/\d\d\/\d{4} /;
  zone.forEach(function (l) {
    var onlyDates = CM_DATE_RE.test(l) && l.replace(CM_DATE_RE, "").trim() === "";
    CM_DATE_RE.lastIndex = 0;
    if (onlyDates) { mode = "col"; cur = null; (l.match(CM_DATE_RE) || []).forEach(function (d) { dateTokens.push(d); }); return; }
    if (mode === "col") {
      if (CM_AMOUNT_LINE_RE.test(l)) { colAmounts.push(nombre(l)); return; }
      if (!colAmounts.length) {
        if (CM_NATURE_RE.test(l)) { cur = cmNouvelleOp(l); colOps.push(cur); }
        else if (cur) cmAttacher(cur, l);
        else if (!colOps.length && ops.length) cmAttacher(ops[ops.length - 1], l);   // commerçant rejeté en haut de la page suivante
        return;
      }
      flushColumn(); mode = "row"; cur = null;   // les montants sont finis : retour aux lignes
    }
    if (PAIRE_DEBUT.test(l)) {
      var PAIRE = /(\d\d\/\d\d\/\d{4}) (\d\d\/\d\d\/\d{4}) /g, starts = [], m;
      while ((m = PAIRE.exec(l)) !== null) starts.push({ i: m.index, len: m[0].length, date: isoDe(m[1]), valeur: isoDe(m[2]) });
      starts.forEach(function (st, k2) {
        var seg = l.slice(st.i + st.len, k2 + 1 < starts.length ? starts[k2 + 1].i : l.length).trim();
        cur = cmOpEnLigne(seg, st.date, st.valeur); ops.push(cur);
      });
      return;
    }
    if (cur) cmAttacher(cur, l);
  });
  if (mode === "col") flushColumn();
  // Montants signés, identifiants, détail lisible.
  var n = 0;
  ops.forEach(function (o) {
    n++;
    var v = Math.abs(Number(o.montant) || 0);
    o.montant = o.credit ? v : -v;
    o.detail = (o.tiers ? o.tiers + (o.detail ? " · " + o.detail : "") : o.detail).slice(0, 400);
    o.id = (r.compte || "?") + "-" + o.date + "-" + String(v.toFixed(2)) + "-" + n;
    delete o.credit;
  });
  r.ops = ops;
  // Sens des opérations : la ligne « Total des mouvements » donne le total des crédits.
  if (totaux) {
    var cre = function () { return Math.round(r.ops.filter(function (o) { return o.montant > 0; }).reduce(function (a, o) { return a + o.montant; }, 0) * 100) / 100; };
    if (Math.abs(cre() - totaux[1]) > 0.011) {
      var abs = r.ops.map(function (o) { return Math.abs(o.montant); }), found = null, L = abs.length;
      if (totaux[1] < 0.011) found = [];
      for (var a = 0; a < L && !found; a++) { if (Math.abs(abs[a] - totaux[1]) < 0.011) found = [a]; }
      for (var b = 0; b < L && !found; b++) for (var c = b + 1; c < L && !found; c++) { if (Math.abs(abs[b] + abs[c] - totaux[1]) < 0.011) found = [b, c]; }
      for (var x = 0; x < L && !found && L <= 60; x++) for (var y = x + 1; y < L && !found; y++) for (var w = y + 1; w < L && !found; w++) { if (Math.abs(abs[x] + abs[y] + abs[w] - totaux[1]) < 0.011) found = [x, y, w]; }
      if (found) r.ops.forEach(function (o, idx) { o.montant = found.indexOf(idx) > -1 ? Math.abs(o.montant) : -Math.abs(o.montant); });
    }
    r.totauxReleve = totaux;
    // Solde de début absent de sa ligne (rejeté ailleurs par la conversion) : déduit des totaux.
    if (r.soldeDebut == null && r.soldeFin != null) r.soldeDebut = Math.round((r.soldeFin - totaux[1] + totaux[0]) * 100) / 100;
  }
  var somme = function () { return r.ops.reduce(function (t2, o) { return t2 + o.montant; }, 0); };
  if (r.soldeDebut != null && r.soldeFin != null) {
    var ecart = Math.round((r.soldeDebut + somme() - r.soldeFin) * 100) / 100;
    if (Math.abs(ecart) > 0.011) {
      for (var q3 = 0; q3 < r.ops.length; q3++) {
        if (Math.abs(Math.round(2 * r.ops[q3].montant * 100) / 100 - ecart) < 0.011) { r.ops[q3].montant = -r.ops[q3].montant; r.ops[q3].doute = true; break; }
      }
      ecart = Math.round((r.soldeDebut + somme() - r.soldeFin) * 100) / 100;
    }
    r.equilibre = Math.abs(ecart) <= 0.011;
    r.ecart = r.equilibre ? 0 : ecart;
  }
  var deb = r.ops.filter(function (o) { return o.montant < 0; }).reduce(function (t2, o) { return t2 - o.montant; }, 0);
  var cr = r.ops.filter(function (o) { return o.montant > 0; }).reduce(function (t2, o) { return t2 + o.montant; }, 0);
  r.totalDebit = Math.round(deb * 100) / 100; r.totalCredit = Math.round(cr * 100) / 100;
  return r;
}
// La banque est reconnue au contenu : Crédit Mutuel (« RELEVE ET INFORMATIONS BANCAIRES »,
// « EUROCOMPTE »), sinon Société Générale.
function parserReleve(texte, nomFichier) {
  if (/CREDIT MUTUEL|EUROCOMPTE|RELEVE ET INFORMATIONS BANCAIRES/i.test(texte || "")) return parserReleveCM(texte, nomFichier);
  return parserReleveSG(texte, nomFichier);
}

// ----------------------------------------------------------------------------
// Facture (mise en page libre) : date, montant TTC probable, fournisseur.
// ----------------------------------------------------------------------------
var MOIS_FR = { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 };
var MOIS_EN = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
function isoDate(y, mo, d) { if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null; return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (d < 10 ? "0" : "") + d; }
function datesDans(t) {
  var out = [], m;
  var re1 = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/g;
  while ((m = re1.exec(t)) !== null) { var d = isoDate(+m[3], +m[2], +m[1]); if (d) out.push({ i: m.index, iso: d }); }
  var re2 = /(\d{4})-(\d{2})-(\d{2})/g;
  while ((m = re2.exec(t)) !== null) { var d2 = isoDate(+m[1], +m[2], +m[3]); if (d2) out.push({ i: m.index, iso: d2 }); }
  var re3 = /(\d{1,2})(?:er)? ([a-zéû]{3,9})\.? (\d{4})/gi;
  while ((m = re3.exec(t)) !== null) { var mo = MOIS_FR[m[2].toLowerCase()] || MOIS_EN[m[2].toLowerCase()]; var d3 = mo && isoDate(+m[3], mo, +m[1]); if (d3) out.push({ i: m.index, iso: d3 }); }
  var re4 = /([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/g;
  while ((m = re4.exec(t)) !== null) { var mo2 = MOIS_EN[m[1].toLowerCase()]; var d4 = mo2 && isoDate(+m[3], mo2, +m[2]); if (d4) out.push({ i: m.index, iso: d4 }); }
  out.sort(function (a, b) { return a.i - b.i; });
  return out;
}
function nombreLibre(s) {
  s = String(s).replace(/[  ]/g, "");
  var lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  var v = parseFloat(s); return isFinite(v) ? Math.round(v * 100) / 100 : null;
}
// ----------------------------------------------------------------------------
// Facture client émise par CHOICE : numéro, client, dates, HT / TVA / TTC.
// Trois mises en page connues : « Numéro de facture CHOICE-25249 » (Client … Date de facture),
// « FACTURE N° CHOICE-25243 » (Date commerciale, A 30 jours, Montant à payer, Adresse de facturation)
// et « N° de facture 25231 » (Date d'échéance, Sous-total HT, Montant total EUR).
// ----------------------------------------------------------------------------
var MONTANT_CLIENT_RE = "(\\d{1,3}(?:[ \\u00a0.]?\\d{3})*\\s?,\\s?\\d{2}|\\d+\\.\\d{2})";
function montantApres(t, label) {
  var re = new RegExp(label + "[^\\d]{0,30}?" + MONTANT_CLIENT_RE, "i"), m = re.exec(t);
  return m ? nombreLibre(m[1].replace(/,\s+/, ",")) : null;
}
function dateApres(t, label) {
  var re = new RegExp(label, "i"), m = re.exec(t);
  if (!m) return null;
  var ds = datesDans(t.slice(m.index + m[0].length, m.index + m[0].length + 60));
  return ds.length ? ds[0].iso : null;
}
function joursApres(iso, n) {
  var d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n);
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function parserFactureClient(texte, nomFichier) {
  var t = normaliser(texte), nom = String(nomFichier || "");
  var c = { numero: null, client: "", date: null, echeance: null, delai: null, ht: null, tva: null, ttc: null };
  var m = /N(?:°|o|um[ée]ro)\s*(?:de\s+)?facture\s*:?\s*(?:CHOICE-)?(\d{4,6})/i.exec(t) || /FACTURE\s*N°\s*CHOICE-(\d{4,6})/i.exec(t) || /(?:CHOICE-|Choice_)\s*(\d{4,6})/i.exec(nom);
  if (m) c.numero = m[1];
  // Client
  m = /(?:^|\n)\s*Client\s*\n?\s*([^\n]{2,60}?)\s*(?=\n|\s+\d{1,4}\s|Date de facture)/.exec(t);
  if (m && !/^(Date|N°|Adresse)/i.test(m[1])) c.client = m[1].trim();
  if (!c.client) { m = /(?:^|\n)\s*Facture\s*\n\s*([A-Za-zÀ-ÿ][^\n\d]{2,50}?)\s*\n/.exec(t); if (m && !/facture|document|N°|client|date|montant/i.test(m[1])) c.client = m[1].trim(); }
  if (!c.client) { m = /(?:^|\n)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ ]{2,40}?)\s+\d{1,4}\s*(?:bis\s+|ter\s+)?(?:rue|avenue|all[ée]e|route|chemin|boulevard|place|bd|av|impasse|quai)\b/i.exec(t); if (m && !/^(CHOICE|Facture|Description|Date)/i.test(m[1])) c.client = m[1].trim(); }
  if (!c.client) {
    // Facturation d'abord, livraison ensuite ; entre les deux, la raison sociale (en capitales :
    // « URPS MKL ») l'emporte sur un nom de personne (« Laurie Gillet »).
    var nettoyer = function (x) { return x.replace(/\s+\d{1,5}\s.*$/, "").replace(/\s+(Les|Le|La|Rue|Avenue|Route|Chemin|Z\.?I\.?|ZA|Parc)\s.*$/i, "").trim(); };
    var capitales = function (x) { var l = x.replace(/[^A-Za-zÀ-ÿ]/g, ""); return l.length >= 3 && l === l.toUpperCase(); };
    var cands = [/Adresse de facturation(?! électronique)\s*:?\s*\n?\s*([^\n]{2,80})/i, /Adresse de livraison\s*:?\s*\n?\s*([^\n]{2,80})/i]
      .map(function (re) { var ma = re.exec(t); return ma && !/^(Adresse|CHOICE|électronique)/i.test(ma[1].trim()) ? nettoyer(ma[1]) : ""; }).filter(Boolean);
    c.client = cands.filter(capitales)[0] || cands[0] || "";
  }
  if (!c.client) { var mn = /(?:CHOICE-|Choice_)\d{4,6}[_ -]+([A-Za-z]+)/.exec(nom); if (mn) c.client = mn[1].replace(/([a-z])([A-Z])/g, "$1 $2"); }
  c.client = c.client.replace(/\s+/g, " ").slice(0, 60);
  // Dates
  c.date = dateApres(t, "Date de facture") || dateApres(t, "Date commerciale") || dateApres(t, "[ÉE]mis le");
  if (!c.date) { var ds = datesDans(t); if (ds.length) c.date = ds[0].iso; }
  c.echeance = dateApres(t, "Date d.{1,2}ch[ée]ance") || dateApres(t, "€\\s*le");
  m = /\bA\s+(\d{1,3})\s+jours\b/i.exec(t); if (m) c.delai = +m[1];
  if (!c.echeance && c.date && c.delai != null) c.echeance = joursApres(c.date, c.delai);
  // Montants
  c.ht = montantApres(t, "(?:Sous-total|Total)\\s*HT");
  c.ttc = montantApres(t, "Total\\s*TTC") || montantApres(t, "Montant total(?:\\s*EUR)?") || montantApres(t, "Montant [àa] payer") || montantApres(t, "Solde d[ûu]") || montantApres(t, "Montant\\s*EUR");
  if (c.ht != null && c.ttc != null) c.tva = Math.round((c.ttc - c.ht) * 100) / 100;
  else if (c.ht != null) { var tv = montantApres(t, "TVA[^\\n]{0,40}?"); if (tv != null && tv < c.ht) { c.tva = tv; c.ttc = Math.round((c.ht + tv) * 100) / 100; } }
  if (c.ht == null && c.ttc != null) { c.ht = Math.round(c.ttc / 1.2 * 100) / 100; c.tva = Math.round((c.ttc - c.ht) * 100) / 100; c.htEstime = true; }
  return c;
}
var LIBELLES_TOTAL = [/total ttc/i, /montant ttc/i, /net [àa] payer/i, /total [àa] payer/i, /amount due/i, /total due/i, /balance due/i, /total amount/i, /grand total/i, /montant total/i, /total/i];
function parserFacture(texte, nomFichier, dossier) {
  var t = normaliser(texte);
  var x = { date: null, montant: null, devise: "EUR", montants: [], fournisseur: "", extrait: "" };
  if (/\$|USD/.test(t) && !/€|EUR/.test(t)) x.devise = "USD";
  else if (/£|GBP/.test(t) && !/€|EUR/.test(t)) x.devise = "GBP";
  // Montants : « 1 234,56 » « 1.234,56 » « 1,234.56 » « 1234.56 »
  var re = /(?:^|[^\d.,])(\d{1,3}(?:[ . ]\d{3})*(?:,\d{2})|\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+[.,]\d{2})(?=$|[^\d])/g, m, tous = [];
  while ((m = re.exec(t)) !== null) { var v = nombreLibre(m[1]); if (v != null && v > 0 && v < 10000000) tous.push({ i: m.index, v: v }); }
  x.montants = tous.map(function (a) { return a.v; }).filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort(function (a, b) { return b - a; }).slice(0, 12);
  // Montant : celui qui suit le libellé le plus probable (total TTC…), sinon le plus grand.
  for (var k = 0; k < LIBELLES_TOTAL.length && x.montant == null; k++) {
    var re2 = new RegExp(LIBELLES_TOTAL[k].source + "[^\\d\\n]{0,40}?(\\d[\\d .\\u00a0,]*[.,]\\d{2})", "gi"), best = null, mm;
    while ((mm = re2.exec(t)) !== null) { var vv = nombreLibre(mm[1]); if (vv != null && (best == null || vv > best)) best = vv; }
    if (best != null) x.montant = best;
  }
  if (x.montant == null && x.montants.length) x.montant = x.montants[0];
  // Date : celle qui suit un mot « date / émise / issued / du », sinon la première.
  var ds = datesDans(t);
  var pref = null;
  for (var j = 0; j < ds.length && !pref; j++) { var avant = t.slice(Math.max(0, ds[j].i - 30), ds[j].i); if (/date|[ée]mise|issued|du\s*:?\s*$|le\s*:?\s*$/i.test(avant)) pref = ds[j].iso; }
  x.date = pref || (ds.length ? ds[0].iso : null);
  // Fournisseur : première ligne « lisible » qui n'est pas un mot-clé de facture.
  var lignes = t.split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
  for (var q = 0; q < lignes.length && q < 15 && !x.fournisseur; q++) {
    var l = lignes[q];
    if (l.length < 3 || l.length > 60) continue;
    if (/facture|invoice|re[çc]u|receipt|page|date|n°|num|total|montant|amount|tva|vat|siret|iban|bic|http|www|@|^\d|\d[.,]\d{2}/i.test(l)) continue;
    if (!/[A-Za-zÀ-ÿ]{3}/.test(l)) continue;
    x.fournisseur = l;
  }
  if (!x.fournisseur) x.fournisseur = String(nomFichier || "").replace(/\.pdf$/i, "").replace(/[_\-]+/g, " ").slice(0, 60);
  x.extrait = lignes.slice(0, 12).join(" · ").slice(0, 400);
  return x;
}

// ----------------------------------------------------------------------------
// Le service Drive renvoie parfois « Service error: Drive » de façon passagère : on réessaie.
function avecReprise(fn, quoi) {
  var derniere = null;
  for (var i = 0; i < 4; i++) {
    try { return fn(); }
    catch (e) { derniere = e; Utilities.sleep(2000 * (i + 1)); }
  }
  throw new Error((quoi || "Drive") + " : " + String(derniere && derniere.message || derniere));
}
function trouver(nom) { return avecReprise(function () { var it = DriveApp.getFilesByName(nom); return it.hasNext() ? it.next() : null; }, "recherche de " + nom); }
