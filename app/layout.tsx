import type { Metadata } from "next";

import { getSiteUrl, siteConfig } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "PortfolioScope · Portfolio analytics with an audit trail",
    template: "%s | PortfolioScope",
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: "Jason Servito", url: siteConfig.repositoryUrl }],
  creator: "Jason Servito",
  keywords: [
    "portfolio analytics",
    "SEC EDGAR",
    "investment research",
    "Next.js",
    "Prisma",
    "PostgreSQL",
  ],
  openGraph: {
    type: "website",
    title: "PortfolioScope · Portfolio analytics with an audit trail",
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: "/og.png",
        width: 1733,
        height: 909,
        alt: "PortfolioScope — portfolio analytics with an audit trail",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PortfolioScope · Portfolio analytics with an audit trail",
    description: siteConfig.description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
