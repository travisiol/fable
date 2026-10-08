import type { Metadata } from "next";
import { SignInGate } from "@/components/SignInGate";
import { ENV } from "@/config/fable";
import { launchAvailability } from "@/server/launch";
import { LaunchLoader } from "./LaunchLoader";

export const metadata: Metadata = { title: "Launch its coin" };
export const dynamic = "force-dynamic";

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = launchAvailability();
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">Launch</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Give it a coin.</h1>
      <p className="mt-4 max-w-2xl text-ink-2">Identity, token, review. Your own wallet signs and pays; FABLE builds the transaction and only reports success once the coin is confirmed on chain.</p>
      <div className="mt-10">
        <SignInGate why="Only a character's creator can launch its coin, so FABLE needs to know which wallet you are.">
          <LaunchLoader characterId={id} availability={{ ok: a.ok, missing: a.missing, cluster: a.cluster, poolWallet: ENV.poolWallet(), budgetWallet: ENV.budgetWallet() }} />
        </SignInGate>
      </div>
    </main>
  );
}
