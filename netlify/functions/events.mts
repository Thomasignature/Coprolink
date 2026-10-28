import type { Config, Context } from "@netlify/functions";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { events } from "../../db/schema.js";
import { authorize, HttpError, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";
import { isIsoDate } from "../lib/lifecycle-policy.mts";

const serialize = (row: typeof events.$inferSelect) => ({
  id: row.id,
  title: row.title,
  detail: row.detail,
  eventDate: row.eventDate,
  eventTime: row.eventTime,
  isPublic: row.isPublic,
});

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const readTime = (value: unknown) => {
  const time = readString(value, "heure", { max: 5, required: false });
  if (time && !TIME_PATTERN.test(time)) throw new HttpError(422, "Heure attendue au format HH:MM");
  return time;
};

/**
 * Agenda de l'immeuble. Réservé à `events:manage`.
 * POST ajoute une date ; PATCH / DELETE `/api/events/:id` la corrigent ou la retirent.
 */
export default async (req: Request, context: Context) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "events:manage",
    });

    if (context.params?.id) {
      const id = Number(context.params.id);
      const scope = and(eq(events.id, id), eq(events.buildingId, ctx.buildingId));
      const [existing] = Number.isInteger(id) ? await db.select().from(events).where(scope).limit(1) : [];
      if (!existing) throw new HttpError(404, "Date introuvable");

      if (req.method === "DELETE") {
        await db.delete(events).where(scope);
        await writeAudit(ctx, {
          action: "event.deleted",
          entityType: "event",
          entityId: id,
          summary: `Date « ${existing.title} » retirée de l'agenda.`,
        });
        return Response.json({ id, removed: true });
      }

      if (req.method !== "PATCH") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
      const patch = await req.json().catch(() => ({}));
      const eventDate = patch.eventDate === undefined ? existing.eventDate : readString(patch.eventDate, "date", { max: 10 });
      if (!isIsoDate(eventDate)) throw new HttpError(422, "Date attendue au format AAAA-MM-JJ");
      const [updated] = await db.update(events).set({
        title: patch.title === undefined ? existing.title : readString(patch.title, "titre", { max: 120 }),
        detail: patch.detail === undefined ? existing.detail : readString(patch.detail, "détail", { max: 300, required: false }),
        eventDate,
        eventTime: patch.eventTime === undefined || patch.eventTime === existing.eventTime ? existing.eventTime : readTime(patch.eventTime),
        isPublic: patch.isPublic === undefined ? existing.isPublic : patch.isPublic !== false,
      }).where(scope).returning();
      await writeAudit(ctx, {
        action: "event.updated",
        entityType: "event",
        entityId: id,
        summary: `Date « ${updated.title} » modifiée (${updated.eventDate}).`,
      });
      return Response.json(serialize(updated));
    }

    if (req.method !== "POST") return Response.json({ error: "Méthode non autorisée" }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    const title = readString(body.title, "titre", { max: 120 });
    const detail = readString(body.detail, "détail", { max: 300, required: false });
    const eventDate = readString(body.eventDate, "date", { max: 10 });
    const eventTime = readTime(body.eventTime);

    if (!isIsoDate(eventDate)) {
      return Response.json({ error: "Date attendue au format AAAA-MM-JJ" }, { status: 422 });
    }

    const [created] = await db
      .insert(events)
      .values({
        buildingId: ctx.buildingId,
        title,
        detail,
        eventDate,
        eventTime,
        isPublic: body.isPublic !== false,
      })
      .returning();

    await writeAudit(ctx, {
      action: "event.created",
      entityType: "event",
      entityId: created.id,
      summary: `Date « ${title} » ajoutée à l'agenda pour le ${eventDate}.`,
    });

    return Response.json(serialize(created), { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: ["/api/events", "/api/events/:id"],
  method: ["POST", "PATCH", "DELETE"],
};
