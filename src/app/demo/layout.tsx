import Link from "next/link";

/** Every /demo page carries this ribbon. Demo data comes from fixtures and is never live. */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="demo-ribbon" role="note" data-testid="demo-ribbon">
        Demo mode — sample data for reviewing the interface. No balance, generation, coin or transaction on these pages is real.{" "}
        <Link href="/" className="underline">
          Leave demo
        </Link>
      </div>
      {children}
    </>
  );
}
