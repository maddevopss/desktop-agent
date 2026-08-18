# MADSuite Desktop Agent

**Version du package : 2.0.0.**

Agent desktop officiel de MADSuite.

Ce dépôt contient l’agent local MADSuite utilisé pour synchroniser le timer, transmettre certains événements applicatifs volontaires et soutenir le contexte opérationnel de l’utilisateur.

## Source de vérité

```text
maddevopss/SYSTEME_MAD
```

Documents liés, à lire à la racine du dépôt `maddevopss/SYSTEME_MAD` :

```text
00-SYSTEME-MAD/repos.md
00-SYSTEME-MAD/ai-context-madsuite-madproof.md
04-ADR/ADR-004-separation-repos-execution-madsuite.md
10-ROADMAP/madsuite-p2-hardening-board.md
```

## État de fondation V1

La fermeture desktop V1 est fusionnée. Le dépôt dispose d’un évaluateur de certification, de tests de contrat et d’un registre de preuves pour les fonctions locales essentielles.

Cette fermeture couvre notamment :

- l’authentification et le renouvellement de session;
- le démarrage et l’arrêt contrôlés du suivi;
- la détection d’inactivité et la mise en lot des événements;
- les filtres de confidentialité et le masquage des informations sensibles;
- le comportement en cas d’indisponibilité du backend;
- le packaging de validation non signé;
- les règles de consentement, de transparence et de désactivation.

La fermeture V1 ne constitue pas une autorisation d’élargir la collecte. Toute nouvelle capacité locale doit rester minimale, volontaire, compréhensible et documentée avant sa mise en service.

## Règles MADPROOF obligatoires

L’agent desktop doit rester volontaire, transparent, désactivable, proportionné et compréhensible par l’utilisateur.

Il ne doit pas collecter par défaut : caméra, microphone, capture d’écran permanente, enregistrement brut du clavier, biométrie, lecture émotionnelle, inférence médicale, profilage externe, comparaison entre utilisateurs ou score de normalité.

## Prérequis

- Node.js compatible avec Electron 43
- Backend MADSuite démarré et accessible
- Frontend build disponible pour le packaging si requis

## Configuration

Copier `.env.example` vers `.env` si nécessaire.

```env
AGENT_API_URL=http://localhost:5000
AGENT_FRONTEND_URL=http://localhost:3000
AGENT_REFRESH_TIMEOUT_MS=15000
NODE_ENV=development
```

`AGENT_API_URL` doit pointer vers le backend, sans suffixe `/api`.

## Commandes

```bash
npm install
npm start
npm test
npm run build
```

## MADPROOF checks

Avant de pousser une correction desktop, exécuter :

```bash
npm run guard:gitignore
npm run guard:hygiene
npm run check:syntax
```

Validation complète locale :

```bash
npm run check:desktop
```

Validation de packaging CI non signé :

```bash
npm run build:ci
```

Les guards bloquent notamment :

- règles `.gitignore` critiques manquantes;
- fichier d’environnement réel;
- installateurs générés;
- outputs `dist/`, `dist-ci/`, `release/`;
- matériel de signature comme `.p12`, `.pfx`, `.key`.

Aucun certificat, installateur ou build généré ne doit être commité. Les releases signées doivent passer par un flux de release contrôlé, jamais par un commit direct.

## Flux d’authentification

1. Le renderer appelle `window.agentAPI.login({ email, password })`.
2. Le processus principal appelle `POST /api/login`.
3. Le backend retourne un jeton d’accès et un cookie `refresh_token`.
4. Le processus principal stocke le jeton. Le renderer ne reçoit qu’un indicateur d’état.
5. Le suivi démarre avec le jeton d’accès courant.
6. En cas d’erreur d’authentification, le processus principal tente un renouvellement.
7. Si le renouvellement échoue, le jeton est nettoyé et le suivi s’arrête.

## Suivi

L’agent surveille la fenêtre active et applique des filtres de confidentialité avant envoi :

- titres de fenêtres sensibles masqués;
- jetons, autorisations Bearer, mots de passe et secrets retirés;
- limitation des données de fenêtres en arrière-plan;
- pause si aucun jeton valide n’est disponible.

Les réglages desktop doivent permettre de désactiver le suivi, choisir l’intervalle, ignorer des applications ou mots-clés, consulter la dernière capture locale et supprimer l’historique serveur de l’utilisateur.

## Décharge mentale (widget Brain Dump)

Un raccourci global ouvre une barre flottante permettant de capturer une pensée parasite
sans quitter l’application en cours, puis de la retrouver dans l’inbox du Dashboard.

- Raccourci : `Ctrl+Shift+Espace`, avec repli automatique sur `Ctrl+Alt+Espace` si une
  autre application détient déjà la combinaison. L’accélérateur retenu est journalisé, et
  libéré via `globalShortcut.unregisterAll()` sur `will-quit`.
- `Entrée` capture et referme immédiatement, sans attendre la réponse réseau; `Échap` ou
  la perte de focus annule.
- L’idée part sur `POST /api/brain-dump-captures` (`{ raw_text, source: "spotlight" }`).
  Session expirée, backend injoignable ou réponse en erreur basculent vers la file offline
  persistante, rejouée plus tard avec une clé d’idempotence (`client_capture_id`) pour ne
  pas créer de doublon.
- Les captures de décharge mentale sont exemptées de l’éviction FIFO de cette file : une
  capture d’activité est ré-échantillonnée en continu, une idée ne l’est pas.
- Le flush sépare les deux flux : les idées ne transitent pas par `/api/activity/batch`, et
  l’échec d’un flux ne bloque plus l’autre (retrait de la file par identifiant).
- Aucun appel IA à l’écriture. Le découpage en micro-actions est déclenché explicitement
  depuis le Dashboard.
- Le widget utilise un preload dédié (`src/widgets/brainDumpPreload.js`, deux canaux
  seulement) et non le `preload.js` principal, et tourne en `sandbox: true`.
- Limite connue : sur un jeu en plein écran exclusif, le raccourci se déclenche mais la
  barre ne peut pas s’afficher par-dessus.

## Compatibilité plateforme

- Windows : fenêtre active et liste des fenêtres ouvertes prises en charge.
- macOS/Linux : la fenêtre active dépend des permissions du système; la liste complète peut rester vide volontairement.
- Le scanner Windows peut utiliser Windows PowerShell ou `pwsh.exe`.

## Packaging Windows

Le build utilise Electron Builder.

Avant de packager :

```bash
cd ../frontend
npm run build
cd ../desktop-agent
npm run build
```

Pour une validation CI sans signature :

```bash
npm run build:ci
```

## Dépannage

- Suivi non démarré : reconnecter l’utilisateur.
- Erreurs 401/403 répétées : vérifier le cookie de renouvellement, `AGENT_API_URL` et l’organisation de l’utilisateur.
- Fenêtres non détectées : vérifier les permissions du système et la compatibilité de `active-win`.
- Build natif qui échoue : relancer `npm run rebuild`.

## Statut

Fondation et fermeture desktop V1 fusionnées. Le dépôt est en évolution continue sous garde-fous MADPROOF, avec priorité à la stabilité, au consentement et à la minimisation des données.