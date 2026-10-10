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
que ce champ sur un événement existant) devient, **pour toutes les urgences** :

```json
"proposition": {
  "reponse": "Bonjour Éric, oui, 14 h sur place demain me convient. J'apporte la v2.2 …",
  "genereePar": "claude-opus-5-5", "genereeLe": "2026-10-10T07:05:00Z",
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

- `source` ∈ `correspondance` · `projet` · `evenement` · `tache` · `document` · `agenda` · `contact`.
  L'app les affiche sous la réponse, dans « Éléments de contexte pris en compte (n) », avec le lien
  s'il existe. Trois à six éléments suffisent ; `extrait` ≤ 300 caractères.
- La réponse est **dans ma voix** : s'appuyer sur mes réponses réelles archivées (ton, formules,
  longueur) ; vouvoiement ou tutoiement tel qu'employé avec cette personne. Pas d'invention : un fait
  absent des sources est annoncé comme à vérifier (« je te confirme la date demain »).
- Pour un SMS ou WhatsApp : court, sans formule de politesse longue. L'app ouvre Messages ou
  WhatsApp pré-rempli ; pour un mail, Gmail. Rien n'est envoyé sans moi.
- Si rien ne justifie une réponse (newsletter, notification, information pure), ne pas écrire de
  `reponse` : l'app affiche alors seulement l'action suggérée.

### Sources de contexte à interroger (dans cet ordre)

1. **Correspondance avec l'interlocuteur** : les 30 dernières entrées de son fichier (relais ou
   Drive local), plus une recherche plein texte sur les mots-clés du message dans tout son fichier.
2. **Projet concerné** : le projet dans lequel l'événement a été classé (export du relais,
   `data.missions`) ; ses tâches ouvertes et leurs échéances (`data.tasks` avec `missionId`), ses
   actions en attente (`data.actions`), ses rendez-vous à venir (`data.rendezvous`).
3. **Archives du projet sur le Drive** : dossier `5_Clients/<Projet>/` (et sous-dossiers). Texte
   des `.md`, `.docx`, `.pdf`, Google Docs exportés ; index plein texte (BM25) ou vecteurs locaux
   (`nomic-embed-text` via Ollama), reconstruit la nuit. Donner le chemin du document en `lien`
   (`https://drive.google.com/file/d/<id>/view` si l'identifiant est connu).
4. **Événements précédents du même expéditeur** et leurs propositions acceptées (`statut: traite`).

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
    --model claude-opus-5-5 --effort medium \
    --tools "" --disallowedTools "mcp__*" \
    --system-prompt-file /Users/choice/assistants/prompts/reponse-etayee.md \
    --output-format json --json-schema "$(cat /Users/choice/assistants/prompts/proposition.schema.json)" \
    --no-session-persistence
```

- `proposition.schema.json` décrit exactement l'objet `proposition` de la section 2 (`reponse`,
  `contexte[]`). Le résultat validé est dans `structured_output` de la sortie JSON ; `result` et
  `session_id` peuvent être ignorés.
- Le prompt contient : le message reçu, les 30 dernières entrées de la correspondance, les extraits
  du projet et des tâches présélectionnés localement, et trois de mes réponses réelles au même
  interlocuteur (pour le ton). Viser 6 000 à 10 000 jetons, pas plus : le forfait se compte en
  volume.
- `--effort medium` suffit pour une réponse ; `high` pour les urgences 1 et 2 si le résultat semble
  court.

Limites du forfait et repli :

- Le forfait a une **fenêtre de 5 heures** et un **plafond hebdomadaire**, partagés avec mes
  propres sessions Claude et Claude Code. Réserver la génération immédiate aux **urgences 1 et 2**
  (à la réception) et traiter les **urgences 3 et 4 par lots de 20, la nuit** (02 h à 06 h), les
  plus récents d'abord, pour ne pas vider la fenêtre pendant que je travaille.
- Quand Claude Code répond par une erreur de limite d'usage (sortie JSON avec `is_error: true` ou
  code de retour non nul mentionnant « usage limit » / « rate limit »), **ne pas réessayer** avant
  la fin de la fenêtre : basculer sur le modèle local pour ce message, avec
  `genereePar: "qwen2.5:14b (repli, forfait épuisé)"`, et remettre l'événement dans la file pour
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

## 4. Vérifier de bout en bout

1. Envoyer une entrée de test au relais (`action: "correspondance"`) → le fichier
   `Correspondances/<Nom>.md` apparaît sur le Drive avec la section du jour.
2. Renvoyer la même entrée avec `reponse` → la section affiche « Ma réponse (date) ».
3. Poster un événement avec `proposition.contexte` → dans l'app, À traiter → la page du message
   montre « étayée » et les éléments de contexte avec leurs liens.
