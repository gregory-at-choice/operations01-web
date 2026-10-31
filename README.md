# choice — web app (PWA) de pilotage : projets, tâches, temps, finances, courrier. (Anciennement Operations01 ; les fichiers Drive et les scripts gardent ce nom.)

Version web installable d'Operations01. Application **web** autonome : les données sont
stockées **localement dans le navigateur** (fonctionne hors ligne, aucune installation de
serveur). C'est un point de départ ; les autres modules (Finances, Dashboard…) suivront.

## Contenu

| Fichier | Rôle |
|---|---|
| `index.html` | Structure de la page (le « squelette ») |
| `styles.css` | Mise en forme (code couleur de l'app, responsive, clair/sombre) |
| `app.js` | Toute la logique : données locales, navigation, missions, historique, chrono |
| `manifest.webmanifest` | Déclare l'app à Chrome (nom, icônes, mode plein écran) → rend l'app **installable** |
| `service-worker.js` | Met l'app en cache → **fonctionnement hors ligne** |
| `icons/` | Icônes de l'application |

## Comment l'INSTALLER via Chrome

Une PWA doit être servie en **HTTPS** pour être installable (un simple double-clic sur le
fichier ne suffit pas). Deux façons simples :

### Option 1 — Netlify Drop (le plus rapide, sans compte technique)
1. Allez sur **https://app.netlify.com/drop**
2. **Glissez-déposez le dossier `webapp`** entier dans la page.
3. Netlify vous donne une **adresse HTTPS** (ex. `https://xxxx.netlify.app`).
4. Ouvrez cette adresse dans **Chrome** → une icône d'installation apparaît dans la barre
   d'adresse (ou menu ⋮ → **Installer Operations01**). L'app s'ajoute à votre bureau /
   écran d'accueil.

### Option 2 — GitHub Pages (puisque le code est déjà sur GitHub)
1. Sur le dépôt GitHub, **Settings → Pages**.
2. Choisissez la branche et le dossier `/webapp`, enregistrez.
3. GitHub fournit une URL `https://<compte>.github.io/<repo>/` → ouvrez-la dans Chrome et
   installez comme ci-dessus.

## Tester en local (facultatif, pour développer)
Depuis le dossier `webapp` :
```
python3 -m http.server 8000
```
Puis ouvrez `http://localhost:8000` (l'installation PWA fonctionne aussi sur `localhost`).

## Réintégrer vos données existantes (depuis l'app native)

Vos missions de l'app native (iOS/macOS) ne sont **jamais perdues** : la web app est un
logiciel séparé. Pour les **retrouver dans la web app** :

1. Dans l'**app native**, écran **Missions** → bouton **« Exporter (JSON pour la web app) »**
   → enregistrez le fichier `operations01-data.json` (Fichiers, AirDrop, Mail…).
2. Dans la **web app**, écran **Missions** → **« Importer »** → choisissez ce fichier.
3. Vos missions et leur historique apparaissent. L'import **ajoute** les données (il
   n'efface rien de ce qui est déjà présent).

Vous pouvez aussi **« Exporter »** depuis la web app à tout moment pour faire une sauvegarde.

## Activer la sauvegarde sur Google Drive

Par défaut, les données sont dans le navigateur. Pour les stocker **sur votre Google Drive**
(et les retrouver sur tout navigateur) :

1. **Hébergez l'app** (voir plus haut) pour obtenir une adresse HTTPS fixe (ex. `https://xxxx.netlify.app`).
2. Créez un **identifiant OAuth Google** :
   - Allez sur **https://console.cloud.google.com/** → créez un projet.
   - **APIs & Services → Enabled APIs** → activez **Google Drive API**.
   - **APIs & Services → Identifiants** → **Créer des identifiants → ID client OAuth** →
     type **Application Web**.
   - Dans **Origines JavaScript autorisées**, ajoutez l'adresse de votre app (ex. `https://xxxx.netlify.app`).
   - Copiez l'**ID client** (se termine par `.apps.googleusercontent.com`).
3. Ouvrez **`config.js`** et collez-le : `googleClientId: "VOTRE_ID.apps.googleusercontent.com"`.
   Re-déployez.
4. Dans l'app, en bas de la barre latérale : **« Se connecter à Google Drive »** → autorisez.
   Un fichier `operations01-data.json` est créé dans votre Drive et mis à jour automatiquement.

> À savoir : la portée demandée est **drive.file** — l'app n'accède **qu'au fichier qu'elle
> crée**, rien d'autre dans votre Drive. Le navigateur garde une copie locale (hors ligne) ;
> Drive est la copie durable et partagée entre navigateurs.

**Où sont les fichiers.** L'app crée ses fichiers à la racine du Drive ; le script
`appsscript-mails.gs` les range ensuite dans le dossier `soft/src-json` (constante `DOSSIER_JSON`),
l'app les retrouve par leur nom quel que soit le dossier. On y trouve `operations01-data.json`
(sociétés, contacts, projets, tâches, factures, temps), `operations01-evenements.json` (messages à
traiter, décisions, demandes), `operations01-assistant.json` (classements et propositions du Mac
mini), `operations01-mails.json` (index des mails et des correspondances) et
`operations01-banque.json` (mouvements bancaires), plus les copies de sûreté :
`operations01-backup-<jour>.json` (une par jour et par appareil, 14 conservées) et
`operations01-conflit-<horodatage>[-local].json` (les deux versions avant une fusion entre
appareils, uniquement si cet appareil avait des modifications non écrites, au plus une paire par
quart d'heure, 20 conservées). Une simple relecture périodique ne crée jamais de copie « conflit ».

## Transactions : la vue façon Pennylane (Finances → Transactions)

C'est l'onglet qui s'ouvre par défaut dans Finances. Chaque ligne est une opération d'un relevé lu sur le Drive, avec sa date, son libellé lisible, sa catégorie, son montant (vert pour les encaissements, rouge pour les décaissements) et l'état de son justificatif :

- **✓ Justifiée** : l'écriture existe et un justificatif y est attaché ;
- **À justifier** : l'écriture existe mais aucun justificatif n'est relié ;
- **Sans justificatif** : l'écriture est marquée comme n'en exigeant pas (frais bancaires, URSSAF, échéance de prêt…) ;
- **À importer** : l'opération est sur le relevé mais pas encore dans l'app ; **Ignorée** : écartée volontairement.

En haut : un bouton par compte (avec le dernier solde connu), des filtres par état, une recherche (libellé, tiers, montant), le mois, et le sens (encaissements / décaissements). Les totaux de la sélection s'affichent au-dessus du tableau, qui est regroupé par mois.

**Un clic sur une ligne ouvre un volet à droite** :

- si la transaction est justifiée, le justificatif s'affiche directement (aperçu Drive), avec « Ouvrir » et « Détacher » ;
- sinon l'app **propose des rapprochements** : les factures du Drive au même montant (datées jusqu'à 120 jours avant / 30 jours après le paiement), puis celles au montant proche (± 2 %) ou du même tiers dans les 90 jours. « Aperçu » montre la facture dans le volet, « Relier » l'attache à l'écriture (en la créant si l'opération n'était pas encore importée). Les autres moyens : chercher la pièce jointe dans les mails, déposer un fichier (rangé dans « Justificatifs choice » sur le Drive), coller un lien, ou déclarer qu'aucun justificatif n'est nécessaire ;
- la catégorie se change dans le volet comme dans le tableau ; comme dans l'onglet Banque, l'app en déduit une règle pour les opérations suivantes du même tiers.

L'autre face du rapprochement : le filtre **📄 Factures sans transaction** liste les factures du Drive qu'aucune écriture n'utilise, avec pour chacune les opérations qui pourraient la payer (montant égal ou proche, même tiers, dans les 120 jours). Un clic ouvre la facture et « Relier » l'attache à l'opération choisie.

## Déploiement des scripts Google : par le Mac mini, plus de copier-coller

Règles pour modifier un `.gs` (détail dans `CONTRAT-DEPLOIEMENT.md`, section 5) : incrémenter
`VERSION` en tête ; laisser vides les réglages propres à un compte (`FICHIER_MAILS_ID`,
`DOSSIER_CORRESPONDANCES_ID`, `SECRET_CODE`) et ne pas les renommer ; ne pas introduire de nouveau
service Google sans l'annoncer (accord à donner dans chaque compte) ; regrouper les modifications du
relais (chaque publication consomme une version Apps Script) ; ne plus rien modifier dans l'éditeur en
ligne, sinon le projet est bloqué jusqu'à décision.

`CONTRAT-DEPLOIEMENT.md` confie au Mac mini le déploiement des cinq scripts Apps Script (relais,
mails, correspondances, banque, rappels) dans les trois comptes, avec `clasp`, à partir de ce dépôt :
toutes les 10 minutes, tout `.gs` modifié est poussé, le relais reçoit une nouvelle version sur son
déploiement existant, et la version qui répond est vérifiée. Mise en place unique : trois connexions
`clasp login` (Grégory clique « Autoriser ») et l'API Apps Script activée dans chaque compte.

## Crédits API du forfait Ultra

Le forfait Ultra inclut 200 $ de crédits API par mois (Console liée au forfait). Le contrat, section
10, fait passer les appels Opus du Mac mini (réponses détaillées, comptes rendus de réunion) sur ces
crédits avec une clé API dédiée, gardée sur le Mac mini seulement : les fenêtres d'usage de Grégory
restent libres. Ordre de repli : crédits → forfait → modèle local. Le brief du matin donne le cumul du
cycle.

## Économie de ressources (v155, relais v19)

- **App** : le fichier des événements (plusieurs Mo) n'est plus téléchargé que s'il a changé
  (vérification de sa date d'abord), et aucune relecture périodique n'a lieu tant que l'onglet est
  caché ; au retour au premier plan, tout ce qui est périmé est relu d'un coup. La relecture des
  données elle-même ne coûtait déjà qu'un appel de métadonnées.
- **Relais v19** : `GET ?action=stamp` renvoie les dates de modification des fichiers sans les lire ;
  le Mac mini ne demande l'export complet que si les données ont changé (contrat, section 9), et
  passe à un cycle de 5 minutes la nuit et le week-end.
- **Scripts mails et correspondances** : la nuit (23 h – 7 h) et le week-end, un passage sur deux est
  sauté (travail toutes les 30 minutes au lieu de 15 ; réglable en tête de script, `HEURES_CREUSES`).

## Banque : relevés et factures déjà sur le Drive (Finances → Banque)

Un script Apps Script (`appsscript-banque.gs`) lit les relevés de compte PDF — Société Générale
(`releve_…pdf`) et Crédit Mutuel (« Extrait de comptes … ») — rangés dans les dossiers de relevés
(`DOSSIERS_RELEVES`, identifiants Drive, sous-dossiers par année inclus), la banque étant reconnue
au contenu, et les factures PDF rangées dans les dossiers du Drive, en extrait le
texte et dépose le résultat dans `operations01-banque.json` (fichier créé par l'app). L'app
importe ensuite les opérations en écritures payées, les classe par règles (les tiennes, apprises
au fil de l'eau, plus des règles par défaut : emprunts, frais bancaires, URSSAF, TVA, impôts,
retraite, assurances, télécom, énergie, déplacements, virements entre tes sociétés), propose pour
chaque opération la facture du Drive qui correspond (même montant, date proche, nom du
fournisseur) et signale : opérations sans justificatif, factures sans paiement repéré, relevés
dont le solde ne tombe pas juste.

Installation (une fois, dans le compte Google qui porte le Drive) :
1. Dans Operations01, ouvrir Finances → Banque une première fois (crée le fichier vide).
2. script.google.com → Nouveau projet → nom « Operations01 banque » → coller `appsscript-banque.gs`.
3. À gauche, « Services » (+) → « Drive API » → Ajouter.
4. Exécuter la fonction `parcourir` → autoriser. Puis exécuter `installerDeclencheur` (un passage par heure).
5. Dans l'app, Finances → Banque → Actualiser : les relevés apparaissent ; associer chaque compte à sa société, puis « Importer ».

Vingt fichiers au plus sont analysés par passage : le rattrapage initial prend quelques heures.
Les dossiers de factures parcourus sont listés dans `DOSSIERS_FACTURES` en tête du script.

**Factures clients.** Les factures émises par CHOICE (dossiers dont le nom contient `FACTURATION`)
reçoivent une lecture dédiée : numéro, client, date, échéance, HT, TVA, TTC. Dans Finances → Banque,
« Factures clients sur le Drive » les liste (2026 par défaut) et « Importer » les ajoute en produits
(montant HT, TVA, échéance, catégorie = client). Le virement reçu qui cite le numéro de facture, ou
à défaut du même montant TTC au centime et au nom du client, devient son encaissement : la facture
passe « payée » et l'écriture que ce virement avait créée est fusionnée. Une facture saisie à la main
dont l'intitulé porte le numéro (« 25236 - Synthenova… ») est complétée, pas dupliquée.

**Exports CSV / OFX (opérations de la semaine).** Le dossier Drive « Exports banque »
(`DOSSIER_EXPORTS_ID`) contient un sous-dossier par banque (« SocieteGenerale », « CreditMutuel »)
ou par numéro de compte. Les fichiers CSV, OFX, QIF ou Excel téléchargés depuis l'espace SG ou CM et
déposés là sont lus par le script comme des relevés
**provisoires** : leurs opérations s'importent comme les autres, et quand le relevé PDF de la période
arrive, celles qu'il confirme sont retirées de l'export et les écritures se rattachent au relevé.

**Alertes bancaires (opérations provisoires).** Si les alertes par e-mail sont activées chez SG et
au Crédit Mutuel, le script lit ces mails (`ALERTES_EXPEDITEURS`, depuis `ALERTES_DEPUIS`) et en tire
date, montant, sens et libellé. Dans Finances → Banque, « Alertes bancaires » propose chaque opération
annoncée tant qu'aucun relevé ne la confirme ; importée, elle est une écriture **provisoire** (payée,
comptée dans la trésorerie) qui se rattache d'elle-même à l'opération du relevé quand il arrive
(même compte, même montant, ± 4 jours). Le texte de chaque alerte est conservé pour vérifier la lecture.

**Justificatifs.** Le script dépose aussi, dans « Justificatifs / Reçus mails » (dossier
`DOSSIER_JUSTIFICATIFS_ID`), les PDF joints aux mails reçus depuis `MAILS_DEPUIS` (25 par passage),
avec en description l'expéditeur, le sujet et la date du mail ; ils sont lus comme des factures.
Cette lecture Gmail demande une autorisation supplémentaire, une fois, au premier `parcourir`
lancé à la main après la mise à jour du script. Dans l'app, « Justificatifs à retrouver » propose
pour chaque opération sans justificatif les documents (factures rangées, reçus des mails) dont le
**montant est exact au centime**, classés par proximité de date et par nom du tiers ; un clic
ouvre l'aperçu, « Rapprocher » rattache le document à l'écriture. « Mails » lance en plus une
recherche Gmail par le nom du tiers (Gmail ne retrouve pas un montant), chaque PDF étant relu
dans le navigateur pour y vérifier le montant.

## Pilotage (Finances)

- **Tableau de bord** (premier onglet de Finances, l'ancienne rubrique du menu y renvoie) : CA du mois,
  résultat de l'exercice, trésorerie et prévision à 90 jours, à encaisser et à payer (avec retards), TVA
  estimée du trimestre, budget, pipeline en cours, projets en cours, graphique produits / charges par
  mois, courbe de trésorerie prévisionnelle, export PDF.
- **Compte de résultat** par exercice (année civile) ou par mois, comparé à la même période de l'exercice
  précédent ; les catégories « hors résultat » sont listées à part.
- **TVA** : par trimestre ou par mois, régime des encaissements (services) ou des débits (biens) ;
  TVA collectée par taux, TVA déductible, TVA nette ou crédit, avec les lignes de la CA3. Les dépenses
  sans taux renseigné (importées du relevé) sont signalées.
- **À payer** : dépenses « à payer » triées par échéance ; sélection puis fichier de virement SEPA
  (pain.001.001.03) à déposer sur l'espace bancaire, et passage en « payée ». L'IBAN débiteur se
  renseigne sur le compte bancaire de la société (Groupe), l'IBAN du bénéficiaire sur le contact ou
  sur la facture.
- **Budget** : montant mensuel par catégorie, comparé au réel cumulé de l'exercice.

## CRM : pipelines, contacts enrichis, historique de relation

- **Pipelines** (rubrique du menu) : tableaux à étapes, trois amorcés (Opportunités, Candidatures,
  Partenariats), étapes renommables, marquables « gagné » / « perdu ». Une fiche porte un contact, une
  société, un projet, un montant et une date de clôture ; glisser-déposer ou ‹ › pour changer d'étape,
  le parcours est conservé. Le montant en jeu apparaît sur le tableau de bord Finances.
- **Contacts** : « Suggestions depuis tes mails » propose les expéditeurs qui t'écrivent (au moins deux
  messages, ou un récent) et ne sont pas encore des contacts, organisation devinée d'après le domaine ;
  « Enrichir depuis les mails » (Gmail relié) lit la signature du dernier mail reçu pour compléter
  téléphone, fonction, organisation et LinkedIn, sans écraser ce qui est déjà renseigné ;
  « Depuis LinkedIn » fournit un signet de navigateur qui crée la fiche depuis le profil ouvert
  (paramètre `?addContact=` lu au démarrage).
- **Import LinkedIn** : « Importer LinkedIn » dans Contacts lit l'archive ZIP fournie par LinkedIn
  (Préférences → Confidentialité des données → Obtenir une copie de vos données → Relations) ou son
  fichier `Connections.csv` : nouveaux contacts créés (catégorie au choix, date de mise en relation),
  contacts existants complétés (lien, e-mail, entreprise, fonction), sans doublon ; option pour ignorer
  les relations sans entreprise ni fonction. Le ZIP est lu dans le navigateur, sans envoi.
- **Relation** sur chaque fiche contact : nombre d'échanges, date « à relancer » (rappel en tête de la
  liste des contacts), notes datées, et l'historique fusionné des mails et messages reçus (À traiter),
  rendez-vous, factures, fiches pipeline et éléments de projet liés, du plus récent au plus ancien.

## Documents : lecture à voix haute

Dans Documents → Lecteur, « 🔊 Lire » lit le document ouvert avec la synthèse vocale du navigateur
(voix françaises de l'appareil, vitesse réglable, réglages mémorisés). Markdown : texte nettoyé (titres,
listes, liens, code, tableaux) et lu en entier. PDF : texte extrait page par page à partir de la page
affichée, la vue suit la lecture ; les pages sans texte (scans) sont sautées. Une barre flottante offre
pause / reprise, phrase précédente / suivante et arrêt ; changer de document ou d'écran arrête la lecture.
Avant lecture : nombre de mots et durée estimée à la vitesse choisie. Documents longs : la position est
mémorisée par document (« Reprendre (57 %) » / « Reprendre (page 12 / 40) »), les titres du Markdown
servent de chapitres (« Lire à partir du chapitre… »), la barre affiche la progression, le chapitre et le
temps restant, et l'écran est maintenu allumé pendant la lecture (le verrouillage coupe la voix).

Dans Planning, « 🔊 Lire la synthèse » (Synthèse agenda) et « 🔊 Lire l'agenda » (Agenda) lisent un texte
parlé (interlocuteurs, invités à trouver, réponses en attente, à préparer ; retards puis jour par jour)
avec les mêmes réglages de voix et de vitesse que Documents, réglables sur place ; changer d'onglet du
Planning ne coupe pas la lecture, changer de section l'arrête.

## Tâches : administration façon Jira

Chaque tâche a une **fiche** (bouton ↗ dans le kanban et dans le tableau d'un projet, ou clic depuis
le brief) : intitulé, description, **clé** (« MSVL-12 », préfixe tiré du titre du projet, « T-n » sans
projet), **statut** (À faire · En cours · En attente · Terminée), **priorité** (haute ▲ · moyenne ·
basse ▽), **type** (tâche, jalon, anomalie), projet et section, **tâche parente** et **sous-tâches**
(ajout en une ligne, indentées dans le tableau du projet, compteur « 2/3 »), **dépendances**
(« bloquée par », verrou 🔒 tant que la bloquante n'est pas terminée ; terminer la bloquante affiche
« Débloqué : … »), **étiquettes**, en charge, échéance, estimation, avancement, chrono, **commentaires
datés**, **historique** des changements (statut, échéance, priorité, projet…), dupliquer, supprimer
(avec ses sous-tâches). La section Tâches propose deux vues, mémorisées par appareil : le **Backlog**
(façon Jira : panneau des projets avec avancement à gauche ; à droite les tickets groupés « En
retard », « Cette semaine », « Semaine prochaine », semaines suivantes, « Backlog » sans échéance,
avec compteurs à faire / en cours / terminées par groupe ; chaque ligne porte la clé, le projet
coloré, le statut modifiable, l'échéance (rouge si dépassée), l'estimation, la priorité et les
initiales de la personne ; cases à cocher pour une action groupée : statut, échéance, projet,
priorité, suppression), le **Kanban** et la **Chronologie**. Toutes ont la barre de **filtres** :
recherche (clé, intitulé, notes), projet, priorité, étiquette, personne.

- **Gestion de projet** : l'onglet d'un projet propose les mêmes vues, mémorisées par appareil :
  **Backlog** (tickets du projet groupés par semaine, section en pastille, statut et échéance en ligne,
  sélection multiple), **Kanban** (quatre colonnes, « + Ajouter » crée la tâche dans la colonne) et
  **Par section** (le tableau historique : sections, avancement, estimation, chrono). Ajouter une
  tâche depuis le Backlog ouvre directement sa fiche.
- **Début et durée** : une tâche porte une échéance, et peut aussi avoir un début et une durée en
  jours ; l'étendue (début → fin) se déduit de ce qui est renseigné.
- **Chronologie (Gantt)** : onglet d'un projet, et vue globale dans Tâches (groupée par projet).
  Une ligne par tâche datée, barres colorées par statut (liseré rouge en retard, remplissage =
  avancement), sous-tâches indentées, jalons en losange, dépendances fléchées, trait « aujourd'hui »,
  échelle au choix **Jour / Semaine / Mois** (mémorisée par appareil, la frise s'ouvre centrée sur
  aujourd'hui, l'étendue affichée est rappelée à droite). Clic sur une barre : la fiche. La chronologie d'un
  projet est la même que celle des Tâches : barre de filtres, bouton « + Tâche », mêmes barres.
- **Charge répartie** : l'estimation d'une tâche étalée sur plusieurs jours se distribue à parts égales
  sur chaque jour de son étendue (6 jours à 120 min, début lundi : 20 min du lundi au samedi). Le Gantt
  l'affiche dans la barre ou juste à sa droite quand elle est étroite (« 1 h · 20 min/j »), et sa ligne
  **Charge par jour**, sous l'échelle, donne le total des estimations des tâches ouvertes affichées pour
  chaque jour (texte par jour à l'échelle jour, total de la semaine à l'échelle resserrée, total général
  dans le coin). Le Planning liste la tâche chaque jour avec sa part (« 20 min ce jour »,
  « échéance » le dernier jour) et affiche la charge estimée en tête de journée, la to-do du jour et
  le brief vocal la comptent dans « Travail du jour » pour sa part seulement.
- **Résumé de projet** : vue d'ensemble en tête de l'onglet Résumé : ouvertes, créées et terminées sur
  30 jours, charge restante estimée, temps passé contre estimé, ouvertes par personne, répartition par
  statut et par priorité, échéances sous 7 jours, activité récente (changements et commentaires).
- **Partager** : depuis la fiche d'une tâche (« Partager ») ou la chronologie d'un projet (« Partager
  le planning »), un texte brut à copier, envoyer par mail ou via la feuille de partage de l'appareil.

## Documents livrés par le Mac mini (notes de lecture du New York Times…)

Un traitement autonome du Mac mini peut livrer un document Markdown à l'app (relais v17, action
`document`, fichier `operations01-livraisons.json`). L'app en fait un document de **Documents** (lecture
à voix haute), le met en tête de la liste de lecture et l'ouvre, prévient par la cloche (et par
notification poussée via le Mac mini), et coche la tâche dont le titre commence par celui indiqué.
Premier usage : les notes de lecture quotidiennes du New York Times (`CONTRAT-NYT.md`), qui cochent la
tâche récurrente « New York Times du JJ/MM/AAAA » du projet Veille.

## Réunions et notes vocales : enregistrer, transcrire, résumer

Rubrique **Réunions** (menu Plus) : un titre, un type (réunion ou note vocale), un projet, puis le
bouton rouge. L'audio est enregistré par le navigateur (MediaRecorder, Opus ou AAC selon l'appareil),
gardé sur l'appareil (IndexedDB) jusqu'à son envoi sur le Drive à la fin (dossier « Enregistrements
choice », envoi reprenable par morceaux), et décrit dans les données (`recordings`, exportées par le
relais v14). Pause et reprise possibles ; l'écran reste allumé pendant l'enregistrement.

- **Transcription et résumé** par le Mac mini (Whisper local, puis Opus 5.5 pour le résumé d'une
  réunion ; contrat section 7), reçus dans `operations01-transcriptions.json` ; l'app vérifie toutes
  les minutes tant qu'un enregistrement attend.
- **Fiche d'un enregistrement** : lecture audio, résumé, décisions, actions (« + Tâche » ou « Créer
  toutes les tâches » dans le projet, responsable et échéance repris), questions ouvertes,
  transcription complète.
- **Projet et journal de bord** (v154) : un enregistrement sans projet (mémo Dictaphone) se rattache
  depuis la liste (menu « Sans projet · choisir… ») ou depuis l'encart « À quel projet rattacher cet
  enregistrement ? » de sa fiche. Le **compte rendu complet** (résumé, décisions, actions, questions)
  est alors consigné dans le journal de bord du projet, replié sur sa première ligne (« voir le compte
  rendu » le déplie) ; un clic sur l'entrée rouvre la fiche, « Ouvrir le journal » fait l'inverse.
  Changer de projet déplace l'entrée dans l'autre journal.
- **iPhone** : garder l'app au premier plan pendant l'enregistrement (en arrière-plan, iOS coupe le
  micro ; une coupure clôt l'enregistrement avec ce qui a été capté, et un enregistrement interrompu
  par une fermeture de l'app est récupéré au lancement suivant). Pour enregistrer **écran éteint ou en
  faisant autre chose**, utiliser **Dictaphone** puis Partager → Drive → dossier « Enregistrements
  choice » : le Mac mini liste ce dossier (relais v15, `action=audios`), transcrit le fichier, et la
  fiche apparaît dans Réunions (lecture dans Drive, projet à choisir). Mieux : avec Dictaphone
  synchronisé par iCloud sur le Mac mini, le pipeline prend chaque mémo tout seul (relais v16,
  `action: "audio"` pour déposer la copie audio sur le Drive), sans partage à la main. Un envoi raté se
  relance depuis la fiche (« Renvoyer sur le Drive »).
- **Lexique** (v153) : un nom mal entendu (« Drotech » au lieu de Drotek) se corrige depuis la fiche
  (« Corriger un nom », le texte sélectionné est proposé) ou le bouton « Lexique » de la rubrique. La
  correction s'applique aussitôt à toutes les transcriptions affichées (texte, résumé, décisions,
  actions, questions), aux entrées de journal et aux tâches déjà créées, et le Mac mini la reçoit
  (relais v18, clé `lexique` de l'export) pour les prochaines transcriptions.

## Notifications poussées : bannière et pastille, téléphone et Mac

La cloche → « Notifications poussées » → **« Activer sur cet appareil »** abonne l'appareil (Web Push).
L'app n'a pas de serveur : c'est le Mac mini qui envoie (bibliothèque web-push, clés VAPID, voir
`ASSISTANT-REPONSES.md` section 6), d'après les abonnements enregistrés dans les données
(`pushSubscriptions`, exportés par le relais v12). Le bouton reste inactif tant que le Mac mini n'a pas
publié sa clé publique dans le fichier assistant (`push.publicKey`).

- **Bannière** système même app fermée, **pastille** sur l'icône = nombre de messages urgents (1–2)
  non traités (l'app la recalcule à chaque ouverture, le Mac mini l'envoie avec chaque notification).
- Un clic ouvre l'écran visé (`./?go=atraiter&id=…`), dans l'app déjà ouverte s'il y en a une.
- **iPhone** : nécessite l'app installée sur l'écran d'accueil (Partager → Sur l'écran d'accueil, iOS 16.4
  ou plus), et l'activation depuis l'app installée. **Mac** : Safari (macOS 13 ou plus) ou Chrome ;
  la pastille sur le Dock demande l'app ajoutée au Dock (Safari → Fichier → Ajouter au Dock).
- « Tester » affiche une bannière locale ; « Désactiver ici » retire l'appareil ; les autres appareils
  abonnés sont listés et peuvent être retirés.

## Journal de bord : un fichier .md par projet

Chaque projet a un onglet **Journal de bord**. Le journal est un fichier `.md` sur le Drive, lisible
dans **Documents** (avec la lecture à voix haute) et avec n'importe quel éditeur.

- **Création** : « Créer le journal de bord » demande le nom du fichier et le **dossier du Drive où le
  classer** (liste des dossiers du Drive tenue par le script des mails, filtrable en tapant ; un chemin
  inconnu est créé). L'app crée le fichier tout de suite à la racine du Drive (sa portée `drive.file`
  ne lui permet pas d'écrire ailleurs), puis le script des mails le **range dans le dossier demandé** à
  son prochain passage (`rangerJournaux`, 15 min au plus). L'onglet indique « À classer dans … » puis
  « Rangé dans … ». « Classer… » change le dossier à tout moment.
- **Deux sortes d'entrées.** 1) Les entrées **automatiques** d'Operations01 : séance de suivi de temps
  à l'arrêt du chrono (durée et total), tâche créée ou changement de statut, action clôturée, fil de
  mails classé dans le projet, réponse préparée à un message, tâches créées depuis un message,
  changement de statut du projet. 2) Les **notes** écrites à la main dans l'onglet (texte libre,
  date et heure modifiables), modifiables et supprimables ensuite. Le texte en cours de saisie est
  un **brouillon conservé sur l'appareil à chaque frappe** : il est remis en place après un redessin
  de l'écran, un rechargement de la page ou un retour depuis une autre app, avec le curseur au même
  endroit, jusqu'à « Consigner » (ou « Effacer le brouillon »).
- **Le fichier** est regroupé par jour (ordre chronologique), une ligne par entrée avec l'heure et une
  icône par type, les notes sur plusieurs lignes conservées. Il est réécrit au plus tard 15 s après
  chaque ajout, et « Régénérer » le réécrit à la demande. Les entrées vivent dans les données
  synchronisées (`journalEntries`) : elles sont fusionnées entre appareils et s'accumulent même avant
  la création du fichier.
- **Lecture** : « Lire » ouvre le journal dans Documents ; il y figure dans la liste de lecture,
  marqué 📓, sans bouton de suppression. « ↗ Drive » l'ouvre sur le Drive.

## Correspondances : un fichier par interlocuteur sur le Drive, réponses étayées

Le dossier **Correspondances/** du Drive (racine de « Mon Drive ») contient **un `.md` par
interlocuteur** : pour chaque message, la date, le sujet, le texte reçu, puis **ma réponse réellement
envoyée** (ou « pas de réponse envoyée »). Les fichiers sont régénérés à chaque passage à partir de
`Correspondances/_données/<clé>.json` ; `_données/index.json` liste les interlocuteurs.

- **Gmail** : `appsscript-correspondances.gs`, installé dans chaque compte Google (boîte principale :
  `DOSSIER_CORRESPONDANCES_ID` vide, le dossier est créé et partagé en écriture avec les boîtes
  secondaires déclarées dans l'app ; boîte secondaire : coller l'identifiant du dossier). Toutes les
  15 minutes : fils ayant bougé, puis l'historique par tranches de 60 fils jusqu'à `ARCHIVE_DEPUIS` (1er janvier 2026).
  Newsletters, notifications et messages entre mes propres adresses sont ignorés ; citations et
  signatures sont retirées ; 4 000 caractères au plus par message.
- **SMS, iMessage, WhatsApp, Google Chat** : le Mac mini envoie les entrées au relais
  (`appsscript-relais-evenements.gs` v3, `action: "correspondance"`), qui écrit dans les mêmes
  fichiers. Un contact de l'app connu par son téléphone **et** son adresse n'a qu'un fichier.
- **Dans l'app** : « Correspondance (n messages archivés · dernier le …) » sur la page d'un message
  et la fiche d'un contact ouvre le `.md` sur le Drive (index relayé par le script mails de la boîte
  principale).
- **Réponses étayées** : pour chaque message, le Mac mini écrit `proposition.reponse` et
  `proposition.contexte[]` (source, titre, date, extrait, lien) après recherche dans l'archive de
  l'interlocuteur, les archives du projet et les tâches, rédigée par Claude Opus 5.5 via le forfait
  Claude (Claude Code en mode headless), le modèle local servant de repli. L'app affiche la réponse, la mention
  « étayée », les éléments de contexte, et ouvre Gmail, Messages ou WhatsApp pré-rempli selon le
  canal. Le contrat complet est dans `ASSISTANT-REPONSES.md`.
- **À la demande seulement** (v144) : par défaut, l'assistant ne propose aucune réponse, quelle que soit
  l'urgence. « ✨ Réponse détaillée basée sur les communications précédentes » (ou « ↻ Nouvelle réponse
  détaillée ») envoie une demande, avec une précision facultative (« courte, en anglais »), que le Mac
  mini sert avec **Claude Opus 5.5 Extra** (effort maximal, toutes les communications précédentes) en
  quelques minutes ; l'app relit le fichier toutes les 30 s en attendant. Seules les propositions
  demandées s'affichent ; une proposition écrite sans demande reste masquée.
- **Corriger et décider** : « ✏️ Modifier » ouvre la réponse en édition ; la version de Grégory est
  mémorisée (synchronisée), c'est elle qui est copiée ou envoyée, et un bouton rétablit la proposition.
  « Créer la tâche », « Une tâche par étape » et « Tâche » ouvrent une boîte : intitulé, **projet**
  (proposé d'après le dernier choix pour cet expéditeur, sinon le sujet et le domaine), **échéance**,
  **temps alloué**, étapes modifiables (« | 30 » pour la durée). Chaque décision (projet, échéance,
  temps, étapes, contre ce qui était proposé) et chaque correction de réponse sont exportées par le
  relais (v5) au Mac mini, qui s'en sert pour apprendre (section 4 du contrat).

### Index des correspondances : un fichier par compte (relais v20, correspondances v3)

`Correspondances/_données/index.json` est la base. S'il manque ou est vide, le relais (v21) le
reconstruit tout seul en arrière-plan, par un déclencheur ponctuel qui se relance jusqu'à ce que tout
soit indexé (vérification au plus une fois par heure ; `reconstruireIndex` reste disponible à la main).
L'adresse du relais ouverte sans paramètre affiche sa version. Chaque compte qui archive écrit ensuite son propre `index-<adresse>.json`, le relais le sien
(`index-relais.json`) ; à la lecture, tous sont fusionnés et la clé la plus récemment mise à jour
l'emporte. Plus d'écriture concurrente des trois boîtes sur un même fichier, et un fichier vidé par une
écriture interrompue (ce qui est arrivé le 27 octobre) est simplement ignoré au lieu de bloquer
l'index.

## Lire les mails dans l'app (Gmail, lecture seule)

Sur la page d'un message « À traiter », la carte **Message complet** affiche le mail lui-même
(texte, mise en forme, pièces jointes) sans quitter l'app. L'accès est **en lecture seule** :
rien n'est envoyé, déplacé ni supprimé, et le contenu n'est pas conservé sur l'appareil.

1. Console Google Cloud → **API et services → Bibliothèque** → **Gmail API** → **Activer**
   (même projet que l'ID client OAuth de l'app).
2. Si l'écran de consentement est en mode « Production » sans validation Google, la lecture
   des mails (portée « restreinte ») peut être refusée : passez l'application en mode **Test**
   et ajoutez votre adresse dans les **utilisateurs test**.
3. Dans l'app : ouvrez un message → **Relier ma boîte Gmail** → sur l'écran Google, laissez la
   case de lecture des e-mails cochée → Autoriser.

La boîte du compte Google relié à l'app est lue avec la session principale. Pour les messages
venant d'un autre compte (Icarus, Majandco, Gmail perso…), la carte propose **« Relier la boîte
<adresse> »** : Google demande de choisir ce compte, et un jeton de lecture seule propre à cette
boîte est mémorisé sur l'appareil (à refaire une fois par appareil). Les images distantes sont
bloquées tant que vous ne cliquez pas « Afficher les images » (pas de pixel de suivi).
« Délier » retire l'accès à tout moment, boîte par boîte.
