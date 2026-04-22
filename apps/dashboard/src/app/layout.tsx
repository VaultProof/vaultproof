import type { Metadata } from "next";
import { Inter, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { MixpanelTracker } from "../components/mixpanel-tracker";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["500","600","700","800"], variable: "--font-inter-tight" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400","500","600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "VaultProof",
  description: "Zero-knowledge API key vault. Your keys are split the moment you enter them.",
  icons: { icon: "/logo2.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable} ${interTight.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-full flex flex-col">
        <MixpanelTracker />
        {children}
      </body>
    </html>
  );
}
