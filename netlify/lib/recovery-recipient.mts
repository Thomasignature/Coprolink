export class RecoveryAccountMissingError extends Error {
  constructor() {
    super("Aucun compte Identity ne correspond à cette adresse. Aucun e-mail n’a été envoyé. Une nouvelle invitation Identity est nécessaire.");
    this.name = "RecoveryAccountMissingError";
  }
}

// /recover can return OK for an unknown address. Verify the account first and
// preserve its stored spelling rather than lowercasing the delivery address.
export async function resolveRecoveryRecipient(
  email: string,
  find: (email: string) => Promise<{ email: string } | null>,
): Promise<string> {
  const account = await find(email.trim());
  if (!account?.email) throw new RecoveryAccountMissingError();
  return account.email;
}
