# choice — Importer le contact (extension Chrome)

Sur un profil LinkedIn, un bouton **« Importer dans choice »** (en bas à droite de la page, ou l'icône
de l'extension) lit le profil et, pour une relation de niveau 1, ses **coordonnées** (e-mail,
téléphone, site, anniversaire), puis ouvre choice sur la fiche créée. Rien n'est envoyé ailleurs que
dans ton app.

## Installation (une fois, Chrome sur Mac)

1. Télécharge le dossier `extension` (archive ZIP fournie par Claude, ou depuis GitHub) et décompresse-le
   à un endroit stable, par exemple `~/Documents/choice-extension`.
2. Chrome → `chrome://extensions` → active **Mode développeur** (en haut à droite).
3. **Charger l'extension non empaquetée** → choisis le dossier décompressé.
4. Épingle l'icône « c » dans la barre (icône puzzle → punaise).

Par défaut l'extension ouvre `https://gregory-at-choice.github.io/operations01-web/` ; l'adresse se
change dans les options de l'extension.

## Limites

- Les coordonnées ne sont visibles que pour tes relations de niveau 1, et seulement celles que la
  personne a renseignées.
- LinkedIn change régulièrement sa page : si le bouton ne lit plus le titre ou l'entreprise, la fiche
  est quand même créée avec le nom et le lien, à compléter à la main.
