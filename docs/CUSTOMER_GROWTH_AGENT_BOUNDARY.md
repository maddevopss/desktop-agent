# Frontière desktop-agent — customer_growth

## Objet

Définir ce que l’agent de bureau peut et ne peut pas faire pour le domaine `customer_growth` sans élargir prématurément sa portée.

## Décision initiale

Le premier incrément de `customer_growth` reste dans le backend et le frontend web. L’agent de bureau ne crée, ne modifie et ne convertit aucun prospect ou opportunité dans cette phase.

## Capacités autorisées plus tard

Après stabilisation du domaine :

- afficher une notification locale pour une prochaine action commerciale;
- ouvrir la fiche web correspondante;
- proposer une note rapide explicitement confirmée par l’utilisateur;
- transmettre une activité commerciale volontaire avec une clé d’idempotence;
- synchroniser seulement les événements destinés à l’organisation authentifiée.

## Capacités interdites

- capturer automatiquement le contenu des courriels ou conversations;
- déduire un prospect depuis l’activité de fenêtre sans consentement;
- enregistrer des coordonnées découvertes passivement;
- convertir automatiquement vers client, projet ou devis;
- stocker durablement des jetons d’accès en clair;
- diffuser un événement hors du salon d’organisation;
- mélanger les données commerciales aux métriques cognitives.

## Authentification et session

- utiliser le gestionnaire de session et de jetons existant;
- garder le jeton d’accès en mémoire ou dans le mécanisme sécurisé retenu;
- utiliser la rotation du jeton de rafraîchissement;
- purger les files d’attente liées à l’utilisateur lors de la déconnexion;
- bloquer l’envoi lorsque l’organisation active n’est pas confirmée.

## File d’attente hors ligne

Toute future activité commerciale mise en file doit contenir :

- identifiant local unique;
- clé d’idempotence;
- type d’activité autorisé;
- identifiant de ressource sans données sensibles inutiles;
- horodatage;
- organisation confirmée depuis la session;
- nombre de tentatives et politique de reprise bornée.

La file doit abandonner ou mettre en quarantaine les éléments lorsque la session change d’organisation.

## IPC et sécurité Electron

- aucune API Node exposée directement au moteur de rendu;
- méthodes `contextBridge` minimales et nommées;
- validation stricte des arguments IPC;
- liste blanche des destinations externes;
- aucune donnée commerciale sensible dans les journaux;
- refus par défaut de toute commande inconnue.

## Tests attendus avant intégration

- session absente ou expirée;
- changement d’organisation;
- file hors ligne puis reconnexion;
- double envoi idempotent;
- backend indisponible sans boucle infinie;
- déconnexion avec file en attente;
- validation IPC;
- absence de secrets dans les logs.

## Découpage futur proposé

- PR 1 : contrat de notification en lecture seule;
- PR 2 : ouverture sécurisée de la fiche web;
- PR 3 : note rapide avec confirmation;
- PR 4 : file hors ligne idempotente;
- PR 5 : tests de changement de session et d’organisation.

## Blocages actuels

- aucun événement `customer_growth` stable n’existe encore;
- le contrat backend n’est pas publié;
- aucune intégration agent ne doit commencer avant la stabilisation web.
