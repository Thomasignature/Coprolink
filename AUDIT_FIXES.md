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

# Recette du 28 octobre 2026 (suite) — corrections avant pilote

Base : `06c76ee` (`integration/full-test-2026-10-02`, PR #18), reprise à l’identique
puis corrigée. Aucune migration modifiée ni ajoutée. Aucune écriture distante, aucun
e-mail réel, aucune notification activée.

## Corrigé et vérifié par tests automatisés (vraies fonctions, PostgreSQL local)

**Invitations et connexion**
- Les réponses ne disent plus « envoyée » : Netlify Identity a seulement *accepté*
  la demande (`emailRequested`, `deliveryConfirmed: false`). Les messages distinguent
  compte nouveau, compte existant non activé et compte déjà actif.
- Identity est toujours interrogé avant l’envoi : un miroir local resté après la
  suppression d’un compte ne bloque plus l’invitation.
- Une invitation en attente enregistrée avec des majuscules est bien réclamée.
- Indisponibilité Identity (503) et quota (429) : aucun accès créé, aucun envoi annoncé.
- Lien expiré ou déjà utilisé : message en français, URL nettoyée, bouton
  « Recevoir un nouveau lien » ; le jeton d’invitation n’est jamais resoumis.
- Deux personnes partageant une adresse (couple) : invitation refusée avant tout
  appel Identity ; la connexion ne tombe plus en erreur 500 permanente.

**Relations et départs**
- Retour d’une personne : nouvelle période obligatoire, sans chevauchement avec la
  précédente ni doublon actif ; les montants de l’ancienne période ne sont pas repris.
- Testés : propriétaire occupant qui déménage (propriété, montants et accès
  conservés), vente partielle, départ total, référent non syndic (lecture de
  gouvernance, 403 sur toutes les écritures syndic), terminal (données publiques de
  son immeuble uniquement, documents privés/propriétaires/autre ACP en 404),
  remplacement du syndic (ancien syndic exclu, historique conservé, dernier
  gestionnaire protégé).

**Finances** : les anciennes valeurs par compte sont marquées « identique au montant
du lot » ou « à rapprocher » ; rien n’est affecté automatiquement.

**Documents** : un fichier non supprimable conserve sa fiche (502, nouvel essai
possible) ; nom de téléchargement ASCII de repli conforme.

**CSV** : réimport avec e-mails ajoutés sans doublon ; adresse partagée signalée
ligne par ligne ; rôles sans accents acceptés ; erreurs de base non exposées.

**Interventions** : l’historique enregistre la transition, l’étape « Planifié » est
cochée sur tous les écrans ; date affichée JJ/MM/AAAA ; heure vide acceptée.

**Agenda/AG** : dates/heures impossibles refusées (422) ; une AG passée ne peut plus
recevoir de présence/procuration.

**Inbox** : routage sur tous les destinataires To/Cc, limité au domaine
`COPROLINK_INBOUND_DOMAIN` s’il est défini ; une pièce jointe non archivable est
signalée sans bloquer les autres ; plus de limite à 8 pièces ; fichiers déjà écrits
supprimés si une opération échoue ; la note ajoutée à un signalement est relue et
modifiable et ne recopie plus le corps brut de l’e-mail.

**Notifications** : un résident lié à une personne V3 sans relation active n’est
plus destinataire (mise en file et envoi).

**Interface** : navigation syndic disponible ≤ 900 px ; navigation et déconnexion
des écrans portefeuille/immeuble/Inbox ≤ 760 px ; le focus ne quitte plus une
fenêtre ouverte lors d’un rafraîchissement ; protection contre les doubles clics
(accès, relances, rôles, retrait, jetons d’écran, ajout de personne) ; confirmation
avant retrait d’accès, annulation d’invitation et révocation d’écran ; erreurs
réseau en français ; saisie financière par ligne qui n’efface plus les chiffres
de l’immeuble.

## Non vérifié : demande des comptes ou des services réels

- Réception réelle et clic des liens Identity (invitation, relance, lien expiré,
  quota) : aucune boîte de test contrôlée n’était disponible.
- Sessions réelles indépendantes dans un navigateur (syndic, propriétaire,
  locataire, référent, terminal) sur une preview avec base isolée.
- Rendu réel à 375 px, 768 px et sur ordinateur, au clavier et en tactile. Les
  corrections d’affichage sont vérifiées par lecture du code et par compilation,
  sans capture.
- Webhook Resend réel, pièces jointes réelles, livraison des notifications.
- Sauvegarde et restauration de la base.

## Décisions métier à prendre avant le pilote

- Les locataires voient-ils le contenu des AG (ordre du jour, description) ? Ils
  le voient aujourd’hui ; seule la réponse est réservée aux propriétaires.
- Le référent non syndic doit-il lire l’Inbox du syndic ? Il le peut aujourd’hui
  (lecture seule).
- Le journal d’activité visible par le conseil contient des adresses e-mail et des
  noms de documents réservés aux propriétaires.
- Un compte déjà actif qui revient reçoit aujourd’hui un lien de réinitialisation
  du mot de passe : le conserver ou ne rien envoyer.
- L’agenda résident affiche aussi les dates passées.
- Débit des notifications (10 envois par passage de 5 minutes, expiration à 23 h) :
  à dimensionner pour le pilote.
- Domaine d’envoi, adresse de réception (`COPROLINK_INBOUND_DOMAIN`), textes de
  confidentialité, durées de conservation, responsabilités et procédure de
  restauration : à fournir, ils ne sont pas inventés ici.

## Consolidation de la version approuvée #23

Les corrections de `4a7d2f5` sont reprises dans la branche d’intégration.
La migration de recalage déjà appliquée sur la base #23 n’est pas réécrite.
L’intégration #18 reçoit un nouveau recalage idempotent, ordonné après ses
migrations existantes ; ses 14 fichiers de migrations antérieurs restent
identiques. Un test vérifie l’application après cet historique avec conservation
d’une copropriété fictive, ainsi que l’idempotence du recalage.

Vérifications : 72 tests réussis, TypeScript et compilation ; génération Drizzle
sans changement de schéma. Code fonctionnel identique à la preview #23 approuvée.
La réception réelle d’une invitation reste à vérifier avec un compte et une
boîte de test contrôlés ; aucun envoi réel effectué lors de cette consolidation.
