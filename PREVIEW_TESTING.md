# Validation du parcours copropriétaire en prévisualisation

## Barrière avant toute écriture

Ne jamais créer de données ni envoyer de notification depuis une deploy preview
avant d'avoir vérifié dans Netlify que `CONTEXT=deploy-preview`, que la branche de
base de données n'est pas celle de production et que les clés Resend de production
ne sont pas exposées à ce contexte. Cette vérification n'est pas réalisable depuis
le dépôt seul : aucun essai d'écriture ou d'envoi ne doit être fait par défaut.

Les documents utilisent un store Netlify Blobs nommé avec le contexte de déploiement
(`coprolink-documents-deploy-preview` ou `coprolink-documents-production`). Une clé
doit suivre `buildings/<buildingId>/<identifiant>` ; l'API refuse une clé appartenant
à un autre immeuble.

## Jeu fictif à préparer dans l'environnement isolé

- deux comptes fictifs copropriétaires rattachés à des lots différents ;
- un lot avec quotité, appel trimestriel et solde fictifs ;
- un PDF bénin dans le store de preview et un document dont `storage_key` est nul ;
- une intervention commune avec au moins deux entrées d'historique ;
- un signalement privé et un signalement partagé, sans donnée personnelle réelle ;
- une AG fictive avec ordre du jour, présence et procuration.

## Parcours manuel

1. Connexion, accueil, ouverture d'une intervention commune et de son historique.
2. Création d'un signalement privé, puis partagé ; vérifier le double clic et l'erreur réseau.
3. Télécharger le document présent ; vérifier l'état explicite du document absent.
4. Ouvrir l'AG et vérifier présence/procuration sans conclure à une conformité légale.
5. Ouvrir « Mon lot », actualiser, utiliser précédent/suivant, puis se déconnecter.
6. Refaire avec le second compte et vérifier l'absence de données privées du premier.
7. Refaire au clavier, à 375 px (mobile) et 768 px (tablette).

## Recette restante avec comptes réels (mise à jour du 28 octobre 2026)

À faire sur une preview dont la base est confirmée isolée, avec des boîtes de test
contrôlées uniquement :

1. Inviter une personne nouvelle, avec une adresse contenant des majuscules ;
   vérifier la réception, l’activation et le rattachement au bon lot.
2. Relancer un compte non activé, ouvrir un lien expiré puis un lien déjà utilisé :
   le message doit proposer « Recevoir un nouveau lien ».
3. Révoquer une personne pendant que sa session est ouverte : l’appel suivant doit
   être refusé et la session afficher l’absence d’accès.
4. Référent non syndic : lecture de la gouvernance, aucune écriture possible.
5. Terminal : aucun document privé ou réservé aux propriétaires.
6. Navigation syndic et écrans portefeuille/immeuble/Inbox à 375 et 768 px.
