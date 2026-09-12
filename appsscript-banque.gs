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
 *   - Relevés : tous les PDF dont le nom commence par « releve_ » (releve_SAS_CHOICE_<compte>_<jjmmaaaa>.pdf).
 *   - Factures : les PDF des dossiers listés dans DOSSIERS_FACTURES (et leurs sous-dossiers).
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
var VERSION = 1;
var FICHIER_BANQUE = "operations01-banque.json";
var PREFIXE_RELEVES = "releve_";
var DOSSIERS_FACTURES = ["FACTURES", "factures", "Facture MAJ", "FACTURATION_CLIENTS", "FACTURATION_CHOICE", "Comptable", "Factures-CXS-TBP"];
var DEPUIS = "2025-01-01";          // fichiers créés avant cette date : ignorés
var MAX_PAR_PASSAGE = 20;
var PROFONDEUR_MAX = 6;

// ----------------------------------------------------------------------------
// Passage principal (déclencheur horaire ou exécution manuelle)
// ----------------------------------------------------------------------------
function parcourir() {
  var fichier = trouver(FICHIER_BANQUE);
  if (!fichier) throw new Error("Fichier " + FICHIER_BANQUE + " absent : ouvrir une fois Finances → Banque dans Operations01.");
  var verrou = LockService.getScriptLock(); verrou.waitLock(30000);
  try {
    var data; try { data = JSON.parse(fichier.getBlob().getDataAsString() || "{}"); } catch (e) { data = {}; }
    data.version = VERSION;
    data.releves = Array.isArray(data.releves) ? data.releves : [];
    data.factures = Array.isArray(data.factures) ? data.factures : [];
    data.erreurs = Array.isArray(data.erreurs) ? data.erreurs : [];
    var connus = {};
    data.releves.forEach(function (r) { connus[r.fileId] = r.mt; });
    data.factures.forEach(function (f) { connus[f.fileId] = f.mt; });
    data.erreurs.forEach(function (e) { connus[e.fileId] = e.mt; });

    var vus = {}, aFaire = [];
    listerReleves().forEach(function (f) { vus[f.id] = true; if (connus[f.id] !== f.mt) aFaire.push(f); });
    listerFactures().forEach(function (f) { vus[f.id] = true; if (connus[f.id] !== f.mt) aFaire.push(f); });
    // Fichiers disparus (corbeille, déplacés hors des dossiers) : retirés.
    data.releves = data.releves.filter(function (r) { return vus[r.fileId]; });
    data.factures = data.factures.filter(function (f) { return vus[f.fileId]; });
    data.erreurs = data.erreurs.filter(function (e) { return vus[e.fileId]; });

    var lot = aFaire.slice(0, MAX_PAR_PASSAGE);
    lot.forEach(function (f) {
      retirer(data, f.id);
      try {
        var texte = texteDuPdf(f.fichier);
        if (f.type === "releve") {
          var r = parserReleveSG(texte, f.nom);
          r.fileId = f.id; r.nom = f.nom; r.url = f.url; r.mt = f.mt;
          data.releves.push(r);
        } else {
          var x = parserFacture(texte, f.nom, f.dossier);
          x.fileId = f.id; x.nom = f.nom; x.url = f.url; x.dossier = f.dossier; x.mt = f.mt; x.creeLe = f.creeLe;
          data.factures.push(x);
        }
      } catch (e) {
        data.erreurs.push({ fileId: f.id, nom: f.nom, url: f.url, mt: f.mt, type: f.type, erreur: String(e && e.message || e) });
      }
    });
    data.releves.sort(function (a, b) { return (b.au || "").localeCompare(a.au || ""); });
    data.factures.sort(function (a, b) { return (b.date || b.creeLe || "").localeCompare(a.date || a.creeLe || ""); });
    data.comptes = comptesDe(data.releves);
    data.restant = aFaire.length - lot.length;
    data.parcouruLe = new Date().toISOString();
    data.updatedAt = Date.now();
    fichier.setContent(JSON.stringify(data));
    Logger.log("Banque : " + lot.length + " fichier(s) analysé(s), " + data.restant + " restant(s), " + data.releves.length + " relevés, " + data.factures.length + " factures.");
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
  return { id: f.getId(), nom: f.getName(), url: f.getUrl(), mt: f.getLastUpdated().toISOString(), creeLe: f.getDateCreated().toISOString().slice(0, 10), type: type, dossier: dossier || "", fichier: f };
}
function listerReleves() {
  var out = [], it = DriveApp.searchFiles("title contains '" + PREFIXE_RELEVES + "' and mimeType = 'application/pdf' and trashed = false");
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName().indexOf(PREFIXE_RELEVES) !== 0) continue;
    var d = descripteur(f, "releve", "");
    if (d.creeLe < DEPUIS) continue;
    out.push(d);
  }
  return out;
}
function listerFactures() {
  var out = [], vus = {};
  DOSSIERS_FACTURES.forEach(function (nom) {
    var it = DriveApp.getFoldersByName(nom);
    while (it.hasNext()) collecterPdf(it.next(), nom, 0, out, vus);
  });
  return out;
}
function collecterPdf(dossier, chemin, prof, out, vus) {
  if (prof > PROFONDEUR_MAX || dossier.isTrashed()) return;
  var fs = dossier.getFilesByType("application/pdf");
  while (fs.hasNext()) {
    var f = fs.next();
    if (vus[f.getId()] || f.isTrashed()) continue;
    if (f.getName().indexOf(PREFIXE_RELEVES) === 0) continue;   // un relevé rangé là : déjà couvert
    vus[f.getId()] = true;
    var d = descripteur(f, "facture", chemin);
    if (d.creeLe < DEPUIS) continue;
    out.push(d);
  }
  var sub = dossier.getFolders();
  while (sub.hasNext()) { var s = sub.next(); collecterPdf(s, chemin + "/" + s.getName(), prof + 1, out, vus); }
}

// ----------------------------------------------------------------------------
// Texte d'un PDF : conversion temporaire en Google Doc (service avancé Drive), puis suppression.
// ----------------------------------------------------------------------------
function texteDuPdf(fichier) {
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
    var montants = [], mm; MONTANT_RE.lastIndex = 0;
    while ((mm = MONTANT_RE.exec(propre)) !== null) montants.push(nombre(mm[1]));
    if (!montants.length) return;   // ligne sans montant : suite de détail, ignorée
    var montant = montants[montants.length - 1];
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
function trouver(nom) { var it = DriveApp.getFilesByName(nom); return it.hasNext() ? it.next() : null; }
