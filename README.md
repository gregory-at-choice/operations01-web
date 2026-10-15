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

- **Début et durée** : une tâche porte une échéance, et peut aussi avoir un début et une durée en
  jours ; l'étendue (début → fin) se déduit de ce qui est renseigné.
- **Chronologie (Gantt)** : onglet d'un projet, et vue globale dans Tâches (groupée par projet).
  Une ligne par tâche datée, barres colorées par statut (liseré rouge en retard, remplissage =
  avancement), sous-tâches indentées, jalons en losange, dépendances fléchées, trait « aujourd'hui »,
  échelle adaptée à l'étendue (jours ou semaines). Clic sur une barre : la fiche.
- **Résumé de projet** : vue d'ensemble en tête de l'onglet Résumé : ouvertes, créées et terminées sur
  30 jours, charge restante estimée, temps passé contre estimé, ouvertes par personne, répartition par
  statut et par priorité, échéances sous 7 jours, activité récente (changements et commentaires).
- **Partager** : depuis la fiche d'une tâche (« Partager ») ou la chronologie d'un projet (« Partager
  le planning »), un texte brut à copier, envoyer par mail ou via la feuille de partage de l'appareil.

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
- **À la demande** : les réponses ne sont rédigées d'avance que pour les messages urgents à répondre et
  les demandes de créneau. Pour tout autre message, « ✨ Proposer une réponse » (ou « ↻ Nouvelle
  proposition ») envoie une demande, avec une précision facultative (« courte, en anglais »), que le
  Mac mini sert avec Opus 5.5 en quelques minutes ; l'app relit le fichier toutes les 30 s en attendant.
- **Corriger et décider** : « ✏️ Modifier » ouvre la réponse en édition ; la version de Grégory est
  mémorisée (synchronisée), c'est elle qui est copiée ou envoyée, et un bouton rétablit la proposition.
  « Créer la tâche », « Une tâche par étape » et « Tâche » ouvrent une boîte : intitulé, **projet**
  (proposé d'après le dernier choix pour cet expéditeur, sinon le sujet et le domaine), **échéance**,
  **temps alloué**, étapes modifiables (« | 30 » pour la durée). Chaque décision (projet, échéance,
  temps, étapes, contre ce qui était proposé) et chaque correction de réponse sont exportées par le
  relais (v5) au Mac mini, qui s'en sert pour apprendre (section 4 du contrat).

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
