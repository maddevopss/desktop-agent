# MADSuite Desktop Agent

Agent desktop officiel de MADSuite.

Ce dépôt contient l’agent local MADSuite utilisé pour synchroniser le timer, transmettre certains événements applicatifs volontaires et soutenir le contexte opérationnel de l’utilisateur.

## Source de vérité

```text
bleeband/SYSTEME_MAD
```

Documents liés, à lire à la racine du dépôt `bleeband/SYSTEME_MAD` :

```text
00-SYSTEME-MAD/repos.md
00-SYSTEME-MAD/ai-context-madsuite-madproof.md
04-ADR/ADR-004-separation-repos-execution-madsuite.md
10-ROADMAP/madsuite-p2-hardening-board.md
```

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
npm run guard:desktop-agent-contract
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
- matériel de signature comme `.p12`, `.pfx`, `.key`;
- régressions du contrat local desktop-agent.

Aucun certificat, installateur ou build généré ne doit être commité. Les releases signées doivent passer par un flux de release contrôlé, jamais par un commit direct.

## Flow d’authentification

1. Le renderer appelle `window.agentAPI.login({ email, password })`.
2. Le main process appelle `POST /api/login`.
3. Le backend retourne un access token et un cookie `refresh_token`.
4. Le main process stocke le token. Le renderer ne reçoit qu’un indicateur d’état.
5. Le tracking démarre avec l’access token courant.
6. En cas d’erreur d’authentification, le main process tente un refresh.
7. Si le refresh échoue, le token est nettoyé et le tracking s’arrête.

## Boundary token main/renderer

Le token d’accès doit rester dans le main process. Le renderer peut recevoir des signaux d’état comme `authenticated: true`, mais il ne doit pas recevoir, stocker ou renvoyer un access token rafraîchi.

Les flux legacy où le renderer transmet un token au main process doivent être refusés ou supprimés.

## Tracking

L’agent surveille la fenêtre active et applique des filtres de confidentialité avant envoi :

- titres de fenêtres sensibles masqués;
- tokens, bearer, mots de passe et secrets retirés;
- limitation des données de fenêtres en arrière-plan;
- pause si aucun token valide n’est disponible.

Les réglages desktop doivent permettre de désactiver le tracking, choisir l’intervalle, ignorer des applications ou mots-clés, consulter la dernière capture locale et supprimer l’historique serveur de l’utilisateur.

## Compatibilité plateforme

- Windows : fenêtre active et liste des fenêtres ouvertes prises en charge.
- macOS/Linux : la fenêtre active dépend des permissions OS; la liste complète peut rester vide volontairement.
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

- Tracking non démarré : reconnecter l’utilisateur.
- Erreurs 401/403 répétées : vérifier le cookie refresh, `AGENT_API_URL` et l’organisation de l’utilisateur.
- Fenêtres non détectées : vérifier les permissions OS et la compatibilité de `active-win`.
- Build natif qui échoue : relancer `npm run rebuild`.

## Statut

Actif, avec garde-fous MADPROOF à maintenir avant toute release.
