## Résumé

Décrire le changement en quelques lignes.

## Type de changement

- [ ] Correction
- [ ] Feature
- [ ] Sécurité
- [ ] Refactor
- [ ] Tests / CI
- [ ] Packaging
- [ ] Documentation
- [ ] Dépendances

## Surface touchée

- [ ] Main process
- [ ] Preload / context bridge
- [ ] Auth / token handling
- [ ] Tracking / window scanning
- [ ] Socket sync
- [ ] Auto-update / packaging
- [ ] CI
- [ ] Autre

## Validation locale

- [ ] `npm run guard:gitignore`
- [ ] `npm run guard:hygiene`
- [ ] `npm run check:syntax`
- [ ] `npm test`
- [ ] `npm run build:ci` si packaging touché

## MADPROOF

- [ ] Aucun `.env` réel ajouté
- [ ] Aucun installateur ou build généré ajouté
- [ ] Aucun certificat ou fichier de signature ajouté
- [ ] Aucun token, cookie ou secret loggé
- [ ] Le tracking reste volontaire, transparent et désactivable
- [ ] Aucune collecte caméra, micro ou capture écran permanente ajoutée

## Notes de release

Indiquer impacts packaging, signature, auto-update, permissions OS ou rollback requis.
