import type { IdentityAccount } from "./identity.mts";

type Delivery = {
  invite: (email: string, name: string) => Promise<IdentityAccount>;
  find: (email: string) => Promise<IdentityAccount | null>;
  resend: (email: string) => Promise<void>;
  isDuplicate: (error: unknown) => boolean;
};

// An existing account still needs an actual email request. Never interpret
// a prepared membership or a failed provider request as successful delivery.
export async function deliverPersonInvitation(
  email: string, name: string, account: IdentityAccount | null, delivery: Delivery,
) {
  if (!account) {
    try {
      return { account: await delivery.invite(email, name), invited: true };
    } catch (error) {
      if (!delivery.isDuplicate(error)) throw error;
      account = await delivery.find(email);
      if (!account) throw error;
    }
  }
  await delivery.resend(email);
  return { account, invited: false };
}
