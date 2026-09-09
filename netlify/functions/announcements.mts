import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { announcements } from "../../db/schema.js";
import { authorize, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

/**
 * Publication d'une communication. Réservée à `announcements:manage`,
 * c'est-à-dire au gestionnaire de l'immeuble concerné.
 *
 * `isPublic` détermine la diffusion sur l'écran des communs ; le contenu est
 * saisi par le syndic, donc maîtrisé.
 */
export default async (req: Request) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "announcements:manage",
    });

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

    return Response.json(
      {
        id: created.id,
        title: created.title,
        body: created.body,
        priority: created.priority,
        isPublic: created.isPublic,
        publishedOn: created.publishedOn,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/announcements",
  method: "POST",
};
