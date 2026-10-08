import type { Metadata, Viewport } from "next";
import { Inter_Tight, JetBrains_Mono, Young_Serif } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { WalletDialog } from "@/components/wallet/WalletDialog";
import { SITE } from "@/config/site";
import "./globals.css";

const body = Inter_Tight({ subsets: ["latin"], variable: "--font-body" });
const serif = Young_Serif({ subsets: ["latin"], weight: "400", variable: "--font-serif" });
const code = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name} — ${SITE.headline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
};

export const viewport: Viewport = { themeColor: "#f4f1ea" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${body.variable} ${serif.variable} ${code.variable}`}>
      <body className="min-h-svh">
        <SiteHeader />
        {children}
        <SiteFooter />
        <WalletDialog />
      </body>
    </html>
  );
}
