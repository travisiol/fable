/** Site identity. */
export const SITE = {
  name: "FABLE",
  ticker: "FABLE",
  headline: "Hold FABLE. Create with AI.",
  supporting: "Use Studio credits to bring original characters to life. Launch their coins on Solana.",
  launchHeadline: "Create a character. Give it a coin.",
  description: "FABLE is an AI creator studio on Solana: create original characters, generate images and videos with funded Studio credits, and optionally launch each character's coin.",
  port: 3982,
  url: process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3982",
} as const;
