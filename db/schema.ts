import {
  pgTable, serial, text, integer, boolean, timestamp, date, numeric, index, uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Rôles applicatifs. Le rôle est porté par l'appartenance à un immeuble
 * (`building_members`), pas par l'utilisateur : un même compte peut être
 * gestionnaire de l'immeuble A et copropriétaire de l'immeuble B.
 *
 * `platform_admin` est la seule exception : il est porté par Netlify Identity
 * (`app_metadata.roles`) car il n'est pas lié à un immeuble.
 */
export const ROLES = ["resident", "council_member", "manager", "platform_admin"] as const;
export type Role = (typeof ROLES)[number];

export const TICKET_STATUSES = ["new", "in_progress", "waiting", "scheduled", "resolved"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const buildings = pgTable("buildings", {
  id: serial().primaryKey(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  address: text().notNull().default(""),
  lots: integer().notNull().default(0),
  managerName: text("manager_name").notNull().default(""),
  emergencyPhone: text("emergency_phone").notNull().default(""),
  reserveFund: numeric("reserve_fund", { precision: 12, scale: 2 }).notNull().default("0"),
  yearlyBudget: numeric("yearly_budget", { precision: 12, scale: 2 }).notNull().default("0"),
  yearlySpent: numeric("yearly_spent", { precision: 12, scale: 2 }).notNull().default("0"),
  healthScore: integer("health_score").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Miroir local des comptes Netlify Identity. Identity reste la source de vérité
 * pour l'authentification ; cette table sert de cible de clé étrangère et porte
 * le profil métier (nom affiché).
 */
export const users = pgTable("users", {
  id: text().primaryKey(), // identifiant Netlify Identity
  email: text().notNull(),
  fullName: text("full_name").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at"),
});

export const buildingMembers = pgTable("building_members", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text().notNull().default("resident"),
  unitLabel: text("unit_label").notNull().default(""),
  shareLabel: text("share_label").notNull().default(""),
  quarterlyCall: numeric("quarterly_call", { precision: 10, scale: 2 }).notNull().default("0"),
  balance: numeric({ precision: 10, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("building_members_building_user_idx").on(t.buildingId, t.userId),
  index("building_members_user_idx").on(t.userId),
]);

/**
 * Copropriétaires ajoutés par le syndic dont le compte Netlify Identity n'existe
 * pas encore (ou n'a pas pu être créé depuis la fonction, faute de jeton
 * opérateur sur le déploiement).
 *
 * L'appartenance est donc décidée AVANT que le compte n'existe : elle est
 * convertie en ligne de `building_members` dès la première connexion de cette
 * adresse (voir `claimPendingMemberships` dans auth.mts). Le syndic n'a ainsi
 * jamais besoin de passer par le tableau de bord Netlify.
 *
 * Pourquoi c'est sûr : Identity vérifie l'adresse (lien de confirmation ou
 * d'invitation) avant d'ouvrir une session, donc seule la personne qui contrôle
 * réellement la boîte peut réclamer l'accès préparé ici.
 */
export const pendingMembers = pgTable("pending_members", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  email: text().notNull(),
  role: text().notNull().default("resident"),
  unitLabel: text("unit_label").notNull().default(""),
  shareLabel: text("share_label").notNull().default(""),
  fullName: text("full_name").notNull().default(""),
  /** `true` quand l'e-mail d'invitation Identity a bien été envoyé. */
  invitationSent: boolean("invitation_sent").notNull().default(false),
  invitedByUserId: text("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("pending_members_building_email_idx").on(t.buildingId, t.email),
  index("pending_members_email_idx").on(t.email),
]);

export const tickets = pgTable("tickets", {
  id: serial().primaryKey(),
  reference: text().notNull().unique(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  title: text().notNull(),
  category: text().notNull().default("Autre"),
  location: text().notNull().default(""),
  description: text().notNull().default(""),
  status: text().notNull().default("new"),
  /** Visible sur l'écran des communs. Jamais nominatif côté public. */
  isPublic: boolean("is_public").notNull().default(true),
  /** Libellé non nominatif affichable côté syndic (ex. « Écran du hall »). */
  reporterLabel: text("reporter_label").notNull().default(""),
  reporterUserId: text("reporter_user_id").references(() => users.id, { onDelete: "set null" }),
  /** Terminal à l'origine du signalement, le cas échéant. */
  reporterTerminalId: integer("reporter_terminal_id"),
  nextStep: text("next_step").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("tickets_building_status_idx").on(t.buildingId, t.status),
  index("tickets_reporter_idx").on(t.reporterUserId),
]);

/** Historique d'un ticket. Écrit à chaque changement de statut, jamais modifié. */
export const ticketUpdates = pgTable("ticket_updates", {
  id: serial().primaryKey(),
  ticketId: integer("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  label: text().notNull(),
  note: text().notNull().default(""),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
  authorLabel: text("author_label").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("ticket_updates_ticket_idx").on(t.ticketId)]);

export const announcements = pgTable("announcements", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  title: text().notNull(),
  body: text().notNull().default(""),
  priority: text().notNull().default("normal"),
  isPublic: boolean("is_public").notNull().default(true),
  authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
  publishedOn: date("published_on").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("announcements_building_idx").on(t.buildingId)]);

export const events = pgTable("events", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  title: text().notNull(),
  detail: text().notNull().default(""),
  eventDate: date("event_date").notNull(),
  eventTime: text("event_time").notNull().default(""),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("events_building_date_idx").on(t.buildingId, t.eventDate)]);

/**
 * Métadonnées documentaires. Le contenu binaire n'est pas encore stocké :
 * `storageKey` est réservé pour le passage à Netlify Blobs avec URLs signées.
 */
export const documents = pgTable("documents", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  name: text().notNull(),
  fileType: text("file_type").notNull().default("PDF"),
  /** "public" = affichable dans les communs. "private" = copropriétaires connectés. */
  access: text().notNull().default("private"),
  storageKey: text("storage_key"),
  updatedOn: date("updated_on").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("documents_building_access_idx").on(t.buildingId, t.access)]);

/**
 * Terminaux physiques installés dans les communs. Chaque tablette reçoit un
 * jeton propre, stocké haché, révocable, sans compte utilisateur associé.
 */
export const terminals = pgTable("terminals", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  label: text().notNull(),
  /** SHA-256 du jeton. Le jeton en clair n'est affiché qu'une fois, à la création. */
  tokenHash: text("token_hash").notNull().unique(),
  /** Aide au support : 6 derniers caractères du jeton, pour identifier une tablette. */
  tokenHint: text("token_hint").notNull().default(""),
  /**
   * Autorise la création de nouveaux signalements depuis ce terminal.
   * Le jeton reste en lecture seule sur toutes les données existantes :
   * aucune modification, aucun accès aux données privées, quelle que soit
   * la valeur de ce drapeau.
   */
  canReport: boolean("can_report").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at"),
  revokedAt: timestamp("revoked_at"),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("terminals_building_idx").on(t.buildingId)]);

/** Journal d'audit. Append-only : trace qui a fait quoi, et survit au syndic. */
export const auditLog = pgTable("audit_log", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").references(() => buildings.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorLabel: text("actor_label").notNull().default(""),
  actorRole: text("actor_role").notNull().default(""),
  action: text().notNull(),
  entityType: text("entity_type").notNull().default(""),
  entityId: text("entity_id").notNull().default(""),
  summary: text().notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("audit_log_building_idx").on(t.buildingId, t.createdAt)]);
