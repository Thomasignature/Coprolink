import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { documents } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

/**
 * Fichiers des documents de l'immeuble, stockés dans Netlify Blobs.
 *
 * - POST   /api/documents          téléversement (multipart) — `documents:manage`
 * - GET    /api/documents/:id      téléchargement — membre de l'immeuble ; un
 *                                  document privé exige `documents:read:private` ;
 *                                  un écran des communs n'obtient que les publics
 * - PATCH  /api/documents/:id      nom, dossier, visibilité — `documents:manage`
 * - DELETE /api/documents/:id      fiche + fichier — `documents:manage`
 *
 * La clé du fichier est générée côté serveur et préfixée par l'immeuble : un
 * client ne choisit jamais l'emplacement ni ne lit la clé d'un autre immeuble.
 */

const MAX_BYTES = 15 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
};

/** Types affichables directement dans le navigateur ; les autres sont téléchargés. */
const INLINE_EXTENSIONS = new Set(["pdf", "png", "jpg", "jpeg", "webp", "txt"]);

const documentStore = () => getStore({ name: "building-documents", consistency: "strong" });

const extensionOf = (fileName: string) => {
  const match = /\.([a-z0-9]{1,5})$/i.exec(fileName);
  return match ? match[1].toLowerCase() : "";
};

const readAccess = (value: unknown) => (value === "public" ? "public" : "private");

const serialize = (row: typeof documents.$inferSelect) => ({
  id: row.id,
  name: row.name,
  fileType: row.fileType,
  folder: row.folder,
  access: row.access,
  updatedOn: row.updatedOn,
  available: row.storageKey !== null,
});

const findDocument = async (buildingId: number, id: number) => {
  const [row] = await db.select().from(documents)
    .where(and(eq(documents.id, id), eq(documents.buildingId, buildingId))).limit(1);
  if (!row) throw new HttpError(404, "Document introuvable");
  return row;
};

const readDocumentId = (context: Context) => {
  const id = Number(context.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "Document introuvable");
  return id;
};

const upload = async (req: Request) => {
  const ctx = await authorize(req, { buildingSlug: readBuildingSlug(req), require: "documents:manage" });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File) || file.size === 0) throw new HttpError(422, "Fichier manquant");
  if (file.size > MAX_BYTES) throw new HttpError(413, "Fichier trop volumineux (15 Mo maximum)");

  const extension = extensionOf(file.name);
  if (!MIME_BY_EXTENSION[extension]) {
    throw new HttpError(415, "Format non accepté (PDF, image, texte, Word, Excel ou OpenDocument)");
  }

  const name = readString(form.get("name"), "nom", { max: 160, required: false }) || file.name.replace(/\.[^.]+$/, "").slice(0, 160);
  const folder = readString(form.get("folder"), "dossier", { max: 80, required: false }) || "Documents de l'immeuble";
  const access = readAccess(form.get("access"));
  const storageKey = `buildings/${ctx.buildingId}/${crypto.randomUUID()}.${extension}`;

  await documentStore().set(storageKey, await file.arrayBuffer());

  let created;
  try {
    [created] = await db.insert(documents).values({
      buildingId: ctx.buildingId,
      name,
      fileType: extension.toUpperCase(),
      folder,
      access,
      storageKey,
    }).returning();
  } catch (error) {
    // Pas de fichier orphelin si l'écriture en base échoue.
    await documentStore().delete(storageKey).catch(() => {});
    throw error;
  }

  await writeAudit(ctx, {
    action: "document.uploaded",
    entityType: "document",
    entityId: created.id,
    summary: `Document « ${name} » ajouté (${access === "public" ? "public" : "privé"}).`,
  });

  return Response.json(serialize(created), { status: 201 });
};

const download = async (req: Request, context: Context) => {
  const ctx = await authorize(req, { buildingSlug: readBuildingSlug(req) });
  const row = await findDocument(ctx.buildingId, readDocumentId(context));

  const allowed = ctx.principal.kind === "terminal"
    ? row.access === "public"
    : ctx.can("building:read") && (row.access === "public" || ctx.can("documents:read:private"));
  // 404 plutôt que 403 : on ne confirme pas l'existence d'un document non autorisé.
  if (!allowed) throw new HttpError(404, "Document introuvable");
  if (!row.storageKey) throw new HttpError(404, "Aucun fichier n'est encore associé à ce document");

  const data = await documentStore().get(row.storageKey, { type: "stream" });
  if (!data) throw new HttpError(404, "Fichier introuvable");

  const extension = extensionOf(row.storageKey);
  const fileName = `${row.name.replace(/[\r\n"\\/]/g, " ").trim() || "document"}.${extension}`;
  const disposition = INLINE_EXTENSIONS.has(extension) ? "inline" : "attachment";

  return new Response(data, {
    headers: {
      "content-type": MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
      "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
};

const update = async (req: Request, context: Context) => {
  const ctx = await authorize(req, { buildingSlug: readBuildingSlug(req), require: "documents:manage" });
  const row = await findDocument(ctx.buildingId, readDocumentId(context));
  const body = await req.json().catch(() => ({}));

  const [updated] = await db.update(documents).set({
    name: body.name === undefined ? row.name : readString(body.name, "nom", { max: 160 }),
    folder: body.folder === undefined ? row.folder : readString(body.folder, "dossier", { max: 80 }),
    access: body.access === undefined ? row.access : readAccess(body.access),
  }).where(eq(documents.id, row.id)).returning();

  await writeAudit(ctx, {
    action: "document.updated",
    entityType: "document",
    entityId: row.id,
    summary: `Document « ${updated.name} » mis à jour (${updated.access === "public" ? "public" : "privé"}).`,
  });

  return Response.json(serialize(updated));
};

const remove = async (req: Request, context: Context) => {
  const ctx = await authorize(req, { buildingSlug: readBuildingSlug(req), require: "documents:manage" });
  const row = await findDocument(ctx.buildingId, readDocumentId(context));

  await db.delete(documents).where(eq(documents.id, row.id));
  if (row.storageKey) {
    await documentStore().delete(row.storageKey).catch((error) => console.error("Suppression du fichier impossible:", error));
  }

  await writeAudit(ctx, {
    action: "document.deleted",
    entityType: "document",
    entityId: row.id,
    summary: `Document « ${row.name} » supprimé.`,
  });

  return Response.json({ id: row.id, removed: true });
};

export default async (req: Request, context: Context) => {
  try {
    if (req.method === "POST" && !context.params?.id) return await upload(req);
    if (req.method === "GET" && context.params?.id) return await download(req, context);
    if (req.method === "PATCH" && context.params?.id) return await update(req, context);
    if (req.method === "DELETE" && context.params?.id) return await remove(req, context);
    return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: ["/api/documents", "/api/documents/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
