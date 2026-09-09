# CoproLink MVP

Prototype fonctionnel d'une plateforme numérique indépendante pour copropriétés :

- **Écran/tablette dans les communs** : informations publiques, interventions, agenda, documents publics et signalement rapide.
- **Espace copropriétaire** : vue d'ensemble, demandes personnelles, documents, finances simplifiées et agenda.
- **Back-office syndic** : file opérationnelle, modification de statut, communications multi-canaux et historique d'activité.

## Démo

Les données sont volontairement stockées dans `localStorage` pour permettre une démonstration sans backend.

Un signalement créé depuis l'écran public ou l'espace copropriétaire apparaît immédiatement dans l'espace syndic du même navigateur. Une modification de statut côté syndic est visible dans les autres interfaces.

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvrir l'URL affichée par Vite.

## Déployer sur Netlify

Le fichier `netlify.toml` est déjà configuré :

- Build : `npm run build`
- Publication : `dist`
- Node : 20
- Rewrite SPA vers `index.html`

### Méthode Git

1. Créer un dépôt GitHub avec ce dossier.
2. Dans Netlify : **Add new project > Import an existing project**.
3. Sélectionner le dépôt.
4. Netlify détectera Vite. Les réglages présents dans `netlify.toml` suffisent.
5. Déployer.

### Méthode manuelle

```bash
npm install
npm run build
```

Glisser ensuite le dossier `dist` dans Netlify Drop.

## Mode tablette / kiosque

Pour une tablette Android pilote :

1. Ouvrir `https://votre-site.netlify.app/#/display`.
2. Installer la PWA depuis Chrome si souhaité.
3. Verrouiller la tablette sur cette application avec le mode kiosque / épinglage d'application Android ou un MDM.
4. Prévoir une alimentation permanente et un support mural antivol.
5. Le mode public ne doit jamais recevoir de données nominatives, soldes individuels, impayés ou documents privés.

Le prototype revient automatiquement à l'écran d'accueil après 2 minutes d'inactivité.

## Passage en production : Supabase

Le stockage local doit être remplacé par Supabase avant tout pilote réel :

### Tables recommandées
- `buildings`
- `users`
- `building_members`
- `tickets`
- `ticket_updates`
- `announcements`
- `events`
- `documents`
- `audit_log`

### Rôles
- `resident`
- `council_member`
- `manager`
- `platform_admin`

### Sécurité impérative
- Row Level Security sur toutes les tables.
- Aucun document privé sur la vue publique.
- URL de tablette avec jeton de terminal à permissions limitées, pas un compte copropriétaire.
- Journalisation des modifications.
- Stockage privé pour les documents sensibles et URL signées à durée courte.
- Politique de conservation et contrat de sous-traitance RGPD à définir avant production.

## Principes produit retenus

1. **Une saisie, plusieurs canaux** : ne pas créer de double travail pour le syndic.
2. **Public ≠ privé** : l'écran du hall reste strictement non nominatif.
3. **L'historique appartient fonctionnellement à l'immeuble** : l'ACP conserve sa mémoire même si le syndic change.
4. **Le statut est plus utile que la performance du syndic** : montrer "planifié / en attente / résolu" plutôt qu'un tableau de contrôle accusateur.
5. **Le hardware est une interface, pas le produit** : la valeur est dans la continuité des données et des processus.

## Prochaines étapes recommandées

- Connecter Supabase et l'authentification réelle.
- Ajouter un système de permissions par immeuble.
- Stockage de documents avec URLs signées.
- Notifications e-mail / push.
- Ingestion d'e-mails entrants pour éviter la double saisie du syndic.
- Connecteurs/API avec logiciels métiers de syndic.
- Mode prestataire avec lien sécurisé pour confirmer une intervention.
- Journal technique / passeport bâtiment à long terme.
