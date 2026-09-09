import type { Config, Context } from "@netlify/functions";
import { authorize, jsonError, readBuildingSlug } from "../lib/auth.mts";
import {
  assertTicketStatus, changeTicketStatus, createTicket, loadTicketTimeline, readString,
  serializeTicket,
} from "../lib/data.mts";

/**
 * Création et mise à jour des signalements.
 *
 * - `POST` exige la capacité `tickets:create` : tous les rôles d'immeuble
 *   l'ont, ainsi qu'un terminal dont `can_report` est actif.
 * - `PATCH` exige `tickets:update`, accordée au seul gestionnaire (et à
 *   `platform_admin`). Un copropriétaire ou un terminal reçoit un 403, quel que
 *   soit le contenu de sa requête.
 */
export default async (req: Request, context: Context) => {
  try {
    if (req.method === "POST") {
      const ctx = await authorize(req, {
        buildingSlug: readBuildingSlug(req),
        require: "tickets:create",
      });

      const body = await req.json().catch(() => ({}));
      const category = readString(body.category, "catégorie", { max: 60 });

      const ticket = await createTicket(ctx, {
        title: readString(body.title, "titre", { max: 120, required: false }) || category,
        category,
        location: readString(body.location, "emplacement", { max: 120 }),
        description: readString(body.description, "description", { max: 1000 }),
        // Un terminal ne choisit pas la visibilité : un signalement fait dans les
        // communs concerne les communs et suit donc le canal public.
        isPublic: ctx.principal.kind === "terminal" ? true : body.isPublic !== false,
      });

      const timelines = await loadTicketTimeline([ticket.id]);
      return Response.json(serializeTicket(ticket, timelines.get(ticket.id) ?? []), { status: 201 });
    }

    if (req.method === "PATCH") {
      const reference = context.params.reference;
      if (!reference) return Response.json({ error: "Référence de ticket manquante" }, { status: 400 });

      const ctx = await authorize(req, {
        buildingSlug: readBuildingSlug(req),
        require: "tickets:update",
      });

      const body = await req.json().catch(() => ({}));
      const status = assertTicketStatus(body.status);
      const note = readString(body.note, "note", { max: 500, required: false });

      const ticket = await changeTicketStatus(ctx, reference, status, note);
      const timelines = await loadTicketTimeline([ticket.id]);
      return Response.json(serializeTicket(ticket, timelines.get(ticket.id) ?? []));
    }

    return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: ["/api/tickets", "/api/tickets/:reference"],
  method: ["POST", "PATCH"],
};
