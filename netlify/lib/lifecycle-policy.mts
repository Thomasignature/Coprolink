export const RELATION_END_REASONS = ["sale", "lease_end", "move", "inheritance", "other"] as const;
export type RelationEndReason = (typeof RELATION_END_REASONS)[number];

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

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
