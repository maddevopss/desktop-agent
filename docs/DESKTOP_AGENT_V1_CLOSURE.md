# Fermeture Desktop Agent V1

## Intention

Constater que l’agent de bureau MADSuite peut être distribué comme composant V1 seulement lorsque son exécution locale, sa session, sa file hors ligne et son artefact Windows sont tous prouvés.

## Contrôles obligatoires

1. démarrage centralisé et arrêt idempotent;
2. stockage et files isolés par utilisateur et organisation;
3. reprises bornées sans boucle infinie;
4. arrêt immédiat du suivi après retrait du consentement;
5. reprise explicite après indisponibilité du serveur;
6. surface IPC minimale et validée;
7. absence d’accès Node depuis le moteur de rendu;
8. purge ou changement de portée lors d’un changement de session;
9. installateur Windows accompagné d’un manifeste SHA-256;
10. approbation humaine de la version distribuée.

## Règles de décision

- `certified` : toutes les preuves sont présentes et liées au commit source;
- `blocked` : au moins une preuve manque, est invalide ou n’est pas approuvée;
- aucune disponibilité technique ne vaut autorisation implicite de suivi;
- aucune file locale ne peut être rejouée sous une autre organisation.

## Portée V1

L’agent assure l’authentification, le suivi consenti, la mise en file hors ligne, la synchronisation, les widgets cognitifs et la fermeture sûre. Il ne prend aucune décision commerciale ou cognitive finale à la place de la personne.
