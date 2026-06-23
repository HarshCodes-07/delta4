import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Delta 4 Analyzer",
  description:
    "Analyze whether your startup idea is just slightly better, or good enough to change behavior.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
