# Contrat : déploiement des scripts Google par le Mac mini

Objectif : Grégory ne colle plus jamais de code dans l'éditeur Apps Script. Le Mac mini (session
« Assistants ») déploie lui-même les scripts Google de choice à partir du dépôt public
`https://github.com/gregory-at-choice/operations01-web` (branche `main`, dossier racine), dès qu'un
fichier `.gs` y change. Les secrets restent dans les propriétés des scripts : ne jamais les lire, les
afficher ni les déplacer.

## 1. Les projets et leurs comptes

| Fichier du dépôt | Projet Apps Script | Comptes | Type |
|---|---|---|---|
| `appsscript-relais-evenements.gs` | relais événements (`doGet`/`doPost`) | choicefinance | application web, **déploiement versionné** |
| `appsscript-mails.gs` | Operations01 Mails (`analyserMails`) | choicefinance, icarus, majandco | déclencheur horaire, pas de déploiement |
| `appsscript-correspondances.gs` | correspondances (`archiverCorrespondances`) | choicefinance, icarus, majandco | déclencheur horaire |
| `appsscript-banque.gs` | banque (`parcourir`) | choicefinance | déclencheur horaire |
| `appsscript-actions-daily.gs` | Operations01 Rappels | choicefinance | déclencheur horaire |

Le numéro de version est en tête de chaque fichier (`var VERSION = …`). Le relais répond sa version
sur son adresse sans paramètre ; les autres scripts n'ont pas de point d'entrée public.

## 2. Mise en place, une seule fois

Outil : `clasp` (CLI officiel Google, `npm install -g @google/clasp`, version 3 ou plus pour
l'option `--user`). Dossier de travail : `~/choice-deploiement/`.

1. **Connexion aux trois comptes** : `clasp login --user choice`, puis `--user icarus`, puis
   `--user majandco`. Chaque commande ouvre le navigateur du Mac mini : **dire à Grégory** de choisir
   le compte et de cliquer « Autoriser ». Rien à copier.
2. **API Apps Script** : pour chaque compte, l'interrupteur sur
   https://script.google.com/home/usersettings doit être activé. Donner le lien à Grégory, un clic
   par compte, et attendre sa confirmation (`clasp list` échoue tant que ce n'est pas fait).
3. **Repérer les projets** : `clasp list --user <compte>` donne les identifiants. Pour chaque projet,
   créer `~/choice-deploiement/<compte>/<projet>/` avec `.clasp.json`
   (`{ "scriptId": "<id>", "rootDir": "." }`), puis `clasp pull` pour récupérer le manifeste
   `appsscript.json` tel qu'il est (fuseau `Europe/Paris`, portées). Ne jamais réécrire le manifeste
   depuis le dépôt : seul le fichier de code est remplacé.
4. **Déploiement du relais** : `clasp deployments --user choice` liste les déploiements ; retenir
   l'identifiant de celui dont l'adresse `/exec` est celle que le Mac mini appelle. C'est toujours
   **ce** déploiement qui reçoit les nouvelles versions (l'adresse ne doit jamais changer).
5. **Dépôt** : `git clone https://github.com/gregory-at-choice/operations01-web.git
   ~/choice-deploiement/depot`. Mémoriser dans `~/choice-deploiement/etat.json` le dernier commit
   déployé par fichier et par compte.
6. **Premier passage** : déployer tout de suite ce qui est en attente (au 29 octobre 2026 : relais
   v21, correspondances v3 dans les trois comptes ; mails et banque si leur version en ligne diffère).

## 3. Cycle, toutes les 10 minutes

1. `git -C ~/choice-deploiement/depot pull --ff-only`.
2. Pour chaque `.gs` modifié depuis le dernier commit déployé, et pour chaque compte concerné :
   - `clasp pull` dans le dossier du projet et **comparer** le code en ligne à la dernière version
     déployée depuis le dépôt. S'il a été modifié à la main dans l'éditeur, **ne pas écraser** :
     prévenir Grégory (notification poussée « Déploiement bloqué : <projet> modifié à la main ») et
     passer au suivant.
   - Copier le `.gs` du dépôt sous le nom du fichier de code du projet (en général `Code.js` côté
     clasp, `Code.gs` en ligne), puis `clasp push -f --user <compte>`.
   - Relais seulement : `clasp deploy -i <identifiant du déploiement> -d "v<N>" --user choice`,
     puis `GET <adresse /exec>` sans paramètre et vérifier `"version": N`. Si la version ne suit pas,
     réessayer une fois après 30 s, puis prévenir.
3. Après un passage avec au moins un déploiement : notification poussée (section 6 du contrat des
   réponses) « Déployé : relais v21 · correspondances v3 (3 comptes) », et une ligne dans
   `~/choice-deploiement/journal.log` (date, fichier, compte, version, résultat).
4. Les fonctions d'installation (`installerAnalyseMails`, `installerCorrespondances`…) ne sont
   **jamais** exécutées par le Mac mini : les déclencheurs existent déjà. Le relais reconstruit
   l'index des correspondances tout seul (v21), rien à lancer.

## 4. Règles

- Pas de secret dans les journaux, les notifications ni le dépôt.
- Un échec de `clasp push` (quota, autorisation expirée) : réessayer au passage suivant, prévenir
  Grégory après trois échecs ; `clasp login --user <compte>` à refaire si l'autorisation a expiré
  (le dire à Grégory, c'est lui qui clique).
- Ne jamais déployer un fichier dont le numéro de version en tête est inférieur à celui déjà en
  ligne.
