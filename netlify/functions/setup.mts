import type { Config } from "@netlify/functions";
import { sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  announcements, buildingMembers, buildings, documents, events, tickets, ticketUpdates,
} from "../../db/schema.js";
import { buildingProfessionals } from "../../db/schema-v3.js";
import { HttpError, jsonError, requireUser } from "../lib/auth.mts";
import { readString } from "../lib/data.mts";

/**
 * Amorçage au premier démarrage : crée un immeuble et rattache l'appelant comme
 * gestionnaire. Sans cet endpoint, aucun compte ne pourrait obtenir le premier
 * rôle, puisque les rôles s'attribuent entre membres d'un immeuble existant.
 *
 * Deux verrous, dans cet ordre :
 *  1. Si la variable d'environnement `COPROLINK_SETUP_TOKEN` est définie, la
 *     requête doit présenter ce jeton dans l'en-tête `x-setup-token`.
 *  2. Sinon, l'amorçage n'est possible que tant qu'aucun immeuble n'existe.
 *     Ensuite, seul un `platform_admin` (rôle réglé dans l'interface Netlify)
 *     peut créer un immeuble supplémentaire.
 */
const slugify = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "immeuble";

export default async (req: Request) => {
  try {
    const principal = await requireUser(req);

    const expectedSetupToken = Netlify.env.get("COPROLINK_SETUP_TOKEN");
    if (expectedSetupToken) {
      const provided = req.headers.get("x-setup-token") ?? "";
      if (provided !== expectedSetupToken) {
        throw new HttpError(403, "Jeton d'amorçage invalide");
      }
    }

    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(buildings);
    const isFirstBuilding = count === 0;

    if (!isFirstBuilding && !principal.isPlatformAdmin && !expectedSetupToken) {
      throw new HttpError(
        403,
        "Un immeuble existe déjà. Seul un administrateur plateforme peut en créer un autre.",
      );
    }

    const body = await req.json().catch(() => ({}));
    const name = readString(body.name, "nom de l'immeuble", { max: 120 });
    const address = readString(body.address, "adresse", { max: 200, required: false });
    const lots = Number.isInteger(body.lots) && body.lots > 0 ? Math.min(body.lots, 5000) : 0;
    const withSampleData = body.withSampleData === true;
    const managerName = readString(body.managerName, "syndic", { max: 120, required: false });

    let slug = slugify(name);
    const [clash] = await db.select().from(buildings).where(sql`${buildings.slug} = ${slug}`).limit(1);
    if (clash) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const [building] = await db
      .insert(buildings)
      .values({
        slug,
        name,
        address,
        lots,
        managerName,
        emergencyPhone: readString(body.emergencyPhone, "urgence", { max: 40, required: false }),
        healthScore: 0,
      })
      .returning();

    await db.insert(buildingMembers).values({
      buildingId: building.id,
      userId: principal.userId,
      role: "manager",
      unitLabel: readString(body.unitLabel, "lot", { max: 80, required: false }),
    });

    if (managerName) {
      await db.insert(buildingProfessionals).values({
        buildingId: building.id,
        professionalType: "syndic",
        organizationName: managerName,
        contactName: principal.fullName || "",
        email: principal.email,
      });
    }

    if (withSampleData) {
      await seedSampleContent(building.id, principal.userId);
    }

    return Response.json(
      { buildingSlug: building.slug, buildingName: building.name, role: "manager" },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
};

/**
 * Contenu de démarrage, explicitement demandé par l'appelant. Sert à ce que
 * l'écran des communs ne soit pas vide le jour de l'installation.
 */
const seedSampleContent = async (buildingId: number, userId: string) => {
  const today = new Date();
  const inDays = (days: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  await db.insert(announcements).values({
    buildingId,
    title: "Bienvenue sur CoproLink",
    body: "Cet écran affiche les informations publiques de la résidence : interventions en cours, prochaines dates et documents pratiques.",
    priority: "normal",
    isPublic: true,
    authorUserId: userId,
  });

  await db.insert(events).values([
    { buildingId, title: "Maintenance ascenseur", detail: "Entretien trimestriel", eventDate: inDays(12), eventTime: "08:30", isPublic: true },
    { buildingId, title: "Nettoyage du parking", detail: "Niveau -1 à libérer", eventDate: inDays(29), eventTime: "07:00", isPublic: true },
  ]);

  await db.insert(documents).values([
    { buildingId, name: "Règlement d'ordre intérieur", fileType: "PDF", access: "public" },
    { buildingId, name: "Consignes incendie", fileType: "PDF", access: "public" },
    { buildingId, name: "PV Assemblée générale", fileType: "PDF", access: "private" },
  ]);

  const [sample] = await db
    .insert(tickets)
    .values({
      reference: `pending-${crypto.randomUUID()}`,
      buildingId,
      title: "Éclairage du hall",
      category: "Éclairage",
      location: "Rez-de-chaussée",
      description: "Deux spots hors service près des boîtes aux lettres.",
      status: "scheduled",
      isPublic: true,
      reporterLabel: "Exemple de démarrage",
      nextStep: "Intervention planifiée",
    })
    .returning();

  await db.update(tickets).set({ reference: `T-${1000 + sample.id}` }).where(sql`${tickets.id} = ${sample.id}`);
  await db.insert(ticketUpdates).values([
    { ticketId: sample.id, label: "Signalé", toStatus: "new", authorLabel: "Exemple de démarrage" },
    { ticketId: sample.id, label: "Rendez-vous confirmé", fromStatus: "new", toStatus: "scheduled", authorLabel: "Exemple de démarrage" },
  ]);
};

export const config: Config = {
  path: "/api/setup",
  method: "POST",
};
