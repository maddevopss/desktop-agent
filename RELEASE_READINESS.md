# Préparation de diffusion du Desktop Agent

## Statut actuel

Le Desktop Agent est actif en développement, mais il ne doit pas être présenté comme prêt pour une diffusion utilisateur générale tant que les preuves locales et Windows ci-dessous ne sont pas obtenues.

## Frontière de sécurité

Le composant doit rester :

- volontaire;
- transparent;
- désactivable;
- limité aux données nécessaires;
- fail-secure lorsque l’authentification ou le backend deviennent indisponibles;
- conforme aux règles MADPROOF-PRIVACY.

Aucune mise à jour de dépendance ou réussite de build ne constitue seule une preuve de sécurité.

## Preuves exigées avant diffusion

### Processus principal et preload

- tests du démarrage et de l’arrêt;
- tests du `contextBridge`;
- liste blanche explicite des canaux IPC;
- absence d’exposition directe de Node au renderer;
- refus des charges IPC invalides.

### Authentification

- stockage local protégé des jetons;
- aucune exposition du jeton au renderer;
- rotation refresh fonctionnelle;
- nettoyage complet au logout ou après révocation;
- arrêt immédiat du tracking sans session valide.

### Tracking et confidentialité

- validation des filtres de titres sensibles;
- validation de la suppression des secrets;
- applications et mots-clés ignorés respectés;
- pause et reprise déterministes;
- suppression de l’historique vérifiée;
- aucune collecte hors du périmètre annoncé.

### Résilience

- comportement hors ligne;
- reprise après redémarrage;
- file d’événements bornée et nettoyable;
- absence de boucle de reconnexion agressive;
- comportement sûr après erreur backend.

### Compatibilité Windows

- exécution de `npm run check:desktop`;
- validation d’`active-win` après mise à jour;
- vérification PowerShell et `pwsh.exe`;
- production d’un build non signé avec `npm run build:ci`;
- installation, lancement et désinstallation sur une machine de test.

### Diffusion

- processus de signature documenté;
- aucun certificat dans Git;
- mécanisme de mise à jour contrôlé;
- version et notes de diffusion;
- procédure de retour arrière;
- consentement utilisateur et réglages de confidentialité visibles.

## Travaux réalisables sur GitHub

- ajouter les tests unitaires et d’intégration indépendants de Windows;
- durcir les guards;
- documenter les canaux IPC et les schémas de données;
- créer des workflows de build non signé;
- conserver les rapports de CI.

## Travaux obligatoirement locaux

- tests d’intégration Electron réels;
- validation de détection de fenêtre active;
- packaging Windows;
- installation et désinstallation;
- vérification du stockage système;
- signature éventuelle;
- observation de l’arrêt réel du tracking.

## Règle de sortie

Le statut « prêt pour diffusion » exige une preuve datée pour chaque section applicable. Tout écart doit être documenté, accepté explicitement et référencé dans SYSTEME_MAD.
