# Audit pré-bêta CoproLink — modèle persistant V3

**Branche source auditée :** `feature/persistent-building-model-v3`  
**Commit source :** `5aa64d70ee0a67db9742906164363470eed4f21d`  
**Date :** 29 septembre 2026  
**Périmètre :** revue statique exhaustive du dépôt, parcours frontend et API, schémas/migrations, autorisations, compilation Vite, contrôle TypeScript et audit npm. Aucun appel n'a été fait vers staging ou production et aucune migration n'y a été exécutée.

## Verdict exécutif

**NO-GO pour une bêta grandeur nature avec données réelles.** Aucun P0 exploitable sans secret n'a été confirmé par la revue statique, mais neuf P1 bloquent le pilote : webhook non signé selon le protocole Resend, pièces jointes fictivement classées, actions Inbox non atomiques, absence de distinction serveur entre propriétaire/occupant/locataire, création initiale non transactionnelle, suppressions destructrices, chaîne d'installation non reproductible, migrations hors schéma Drizzle et module AG trop incomplet pour porter des actes de gouvernance.

Le socle est prometteur : la plupart des requêtes métier filtrent explicitement sur `buildingId`, les rôles sont relus côté serveur, les jetons de tablette sont hachés et révocables, et le build frontend passe. Le produit doit cependant être présenté comme un **prototype fonctionnel**, pas comme un système prêt à traiter durablement des données de copropriété.

## Synthèse des constats

| Priorité | Nombre | Lecture |
| --- | ---: | --- |
| P0 — critique | 0 | Aucun P0 confirmé dans les conditions de cette revue statique. |
| P1 — avant bêta | 9 | Bloquants sécurité, intégrité, confidentialité ou exploitation. |
| P2 — important | 10 | Lacunes importantes de robustesse et de cohérence produit. |
| P3 — amélioration | 5 | Dette de qualité, UX et exploitation. |

---

## P0 — critique

### Aucun P0 confirmé

La revue n'a pas mis en évidence d'accès inter-immeubles trivial sans authentification ni de secret versionné. Ce constat n'est **pas** une preuve d'absence de P0 : les tests dynamiques Identity/Postgres/Resend et les tests adversariaux multi-comptes n'ont pas pu être exécutés sans environnement isolé et jeux d'identités.

---

## P1 — à corriger avant bêta

### P1-01 — Le webhook Resend n'authentifie pas la signature du fournisseur

- **Fichier / zone :** `netlify/functions/inbound-email.mts`, `receiveResendWebhook`, lignes 279–335.
- **Scénario :** récupérer le token placé dans la query string (journaux de proxy, historique, capture d'écran, outil d'observabilité), puis envoyer un faux événement `email.received` avec un `email_id` choisi et un destinataire dont la partie locale est le slug d'un immeuble.
- **Impact :** injection de faux messages et métadonnées dans l'Inbox, consommation de l'API Resend, leurre d'un opérateur vers une communication/un ticket/un événement. Le secret en URL est particulièrement exposé aux traces techniques.
- **Correction :** vérifier la signature officielle du webhook sur les octets bruts et les en-têtes signés, avec tolérance temporelle et secret par environnement ; retirer le token de l'URL ; valider aussi le domaine destinataire autorisé, la taille du corps et le type de contenu ; ajouter des tests signature valide, invalide, expirée et rejeu.

### P1-02 — Le « classement » des pièces jointes ne stocke aucun fichier

- **Fichier / zone :** `netlify/functions/inbound-email.mts`, `createDocumentAction`, lignes 168–205 ; `src/inbox-ai.jsx`, action de classement ; `netlify/functions/workspace.mts`, sérialisation des documents.
- **Scénario :** recevoir un e-mail avec un PDF, cliquer « Classer dans Documents », puis ouvrir l'espace Documents. Une ligne est créée avec `storageKey: null` ; le binaire n'est jamais téléchargé ni conservé.
- **Impact :** faux sentiment d'archivage, perte potentielle de pièces contractuelles/PV/factures après expiration côté fournisseur, incapacité à consulter ou prouver le contenu, rupture du parcours produit principal.
- **Correction :** récupérer chaque pièce via l'API Resend, contrôler taille/MIME/extension et antivirus, stocker le binaire dans un stockage objet privé, enregistrer clé, hash, taille, MIME et nom original, fournir une URL signée à durée courte, et ne marquer l'action `created` qu'après commit complet. Tant que ce flux n'existe pas, renommer l'action en « créer des fiches document » et afficher un blocage explicite.

### P1-03 — Les actions Inbox ne sont pas idempotentes en concurrence

- **Fichier / zone :** `netlify/functions/inbound-email.mts`, lignes 145–258.
- **Scénario :** double-cliquer, envoyer deux requêtes PATCH parallèles, ou laisser deux opérateurs valider la même action. Les deux requêtes lisent l'état `pending`, créent chacune l'entité, puis écrasent le pointeur dans l'e-mail.
- **Impact :** doublons d'événements, annonces, notes de ticket ou documents ; une partie des doublons devient orpheline et invisible depuis l'Inbox. Les écritures métier, statut et audit ne sont pas transactionnelles, donc un échec intermédiaire produit aussi des états partiels.
- **Correction :** transaction Postgres par action, transition atomique `pending -> processing` conditionnée dans un `UPDATE ... WHERE status='pending' RETURNING`, clé d'idempotence unique `(inbound_email_id, action_type)`, finalisation et audit dans la même transaction ; permettre une reprise contrôlée des statuts `failed`.

### P1-04 — Propriétaire, occupant et locataire ne sont pas des autorisations serveur

- **Fichier / zone :** `db/schema.ts`, `ROLES` et `building_members` ; `netlify/lib/auth.mts`, `ROLE_CAPABILITIES` ; `netlify/functions/person-access.mts`, attribution forcée de `resident` ; `src/resident-lot.jsx`, distinction uniquement via `previewRole`.
- **Scénario :** inviter une personne V3 reliée comme `tenant` ou `occupant`. Son compte reçoit le rôle générique `resident`, donc les capacités `documents:read:private` et `finance:read:own`. Le mode locataire affiché dans la prévisualisation n'est pas dérivé par l'API pour une vraie session.
- **Impact :** un locataire peut recevoir les documents privés et données financières copiées dans `building_members`; incohérence entre promesse UI et contrôles réels. Les relations V3 ne pilotent pas l'accès.
- **Correction :** calculer les droits depuis les relations actives lot/personne (avec dates), distinguer au minimum propriétaire et occupant/locataire, définir une matrice documents/finance/AG/tickets, retourner un profil serveur et supprimer toute sécurité fondée sur `previewRole`.

### P1-05 — Création d'immeuble et amorçage non transactionnels et sujets aux courses

- **Fichier / zone :** `netlify/functions/setup.mts`, lignes 32–103 et 113–162.
- **Scénario :** deux premiers comptes appellent `/api/setup` simultanément sans token ; chacun observe `count === 0`. Autre cas : l'insertion de l'immeuble réussit puis l'ajout du membre/professionnel/des données exemple échoue.
- **Impact :** deux gestionnaires initiaux non autorisés, immeuble orphelin ou partiellement initialisé, slug en collision malgré le pré-contrôle, données d'exemple partielles.
- **Correction :** transaction unique, verrou/advisory lock d'amorçage, contrainte et retry explicite sur le slug, rollback complet en cas d'échec, token obligatoire hors environnement local ou création réservée à un `platform_admin` pré-provisionné.

### P1-06 — Suppressions V3 destructrices sans garde ni historique

- **Fichier / zone :** `netlify/functions/building-model.mts`, DELETE lignes 260–282 ; FKs `ON DELETE CASCADE` dans `db/schema-v3.ts` et migrations.
- **Scénario :** supprimer un lot ou une personne depuis l'administration, sans confirmation serveur ni mode archive. La suppression d'une personne cascade ses relations, son mandat de référent, ses préférences et ses réponses d'AG ; supprimer un lot efface les relations associées.
- **Impact :** perte irréversible de l'historique de propriété/occupation et de participation aux AG, journal d'audit insuffisant pour reconstruire les données, risque juridique et support majeur.
- **Correction :** soft-delete/archivage daté, fin de relation plutôt que suppression, refus si entité référencée, confirmation forte avec aperçu d'impact, snapshot minimal dans l'audit, procédure de restauration et tests de cascade.

### P1-07 — Installation CI non reproductible et contrôle TypeScript en échec

- **Fichier / zone :** `package.json`, dépendance `@netlify/identity` à `2.0.0` et nombreuses versions `latest` ; `package-lock.json`, encore verrouillé sur `@netlify/identity` 1.2.0 ; `db/index.ts` et appels `db.execute` des modules Inbox/AG.
- **Scénario :** exécuter `npm ci` : arrêt immédiat pour désynchronisation package/lock. Après installation sans lock, `npx tsc --noEmit` échoue sur la construction Drizzle et 23 appels `db.execute` incompatibles avec les types résolus.
- **Impact :** un build Netlify propre peut échouer ou résoudre un graphe différent ; aucune garantie que les fonctions typent ou s'exécutent avec les versions déployées ; mises à jour majeures implicites via `latest`.
- **Correction :** choisir des versions exactes/compatibles, régénérer et committer le lock, corriger l'initialisation Drizzle et `execute`, ajouter `typecheck`, `test` et `ci` aux scripts, imposer `npm ci && npm run typecheck && npm test && npm run build` en CI.

### P1-08 — Le schéma V3 est hors de la source de vérité Drizzle et du runtime principal

- **Fichier / zone :** `drizzle.config.ts`, qui ne référence que `db/schema.ts` ; `db/index.ts`, qui n'importe que ce même schéma ; `db/schema-v3.ts` et migrations V3/Inbox/AG.
- **Scénario :** lancer une génération ou une vérification de migration Drizzle. Les tables V3, Inbox et AG ne font pas partie du schéma configuré ; une migration ultérieure peut ignorer ces objets ou proposer des changements destructeurs. Les relations typées ne sont pas enregistrées dans l'instance principale.
- **Impact :** drift silencieux entre code et base, migrations non fiables, difficulté de reproduire un environnement, risque accru lors du prochain changement de schéma.
- **Correction :** exporter un schéma unifié (ou configurer explicitement les deux fichiers), faire de toutes les tables/contraintes/index la source de vérité, puis tester une base vide et une mise à niveau depuis la dernière production.

### P1-09 — Le module AG n'est pas apte à porter une AG réelle

- **Fichier / zone :** `db/schema-v3.ts`, tables AG ; `netlify/functions/assemblies.mts` ; composants `assembly-panel.jsx` et `syndic-assemblies.jsx`.
- **Scénario :** un locataire/occupant ayant un compte `resident` répond à l'AG ; une AG passée ou clôturée accepte encore une réponse ; le syndic doit produire convocation, annexes, feuille de présence, quotes-parts, pouvoirs, votes et PV.
- **Impact :** personnes non habilitées admises, aucune pondération par quotité, aucun vote/résolution/quorum, absence de gel et de preuve documentaire ; les compteurs affichés peuvent être interprétés à tort comme un suivi juridique.
- **Correction :** cadrer le module comme simple RSVP non juridique ou implémenter éligibilité depuis les propriétaires actifs, mandats structurés, résolutions/votes/quotités, statuts et transitions verrouillées, documents immuables et audit horodaté. Retirer les totaux globaux aux résidents si non nécessaires.

---

## P2 — important

### P2-01 — Séparation syndic/référent incohérente pour l'Inbox

- **Fichier / zone :** `netlify/lib/auth.mts`, `authorizeCoproLinkAdmin` / `authorizeSyndicOperator` ; `netlify/functions/inbound-email.mts`, GET et PATCH.
- **Scénario :** un référent actif ouvre l'Inbox et valide une annonce, un événement, un classement ou une note de ticket. L'endpoint PATCH utilise `authorizeCoproLinkAdmin`, alors que les écritures du modèle et de l'AG sont réservées au syndic.
- **Impact :** ambiguïté de responsabilité et droits opérationnels plus larges que le commentaire d'architecture ; un référent peut publier une communication sans capacité `announcements:manage` ordinaire.
- **Correction :** matrice RACI explicite par action. Autoriser le référent à consulter/proposer si souhaité, mais exiger la capacité métier correspondante ou `authorizeSyndicOperator` pour exécuter.

### P2-02 — Invitations et fiches personnes peuvent diverger

- **Fichier / zone :** `netlify/functions/members.mts`, flux d'invitation ; `netlify/functions/person-access.mts` ; `netlify/lib/auth.mts`, `linkBuildingPersonAccount`.
- **Scénario :** inviter via l'ancien écran Membres ne crée/relie pas forcément une personne V3 ; inversement, inviter une personne choisit seulement le premier lot trouvé. Modifier ensuite l'e-mail de la personne ne met pas à jour le compte, l'invitation ou l'appartenance.
- **Impact :** compte actif sans personne V3 donc impossible de répondre à l'AG, lot erroné pour les personnes multi-lots, statuts d'accès trompeurs.
- **Correction :** service transactionnel unique d'invitation, identifiant de personne obligatoire, choix explicite des relations/lots, synchronisation contrôlée des e-mails et état d'activation, suppression du doublon fonctionnel entre `members` et `person-access`.

### P2-03 — Contraintes de cohérence et validation métier insuffisantes

- **Fichier / zone :** schémas `db/schema.ts` et `db/schema-v3.ts`, migrations ; helpers `readString` et endpoints V3.
- **Scénario :** soumettre un e-mail invalide, une date impossible mais au bon format, une quotité libre incohérente, un `displayOrder` extrême, un statut texte injecté directement en base, ou lier `userId` arbitraire lors de la création d'une personne.
- **Impact :** données non exploitables, erreurs SQL 500, incohérences difficiles à corriger et surface d'abus.
- **Correction :** validation structurée partagée (schémas), limites de payload, parse strict des dates/e-mails/téléphones/nombres, contraintes `CHECK`/enum et bornes, ne jamais accepter `userId` directement du client.

### P2-04 — Import CSV non conforme et partiellement atomique

- **Fichier / zone :** `src/onboarding-import.jsx`, `splitLine`/`parseCsv` ; `netlify/functions/onboarding-import.mts`.
- **Scénario :** importer `"Dupont, Jean"`, une adresse avec point-virgule, une cellule multilignes, un BOM, deux lignes concurrentes pour le même lot, ou une ligne sans e-mail répétée. Le parser fait un simple `split`; le serveur traite ligne par ligne sans transaction et déduplique une personne uniquement par e-mail.
- **Impact :** colonnes décalées, doublons de personnes sans e-mail, import partiel après erreur, résultat difficile à annuler.
- **Correction :** bibliothèque CSV éprouvée côté serveur, upload du fichier brut, phase dry-run avec erreurs, identifiants externes, transaction ou lots reprenables, verrou/upsert et rapport exportable.

### P2-05 — DDL exécuté à chaque requête Inbox/AG

- **Fichier / zone :** `ensureInboundEmailTable` et `ensureAssemblyTables`.
- **Scénario :** chaque GET/POST/PATCH lance plusieurs `CREATE TABLE/INDEX IF NOT EXISTS` et `ALTER TABLE`, y compris avec des requêtes concurrentes.
- **Impact :** latence, verrous de catalogue, privilèges DDL nécessaires au runtime, masquage des migrations manquantes et comportement différent entre preview et production.
- **Correction :** retirer tout DDL des fonctions, appliquer les migrations dans un job de déploiement bloquant, fournir un healthcheck de version de schéma et une base de preview migrée automatiquement.

### P2-06 — Données personnelles sur-collectées et politique RGPD absente

- **Fichier / zone :** `inbound_emails.raw_event_json`, corps HTML/texte, personnes et audit ; `README.md`, reste à faire juridique.
- **Scénario :** ingérer un e-mail contenant signatures, destinataires, contenu sensible et payload fournisseur ; conserver indéfiniment ces champs et les audits nominatifs sans purge/export.
- **Impact :** exposition accrue en cas d'incident, non-respect possible de minimisation, conservation, droit d'accès/effacement et information des personnes.
- **Correction :** classification des données, durées de conservation, purge planifiée, chiffrement et accès restreint, redaction du payload brut, export/effacement encadrés, registre/DPA/politique avant données réelles.

### P2-07 — Aucune protection explicite contre abus/volume

- **Fichier / zone :** endpoints setup, tickets, session, Inbox et imports ; `netlify.toml`.
- **Scénario :** multiplier les requêtes de tickets terminal, webhooks, recherches Identity, imports de 500 lignes ou hydratations de 20 e-mails.
- **Impact :** coûts, saturation DB/API tierce, rate-limit Identity/Resend, déni de service applicatif.
- **Correction :** quotas par principal/IP/immeuble, limites de taille, timeout/abort des appels externes, file asynchrone pour ingestion, pagination, backoff et observabilité.

### P2-08 — Les opérations multi-écritures tickets/invitations ne sont pas transactionnelles

- **Fichier / zone :** `netlify/lib/data.mts`, `createTicket`/`changeTicketStatus`; `members.mts`; `person-access.mts`.
- **Scénario :** provoquer une erreur après création du ticket mais avant sa référence/timeline/audit, ou après création Identity avant l'appartenance DB.
- **Impact :** tickets `pending-*`, compte invité sans accès, audit manquant ou état UI incohérent.
- **Correction :** transactions DB ; pour Identity (système externe), saga/outbox avec états explicites, reprises idempotentes et réconciliation.

### P2-09 — En-têtes de sécurité incomplets

- **Fichier / zone :** `public/_headers`, `src/styles.css` (Google Fonts distant).
- **Scénario :** charger l'application : aucune CSP n'encadre scripts, connexions, styles ou frames ; pas de HSTS ni politique COOP. La police distante divulgue au tiers les métadonnées de chargement.
- **Impact :** impact accru d'une injection future, protection navigateur incomplète et dépendance tierce inutile pour une application de données personnelles.
- **Correction :** CSP stricte compatible Netlify Identity, `frame-ancestors`, HSTS sur production, COOP/`object-src 'none'` selon compatibilité, auto-hébergement des polices ; tests automatiques des headers.

### P2-10 — Multi-immeubles fragile dans le routage client

- **Fichier / zone :** `src/app.jsx`, sélection `memberships.find(...) ?? memberships[0]` et redirection référent.
- **Scénario :** fournir un slug absent ou ouvrir une URL d'un immeuble non autorisé : le client retombe silencieusement sur le premier immeuble. Un référent de plusieurs immeubles est redirigé vers le premier ; la navigation ne signale pas clairement la substitution.
- **Impact :** action effectuée sur le mauvais immeuble par erreur humaine, confusion forte pour un portefeuille syndic.
- **Correction :** refuser le slug inconnu côté client, afficher un sélecteur explicite, conserver l'immeuble courant, confirmer le contexte dans chaque action destructive et tester les changements rapides A/B.

---

## P3 — amélioration

### P3-01 — Pas de suite de tests ni de script de qualité

- **Zone :** `package.json`.
- **Scénario :** lancer `npm test` ou chercher lint/format/tests : aucun script ni fichier de test.
- **Impact :** régressions silencieuses sur autorisations, migrations et parcours critiques.
- **Correction :** Vitest pour unitaires, tests API avec Postgres jetable, Playwright multi-comptes, ESLint et CI obligatoire.

### P3-02 — Bundle principal monolithique

- **Zone :** `src/app.jsx` et imports statiques ; sortie Vite.
- **Scénario :** charger l'espace résident sur mobile : tout le code des vues syndic/Inbox/modèle est inclus dans le bundle principal (~424 kB non compressé).
- **Impact :** démarrage et mise à jour PWA plus lourds sur mobile.
- **Correction :** `React.lazy` par espace/route, chunks stables, budget de bundle CI.

### P3-03 — UX d'erreur inégale

- **Zone :** `syndic-assemblies.jsx` et plusieurs actions `finally` sans `catch` utilisateur.
- **Scénario :** échec de création d'AG ou ajout d'ordre du jour : promesse rejetée sans message local utile.
- **Impact :** opérateur incertain, doubles tentatives favorisant les courses.
- **Correction :** erreurs accessibles et persistantes par formulaire, corrélation d'erreur, retry explicite et désactivation robuste.

### P3-04 — Accessibilité et responsive non vérifiés automatiquement

- **Zone :** modales/navigation/composants frontend et CSS très compact.
- **Scénario :** navigation clavier/lecteur d'écran : modales sans `role="dialog"`, focus trap/restauration ou fermeture Escape systématique ; textes de 8–10 px fréquents.
- **Impact :** parcours difficile pour utilisateurs malvoyants ou clavier ; risque WCAG.
- **Correction :** primitives de dialogue accessibles, tailles lisibles, focus visible, axe-core et matrice 320/375/768/desktop. Le CSS contient des media queries utiles mais cela ne remplace pas les tests appareils.

### P3-05 — Documentation en retard sur la V3

- **Zone :** `README.md`, tables/API/variables et liste « reste à faire ».
- **Scénario :** un exploitant suit le README : les tables V3, `RESEND_API_KEY`, le secret webhook et les nouvelles API ne sont pas documentés ; l'ingestion e-mail est encore annoncée comme future.
- **Impact :** configuration incomplète, exploitation erronée et onboarding technique lent.
- **Correction :** architecture V3, matrice des rôles, variables par contexte, runbooks Resend/migrations/restauration et limites produit explicites.

---

## Analyse transversale demandée

### Isolation entre immeubles

Les endpoints principaux appliquent généralement `buildingId` aux lectures/écritures : tickets, membres, terminaux, modèle V3, AG et Inbox. Les actions Inbox vérifient aussi que le ticket cible appartient à l'immeuble. C'est un bon socle. Il manque cependant des tests automatisés systématiques d'IDOR et une défense en profondeur en base (RLS). Le fallback client vers le premier immeuble est un risque d'erreur, pas une fuite serveur confirmée.

### Communications, tickets, planning et documents

Les créations sont autorisées côté serveur et scoppées. Les tickets ont des références globalement uniques fondées sur l'ID, mais la création/timeline/audit doit devenir transactionnelle. Communications et planning ne disposent que de la création : pas d'édition, d'archivage ou de suppression contrôlée. Les documents n'ont aucun endpoint d'upload/téléchargement et ne doivent pas être considérés fonctionnels.

### Espace syndic, espace résident et mobile

Les deux espaces sont visuellement structurés et les actions principales sont reliées aux API. L'espace résident n'utilise toutefois pas les relations V3 pour construire « Mon lot » ; il continue à lire la copie legacy dans `building_members`. La vue locataire est essentiellement une prévisualisation UI. Les media queries existent, mais aucune preuve de test responsive, tactile, clavier ou sur appareil réel n'est présente.

### Dépendances et configuration Netlify/Vite/Node

Node 22.12 est fixé dans `netlify.toml`, mais le manifeste emploie `latest`, le lock est incohérent et aucun `engines` n'encadre les postes/CI. Le build Vite passe après installation hors lock. Il n'y a pas de configuration explicite de migration dans les scripts, de monitoring, de logs structurés, de tracing, d'alertes ni de sauvegarde/restauration documentée.

## Checklist Go / No-Go bêta

| Critère | État | Condition de passage |
| --- | --- | --- |
| Build frontend | **GO conditionnel** | Build passe, mais doit passer via `npm ci` verrouillé. |
| Installation/CI reproductible | **NO-GO** | Synchroniser lock, versions et typecheck. |
| Isolation multi-immeubles | **GO conditionnel** | Ajouter tests IDOR exhaustifs et supprimer fallback silencieux. |
| Authentification et invitations | **NO-GO** | Unifier personne/membre/invitation et tester activation/reprise. |
| Séparation syndic/référent | **NO-GO** | Définir puis appliquer la matrice aux actions Inbox et aux données personnelles. |
| Propriétaire/occupant/locataire | **NO-GO** | Faire des relations V3 la source de droits serveur. |
| Webhook Resend | **NO-GO** | Signature fournisseur, rejeu, domaine et limites. |
| Pièces jointes/documents | **NO-GO** | Stockage binaire privé, scan, hash et téléchargement autorisé. |
| Idempotence Inbox | **NO-GO** | Verrou atomique, transaction et clé unique. |
| Tickets/communications/planning | **GO conditionnel** | Transactions, tests concurrence et cycle de vie. |
| AG réelle | **NO-GO** | Limiter explicitement à RSVP ou compléter le modèle juridique. |
| Migrations | **NO-GO** | Schéma unifié, aucune DDL runtime, tests fresh/upgrade/rollback. |
| Suppressions/restauration | **NO-GO** | Archivage, garde-fous et restauration testée. |
| RGPD/sécurité des données | **NO-GO** | Conservation, purge, information, DPA et réduction du payload brut. |
| Mobile/accessibilité | **GO conditionnel** | Tests appareils et WCAG avant ouverture large. |
| Observabilité/support | **NO-GO** | Alertes, erreurs corrélées, sauvegarde/restauration et runbooks. |

**Décision globale : NO-GO.** Un pilote fermé sur données synthétiques peut continuer, sans prétention d'archivage documentaire ni d'AG juridique.

## Les 10 corrections prioritaires

1. Mettre en place la vérification cryptographique officielle du webhook Resend et le rejet des replays.
2. Implémenter le stockage binaire sécurisé des pièces jointes, ou désactiver le bouton de classement.
3. Rendre chaque action Inbox transactionnelle et atomiquement idempotente.
4. Dériver les droits propriétaire/occupant/locataire des relations V3 actives et filtrer finance/documents/AG.
5. Synchroniser `package.json`/lock, figer les versions et obtenir un typecheck vert en CI.
6. Unifier le schéma Drizzle V1/V3/Inbox/AG et supprimer le DDL au runtime.
7. Rendre setup, tickets et écritures composées transactionnels ; ajouter verrou d'amorçage et outbox Identity.
8. Remplacer les suppressions lots/personnes par archivage et fins de relation avec impact preview/restauration.
9. Unifier invitation/membre/personne, prendre en charge multi-lots et tester tout le cycle d'activation.
10. Requalifier l'AG en RSVP tant que votes, pouvoirs, quotités, gel, documents et preuve ne sont pas implémentés.

## Tests automatisés manquants

### Unitaires

- Matrice capacités/rôles et distinction syndic/référent/propriétaire/occupant/locataire/admin.
- Validation et normalisation : e-mail, dates réelles, heures, slugs, CSV, relation active.
- Parsing d'e-mail : destinataires multiples, domaines, sender, tailles, encodages et dates.
- Analyse Inbox : classification, dates/heures, référence ticket et absence de faux positifs.
- Sérialisation publique des tickets et filtrage documents/finance.

### Intégration API + Postgres jetable

- Matrice endpoint × rôle × immeuble, avec IDs valides d'un autre immeuble sur chaque route.
- Setup concurrent, collision de slug, panne après chaque écriture et rollback.
- Invitation : nouveau compte, compte existant, Identity indisponible, relance, activation, e-mail en casse différente, multi-immeubles, multi-lots.
- Import deux fois et imports parallèles ; CSV cité/multiligne/BOM/erreurs partielles.
- Webhook signé/invalide/expiré/rejoué, `email_id` dupliqué en concurrence, mauvais domaine et payload surdimensionné.
- Deux validations simultanées de chacune des quatre actions Inbox ; injection de panne avant/après objet/statut/audit.
- Upload/téléchargement document : MIME trompeur, malware de test, taille, ACL, URL expirée, hash.
- Suppressions/archivages : lot/personne/référent ayant relations, invitation, ticket et réponse AG.
- AG : éligibilité, relation terminée, multi-lots, procuration, AG clôturée, double réponse concurrente.
- Migrations : base vide, upgrade depuis chaque version déployée, données existantes, rerun et restauration.

### End-to-end

- Création de zéro → lots/personnes → invitation → activation → première connexion.
- Deux immeubles dans un portefeuille et un même compte avec rôles différents.
- Parcours complet e-mail → Inbox → document/ticket/événement/communication.
- Ticket terminal → syndic → résident, y compris révocation du terminal.
- Responsive 320/375/768/1440, iOS Safari, Android Chrome, desktop et PWA mise à jour.
- Axe/accessibilité, clavier, focus des modales et zoom 200 %.

## Tests manuels multi-comptes indispensables

Préparer deux immeubles A/B, deux syndics, un référent par immeuble, un copropriétaire multi-lots, un copropriétaire non occupant, un occupant, un locataire, un membre du conseil, un platform admin et un terminal par immeuble.

1. Pour chaque profil, copier manuellement les URLs/IDs de A vers B et confirmer 403/404 sans fuite dans la réponse ou les logs.
2. Connecter simultanément syndic et référent ; vérifier lecture/proposition/exécution selon la matrice cible.
3. Inviter une même adresse dans A et B avec rôles différents, activer une fois, changer d'immeuble et contrôler chaque droit.
4. Inviter un compte existant, un nouveau compte et une adresse lorsque Identity est indisponible ; relancer puis annuler.
5. Changer l'e-mail d'une personne avant/après invitation et vérifier qu'aucun tiers ne récupère l'accès.
6. Affecter une personne à plusieurs lots et avec relations simultanées/historiques ; vérifier « Mon lot », finances, documents et AG.
7. Envoyer de vrais e-mails Resend : texte, HTML, plusieurs destinataires, CC, 0/1/20+ pièces, gros fichier, nom Unicode, type trompeur et message dupliqué.
8. Valider la même action Inbox au même instant depuis deux navigateurs et constater une seule entité/audit.
9. Révoquer un membre/référent/terminal pendant qu'une session est ouverte et confirmer l'effet dès l'appel suivant.
10. Tenter suppression d'une personne/lot avec historique ; vérifier avertissement, archivage et restauration.
11. Créer une AG, répondre avec chaque profil, clôturer, tenter de modifier, puis exporter/relire la preuve attendue.
12. Tester hors ligne/retour réseau et nouvelle version du service worker sans afficher de données authentifiées mises en cache.

## Niveau de maturité estimé

**Prototype avancé / alpha interne : 2 sur 5.**

- **Produit/UI : 3/5** — parcours et intentions bien visibles, responsive amorcé, mais plusieurs fonctions sont des maquettes (documents, locataire réel, AG juridique).
- **Backend/intégrité : 2/5** — bon scoping applicatif, mais transactions, idempotence et cycle de vie manquent.
- **Sécurité/confidentialité : 2/5** — contrôles d'accès centraux utiles, mais webhook, droits de relation, rétention et headers sont insuffisants.
- **Données/migrations : 1,5/5** — drift de schéma, DDL runtime, suppressions en cascade et aucune preuve de migration automatisée.
- **Qualité/exploitation : 1/5** — aucun test, lock cassé, typecheck rouge, pas de runbook d'observabilité/restauration.

Une **bêta fermée sur données synthétiques** est raisonnable pour tester l'ergonomie. Une **bêta grandeur nature avec e-mails, documents, données financières ou actes d'AG réels** doit attendre la fermeture des P1 et la validation des tests multi-comptes.

## Contrôles exécutés

- `git rev-parse HEAD`, `git branch --show-current`, `git remote -v` : source confirmée avant audit.
- `npm ci` : **échec** attendu du fait du lock incohérent (`@netlify/identity` 1.2.0 vs 2.0.0).
- `npm install --no-package-lock` : réussite, 153 paquets installés, aucune vulnérabilité signalée pendant l'installation.
- `npm run build` : réussite ; bundle JS principal 424,24 kB (118,36 kB gzip), CSS 102,10 kB (19,58 kB gzip).
- `npx tsc --noEmit` : **échec**, initialisation Drizzle incompatible et 23 erreurs sur les appels `db.execute` des modules AG/Inbox.
- `npm audit --omit=dev --package-lock-only` : réussite, 0 vulnérabilité connue dans le graphe verrouillé ; ce résultat ne corrige pas la désynchronisation du lock.

