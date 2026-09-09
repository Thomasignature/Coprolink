import type { Config } from "@netlify/functions";
import { db } from "../../db/index.js";
import { events } from "../../db/schema.js";
import { authorize, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

/** Ajout d'une date à l'agenda de l'immeuble. Réservé à `events:manage`. */
export default async (req: Request) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "events:manage",
    });

    const body = await req.json().catch(() => ({}));
    const title = readString(body.title, "titre", { max: 120 });
    const detail = readString(body.detail, "détail", { max: 300, required: false });
    const eventDate = readString(body.eventDate, "date", { max: 10 });
    const eventTime = readString(body.eventTime, "heure", { max: 5, required: false });

    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
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

    return Response.json(
      {
        id: created.id,
        title: created.title,
        detail: created.detail,
        eventDate: created.eventDate,
        eventTime: created.eventTime,
        isPublic: created.isPublic,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/events",
  method: "POST",
};
