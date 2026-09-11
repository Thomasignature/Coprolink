import { admin, getIdentityConfig, type User } from "@netlify/identity";
import { HttpError } from "./auth.mts";

/**
 * Administration des comptes Netlify Identity.
 *
 * Identity reste la source de vérité de l'authentification ; ce module ne fait
 * que créer et retrouver des comptes. Le rôle applicatif ne s'écrit jamais ici :
 * il vit dans `building_members` (voir auth.mts).
 *
 * Règle de ce module : aucune erreur brute ne sort d'ici. Les opérations
 * d'administration dépendent du jeton opérateur injecté par le runtime Netlify,
 * qui peut manquer (Identity pas encore activé sur le déploiement, jeton rejeté,
 * endpoint injoignable). Dans ce cas la faute est signalée par
 * `IdentityAdminUnavailableError`, que l'appelant sait traiter — sans quoi elle
 * se transformerait en « Erreur interne » côté interface, ce qui n'apprend rien
 * au syndic et donne l'impression que l'ajout d'un copropriétaire est cassé.
 */

export type IdentityAccount = {
  id: string;
  email: string;
  fullName: string;
  /** `false` tant que la personne n'a pas ouvert son lien d'invitation. */
  activated: boolean;
};

/** L'API d'administration Identity n'est pas utilisable sur cette invocation. */
export class IdentityAdminUnavailableError extends Error {
  detail: string;
  constructor(detail: string) {
    super(`Administration Identity indisponible : ${detail}`);
    this.name = "IdentityAdminUnavailableError";
    this.detail = detail;
  }
}

/** Identity refuse l'invitation : l'adresse a déjà un compte. */
export class IdentityEmailTakenError extends Error {
  constructor(email: string) {
    super(`Un compte Identity existe déjà pour ${email}.`);
    this.name = "IdentityEmailTakenError";
  }
}

const PAGE_SIZE = 100;
/** Garde-fou de pagination : une copropriété n'a pas 2 000 comptes. */
const MAX_PAGES = 20;

const toAccount = (user: User): IdentityAccount => ({
  id: user.id,
  email: (user.email ?? "").toLowerCase(),
  fullName: user.name ?? (user.userMetadata?.full_name as string | undefined) ?? "",
  activated: Boolean(user.confirmedAt),
});

const describeFailure = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.trim() || "cause inconnue";
};

/**
 * Point d'accès Identity + jeton opérateur, ou refus explicite.
 *
 * Le jeton n'existe que dans le contexte d'une fonction Netlify : il ne peut
 * donc jamais venir du navigateur, et c'est ce qui rend la création de comptes
 * sûre depuis l'espace syndic.
 */
const requireAdminConfig = () => {
  const config = getIdentityConfig();
  if (!config?.url) {
    throw new IdentityAdminUnavailableError("aucun point d'accès Identity n'est exposé sur ce déploiement");
  }
  if (!config.token) {
    throw new IdentityAdminUnavailableError("aucun jeton opérateur n'est fourni à la fonction");
  }
  return { url: config.url, token: config.token };
};

/** Tous les comptes Identity du projet, pagination comprise. */
const listIdentityUsers = async (): Promise<User[]> => {
  requireAdminConfig();

  const users: User[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await admin.listUsers({ page, perPage: PAGE_SIZE });
      // Une réponse sans tableau d'utilisateurs n'est pas une erreur fatale :
      // on s'arrête simplement là où la pagination s'arrête.
      if (!Array.isArray(batch) || batch.length === 0) break;
      users.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (error) {
    throw new IdentityAdminUnavailableError(describeFailure(error));
  }
  return users;
};

/** @throws {IdentityAdminUnavailableError} si l'API d'administration est hors service. */
export const findAccountByEmail = async (email: string): Promise<IdentityAccount | null> => {
  const needle = email.toLowerCase();
  const match = (await listIdentityUsers()).find((u) => (u.email ?? "").toLowerCase() === needle);
  return match ? toAccount(match) : null;
};

/**
 * Variante tolérante : ne lève jamais. `unavailable` porte la raison lorsque la
 * recherche n'a pas pu aboutir, pour que l'appelant choisisse une solution de
 * repli plutôt que d'échouer.
 */
export const lookupAccountByEmail = async (
  email: string,
): Promise<{ account: IdentityAccount | null; unavailable: string | null }> => {
  try {
    return { account: await findAccountByEmail(email), unavailable: null };
  } catch (error) {
    if (error instanceof IdentityAdminUnavailableError) return { account: null, unavailable: error.detail };
    throw error;
  }
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
 * l'e-mail.
 *
 * @throws {IdentityEmailTakenError} si l'adresse possède déjà un compte.
 * @throws {IdentityAdminUnavailableError} si l'invitation n'a pas pu être tentée.
 */
export const inviteAccount = async (email: string, fullName: string): Promise<IdentityAccount> => {
  const { url, token } = requireAdminConfig();

  let response: Response;
  try {
    response = await fetch(`${url}/invite`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(fullName ? { email, data: { full_name: fullName } } : { email }),
    });
  } catch (error) {
    throw new IdentityAdminUnavailableError(describeFailure(error));
  }

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { msg?: string } | null;
    const message = detail?.msg ?? "";

    if (/already|exist|registered|taken/i.test(message)) throw new IdentityEmailTakenError(email);

    // 401/403 = jeton opérateur refusé, 5xx = Identity en difficulté : dans les
    // deux cas l'adresse n'est pas en cause, et l'appelant peut se rabattre sur
    // une invitation en attente plutôt que de perdre la demande du syndic.
    if (response.status === 401 || response.status === 403 || response.status >= 500) {
      throw new IdentityAdminUnavailableError(`Identity a répondu ${response.status} ${message}`.trim());
    }

    throw new HttpError(422, message || `L'envoi de l'invitation a échoué (${response.status}).`);
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
  if (!account) {
    throw new IdentityAdminUnavailableError("l'invitation est partie mais le compte n'a pas pu être relu");
  }
  return account;
};
