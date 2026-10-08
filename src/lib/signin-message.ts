import { SITE } from "../config/site.ts";

/** The exact text a wallet signs to open a session. Built identically on both sides. */
export function signInMessage(input: { host: string; address: string; nonce: string; issuedAt: string }): string {
  return [
    `${input.host} wants you to sign in to ${SITE.name} with your Solana account:`,
    input.address,
    "",
    "Signing in proves you control this address. It costs nothing and moves no funds.",
    "",
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}
