import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Profile } from "@/components/Profile";
import { EXAMPLES } from "@/config/examples";
import { demoProfile } from "@/demo/fixtures";

export const metadata: Metadata = { title: "Example character (demo)" };

export function generateStaticParams() {
  return EXAMPLES.map((e) => ({ slug: e.slug }));
}

export default async function DemoCharacter({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = demoProfile(slug);
  if (!p) notFound();
  return <Profile p={p} />;
}
