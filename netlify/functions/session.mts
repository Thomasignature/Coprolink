import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { buildings } from "../../db/schema.js";
import { jsonError, listMemberships, resolvePrincipal } from "../lib/auth.mts";

/**
 * État de session. Renvoie 200 même sans session afin que le client puisse
 * afficher l'écran de connexion sans traiter une erreur.
 *
 * Les rôles renvoyés ici sont purement informatifs pour l'affichage : chaque
 * endpoint revérifie l'autorisation côté serveur.
 */
export default async (req: Request) => {
  try {
    const principal = await resolvePrincipal(req);

    if (!principal) {
      return Response.json({ authenticated: false }, { headers: { "cache-control": "no-store" } });
    }

    if (principal.kind === "terminal") {
      return Response.json(
        {
          authenticated: true,
          kind: "terminal",
          terminal: { label: principal.label, canReport: principal.canReport },
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const memberships = await listMemberships(principal.userId);

    // Un compte sans aucun rattachement doit savoir s'il peut installer le
    // premier immeuble ou s'il doit attendre qu'un syndic lui accorde l'accès.
    // Seuls des booléens sont exposés, jamais la valeur du jeton d'amorçage.
    let canBootstrap = false;
    let setupTokenRequired = false;
    if (memberships.length === 0) {
      setupTokenRequired = Boolean(Netlify.env.get("COPROLINK_SETUP_TOKEN"));
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(buildings);
      canBootstrap = count === 0 || principal.isPlatformAdmin || setupTokenRequired;
    }

    return Response.json(
      {
        authenticated: true,
        kind: "user",
        user: {
          email: principal.email,
          fullName: principal.fullName,
          isPlatformAdmin: principal.isPlatformAdmin,
        },
        memberships: memberships.map((m) => ({
          buildingSlug: m.buildingSlug,
          buildingName: m.buildingName,
          role: m.role,
          unitLabel: m.unitLabel,
        })),
        needsSetup: memberships.length === 0,
        canBootstrap,
        setupTokenRequired,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: "/api/session",
  method: "GET",
};
