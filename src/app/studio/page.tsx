import type { Metadata } from "next";
import { SignInGate } from "@/components/SignInGate";
import { ENV } from "@/config/fable";
import { StudioLoader } from "./StudioLoader";

export const metadata: Metadata = { title: "Studio" };
export const dynamic = "force-dynamic";

export default function StudioPage() {
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">Studio</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Create with your character</h1>
      <p className="mt-4 max-w-2xl text-ink-2">Pick a saved character, choose a preset and describe the shot. Each job is paid by one balance you choose: your Studio credits or the character&apos;s content budget, never both.</p>
      <div className="mt-10">
        <SignInGate why="The Studio spends your credits and your characters' budgets, so FABLE needs to know which wallet you are.">
          <StudioLoader imagesOn={Boolean(ENV.openaiKey())} videoOn={Boolean(ENV.geminiKey())} />
        </SignInGate>
      </div>
    </main>
  );
}
