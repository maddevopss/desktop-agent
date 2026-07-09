# Session boundary follow-up

Cette PR retire le secret du payload automatique envoyé du main process vers le renderer lors d’un refresh automatique.

Les flux IPC legacy qui permettent encore au renderer d’appeler certains handlers liés au cycle de session sont conservés temporairement pour compatibilité et stabilité CI.

Suivi recommandé dans une issue séparée :

- auditer les usages renderer existants;
- remplacer les handlers legacy par des signaux sans secret;
- ajouter un guard empêchant un secret de session dans les payloads `notifyRenderer`;
- retirer les aliases legacy après migration.
