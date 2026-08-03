# CLAUDE.md — MADSuite Desktop Agent

Agent Electron (Jest) de MADSuite.

## ⚡ Règles strictes — Économie de tokens & Workflow mobile

Ces règles priment sur tout comportement par défaut de Claude Code sur ce repo.

### 1. Économie de tokens
- Réponses concises. Pas de blabla, pas de formules de politesse.
- Ne JAMAIS lancer `npm test` seul, `npm run check:desktop` ou `test:coverage` (suites complètes) sauf demande explicite.
- Cibler uniquement les fichiers modifiés:
  - `npx jest <chemin_du_fichier_test> --silent --runInBand`
- Ne pas lancer `guard:*`, `check:syntax` ou un `build` complet sauf demande explicite.

### 2. Pas de polling
- Ne JAMAIS boucler en attente d'un résultat CI/CD après un `git push`.
- S'arrêter dès que le push est effectué. Ne pas surveiller le pipeline.

### 3. Gestion des erreurs
- Si un test/build échoue: lire uniquement les 30 dernières lignes du log/stack trace.
- Ne jamais lire un log complet, même en cas d'échec répété.

### 4. Format mobile
- Résumés courts, étapes numérotées ou puces.
- Pas de longs paragraphes ni de gros blocs de code non essentiels.
