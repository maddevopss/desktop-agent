# MADSuite Desktop Agent

Agent Electron qui capture l'activite locale de l'utilisateur et l'envoie au backend MADSuite.

## Prerequis

- Node.js compatible avec Electron 42
- Backend MADSuite demarre et accessible
- Frontend build disponible pour le packaging (`../frontend/build`)

## Configuration

Copier `.env.example` vers `.env` si necessaire.

```env
AGENT_API_URL=http://localhost:5000
AGENT_FRONTEND_URL=http://localhost:3000
AGENT_REFRESH_TIMEOUT_MS=15000
NODE_ENV=development
```

`AGENT_API_URL` doit pointer vers le backend, sans suffixe `/api`.
`AGENT_FRONTEND_URL` controle l'URL chargee en mode developpement par Electron.
`AGENT_REFRESH_TIMEOUT_MS` controle le delai laisse au refresh automatique avant de nettoyer la session.

## Commandes

```bash
npm install
npm start
npm test
npm run build
```

- `npm start` lance l'agent Electron en developpement.
- `npm test` execute les tests Jest du main process, preload, tracking et scanner de fenetres.
- `npm run build` produit les artefacts Electron Builder dans `dist/`.

En developpement, Electron charge le frontend Vite via `AGENT_FRONTEND_URL` et
le port par defaut reste `http://localhost:3000`.

## Flow d'authentification

1. Le renderer appelle `window.agentAPI.login({ email, password })`.
2. Le main process appelle `POST /api/login`.
3. Le backend retourne un access token et un cookie `refresh_token`.
4. **Isolation :** Le main process stocke le token. Le Renderer ne reçoit qu'un flag `isLoggedIn: true`.
5. Le tracking demarre avec l'access token courant.
6. En cas de 401/403 pendant l'envoi d'activite, le main process tente `POST /api/refresh` avec le cookie refresh.
7. Si le refresh reussit, le nouveau token remplace l'ancien et le renderer est notifie.
8. Si le refresh echoue, le token est nettoye et le tracking s'arrete.

Le main process refuse de restaurer un token inutilisable: mauvais type de token ou absence de `organisation_id`.
Le token est conserve dans `electron-store` et lu via un getter qui resynchronise la valeur memoire avant le tracking.

## Tracking

L'agent surveille la fenetre active et applique les filtres de confidentialite avant envoi:

- titres de fenetres sensibles masques;
- tokens, bearer, mots de passe et secrets retires;
- limitation des donnees de fenetres en arriere-plan;
- pause si aucun token valide n'est disponible.

Les réglages desktop permettent de désactiver le tracking, choisir l'intervalle,
ignorer des applications ou mots-clés, consulter la dernière capture locale et
supprimer l'historique serveur de l'utilisateur.

## Compatibilité plateforme

- Windows: fenêtre active et liste des fenêtres ouvertes prises en charge.
- macOS/Linux: `active-win` peut fournir la fenêtre active selon les permissions,
  mais la liste complète des fenêtres retourne volontairement une liste vide.
- Le scanner Windows utilise Windows PowerShell. Si l'exécutable standard est
  absent, l'agent tente `pwsh.exe`. Une politique d'entreprise peut désactiver
  cette collecte; l'agent continue alors sans envoyer les fenêtres d'arrière-plan.

En build packagé, DevTools n'est pas ouvert et les raccourcis F12/Ctrl+Shift+I
sont bloqués. DevTools reste disponible uniquement avec `app.isPackaged === false`.

## Packaging Windows

Le build utilise `electron-builder` avec `electron-builder.json`.

Sorties configurees:

- installateur NSIS.

Avant de packager:

```bash
cd ../frontend
npm run build
cd ../desktop-agent
npm run build
```

Le build local utilise un certificat de test pour le signage Windows.

## Depannage

- `TRACKING NON DEMARRE - token manquant`: reconnecter l'utilisateur.
- 401/403 repetes: verifier le cookie refresh, `AGENT_API_URL`, et l'organisation de l'utilisateur.
- Fenetres non detectees: verifier les permissions OS et la compatibilite de `active-win`.
- Build natif qui echoue: relancer `npm run rebuild`.
