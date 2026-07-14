import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "PortfolioScope",
    template: "%s | PortfolioScope",
  },
  description:
    "Portfolio analytics, deterministic risk alerts, and explainable stock research in a polished full-stack demo.",
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
