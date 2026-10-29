# Réponses étayées et archive des correspondances — contrat entre le Mac mini et l'app

Document de référence pour le pipeline « assistants » du Mac mini (`/Users/choice/assistants`).
L'app choice (ce dépôt) et les scripts Google Apps Script sont déjà prêts à recevoir ce qui est
décrit ici. Ce fichier peut être collé tel quel dans une session Claude Code ouverte sur le Mac mini.

## Objectif

1. **Pour chaque message entrant** (mail, SMS, iMessage, WhatsApp, Google Chat…), quelle que soit son
   urgence, proposer une **réponse étayée** : prête à envoyer, et accompagnée des **éléments de
   contexte** qui l'ont fondée (ce que l'interlocuteur et moi nous sommes déjà dit, les documents du
   projet, les tâches en cours, les échéances).
2. **Tenir une archive des correspondances sur le Drive** : dossier `Correspondances/`, un fichier
   `.md` par interlocuteur, avec pour chaque message la date, le sujet, le texte reçu, puis **ma
   réponse réellement envoyée**.

Gmail est déjà couvert par un script Google (`appsscript-correspondances.gs`) qui tourne dans chaque
boîte. Le Mac mini doit couvrir **les canaux hors Gmail** (Messages, WhatsApp, Google Chat) et
**générer les propositions**.

## 1. Archive des correspondances : ce que le Mac mini envoie

Pour chaque message reçu hors Gmail, et de nouveau quand ma réponse est partie, envoyer au relais
(URL habituelle du script « Operations01 relais ») :

```json
POST { "secret": "…", "action": "correspondance", "entrees": [
  { "id": "sms:<ROWID chat.db>",            // identifiant stable du message reçu (préfixe par canal)
    "cle": "+33612345678",                   // téléphone au format +33… ou adresse e-mail (clé de l'interlocuteur)
    "nom": "Éric Chenneveau",                // nom du carnet d'adresses macOS si connu, sinon vide
    "canal": "sms" | "imessage" | "whatsapp" | "chat",
    "compte": "messages-mac-mini",           // même valeur que ev.compte dans les événements
    "sens": "recu",                          // "envoye" pour un message que j'ouvre moi-même
    "date": "2026-10-09T08:00:00Z",          // réception
    "sujet": "SMS",                          // ou les premiers mots (≤ 60 caractères)
    "message": "texte reçu",
    "reponse": "",                           // ma réponse réellement envoyée, quand elle existe
    "reponseLe": "",                         // date d'envoi de ma réponse
    "lien": "" } ] }
```

Règles :

- **Fusion par `id`** : renvoyer la même entrée plus tard avec `reponse` renseignée complète la
  fiche sans doublon. Ma réponse = le premier message sortant de la même conversation après le
  message reçu (`is_from_me = 1` dans `chat.db` ; `ZISFROMME = 1` dans `ChatStorage.sqlite`).
- Un message sortant qui ne répond à rien (c'est moi qui ouvre) : `sens: "envoye"`, `reponse` =
  mon texte, `message` vide.
- Le relais range les SMS d'un contact de l'app (téléphone connu) **dans le même fichier que ses
  mails**, sous son adresse. Rien à faire côté Mac mini.
- Reprise de l'historique : envoyer par lots de 200 entrées, les plus anciennes d'abord, depuis le
  début des bases (le relais tient en 20 s pour 200 entrées).
- Réponse du relais : `{ ok, interlocuteurs, entrees, ignorees }`.

Lecture (pour le contexte) :

- `GET ?secret=…&action=correspondances` → index `{ cle: { nom, url, n, dernier, canaux } }`.
- `GET ?secret=…&action=correspondance&cle=+33612345678&max=30` → `{ nom, total, entrees:[…], markdown }`,
  les 30 dernières entrées (`depuis=AAAA-MM-JJ` pour borner dans le temps). La clé peut être un
  téléphone saisi autrement (`06 12 34 56 78`) ou une adresse : le relais résout via les contacts.

Si Google Drive pour ordinateur est installé sur le Mac mini, le dossier
`~/Library/CloudStorage/GoogleDrive-<compte>/Mon Drive/Correspondances/` contient les mêmes `.md`
et `_données/*.json` : les lire directement est plus rapide que le relais.

## 2. Proposition de réponse étayée : ce que le Mac mini écrit dans l'événement

Le champ `proposition` d'un événement (POST habituel `{ evenements:[…] }`, le relais ne met à jour
que ce champ sur un événement existant) est écrit **uniquement sur demande de Grégory** (v144,
« Quand rédiger » ci-dessous) :

```json
"proposition": {
  "reponse": "Bonjour Éric, oui, 14 h sur place demain me convient. J'apporte la v2.2 …",
  "genereePar": "claude-opus-5-5 (extra)", "genereeLe": "2026-10-10T07:05:00Z", "surDemande": true,
  "contexte": [
    { "source": "correspondance", "titre": "Éric Chenneveau · 28/09 · Point d'étape chantier",
      "date": "2026-09-28", "extrait": "« Première réunion de chantier le 28, visite SDIS dans la semaine. »",
      "lien": "https://drive.google.com/file/d/…/view" },
    { "source": "projet", "titre": "MSVL - Financement public · Opérations détaillées",
      "date": "2026-09-29", "extrait": "Qualifier par écrit le chantier ouvert le 28 septembre (échéance 2 oct.)" },
    { "source": "tache", "titre": "Arrêter la version de référence dans la v2.2", "date": "2026-10-09" }
  ],
  "tache": { … }, "processus": [ … ]      // inchangés
}
```

- `source` ∈ `correspondance` · `projet` · `evenement` · `tache` · `document` · `agenda` · `contact`
  (`agenda` : les créneaux vérifiés, voir « Proposer de vrais créneaux »).
  L'app les affiche sous la réponse, dans « Éléments de contexte pris en compte (n) », avec le lien
  s'il existe. Trois à six éléments suffisent ; `extrait` ≤ 300 caractères.
- La réponse est **dans ma voix** : s'appuyer sur mes réponses réelles archivées (ton, formules,
  longueur) ; vouvoiement ou tutoiement tel qu'employé avec cette personne. Pas d'invention : un fait
  absent des sources est annoncé comme à vérifier (« je te confirme la date demain »).
- Pour un SMS ou WhatsApp : court, sans formule de politesse longue. L'app ouvre Messages ou
  WhatsApp pré-rempli ; pour un mail, Gmail. Rien n'est envoyé sans moi.
- Si rien ne justifie une réponse (newsletter, notification, information pure), ne pas écrire de
  `reponse` : l'app affiche alors seulement l'action suggérée.

### Texte des messages hors mail

Pour les événements `sms`, `imessage`, `whatsapp` et `chat`, envoyer le **texte intégral** dans
`ev.contenu` (le relais v6 le conserve, tronqué à 3 000 caractères, et l'app l'affiche dans une carte
« Message » ; pour les mails il reste supprimé, l'app les lit dans Gmail). `ev.sujet` = les premiers
mots (≤ 60 caractères), `ev.expediteur.nom` = le nom du carnet d'adresses macOS quand il existe, sinon
vide (jamais le numéro répété). Renvoyer une fois tous les événements hors mail des 30 derniers jours
avec leur `contenu` : le relais complète ceux qui n'en ont pas. Depuis le relais v7, renvoyer un
événement hors mail déjà connu met aussi à jour `expediteur.nom` et `sujet` (pour corriger les anciens
qui portaient le numéro). `POST { action: "retirer", ids: [...] }` retire des événements envoyés par
erreur, seulement s'ils sont encore « nouveau » : ne jamais envoyer au relais un message absent de
l'app sans vouloir qu'il y apparaisse (`GET ?action=export` donne la liste des identifiants connus).

### Périmètre par compte

| Compte (`ev.compte`) | Classement par urgence | Réponse étayée | Archive des correspondances |
|---|---|---|---|
| `choicefinance`, `majandco`, `icarus` | oui | **oui** | oui (script Gmail dans chaque boîte) |
| `gmail` (Gmail perso, reçoit la redirection Outlook) et `outlook` | **oui, c'est l'essentiel** | **non** : ne pas écrire `proposition.reponse`, l'action suggérée suffit, Grégory gère ces réponses lui-même | non |
| `messages-mac-mini` (SMS, iMessage), `whatsapp-mac-mini`, Google Chat | oui | oui, courte | oui (via le relais, section 1) |

Un mail du compte `gmail` ou `outlook` ne consomme donc rien sur le forfait : pas d'appel à Opus, le
classement local suffit. Les volumes concernés sont faibles (environ 175 messages par mois à eux
deux).

### Proposer de vrais créneaux (agenda)

Quand un message demande ou propose une rencontre, un déjeuner, un appel, une visio ou « tes
dispos », la réponse **ne doit jamais promettre de regarder l'agenda** : elle le regarde. Le relais v9
l'expose : `GET ?secret=…&action=agenda&jours=10` renvoie tous les agendas Google du compte principal
(Choice, Icarus, Majandco en occupé/libre, perso) avec, pour chaque jour, les plages libres de 8 h à
22 h et deux raccourcis `midi` (12 h–14 h libre au moins 75 min) et `soir` (19 h–22 h). Les événements
« routine » et « lecture » ne comptent pas comme occupés ; les événements marqués provisoires sont
signalés `optionnel`.

Règles : proposer **deux ou trois créneaux précis** (jour, heure), à partir du lendemain sauf si le
message est urgent ; pour un déjeuner, viser 12 h 30 et vérifier qu'aucun rendez-vous ne commence avant
14 h 15 ; tenir compte des trajets (un événement « Trajet voiture » bloque, et un lieu hors Tours la
veille au soir ou le matin exclut un déjeuner à Tours) ; mentionner la contrainte quand elle existe
(« je dois être à Mame à 14 h »). Mettre les créneaux retenus dans `proposition.contexte` avec
`source: "agenda"` (titre : « Agenda · jeudi 16 : libre 11 h 30–15 h 30 »), et une tâche
« Confirmer le créneau avec X » à l'échéance du premier créneau proposé. Exemple attendu pour « Cette
semaine dispo un midi pour déjeuner ? » reçu un lundi : « Yes avec plaisir 🙂 Jeudi ou vendredi midi,
12 h 30 ? Aujourd'hui aussi possible mais je dois être à Mame à 14 h. »

### Sources de contexte à interroger (dans cet ordre)

1. **Correspondance avec l'interlocuteur** : **tout** son fichier (relais ou Drive local), pas
   seulement les dernières entrées : une réponse détaillée se demande rarement, elle mérite
   l'historique complet. Si le fichier dépasse ce que le prompt accepte, garder l'intégralité des
   douze derniers mois et résumer le reste par trimestre.
2. **Projet concerné** : le projet dans lequel l'événement a été classé (export du relais,
   `data.missions`) ; ses tâches ouvertes et leurs échéances (`data.tasks` avec `missionId`), ses
   actions en attente (`data.actions`), ses rendez-vous à venir (`data.rendezvous`).
3. **Archives du projet sur le Drive** : dossier `5_Clients/<Projet>/` (et sous-dossiers). Texte
   des `.md`, `.docx`, `.pdf`, Google Docs exportés ; index plein texte (BM25) ou vecteurs locaux
   (`nomic-embed-text` via Ollama), reconstruit la nuit. Donner le chemin du document en `lien`
   (`https://drive.google.com/file/d/<id>/view` si l'identifiant est connu).
4. **Événements précédents du même expéditeur** et leurs propositions acceptées (`statut: traite`).

### Quand rédiger : jamais d'avance, uniquement à la demande (v144)

**Par défaut, aucune réponse n'est rédigée.** Ni pour les urgences 1 et 2, ni pour les demandes de
créneau : plus aucune génération d'avance, plus de lot de nuit. Le classement (urgence, action,
résumé d'une phrase), les tâches proposées et les notifications poussées continuent comme avant.

- **À la demande seulement** : dans l'app, « ✨ Réponse détaillée basée sur les communications
  précédentes » (ou « ↻ Nouvelle réponse détaillée » quand une existe) écrit une demande dans
  `data.evRequests` de l'export du relais :
  `{ idEvt: { type: "reponse", mode: "detaillee", modele: "claude-opus-5-5-extra", at, note, expediteur, source, sujet, urgence } }`.
  **Interroger l'export toutes les 60 secondes** ; servir chaque demande dont `at` est postérieur au
  `genereeLe` de la proposition existante, **avant tout autre travail**, avec **Claude Opus 5.5
  « Extra »** : le modèle `claude-opus-5-5` en effort Extra, Claude Code `--effort xhigh` (le niveau
  juste en dessous de max), réflexion étendue, et **toutes** les communications précédentes
  avec l'interlocuteur (le `.md` complet, pas seulement les derniers messages), le ton et les
  habitudes, les lieux, les dates, l'agenda si un créneau est en jeu, le projet et son journal de bord.
- La proposition ainsi produite porte `surDemande: true` et `genereePar: "claude-opus-5-5 (extra)"` :
  l'app n'affiche **que** les propositions demandées. Une proposition écrite sans demande n'est pas
  affichée (et consomme le forfait pour rien).
- **Repli** : l'app reconnaît un repli au mot « repli » dans `genereePar`, quel que soit le modèle,
  et l'affiche avec l'étiquette « repli · Opus réécrira après la pause ». Quand Opus réécrit la réponse
  après la pause (`genereeLe` plus récent), le relais la remplace et l'app affiche la nouvelle version,
  y compris si Grégory avait retouché le texte du repli. `note` est une consigne de Grégory à respecter mot pour mot (« réponse courte, je décline »,
  « en anglais », « propose un créneau la semaine prochaine »). Poster la proposition avec
  `genereeLe` = maintenant : l'app efface la demande dès qu'elle la voit. Objectif : moins de trois
  minutes entre la demande et l'affichage.
- Les tâches proposées (`tache`, `processus`) et le classement ne changent pas : ils restent
  systématiques et locaux.

### Modèle : Claude Opus 5.5 via mon forfait Claude (Claude Code en mode headless)

La rédaction des réponses se fait avec **Claude Opus 5.5**, facturé sur **mon abonnement Claude**
(pas de clé API, pas de facturation au jeton), en appelant Claude Code sans interface depuis le
pipeline. Le modèle local (Ollama) reste chargé du **classement**, des **vecteurs** et de la
**présélection du contexte** ; il sert aussi de **repli** quand le forfait est épuisé.

Mise en place (une fois, sur le Mac mini, avec le compte Claude Code déjà connecté) :

1. `claude setup-token` → jeton OAuth valable un an, lié à l'abonnement. Le stocker dans le
   trousseau ou un fichier `chmod 600`, et le fournir au pipeline par la variable
   `CLAUDE_CODE_OAUTH_TOKEN`. Ne **jamais** définir `ANTHROPIC_API_KEY` dans l'environnement du
   pipeline : en mode `-p`, une clé API présente l'emporte toujours sur le forfait.
2. Claude Code ≥ 2.1.280 (Opus 5.5). Vérifier avec `claude --version`.
3. Lancer chaque génération depuis un dossier **sans** `CLAUDE.md`, hooks ni serveurs MCP (par
   exemple `/Users/choice/assistants/claude-vide/`), pour que rien du contexte de développement ne
   s'invite dans le prompt.

Appel type (un message = un appel, prompt et contexte sur l'entrée standard) :

```bash
cd /Users/choice/assistants/claude-vide && env -u ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.assistants/claude-token)" \
  claude -p "$(cat /tmp/prompt-$ID.md)" \
    --model claude-opus-5-5 --effort xhigh \
    --tools "" --disallowedTools "mcp__*" \
    --system-prompt-file /Users/choice/assistants/prompts/reponse-etayee.md \
    --output-format json --json-schema "$(cat /Users/choice/assistants/prompts/proposition.schema.json)" \
    --no-session-persistence
```

- `proposition.schema.json` décrit exactement l'objet `proposition` de la section 2 (`reponse`,
  `contexte[]`). Le résultat validé est dans `structured_output` de la sortie JSON ; `result` et
  `session_id` peuvent être ignorés.
- Le prompt contient : le message reçu, la correspondance complète avec l'interlocuteur, les
  extraits du projet, de ses tâches et de son journal de bord présélectionnés localement, l'agenda si
  un créneau est en jeu, et mes réponses réelles au même interlocuteur (pour le ton). Pas de plafond
  de jetons serré : les demandes sont rares et voulues, la qualité prime.
- `--effort xhigh` (« Extra ») pour toutes les réponses demandées ; aucune génération sans demande.

Forfait : **Max 20x**. Depuis la v144, seules mes demandes déclenchent Opus : quelques réponses
par jour au plus, soit une fraction du plafond hebdomadaire. À mesurer avec `/usage` dans Claude
Code (part de la fenêtre de 5 heures et de la semaine) et à reporter dans le brief du matin.

Limites du forfait et repli :

- Le forfait a une **fenêtre de 5 heures** et un **plafond hebdomadaire**, partagés avec mes
  propres sessions Claude et Claude Code. **Aucune génération d'avance** : réponses à la demande
  seulement (section ci-dessus), en effort Extra (xhigh) puisqu'elles sont rares et voulues.
- Quand Claude Code répond par une erreur de limite d'usage (sortie JSON avec `is_error: true` ou
  code de retour non nul mentionnant « usage limit » / « rate limit »), **ne pas réessayer** avant
  la fin de la fenêtre : basculer sur le modèle local pour ce message, avec
  `genereePar: "qwen3:8b (repli, forfait épuisé)"` (ou `"qwen3:8b (repli)"` après deux échecs
  d'Opus), toujours avec `surDemande: true`, et remettre l'événement dans la file pour
  régénération par Opus au passage suivant.
- Renouveler le jeton avant son échéance (un an) : noter la date dans le brief du matin un mois
  avant.

Cadence et journal :

- Une proposition peut être **régénérée** (nouvel élément de contexte, réponse de ma part arrivée
  entre-temps) : renvoyer l'événement avec un `genereeLe` plus récent, le relais remplace.
- Journaliser dans `~/Library/Logs/assistants/reponses.log` : id, urgence, sources consultées,
  durée, modèle (`claude-opus-5-5` ou repli), et le `total_cost_usd` renvoyé (indicatif : avec le
  forfait il n'est pas facturé).

## 3. Ce que l'app fait déjà (v119)

- Affiche la proposition pour tout événement qui en a une, avec la mention « étayée » et le bloc
  « Éléments de contexte pris en compte (n) » quand `contexte` est présent.
- Bouton « Répondre dans Gmail / Messages / WhatsApp » pré-rempli selon le canal ; « Copier ».
- Lien « Correspondance (n messages archivés · dernier le …) » sur la page d'un message et sur la
  fiche d'un contact, vers le `.md` de l'interlocuteur sur le Drive (index fourni par le script
  mails de la boîte principale, rafraîchi toutes les 15 minutes).

## 4. Apprendre des échanges et des décisions

L'app enregistre ce que Grégory fait réellement de chaque proposition, et le relais l'expose dans
`GET ?action=export` (clés `data.evEdits`, `data.evDecisions`, `data.evLearn`, `data.evSteps`), en
plus de `data.tasks` (avec `eventId`, `estimationMin`, `missionId`, `dueDate`) et des temps réellement
passés (`missions[].entries`). À exploiter à chaque génération et dans un recalibrage nocturne :

| Signal | Où | Usage |
|---|---|---|
| **Réponse corrigée** : `evEdits[id] = { reponse, original, genereePar, expediteur, source, compte, sujet, at }` | export | Les 20 dernières corrections (original → version de Grégory) pour le même expéditeur, sinon le même compte, entrent dans le prompt comme exemples « voici comment je corrige tes brouillons ». Mesurer la distance original/corrigé par semaine : elle doit baisser. |
| **Réponses réellement envoyées** | archive `Correspondances` (section 1) | La vérité terrain du ton et de la longueur : trois réponses réelles au même interlocuteur dans chaque prompt. |
| **Projet choisi** : `evLearn.senderMission[expediteur] = missionId` et `evDecisions[id].missionId` | export | Proposer directement ce projet pour cet expéditeur (champ `projetId` dans la proposition : l'app le présélectionnera). Après trois décisions concordantes pour un domaine d'adresse, l'étendre à tout le domaine. |
| **Échéance et temps alloué** : `evDecisions[id].dueDate` / `estimationMin` contre `evDecisions[id].proposed` | export | Calibrer par type d'action et par expéditeur : si Grégory alloue en moyenne 0,7 fois le temps proposé, proposer 0,7 fois. Même chose pour le délai entre réception et échéance choisie. |
| **Étapes retenues** : `evDecisions[id].steps` contre `proposed.steps`, `evSteps` (étapes cochées) | export | Étapes supprimées systématiquement → ne plus les proposer ; étapes ajoutées → les proposer pour les messages semblables. |
| **Temps réellement passé** : `missions[].entries` (chronos) et `tasks[].estimationMin` | export | Ratio réel / alloué par projet et par type de tâche, repris dans les estimations (`assistant.estimations`). |
| **Décisions sans suite** : événement `traite` sans tâche créée, ou `ignore` | export + événements | Un expéditeur ignoré trois fois d'affilée → urgence 4 par défaut ; un expéditeur dont les messages deviennent toujours des tâches → urgence relevée d'un cran. |

Charge journalière : une tâche étalée sur plusieurs jours (`startDate`/`durationDays`/`dueDate`
dans `data.tasks`) compte dans le brief et dans `totalEstimeMin` pour **sa part du jour** seulement :
estimation divisée par le nombre de jours de son étendue (6 jours à 120 min : 20 min par jour), pas
pour son total.

Règles : l'apprentissage ne modifie jamais les données de l'app (lecture seule de l'export) ; il
s'exprime dans les propositions suivantes. Journaliser chaque nuit dans `apprentissage.log` : nombre
de corrections lues, distance moyenne, ratios de temps, projets appris. Mettre dans le brief du matin
une ligne « L'assistant a appris : … » quand quelque chose a changé.

## 6. Notifications poussées : bannière et pastille sur l'iPhone et le Mac (v143, relais v12)

L'app n'a pas de serveur. C'est **le Mac mini qui envoie les notifications** (Web Push), d'après les
abonnements que chaque appareil enregistre dans l'app. Grégory les active depuis la cloche →
« Notifications poussées » → « Activer sur cet appareil » (sur iPhone, depuis l'app installée sur
l'écran d'accueil). Le service worker de l'app affiche la bannière, pose la pastille et ouvre l'écran
visé au clic.

**Clés VAPID (une fois).** `npx web-push generate-vapid-keys` → garder les deux clés dans
`~/.assistants/vapid.json` (`{ "publicKey", "privateKey" }`, privée jamais exportée). Publier la clé
publique dans le fichier assistant via le relais :
`POST { secret, action: "assistant", push: { publicKey: "<clé publique>" } }` (à chaque démarrage, c'est
idempotent). Tant que `push.publicKey` n'est pas publié, le bouton « Activer » de l'app reste inactif.

**Abonnements.** L'export du relais (`GET ?action=export`, v12) contient `data.pushSubscriptions` :
`[{ id, endpoint, keys: { p256dh, auth }, appareil: "iPhone · Safari (app installée)", createdAt, vuLe }]`.
Un abonnement = un appareil. Les relire à chaque cycle (ils changent quand Grégory active ou désactive
un appareil).

**Envoi.** Bibliothèque `web-push` (Node) :
```js
webpush.sendNotification({ endpoint, keys }, JSON.stringify(charge), {
  vapidDetails: { subject: "mailto:gregory.arbia@choicefinance.fr", publicKey, privateKey },
  TTL: 3600, urgency: "high" });
```
Charge utile (JSON) : `{ titre, corps, url, section, id, tag, urgence, badge }`.
- `titre` court (« Urgence 1 · Éric Chenneveau »), `corps` ≤ 150 caractères (sujet ou première phrase du
  résumé) ; pas de contenu sensible au-delà (la bannière s'affiche sur l'écran verrouillé).
- `url` : `./?go=atraiter&id=<id de l'événement>` ouvre le message dans l'app ; `./?go=home` pour le brief.
  `section` et `id` servent quand l'app est déjà ouverte (le service worker lui demande d'y aller).
- `tag` = id de l'événement (une bannière remplacée, jamais dupliquée) ; `urgence` 1 garde la bannière à
  l'écran jusqu'au clic.
- `badge` = nombre d'événements **nouveaux d'urgence 1 ou 2** à l'instant de l'envoi : c'est la pastille
  sur l'icône. L'app la recalcule elle-même à chaque ouverture.

**Quoi envoyer.**
1. Un événement nouveau classé **urgence 1 ou 2** → envoi immédiat, une seule fois par événement
   (journal des envois `~/.assistants/push-envoyes.json`, id → date).
2. **Brief du matin à 8 h** (jours ouvrés) : titre « Brief du jour », corps « N urgents · N échéances
   aujourd'hui · N rendez-vous », `url` `./?go=home`.
3. **Rappel de rendez-vous 30 min avant** (agenda via `?action=agenda&jours=1`) : titre = intitulé,
   corps = heure et lieu.
4. Silence entre 22 h et 7 h, sauf urgence 1. Jamais plus de 6 envois par heure : au-delà, un seul
   envoi « N nouveaux messages urgents ».

**Abonnements morts.** Réponse 404 ou 410 du service de push → l'abonnement n'existe plus : ajouter son
`id` à `push.invalides` via `POST { action: "assistant", push: { invalides: [id, …] } }` ; l'app le
retire de sa liste à sa prochaine ouverture. 401/403 → clé VAPID incohérente avec celle publiée
(republier la clé publique, Grégory devra réactiver les appareils).

**Test.** `node push.js --test` envoie « choice · test » à tous les abonnements et affiche le code de
chaque réponse (201 = livré au service de push).

## 7. Réunions et notes vocales : transcription et résumé (v147, relais v14)

Grégory enregistre depuis l'app (rubrique **Réunions**) une réunion ou une note vocale. L'audio part sur
le Drive dans le dossier « Enregistrements choice » (fichier `.webm` Opus ou `.m4a` AAC selon
l'appareil, 64 kbit/s), et l'enregistrement est décrit dans `data.recordings` de l'export du relais :
`{ id, title, kind: "reunion"|"note", missionId, startedAt, durationSec, mime, size, fileId, fileName, statut }`.
`statut: "envoye"` = audio disponible, transcription attendue. **Le Mac mini transcrit, résume et poste.**

**Fichiers déposés directement dans le dossier (v149, relais v15).** Sur iPhone, l'app web ne peut pas
enregistrer en arrière-plan ; Grégory utilise alors Dictaphone puis Partager → Drive → dossier
« Enregistrements choice ». `GET ?action=audios` liste les fichiers audio du dossier
(`{ id, nom, mime, taille, creeLe }`). Tout fichier absent de `data.recordings` (par `fileId`) et des
transcriptions est à traiter comme un enregistrement : poster la transcription avec
`id: "drive:<fileId>"`, `fileId`, `titre` (nom sans extension), `nom`, `mime`, `taille`, `enregistreLe`
(= `creeLe`), `dureeSec` (mesurée), `kind: "reunion"` (ou `"note"` si moins de 3 minutes). L'app crée
alors la fiche d'elle-même ; Grégory lui attribue un projet.

**Dictaphone par iCloud, sans aucun geste (relais v16).** Le Mac mini est connecté au compte iCloud de
Grégory avec Dictaphone activé : chaque mémo enregistré sur l'iPhone (écran éteint, autre app devant)
arrive de lui-même dans
`~/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/` (fichiers `.m4a`), et la base
`CloudRecordings.db` (SQLite, table `ZCLOUDRECORDING`) donne pour chacun le titre (`ZCUSTOMLABEL` ou
`ZENCRYPTEDTITLE`), la date (`ZDATE`, secondes depuis 2001-01-01) et la durée (`ZDURATION`). Cycle :
1. Surveiller ce dossier (toutes les 60 s, ou `fswatch`). Un mémo est pris en compte quand son fichier
   n'a plus changé depuis 30 s (synchronisation terminée). Ignorer les mémos dont le titre contient
   « perso » (règle modifiable par Grégory).
2. Déposer une copie de l'audio dans le dossier Drive pour l'écoute depuis l'app :
   `POST { secret, action: "audio", nom: "<AAAA-MM-JJ HHhMM – titre>.m4a", mime: "audio/mp4", base64 }`
   → `{ id }` (45 Mo au plus ; au-delà, poster une version réencodée à 48 kbit/s). Un nom déjà présent
   renvoie l'id existant (`deja: true`) : l'opération est rejouable.
3. Transcrire et résumer comme ci-dessus, puis poster la transcription avec `id: "drive:<id>"`,
   `fileId`, `titre` (titre du mémo), `enregistreLe` (date du mémo), `dureeSec`, `origine: "dictaphone"`.
4. Notification poussée « Transcription prête · <titre> ».
Un mémo arrivé aussi par Partager → Drive (même nom) n'est traité qu'une fois (dédoublonnage par nom).

**Cycle (toutes les 60 secondes, avec les demandes de réponse).**
1. Lire l'export ; pour chaque enregistrement `statut: "envoye"` absent de `GET ?action=transcriptions`
   (ids déjà traités), télécharger l'audio : `GET ?action=audio&id=<fileId>` → `{ nom, mime, taille, base64 }`
   (45 Mo au plus par le relais ; au-delà, lire le fichier par le Drive local du Mac mini si monté).
2. **Transcrire en local** : Whisper (`mlx-whisper` ou `whisper.cpp`, modèle `large-v3-turbo`), langue
   détectée (français par défaut), horodatage par segment conservé pour la relecture, pas de diarisation
   obligatoire (si elle est disponible, préfixer les tours de parole « — »).
3. **Résumer** : pour une **réunion**, Claude Opus 5.5 (`--effort high`, pas Extra : c'est un résumé,
   pas une réponse) avec le contexte du projet (`missionId` : tâches ouvertes, journal de bord,
   correspondances des participants cités) ; pour une **note vocale**, le modèle local suffit (résumé en
   trois phrases, actions éventuelles). Produire :
   - `resume` : Markdown court (objet, points clés, conclusion), 150 à 400 mots pour une réunion ;
   - `decisions` : liste de phrases ;
   - `actions` : `[{ titre, responsable, echeance (AAAA-MM-JJ ou ""), note }]`, formulées comme des tâches ;
   - `questions` : points restés ouverts.
4. Poster : `POST { secret, action: "transcription", id: <id de l'enregistrement>, texte, resume, decisions,
   actions, questions, modele: "whisper large-v3-turbo + claude-opus-5-5", langue, dureeSec, genereeLe }`.
   Le relais écrit dans `operations01-transcriptions.json` (fichier créé par l'app à la première ouverture
   de Réunions ; s'il manque, le relais le dit).
5. Notification poussée (section 6) : « Transcription prête · <titre> », `url: ./?go=reunions&id=<id>`.

**Ce que fait l'app ensuite** : affiche résumé, décisions, actions (bouton « + Tâche » et « Créer toutes
les tâches » dans le projet, responsable et échéance repris), questions, transcription complète ; consigne
la réunion dans le journal de bord du projet (type « Réunion », résumé inclus). Objectif : résultat
disponible moins de dix minutes après la fin d'une réunion d'une heure.

**Lexique (v153, relais v18).** Whisper et le résumé écorchent les noms propres (« Drotech » pour
Drotek). L'export du relais contient `data.lexique` : `[{ faux, juste }]`, les corrections saisies par
Grégory dans l'app (bouton « Corriger un nom » sur une fiche, ou « Lexique » dans Réunions). À respecter
à chaque transcription :
1. Donner à Whisper un `initial_prompt` qui cite les orthographes correctes du lexique et les noms
   propres du projet (`missionId` : titre, participants, interlocuteurs des correspondances), par exemple
   « Réunion Icarus, Pulsar, Drotek, Radxa, Avetix, Dronisos, PX4, Swarmer, UniFi, DSTA, A400M, LoRa, DGA. »
2. Appliquer les remplacements du lexique (mot entier, sans tenir compte de la casse) au texte, au
   résumé, aux décisions, actions et questions avant de poster.
3. Rappeler dans le prompt du résumé : « Orthographes à respecter : … » avec la liste du lexique.
Noms déjà connus à utiliser d'office : Drotek (fournisseur, drotek.com), Radxa, Avetix, Dronisos,
Pulsar, Icarus Swarms, DSTA, PX4, Swarmer, UniFi, LoRa, DGA, A400M.
L'app applique de son côté le lexique à l'affichage, aussi aux transcriptions déjà reçues : inutile de
reposter une transcription corrigée.

**Règles.** Ne jamais supprimer l'audio. Un enregistrement de moins de 10 secondes : transcrire seulement,
`resume` vide. Texte des transcriptions et résumés : jamais envoyé à un service tiers autre que Claude
(forfait) ; Whisper tourne en local.

## 8. Documents livrés à l'app (v151, relais v17)

Tout traitement autonome qui produit un document pour Grégory (notes de lecture du New York Times,
compte rendu, synthèse) le livre à l'app par le relais :
`POST { secret, action: "document", cle, titre, nom: "<fichier>.md", texte, message, tache, compteRendu, genereLe }`.
Le relais l'écrit dans `operations01-livraisons.json` (fichier créé par l'app à l'ouverture de Documents ;
45 jours conservés, 400 000 caractères par document au plus). L'app en fait un **document du lecteur**
(lisible à voix haute), le met en tête de la liste et l'ouvre, affiche `message` dans la cloche, et coche la
tâche ouverte dont le titre commence par `tache`. Envoyer aussi `message` en notification poussée
(section 6, `url: ./?go=reader`). Le contrat du New York Times (`CONTRAT-NYT.md`, § 10) en est le
premier usage : `cle: "nyt-<date>"`, `tache: "New York Times du JJ/MM/AAAA"`, lancement à 10 h 45.

## 5. Vérifier de bout en bout

1. Envoyer une entrée de test au relais (`action: "correspondance"`) → le fichier
   `Correspondances/<Nom>.md` apparaît sur le Drive avec la section du jour.
2. Renvoyer la même entrée avec `reponse` → la section affiche « Ma réponse (date) ».
3. Poster un événement avec `proposition.contexte` → dans l'app, À traiter → la page du message
   montre « étayée » et les éléments de contexte avec leurs liens.

## 9. Économie de ressources (v155, relais v19)

Le pipeline doit coûter le moins possible quand il ne se passe rien : la nuit, le week-end, et entre
deux mails. Règles à appliquer par le Mac mini.

1. **Interroger `GET ?action=stamp` chaque minute, pas l'export.** Réponse :
   `{ ok, version, maintenant, data, evenements, assistant }` : dates de dernière modification des
   trois fichiers, sans en lire le contenu. **Ne demander `action=export` que si `data` a changé**
   depuis la dernière lecture (demandes de réponse, enregistrements, abonnements, lexique, tâches…).
   Les fichiers `evenements` et `assistant` sont écrits par le Mac mini lui-même : leur date sert
   seulement à détecter une écriture faite par l'app (décision sur un événement).
2. **Cycle de nuit** : de 23 h à 7 h et le week-end, le cycle passe de 60 s à **5 minutes** (stamp
   compris), sauf si une demande est en attente (`evRequests` non servie) ou qu'un audio attend
   une transcription : dans ce cas le cycle à 60 s reprend jusqu'à ce que ce soit fait.
3. **N'écrire `operations01-evenements.json` que si son contenu a changé** (comparer au dernier
   écrit) : chaque écriture déclenche un téléchargement de plusieurs Mo par chaque appareil ouvert.
4. **Alléger ce fichier** : y garder les événements des **90 derniers jours** et ceux encore
   ouverts ; déplacer le reste dans `operations01-evenements-archive.json` (même dossier, jamais lu
   par l'app, consultable pour les statistiques et les réponses étayées). Objectif : moins de 1 Mo.
5. **Dictaphone** : surveiller le dossier des mémos par événement (`fswatch`, ou FSEvents) plutôt
   que par relecture toutes les 60 s ; garder une relecture de sécurité toutes les 10 minutes.
6. **Ollama** : laisser le modèle de classement se décharger après 10 minutes d'inactivité
   (`keep_alive: "10m"`) ; le recharger coûte quelques secondes, le garder coûte de la mémoire en
   permanence. Whisper n'est chargé que le temps d'une transcription.
7. **Lots** : regrouper les écritures au relais d'un même cycle (événements, correspondances) en
   une seule requête quand l'action le permet, et ne jamais relire un fichier déjà lu dans le cycle.

Ce qui ne change pas : la transcription locale (Whisper turbo), le classement local des mails,
et Claude Opus seulement à la demande et pour le compte rendu des réunions.

