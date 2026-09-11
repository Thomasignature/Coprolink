import { admin, getIdentityConfig, type User } from "@netlify/identity";
import { HttpError } from "./auth.mts";

/**
 * Administration des comptes Netlify Identity.
 *
 * Identity reste la source de vérité de l'authentification ; ce module ne fait
 * que créer et retrouver des comptes. Le rôle applicatif ne s'écrit jamais ici :
 * il vit dans `building_members` (voir auth.mts).
 */

export type IdentityAccount = {
  id: string;
  email: string;
  fullName: string;
  /** `false` tant que la personne n'a pas ouvert son lien d'invitation. */
  activated: boolean;
};

const PAGE_SIZE = 100;
/** Garde-fou de pagination : une copropriété n'a pas 2 000 comptes. */
const MAX_PAGES = 20;

const toAccount = (user: User): IdentityAccount => ({
  id: user.id,
  email: (user.email ?? "").toLowerCase(),
  fullName: user.name ?? (user.userMetadata?.full_name as string | undefined) ?? "",
  activated: Boolean(user.confirmedAt),
});

/** Tous les comptes Identity du projet, pagination comprise. */
const listIdentityUsers = async (): Promise<User[]> => {
  const users: User[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await admin.listUsers({ page, perPage: PAGE_SIZE });
    if (!batch || batch.length === 0) break;
    users.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return users;
};

export const findAccountByEmail = async (email: string): Promise<IdentityAccount | null> => {
  const needle = email.toLowerCase();
  const match = (await listIdentityUsers()).find((u) => (u.email ?? "").toLowerCase() === needle);
  return match ? toAccount(match) : null;
};

/** État d'activation de chaque compte, indexé par identifiant Identity. */
export const listActivationStates = async (): Promise<Map<string, boolean>> => {
  const states = new Map<string, boolean>();
  for (const user of await listIdentityUsers()) states.set(user.id, Boolean(user.confirmedAt));
  return states;
};

/**
 * Crée le compte et déclenche l'e-mail d'invitation.
 *
 * `/invite` exige le jeton opérateur, qui n'existe que dans une fonction
 * Netlify — cet appel ne peut donc jamais venir du navigateur. C'est le seul
 * point de création de compte offert au syndic, et c'est volontaire : il
 * fonctionne même lorsque les inscriptions libres sont désactivées, et la
 * personne choisit son mot de passe depuis le lien reçu, de sorte qu'aucun mot
 * de passe provisoire ne circule par un autre canal.
 *
 * Relancé sur une adresse déjà invitée mais non activée, il renvoie simplement
 * l'e-mail. Identity refuse en revanche d'inviter un compte déjà activé, ce que
 * l'appelant doit vérifier avant d'arriver ici.
 */
export const inviteAccount = async (email: string, fullName: string): Promise<IdentityAccount> => {
  const config = getIdentityConfig();
  if (!config?.url || !config.token) {
    throw new HttpError(503, "Netlify Identity n'est pas joignable sur ce déploiement : invitation impossible.");
  }

  const response = await fetch(`${config.url}/invite`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
    body: JSON.stringify(fullName ? { email, data: { full_name: fullName } } : { email }),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { msg?: string } | null;
    throw new HttpError(
      response.status === 422 ? 422 : 502,
      detail?.msg ?? `L'envoi de l'invitation a échoué (${response.status}).`,
    );
  }

  const created = (await response.json().catch(() => null)) as { id?: unknown; email?: unknown } | null;
  if (typeof created?.id === "string") {
    return {
      id: created.id,
      email: typeof created.email === "string" ? created.email.toLowerCase() : email,
      fullName,
      activated: false,
    };
  }

  // Corps de réponse inexploitable : l'invitation est partie, on relit le compte
  // pour récupérer son identifiant, indispensable à la clé étrangère.
  const account = await findAccountByEmail(email);
  if (!account) throw new HttpError(502, "L'invitation est partie mais le compte n'a pas pu être relu.");
  return account;
};
