import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://delta4.vercel.app";
const SITE_NAME = "Delta 4 Analyzer";
const SITE_DESCRIPTION =
  "Inspired by Kunal Shah's Delta 4 framework — paste your startup URL or idea and get a score on whether it creates irreversible behaviour change.";
const OG_IMAGE = "/images/ogimage.png";
const FAVICON = "/images/kunalshah.jpeg";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Delta 4",
    "Kunal Shah",
    "startup analyzer",
    "behaviour change",
    "product evaluation",
    "startup idea",
    "founder tools",
  ],
  authors: [{ name: "Delta 4 Analyzer" }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "technology",
  alternates: {
    canonical: SITE_URL,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [{ url: FAVICON, type: "image/jpeg" }],
    shortcut: FAVICON,
    apple: FAVICON,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "Will your startup create Delta 4?",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE,
        width: 3456,
        height: 1984,
        alt: "Delta 4 Analyzer — evaluate whether your startup creates irreversible behaviour change",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Will your startup create Delta 4?",
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE],
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
