import type { Metadata } from "next";
import { db } from "@/server/db";
import { configStatus } from "@/server/views";
import { formatCredits } from "@/lib/format";
import { OwnerTools } from "./OwnerTools";

export const metadata: Metadata = { title: "Configuration" };
export const dynamic = "force-dynamic";

export default async function ConfigPage() {
  const d = await db();
  const s = await configStatus(d);
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">For the operator</p>
      <h1 className="display mt-3 text-5xl">Configuration</h1>
      <p className="mt-4 max-w-2xl text-ink-2">Which integrations this deployment has. Values are never shown, only whether they are set. Missing items keep saved content readable and switch the matching actions off.</p>
      <ul className="mt-8 border-t border-ink">
        {s.items.map((i) => (
          <li key={i.key} className="grid gap-1 border-b border-line py-4 sm:grid-cols-[1.1fr_0.9fr_2fr] sm:items-center sm:gap-4">
            <span className="font-semibold">{i.label}</span>
            <span className="mono text-xs">
              <span className={`chip mr-2 ${i.ok ? "chip-good" : "chip-alert"}`}>{i.ok ? "Set" : "Missing"}</span>
              {i.key}
            </span>
            <span className="text-sm text-ink-2">{i.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        Database: {d.info.driver} ({d.info.persistent ? "durable" : "ephemeral"}). Holder pool: {formatCredits(s.pool.funded)} funded, {formatCredits(s.pool.allocated)} allocated, {formatCredits(s.pool.allocatable)} allocatable.
      </p>
      <OwnerTools />
    </main>
  );
}
