import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { announcements } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

/**
 * Publication d'une communication. Réservée à `announcements:manage`,
 * c'est-à-dire au gestionnaire de l'immeuble concerné.
 *
 * `isPublic` détermine la diffusion sur l'écran des communs ; le contenu est
 * saisi par le syndic, donc maîtrisé.
 *
 * PATCH / DELETE `/api/announcements/:id` corrigent ou retirent une
 * communication, avec la même capacité et toujours bornés à l'immeuble.
 */
const serialize = (row: typeof announcements.$inferSelect) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  priority: row.priority,
  isPublic: row.isPublic,
  publishedOn: row.publishedOn,
});

export default async (req: Request, context: Context) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "announcements:manage",
    });

    if (context.params?.id) {
      const id = Number(context.params.id);
      const scope = and(eq(announcements.id, id), eq(announcements.buildingId, ctx.buildingId));
      const [existing] = Number.isInteger(id) ? await db.select().from(announcements).where(scope).limit(1) : [];
      if (!existing) throw new HttpError(404, "Communication introuvable");

      if (req.method === "DELETE") {
        await db.delete(announcements).where(scope);
        await writeAudit(ctx, {
          action: "announcement.deleted",
          entityType: "announcement",
          entityId: id,
          summary: `Communication « ${existing.title} » retirée.`,
        });
        return Response.json({ id, removed: true });
      }

      if (req.method !== "PATCH") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
      const patch = await req.json().catch(() => ({}));
      const [updated] = await db.update(announcements).set({
        title: patch.title === undefined ? existing.title : readString(patch.title, "titre", { max: 120 }),
        body: patch.body === undefined ? existing.body : readString(patch.body, "message", { max: 1000 }),
        priority: patch.priority === undefined ? existing.priority : patch.priority === "important" ? "important" : "normal",
        isPublic: patch.isPublic === undefined ? existing.isPublic : patch.isPublic !== false,
      }).where(scope).returning();
      await writeAudit(ctx, {
        action: "announcement.updated",
        entityType: "announcement",
        entityId: id,
        summary: `Communication « ${updated.title} » modifiée.`,
      });
      return Response.json(serialize(updated));
    }

    if (req.method !== "POST") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    const title = readString(body.title, "titre", { max: 120 });
    const text = readString(body.body, "message", { max: 1000 });
    const priority = body.priority === "important" ? "important" : "normal";
    const isPublic = body.isPublic !== false;

    const [created] = await db
      .insert(announcements)
      .values({
        buildingId: ctx.buildingId,
        title,
        body: text,
        priority,
        isPublic,
        authorUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
      })
      .returning();

    await writeAudit(ctx, {
      action: "announcement.published",
      entityType: "announcement",
      entityId: created.id,
      summary: `Communication « ${title} » publiée${isPublic ? " sur l'app et l'écran du hall" : " dans l'app uniquement"}.`,
    });

    return Response.json(serialize(created), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: ["/api/announcements", "/api/announcements/:id"],
  method: ["POST", "PATCH", "DELETE"],
};
