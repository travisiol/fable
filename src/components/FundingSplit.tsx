import { FEE_SPLIT_BPS } from "@/config/fable";

/** The 30 / 40 / 30 breakdown as three proportional bands (no chart decoration). */
export function FundingSplit({ active }: { active: boolean }) {
  const parts = [
    { bps: FEE_SPLIT_BPS.holderPool, title: "Holder credit pool", text: "Funds Studio credits for eligible FABLE holders, allocated weekly.", tone: "bg-violet text-white" },
    { bps: FEE_SPLIT_BPS.characterBudget, title: "The character's content budget", text: "Pays for new images and clips of that character only.", tone: "bg-lavender text-ink" },
    { bps: FEE_SPLIT_BPS.creator, title: "The character's creator", text: "Paid to the creator's wallet by pump.fun at each distribution.", tone: "bg-ink text-ivory" },
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={active ? "chip chip-good" : "chip chip-violet"}>{active ? "Active on verified launches" : "Proposed configuration"}</span>
        <span className="hint">Applies to creator fees received — not to trading volume.</span>
      </div>
      <div className="mt-4 flex h-16 w-full overflow-hidden border border-ink" role="img" aria-label="30% holder pool, 40% character budget, 30% creator">
        {parts.map((p) => (
          <div key={p.title} className={`flex items-center px-3 ${p.tone}`} style={{ width: `${p.bps / 100}%` }}>
            <span className="display text-2xl sm:text-3xl">{p.bps / 100}%</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {parts.map((p) => (
          <div key={p.title} className="rule-soft pt-3">
            <p className="font-semibold">
              <span className="mono mr-2">{p.bps / 100}%</span>
              {p.title}
            </p>
            <p className="mt-1 text-sm text-ink-2">{p.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
