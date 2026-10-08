import type { Metadata } from "next";
import { SignInGate } from "@/components/SignInGate";
import { DashboardClient } from "./DashboardClient";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">Dashboard</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Your wallet and characters</h1>
      <div className="mt-10">
        <SignInGate why="Your balances, drafts and creator controls are private to your wallet.">
          <DashboardClient />
        </SignInGate>
      </div>
    </main>
  );
}
