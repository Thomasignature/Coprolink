import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { documents } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { documentBelongsToBuilding, documentStoreName, mayReadDocument, SAFE_DOCUMENT_TYPES, safeDownloadName } from "../lib/document-policy.mts";

export default async (req: Request, context: Context) => {
  try {
    if (req.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
    const ctx = await authorize(req, { buildingSlug: readBuildingSlug(req), require: "building:read" });
    const id = Number(context.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(422, "Document invalide");

    const [document] = await db.select().from(documents)
      .where(and(eq(documents.id, id), eq(documents.buildingId, ctx.buildingId))).limit(1);
    if (!document) throw new HttpError(404, "Document introuvable");
    if (!mayReadDocument(document.access, ctx.can("documents:read:private"))) {
      throw new HttpError(403, "Vous n’avez pas accès à ce document");
    }
    if (!document.storageKey) throw new HttpError(404, "Le fichier n’a pas encore été déposé");

    if (!documentBelongsToBuilding(document.storageKey, ctx.buildingId)) throw new HttpError(409, "Clé de stockage du document invalide");
    const contentType = SAFE_DOCUMENT_TYPES[document.fileType.toUpperCase()];
    if (!contentType) throw new HttpError(415, "Type de document non autorisé");

    // The Netlify deploy context is part of the store name so a deploy preview
    // never reads production blobs, even when both belong to the same site.
    const store = getStore(documentStoreName(Netlify.env.get("CONTEXT") || "dev"));
    const stored = await store.get(document.storageKey, { type: "arrayBuffer" });
    if (!stored) throw new HttpError(404, "Le fichier stocké est introuvable");
    return new Response(stored, {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${safeDownloadName(document.name)}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = { path: "/api/documents/:id", method: "GET" };
