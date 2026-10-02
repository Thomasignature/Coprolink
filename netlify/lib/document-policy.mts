import { createHash } from "node:crypto";

export const SAFE_DOCUMENT_TYPES: Record<string, string> = {
  PDF: "application/pdf", PNG: "image/png", JPG: "image/jpeg", JPEG: "image/jpeg", WEBP: "image/webp",
};

export const documentStoragePrefix = (buildingId: number) => `buildings/${buildingId}/`;

export const documentStoreName = (context = "dev", branch = "") => {
  const safeContext = context.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40) || "dev";
  const branchScope = safeContext === "production" || !branch ? "" : `-${branch.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 12)}-${createHash("sha256").update(branch).digest("hex").slice(0, 10)}`;
  return `coprolink-documents-${safeContext.slice(0, 20)}${branchScope}`;
};

export const documentBelongsToBuilding = (storageKey: string, buildingId: number) =>
  storageKey.startsWith(documentStoragePrefix(buildingId)) && !storageKey.includes("../");

export const mayReadDocument = (access: string, canReadPrivate: boolean, canReadOwners = false) =>
  access === "public" || (access === "owners" ? canReadOwners : canReadPrivate);

export const safeDownloadName = (value: string) => value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "document";
