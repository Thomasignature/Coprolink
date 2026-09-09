import type { Config, Context } from "@netlify/functions";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { terminals } from "../../db/schema.js";
import { authorize, generateTerminalToken, jsonError, readBuildingSlug } from "../lib/auth.mts";
import { readString, writeAudit } from "../lib/data.mts";

/**
 * Gestion des jetons de terminal pour les tablettes installées dans les communs.
 * Réservé à `terminals:manage` (gestionnaire de l'immeuble).
 *
 * Le jeton en clair n'existe que dans la réponse de création : seul son SHA-256
 * est conservé en base. Il est donc impossible de le retrouver après coup — une
 * tablette perdue se traite par révocation et création d'un nouveau jeton.
 */
export default async (req: Request, context: Context) => {
  try {
    const ctx = await authorize(req, {
      buildingSlug: readBuildingSlug(req),
      require: "terminals:manage",
    });

    if (req.method === "GET") {
      const rows = await db
        .select()
        .from(terminals)
        .where(eq(terminals.buildingId, ctx.buildingId))
        .orderBy(desc(terminals.createdAt));

      return Response.json(
        {
          terminals: rows.map((t) => ({
            id: t.id,
            label: t.label,
            tokenHint: t.tokenHint,
            canReport: t.canReport,
            lastSeenAt: t.lastSeenAt?.toISOString() ?? null,
            revokedAt: t.revokedAt?.toISOString() ?? null,
          })),
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const label = readString(body.label, "libellé", { max: 80 });
      const canReport = body.canReport !== false;

      const { token, tokenHash, tokenHint } = generateTerminalToken();

      const [created] = await db
        .insert(terminals)
        .values({
          buildingId: ctx.buildingId,
          label,
          tokenHash,
          tokenHint,
          canReport,
          createdByUserId: ctx.principal.kind === "user" ? ctx.principal.userId : null,
        })
        .returning();

      await writeAudit(ctx, {
        action: "terminal.created",
        entityType: "terminal",
        entityId: created.id,
        summary: `Jeton de terminal créé pour « ${label} » (signalement ${canReport ? "autorisé" : "désactivé"}).`,
      });

      return Response.json(
        {
          id: created.id,
          label: created.label,
          canReport: created.canReport,
          tokenHint: created.tokenHint,
          // Affiché une seule fois. Non récupérable ensuite.
          token,
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    }

    const terminalId = Number(context.params.id);
    if (!Number.isInteger(terminalId)) {
      return Response.json({ error: "Identifiant de terminal invalide" }, { status: 400 });
    }

    // Le filtre sur buildingId empêche d'agir sur le terminal d'un autre immeuble.
    const scope = and(eq(terminals.id, terminalId), eq(terminals.buildingId, ctx.buildingId));

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const [updated] = await db
        .update(terminals)
        .set({ canReport: body.canReport === true })
        .where(scope)
        .returning();

      if (!updated) return Response.json({ error: "Terminal introuvable" }, { status: 404 });

      await writeAudit(ctx, {
        action: "terminal.updated",
        entityType: "terminal",
        entityId: updated.id,
        summary: `Signalement depuis « ${updated.label} » ${updated.canReport ? "autorisé" : "désactivé"}.`,
      });

      return Response.json({ id: updated.id, label: updated.label, canReport: updated.canReport });
    }

    if (req.method === "DELETE") {
      const [revoked] = await db
        .update(terminals)
        .set({ revokedAt: new Date() })
        .where(scope)
        .returning();

      if (!revoked) return Response.json({ error: "Terminal introuvable" }, { status: 404 });

      await writeAudit(ctx, {
        action: "terminal.revoked",
        entityType: "terminal",
        entityId: revoked.id,
        summary: `Jeton du terminal « ${revoked.label} » révoqué.`,
      });

      return Response.json({ id: revoked.id, revoked: true });
    }

    return Response.json({ error: "Méthode non autorisée" }, { status: 405 });
  } catch (error) {
    return jsonError(error);
  }
};

export const config: Config = {
  path: ["/api/terminals", "/api/terminals/:id"],
  method: ["GET", "POST", "PATCH", "DELETE"],
};
