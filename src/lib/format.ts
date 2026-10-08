export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Integer base units → decimal string, without float rounding. */
export function formatUnits(amount: bigint, decimals: number, maxFraction = 4): string {
  const negative = amount < BigInt(0);
  const abs = negative ? -amount : amount;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  let fraction = decimals > 0 ? (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction) : "";
  fraction = fraction.replace(/0+$/, "");
  const wholeText = whole.toLocaleString("en-US");
  return `${negative ? "-" : ""}${wholeText}${fraction ? `.${fraction}` : ""}`;
}

export function formatSol(lamports: bigint | number | string): string {
  return formatUnits(BigInt(lamports), 9, 4);
}

export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return `$${value.toPrecision(2)}`;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value < 10 ? 2 : 0 });
}

export function formatCredits(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "credit" : "credits"}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(ms: number): string {
  return `${new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

export const catalogueNo = (n: number | null | undefined) => `No. ${String(n ?? 0).padStart(3, "0")}`;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isBase58Address(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value);
}
