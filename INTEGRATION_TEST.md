# Version de test intégrée — 2 octobre 2026

Branche : `integration/full-test-2026-10-02`. Destination : Deploy Preview uniquement.

## Contenu réuni

- Socle `feature/beta-consolidation-v1`, avec modèle persistant, cockpit multi-ACP, accueil mobile, Mon lot, aperçus par rôle, AG, permissions et cycle de vie.
- Correctif `fix/people-relation-lifecycle` : fin sélective des relations, dates/motifs et historique Actuels / Anciens / Tous.
- Correctif `fix/audit-import-ticket-followup` : import CSV, rapprochement sans e-mail, erreurs visibles et priorités des demandes.
- Récupération des fonctions propres à `agent-coprolink-on-feature-branch-a23f` (commit `7ade972ee8f701ef4e441dfe96dd381c7973102a`) : stockage/gestion des documents, édition/retrait des communications et échéances, saisie financière par le syndic.

La récupération est adaptée au socle récent : téléchargement résident authentifié conservé, documents réservés aux propriétaires pris en charge, stockage séparé par contexte et branche de preview, taille d’envoi limitée à 4 Mo. Les dépendances verrouillées du socle sont conservées.

## Inventaire des 22 branches GitHub

Déjà incluses par ascendance dans le socle avec les correctifs : `agent-et-notification-didentit-462f`, `agent-sur-la-plateforme-b13d`, `agent-usability-of-the-application-126f`, `feature/beta-consolidation-v1-clean`, `feature/beta-consolidation-v1`, `feature/building-centric-refactor`, `feature/persistent-building-model-v3`, `feature/preview-as`, `feature/preview-permissions`, `feature/resident-manager-v2`, `feature/resident-mobile-home`, `feature/resident-my-lot`, `fix/people-relation-lifecycle`, `fix/pre-beta-hardening`, `fix/resident-owner-journey`, `main`, `staging`, et la tête `fix/audit-import-ticket-followup`.

Branche divergente avec fonctions récupérées : `agent-coprolink-on-feature-branch-a23f`.

Reconstructions historiques remplacées par leurs variantes propres, sans réimporter leurs anciennes versions de sécurité/UI : `codex/verifie-acces-au-depot-et-branche` (PR7 → PR8), `codex/verifie-acces-au-depot-et-branche-cxmugx` (PR10 → PR11), `codex/verifie-acces-au-depot-et-branche-0o6uie` (PR13 → PR14).

## Vérification

`npm run check` : TypeScript, 24 tests et compilation. Ce contrôle n’est pas une validation complète des fonctions avec une base distante.

À vérifier sur la preview avant toute promotion :

1. La base de données cible est la branche d’intégration, distincte de production ; les migrations attendues sont appliquées.
2. Créer une ACP fictive, importer deux fois un CSV et contrôler l’absence de nouveaux doublons.
3. Charger un document fictif de moins de 4 Mo ; télécharger et vérifier sa visibilité membre, propriétaire et écran avec comptes distincts.
4. Modifier une communication et une échéance ; contrôler la persistance après rechargement.
5. Enregistrer des montants fictifs depuis le syndic ; vérifier la lecture limitée à la situation de chaque propriétaire.
6. Déménagement : terminer occupant, conserver owner. Vente : terminer tous les liens ; contrôler historique et révocation d’accès.
7. Invitation et activation, y compris invitation ancienne après clôture ; contrôler les refus d’accès.

L’Inbox intelligente et les parcours encore incomplets du produit ne deviennent pas validés par cette intégration. Ne pas fusionner la PR de preview vers staging/main pour tester ; elle sert uniquement de déclencheur Netlify.
