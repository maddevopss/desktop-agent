# MADSuite Desktop Agent

Agent desktop officiel de MADSuite.

Ce dépôt contient l’agent local MADSuite utilisé pour synchroniser le timer, transmettre certains événements applicatifs volontaires et soutenir le contexte opérationnel de l’utilisateur.

## Source de vérité

```text
bleeband/SYSTEME_MAD
```

Documents liés :

```text
SYSTEME_MAD/00-SYSTEME-MAD/repos.md
SYSTEME_MAD/00-SYSTEME-MAD/ai-context-madsuite-madproof.md
SYSTEME_MAD/04-ADR/ADR-004-separation-repos-execution-madsuite.md
SYSTEME_MAD/10-ROADMAP/madsuite-p2-hardening-board.md
```

## Règles MADPROOF obligatoires

L’agent desktop doit rester volontaire, transparent, désactivable, proportionné et compréhensible par l’utilisateur.

Il ne doit pas collecter par défaut : caméra, microphone, capture d’écran permanente, enregistrement brut du clavier, biométrie, lecture émotionnelle, inférence médicale, profilage externe, comparaison entre utilisateurs ou score de normalité.

## Prérequis

- Node.js compatible avec Electron 42
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

## Flow d’authentification

1. Le renderer appelle `window.agentAPI.login({ email, password })`.
2. Le main process appelle `POST /api/login`.
3. Le backend retourne un access token et un cookie `refresh_token`.
4. Le main process stocke le token. Le renderer ne reçoit qu’un indicateur d’état.
5. Le tracking démarre avec l’access token courant.
6. En cas d’erreur d’authentification, le main process tente un refresh.
7. Si le refresh échoue, le token est nettoyé et le tracking s’arrête.

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

## Dépannage

- Tracking non démarré : reconnecter l’utilisateur.
- Erreurs 401/403 répétées : vérifier le cookie refresh, `AGENT_API_URL` et l’organisation de l’utilisateur.
- Fenêtres non détectées : vérifier les permissions OS et la compatibilité de `active-win`.
- Build natif qui échoue : relancer `npm run rebuild`.

## Statut

Actif, avec garde-fous MADPROOF à maintenir avant toute release.