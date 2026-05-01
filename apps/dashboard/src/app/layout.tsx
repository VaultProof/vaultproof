import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
