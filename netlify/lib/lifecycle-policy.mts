export const RELATION_END_REASONS = ["sale", "lease_end", "move", "inheritance", "other"] as const;
export type RelationEndReason = (typeof RELATION_END_REASONS)[number];

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export const businessDate = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const validateRelationEnd = (relation: { startDate: string | null; endDate: string | null }, endDate: unknown, now = new Date()) => {
  if (relation.endDate) throw new Error("Une relation terminée est en lecture seule. Créez une nouvelle période pour un retour.");
  if (!isIsoDate(endDate)) throw new Error("Date de fin invalide");
  if (endDate > businessDate(now)) throw new Error("La date de fin ne peut pas être future");
  if (relation.startDate && endDate < relation.startDate) throw new Error("La fin ne peut pas précéder le début de la relation");
  return endDate;
};

export const readEndReason = (value: unknown): RelationEndReason => {
  if (typeof value !== "string" || !RELATION_END_REASONS.includes(value as RelationEndReason)) {
    throw new Error("Motif de fin invalide");
  }
  return value as RelationEndReason;
};

export const shouldRevokeBuildingAccess = (activeRelationCount: number) => activeRelationCount === 0;

export const canPermanentlyDeletePerson = (references: {
  relations: number;
  referents: number;
  assemblyResponses: number;
  activeAccess: number;
}) => Object.values(references).every((count) => count === 0);

export const capabilitiesForRelations = (relationTypes: Iterable<string>) => {
  const relations = new Set(relationTypes);
  const capabilities: string[] = [];
  if (relations.has("owner")) capabilities.push("resident:owner", "finance:read:own", "documents:read:owners", "assemblies:respond");
  if (relations.has("tenant")) capabilities.push("resident:tenant");
  if (relations.has("occupant")) capabilities.push("resident:occupant");
  return capabilities;
};
