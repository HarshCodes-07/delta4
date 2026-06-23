import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://delta4.vercel.app"),
  title: "Delta 4 Analyzer",
  description:
    "Analyze whether your startup idea is just slightly better, or good enough to change behavior.",
  openGraph: {
    title: "Delta 4 Analyzer",
    description:
      "Inspired by Kunal Shah's Delta 4 framework — evaluate whether your startup creates irreversible behaviour change.",
    images: ["/images/kunalshah.jpeg"],
  },
  twitter: {
    card: "summary",
    images: ["/images/kunalshah.jpeg"],
  },
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
