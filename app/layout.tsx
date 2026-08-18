import type { Metadata } from "next";

import { getSiteUrl, siteConfig } from "@/lib/site";

import "./globals.css";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "PortfolioScope · Portfolio and stock dashboard",
    template: "%s | PortfolioScope",
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: "Jason Servito", url: siteConfig.repositoryUrl }],
  creator: "Jason Servito",
  keywords: [
    "portfolio analytics",
    "stock dashboard",
    "watchlist",
    "investment research",
  ],
  openGraph: {
    type: "website",
    title: "PortfolioScope · Portfolio and stock dashboard",
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: "/og.png",
        width: 1733,
        height: 909,
        alt: "PortfolioScope portfolio and stock dashboard",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PortfolioScope · Portfolio and stock dashboard",
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
    <html
      lang="en"
      className="h-full antialiased"
      data-scroll-behavior="smooth"
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
