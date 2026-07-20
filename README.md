# Operations01 — Web App (PWA)

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
