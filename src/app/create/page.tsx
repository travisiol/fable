import type { Metadata } from "next";
import { CreateLoader } from "./CreateLoader";

export const metadata: Metadata = { title: "Create a character" };

export default function CreatePage() {
  return (
    <main className="shell py-10 sm:py-14">
      <p className="label">Create</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Create a character. Give it a coin.</h1>
      <p className="mt-4 max-w-2xl text-ink-2">Describe, generate, review. The coin is optional: a saved character has its own page and gallery either way.</p>
      <div className="mt-10">
        <CreateLoader />
      </div>
    </main>
  );
}
