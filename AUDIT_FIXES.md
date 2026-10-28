# Corrections de l’audit du 28 octobre 2026

## Version et destination
Base : `c08f3b3`, branche `integration/full-test-2026-10-02`, PR #18.
Destination : prévisualisation #18 uniquement ; aucune promotion main/staging.

## Corrections appliquées

1. **Données du résident** : lots obtenus depuis ses relations V3 actives ;
   champs financiers absents pour les non-propriétaires. Les conseils n’obtiennent
   plus ce droit par leur seul rôle. Aperçu filtré sans réutiliser les lots du syndic.
2. **Rendu réel** : libellés et blocs propriétaire basés sur les capacités de
   l’API, indépendamment du mode aperçu ; solde nul affiché et centimes conservés.
3. **Gouvernance** : le référent non syndic ouvre directement sa vue d’immeuble.
4. **Cycle de vie** : validation serveur des dates impossibles/futures/inversées,
   historique non réouvrable, fermeture sérialisée, annulation des accès préparés,
   protection du dernier gestionnaire contre retrait et rétrogradation.
5. **Invitations** : relations actives vérifiées avant envoi et avant attribution,
   choix déterministe du lot, relance sans rétrograder un syndic ou membre du conseil,
   ancien accès révoqué non réactivé par la réclamation d’une invitation en attente.
6. **Finances** : montants personnels par période de propriété, plusieurs lots,
   saisie syndic par relation ; migration prudente et conservation de l’ancien état.
7. **Signalements** : date et heure exigibles pour Planifié ; statut et historique
   écrits dans la même transaction.
8. **Imports** : transaction par ligne et verrou d’immeuble, reprise sans doublons
   lors de deux imports simultanés ; compteurs validés après commit.
9. **Documents** : téléchargement public permis au terminal autorisé et toujours
   borné à son immeuble ; fichiers propriétaires protégés.
10. **Inbox** : pièces jointes obtenues auprès de l’API authentifiée Resend,
    téléchargées depuis son CDN HTTPS sans transmettre la clé d’API au CDN,
    bornées à 4 Mo/fichier et 12 Mo/opération, archivées dans le store de branche.
    Clés choisies côté serveur ; actions métier et marquage de traitement atomiques.
    Dates proposées modifiables, dates impossibles refusées, scores artificiels retirés.
    L’événement issu d’un e-mail est privé par défaut.
11. **Notifications** : file transactionnelle, contrôle des accès et du contenu
    avant envoi, destinataires individuels, clé d’idempotence et reprises bornées,
    journal des statuts consultable par le syndic. Désactivées en prévisualisation.
12. **Agenda et accessibilité** : dates passées retirées de l’agenda du hall,
    focus contenu dans les fenêtres communes et restauré à leur fermeture.
13. **Documentation** : README et plan de recette actualisés, versions Node/npm fixées.

## Validation effectuée

- Installation reproductible avec Node 22.12.0 / npm 10.9.0.
- TypeScript, tests et compilation Vite.
- Tests avec les vraies fonctions et autorisations sur base locale PostgreSQL :
  séparation des données par ACP et par propriétaire ; locataire avec montants
  historiques volontairement peuplés ; multi-lots, montants nuls et crédits ;
  migration sans affectation ambiguë ; clôture partielle puis totale, refus de
  réouverture et d’ancienne invitation ; dernier gestionnaire protégé ; date de
  planification ; imports concurrents ; actions Inbox répétées et binaires archivés ;
  annulation d’une notification après révocation et suivi d’envoi avec fournisseur simulé.
- Rendu React des vrais écrans : locataire sans bloc propriétaire, propriétaire avec
  sélection de plusieurs lots et montant nul affiché.

## Travaux qui demandent encore une recette ou une décision métier

- Tester réception et clic des liens Identity avec comptes indépendants et boîtes
  réelles ; aucun e-mail réel n’a été envoyé par ces tests.
- Vérifier en preview les sessions propriétaire/locataire/référent, le terminal,
  le tactile/clavier et les dimensions 375/768 px.
- Vérifier les anciennes valeurs financières ambiguës ; la migration ne les devine pas.
- Configurer le domaine expéditeur et activer les notifications seulement pour le
  pilote retenu ; leur arrivée réelle en boîte reste à valider.
- Finaliser politique de confidentialité, conservation, responsabilités et tests
  de restauration selon l’exploitation réelle. Aucune sauvegarde distante n’a
  été restaurée pendant ce travail.
- Cadrer les compléments produit : portail prestataire, votes et procès-verbaux
  d’AG, modification avancée des AG, export et gestion des cas complexes.

Les contrôles locaux ne constituent pas une certification de conformité légale
ni une recette complète en environnement distant.
