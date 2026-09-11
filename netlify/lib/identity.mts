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

export class IdentityAdminUnavailableError extends Error {
  detail: string;
  constructor(detail: string) {
    super(`Administration Identity indisponible : ${detail}`);
    this.name = "IdentityAdminUnavailableError";
    this.detail = detail;
  }
}

export class IdentityEmailTakenError extends Error {
  constructor(email: string) {
    super(`Un compte Identity existe déjà pour ${email}.`);
    this.name = "IdentityEmailTakenError";
  }
}

export class IdentityRateLimitError extends Error {
  constructor() {
    super("Trop de demandes d'e-mail Identity ont été effectuées récemment.");
    this.name = "IdentityRateLimitError";
  }
}

const PAGE_SIZE = 100;
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

const requireIdentityUrl = () => {
  const config = getIdentityConfig();
  if (!config?.url) {
    throw new IdentityAdminUnavailableError("aucun point d'accès Identity n'est exposé sur ce déploiement");
  }
  return config.url;
};

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

const listIdentityUsers = async (): Promise<User[]> => {
  requireAdminConfig();

  const users: User[] = [];
  try {
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await admin.listUsers({ page, perPage: PAGE_SIZE });
      if (!Array.isArray(batch) || batch.length === 0) break;
      users.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  } catch (error) {
    throw new IdentityAdminUnavailableError(describeFailure(error));
  }
  return users;
};

export const findAccountByEmail = async (email: string): Promise<IdentityAccount | null> => {
  const needle = email.toLowerCase();
  const match = (await listIdentityUsers()).find((u) => (u.email ?? "").toLowerCase() === needle);
  return match ? toAccount(match) : null;
};

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

export const listActivationStates = async (): Promise<Map<string, boolean>> => {
  const states = new Map<string, boolean>();
  for (const user of await listIdentityUsers()) states.set(user.id, Boolean(user.confirmedAt));
  return states;
};

/**
 * Envoie un nouveau lien à un compte Identity existant.
 *
 * Netlify refuse `/invite` lorsqu'une adresse existe déjà, y compris si le compte
 * n'a jamais été activé. `/recover` est donc utilisé pour le renvoi : lors de
 * l'ouverture du lien, GoTrue confirme aussi un compte qui ne l'était pas encore,
 * puis CoproLink laisse la personne choisir son mot de passe.
 */
export const sendAccountActivationLink = async (email: string): Promise<void> => {
  const url = requireIdentityUrl();

  let response: Response;
  try {
    response = await fetch(`${url}/recover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    throw new IdentityAdminUnavailableError(describeFailure(error));
  }

  if (response.ok) return;

  const detail = (await response.json().catch(() => null)) as { msg?: string; error_description?: string } | null;
  const message = detail?.msg ?? detail?.error_description ?? "";

  if (response.status === 429 || /rate limit|too many/i.test(message)) {
    throw new IdentityRateLimitError();
  }

  if (response.status >= 500) {
    throw new IdentityAdminUnavailableError(`Identity a répondu ${response.status} ${message}`.trim());
  }

  throw new HttpError(422, message || `L'envoi du lien d'activation a échoué (${response.status}).`);
};

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

  const account = await findAccountByEmail(email);
  if (!account) {
    throw new IdentityAdminUnavailableError("l'invitation est partie mais le compte n'a pas pu être relu");
  }
  return account;
};
