import {
  pgTable, serial, text, integer, boolean, timestamp, date, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { buildings, users } from "./schema.js";

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
