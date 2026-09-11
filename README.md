# CoproLink

Plateforme numérique indépendante pour copropriétés :

- **Écran/tablette dans les communs** : informations publiques, interventions, agenda, documents publics et signalement rapide, sans compte nominatif.
- **Espace copropriétaire** : vue d'ensemble, demandes personnelles, documents, situation financière et agenda.
- **Back-office syndic** : file opérationnelle, changement de statut, communications multi-canaux, journal d'activité, gestion des écrans et des accès.

Les données sont partagées : un signalement créé sur la tablette du hall apparaît immédiatement dans la file du syndic, et un changement de statut est visible partout, sur tous les appareils.

## Architecture

| Couche | Technologie |
| --- | --- |
| Interface | React + Vite (SPA, routage par hash, PWA) |
| API | Netlify Functions (`netlify/functions/*.mts`) |
| Base de données | Netlify Database (Postgres managé) via Drizzle ORM |
| Authentification | Netlify Identity (cookie `nf_jwt`) |

Le schéma est décrit dans `db/schema.ts` et les migrations vivent dans
`netlify/database/migrations`. **Elles sont appliquées par la plateforme Netlify
au déploiement** : ne les exécutez pas à la main et ne modifiez jamais une
migration déjà appliquée — ajoutez-en une nouvelle.

### Tables

`buildings`, `users`, `building_members`, `tickets`, `ticket_updates`,
`announcements`, `events`, `documents`, `terminals`, `audit_log`.

### Rôles et autorisation

Le rôle est attribué **par immeuble** dans `building_members` : une même personne
peut être gestionnaire d'un immeuble et copropriétaire d'un autre.

| Rôle | Portée |
| --- | --- |
| `resident` | Lit l'immeuble, crée des signalements, voit ses propres demandes et sa propre situation financière |
| `council_member` | Idem, plus la totalité des demandes et le journal d'audit |
| `manager` | Idem, plus le changement de statut, les communications, l'agenda, les écrans et les accès |
| `platform_admin` | Idem sur tout immeuble |

`platform_admin` n'est **pas** attribuable via l'API : il se règle dans
`app_metadata.roles` depuis l'onglet Identity de Netlify. Un gestionnaire ne peut
donc pas s'accorder lui-même un accès plateforme.

Chaque appel d'API repasse par `netlify/lib/auth.mts`, qui applique trois règles :

1. Le rôle n'est jamais lu dans la requête ; il est relu en base à chaque appel.
2. Un jeton de terminal ne donne accès qu'aux données publiques d'un seul
   immeuble et ne peut modifier aucun enregistrement existant.
3. Toute requête est confinée à un immeuble pour lequel une adhésion est vérifiée.

Un accès peut être décidé **avant** que le compte n'existe : la ligne est alors
écrite dans `pending_members` et convertie en appartenance réelle à la première
requête authentifiée de cette adresse. C'est Identity qui vérifie l'adresse
(lien de confirmation ou d'invitation), donc seule la personne qui contrôle la
boîte peut réclamer l'accès préparé pour elle.

## Lancer en local

```bash
npm install
netlify dev
```

`netlify dev` est nécessaire : les endpoints Identity et la base de données ne
sont pas disponibles avec `vite` seul.

## Première mise en service

1. **Déployer** le site (Netlify détecte Vite ; `netlify.toml` suffit). La base
   de données et Identity sont provisionnées automatiquement, et les migrations
   sont appliquées au déploiement.
2. **Restreindre les inscriptions** : dans Netlify, onglet *Identity*, passer
   *Registration* sur **Invite only**. Sinon, n'importe quel visiteur peut créer
   un compte, et le premier arrivé pourrait réclamer l'immeuble initial.
   En complément ou en remplacement, définir la variable d'environnement
   `COPROLINK_SETUP_TOKEN` : la création d'un immeuble exigera alors ce jeton.
3. **S'inviter** depuis l'onglet Identity, puis accepter l'invitation par
   e-mail : le lien ouvre l'application et demande un mot de passe.
4. **Créer l'immeuble** : l'écran de première installation s'affiche
   automatiquement pour un compte sans rattachement. Vous devenez gestionnaire
   de l'immeuble créé.
5. **Inviter les copropriétaires** depuis *Espace syndic → Accès* : une adresse
   e-mail suffit. La fonction crée le compte Netlify Identity (jeton opérateur,
   côté serveur uniquement) et envoie l'e-mail d'invitation ; le rôle est
   accordé dans le même geste. Aucun passage par le tableau de bord Netlify
   n'est nécessaire.
   Si la création de compte est momentanément impossible (Identity pas encore
   actif, jeton opérateur absent, endpoint protégé par mot de passe), la demande
   n'est pas perdue : elle apparaît dans *Accès préparés* et devient une
   appartenance réelle à la première connexion de cette adresse — utile
   seulement si les inscriptions libres sont autorisées, sinon relancer
   l'invitation depuis cette même liste une fois Identity joignable.

## Mode tablette / kiosque

L'écran des communs n'utilise **pas** de compte utilisateur mais un jeton de
terminal, propre à un immeuble, révocable, et qui ne peut lire aucune donnée
nominative ni aucun document privé.

1. Dans *Espace syndic → Écrans*, créer un jeton. L'adresse d'enrôlement
   n'est affichée **qu'une seule fois** ; le jeton n'est stocké en base que
   sous forme de hachage SHA-256.
2. Ouvrir cette adresse une fois sur la tablette : le jeton est conservé sur
   l'appareil et retiré de l'URL.
3. Installer la PWA depuis Chrome si souhaité, puis verrouiller la tablette en
   mode kiosque / épinglage d'application Android, ou via un MDM.
4. Prévoir une alimentation permanente et un support mural antivol.
5. La case *Signalements* autorise ou non la création de signalements depuis cet
   écran. Décochée, le jeton devient strictement en lecture.
6. En cas de perte ou de vol de la tablette : **Révoquer**. Le jeton est refusé
   dès la requête suivante.

L'écran revient automatiquement à l'accueil après 2 minutes d'inactivité et se
rafraîchit chaque minute.

## Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `NETLIFY_DATABASE_URL` | Fournie automatiquement par Netlify Database |
| `COPROLINK_SETUP_TOKEN` | Optionnelle. Si définie, exigée dans l'en-tête `x-setup-token` pour créer un immeuble |

## API

| Méthode | Chemin | Autorisation |
| --- | --- | --- |
| `GET` | `/api/session` | Publique (décrit la session courante) |
| `GET` | `/api/workspace` | `building:read` |
| `GET` | `/api/display` | Jeton de terminal uniquement |
| `POST` | `/api/tickets` | `tickets:create` (tous les rôles, terminal si autorisé) |
| `PATCH` | `/api/tickets/:reference` | `tickets:update` (gestionnaire) |
| `POST` | `/api/announcements` | `announcements:manage` |
| `POST` | `/api/events` | `events:manage` |
| `GET POST` | `/api/terminals` | `terminals:manage` |
| `PATCH DELETE` | `/api/terminals/:id` | `terminals:manage` |
| `GET POST` | `/api/members` | `members:manage` |
| `PATCH DELETE` | `/api/members/:id` | `members:manage` |
| `POST` | `/api/setup` | Compte authentifié + verrou d'amorçage |

## Principes produit retenus

1. **Une saisie, plusieurs canaux** : ne pas créer de double travail pour le syndic.
2. **Public ≠ privé** : l'écran du hall reste strictement non nominatif. Les
   descriptions libres et l'identité des signalants ne sortent jamais dans une
   charge utile publique.
3. **L'historique appartient fonctionnellement à l'immeuble** : `ticket_updates`
   et `audit_log` ne sont écrits qu'en ajout, l'ACP conserve sa mémoire même si
   le syndic change.
4. **Le statut est plus utile que la performance du syndic** : montrer
   « planifié / en attente / résolu » plutôt qu'un tableau de contrôle accusateur.
5. **Le hardware est une interface, pas le produit** : la valeur est dans la
   continuité des données et des processus.

## Reste à faire avant un pilote réel

- Stockage des fichiers de documents (Netlify Blobs) : seules leurs fiches sont
  aujourd'hui référencées, la colonne `documents.storage_key` est prévue pour cela.
- Notifications e-mail lors d'un changement de statut ou d'une communication.
- Écrans d'administration manquants : édition des documents, du budget et de la
  situation financière par lot.
- Pages légales : politique de confidentialité, registre des traitements,
  politique de conservation et contrat de sous-traitance RGPD.
- Ingestion d'e-mails entrants pour éviter la double saisie du syndic.
- Mode prestataire avec lien sécurisé pour confirmer une intervention.
