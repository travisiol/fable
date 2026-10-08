/**
 * Example characters (spec §6, §9): shown only with an "Example character" label, never mixed with
 * live records and never given launch counts, volume, followers or revenue. Their portraits were
 * generated once with gpt-image-2 (public/examples). The demo fixtures (/demo) reuse them.
 */
export interface ExampleCharacter {
  slug: string;
  number: string;
  idea: string;
  name: string;
  bio: string;
  personality: string;
  niche: string;
  style: string;
  portrait: string;
  /** Only in the demo: a pretend ticker, never shown outside /demo. */
  demoTicker: string;
}

export const EXAMPLES: ExampleCharacter[] = [
  {
    slug: "robot-comedian",
    number: "EX-01",
    idea: "A robot comedian.",
    name: "Tinpan Kowalski",
    bio: "A washed-up robot comedian broadcasting from a tiny apartment in Tokyo, still working on the joke that got him unplugged in 1998.",
    personality: "Deadpan, warm underneath, allergic to applause he did not earn.",
    niche: "Late-night stand-up and kitchen-table monologues",
    style: "Photographic portrait",
    portrait: "/examples/robot-comedian.png",
    demoTicker: "TINPAN",
  },
  {
    slug: "space-explorer",
    number: "EX-02",
    idea: "A retired space explorer.",
    name: "Commander Ida Vey",
    bio: "Flew eleven survey missions past the asteroid belt, retired to a seaside town, and now answers every question with a story from orbit.",
    personality: "Patient, dry humour, precise about distances, generous with advice.",
    niche: "Space history, stargazing, slow travel",
    style: "Photographic portrait",
    portrait: "/examples/space-explorer.png",
    demoTicker: "IDAVEY",
  },
  {
    slug: "pigeon-critic",
    number: "EX-03",
    idea: "A dramatic pigeon food critic.",
    name: "Monsieur Crumbe",
    bio: "A city pigeon who reviews pavement cafés with the gravity of a three-star inspector, and the appetite of a pigeon.",
    personality: "Theatrical, vain, devastatingly honest about croissants.",
    niche: "Street food reviews",
    style: "Photographic portrait",
    portrait: "/examples/pigeon-critic.png",
    demoTicker: "CRUMBE",
  },
  {
    slug: "fashion-designer",
    number: "EX-04",
    idea: "A virtual fashion designer.",
    name: "Sable Arden",
    bio: "A virtual designer who drafts collections that only exist on screen, and explains every pleat like it was a manifesto.",
    personality: "Calm, exacting, quietly funny, obsessed with lavender.",
    niche: "Digital fashion and styling",
    style: "Soft 3D animation",
    portrait: "/examples/fashion-designer.png",
    demoTicker: "SABLE",
  },
];

export const exampleBySlug = (slug: string) => EXAMPLES.find((e) => e.slug === slug) ?? null;

/** The labelled idea chips under "Who are you bringing to life?". */
export const IDEA_EXAMPLES = [
  { label: "A robot comedian", idea: "A washed-up robot comedian broadcasting from a tiny apartment in Tokyo." },
  { label: "A retired space explorer", idea: "A retired space explorer who answers every question with a story from orbit." },
  { label: "A dramatic pigeon food critic", idea: "A dramatic pigeon who reviews pavement cafés like a three-star inspector." },
  { label: "A virtual fashion designer", idea: "A virtual fashion designer whose collections only exist on screen." },
];
