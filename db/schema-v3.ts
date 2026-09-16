import {
  pgTable, serial, text, integer, boolean, timestamp, date, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { buildings, users, events } from "./schema.js";

export const RELATION_TYPES = ["owner", "occupant", "tenant"] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const PROFESSIONAL_TYPES = ["syndic", "provider", "insurance", "maintenance", "other"] as const;
export type ProfessionalType = (typeof PROFESSIONAL_TYPES)[number];

export const buildingUnits = pgTable("building_units", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  label: text().notNull(),
  floor: text().notNull().default(""),
  displayOrder: integer("display_order").notNull().default(0),
  shareLabel: text("share_label").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("building_units_building_label_idx").on(t.buildingId, t.label),
  index("building_units_building_floor_idx").on(t.buildingId, t.floor),
]);

export const buildingPeople = pgTable("building_people", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull().default(""),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("building_people_building_user_idx").on(t.buildingId, t.userId),
  index("building_people_building_name_idx").on(t.buildingId, t.fullName),
]);

export const unitPersonRelations = pgTable("unit_person_relations", {
  id: serial().primaryKey(),
  unitId: integer("unit_id").notNull().references(() => buildingUnits.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => buildingPeople.id, { onDelete: "cascade" }),
  relationType: text("relation_type").notNull(),
  shareLabel: text("share_label").notNull().default(""),
  startDate: date("start_date"),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("unit_person_relations_unit_idx").on(t.unitId),
  index("unit_person_relations_person_idx").on(t.personId),
]);

export const buildingReferents = pgTable("building_referents", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  personId: integer("person_id").notNull().references(() => buildingPeople.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").notNull().default(false),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
}, (t) => [index("building_referents_building_idx").on(t.buildingId)]);

export const buildingProfessionals = pgTable("building_professionals", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  professionalType: text("professional_type").notNull(),
  organizationName: text("organization_name").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  startedAt: date("started_at"),
  endedAt: date("ended_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("building_professionals_building_type_idx").on(t.buildingId, t.professionalType)]);

export const personVisibilityPreferences = pgTable("person_visibility_preferences", {
  personId: integer("person_id").primaryKey().references(() => buildingPeople.id, { onDelete: "cascade" }),
  directoryVisible: boolean("directory_visible").notNull().default(true),
  hallVisible: boolean("hall_visible").notNull().default(false),
  showEmail: boolean("show_email").notNull().default(false),
  showPhone: boolean("show_phone").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * E-mails entrants reçus par l'adresse Resend de l'immeuble.
 * Les actions métier proposées par CoproLink restent soumises à validation
 * humaine. Leur résultat est persisté pour éviter toute double exécution.
 */
export const inboundEmails = pgTable("inbound_emails", {
  id: serial().primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id, { onDelete: "cascade" }),
  provider: text().notNull().default("resend"),
  providerEmailId: text("provider_email_id").notNull(),
  messageId: text("message_id").notNull().default(""),
  fromAddress: text("from_address").notNull().default(""),
  fromName: text("from_name").notNull().default(""),
  toAddress: text("to_address").notNull().default(""),
  subject: text().notNull().default(""),
  textBody: text("text_body").notNull().default(""),
  htmlBody: text("html_body").notNull().default(""),
  attachmentsJson: text("attachments_json").notNull().default("[]"),
  rawEventJson: text("raw_event_json").notNull().default("{}"),
  processingStatus: text("processing_status").notNull().default("received"),
  calendarActionStatus: text("calendar_action_status").notNull().default("pending"),
  calendarEventId: integer("calendar_event_id").references(() => events.id, { onDelete: "set null" }),
  calendarActionedAt: timestamp("calendar_actioned_at"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("inbound_emails_provider_email_idx").on(t.provider, t.providerEmailId),
  index("inbound_emails_building_received_idx").on(t.buildingId, t.receivedAt),
]);