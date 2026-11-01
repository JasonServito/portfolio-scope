export const siteConfig = {
  name: "PortfolioScope",
  description:
    "A straightforward stock dashboard for portfolios, watchlists, alerts, and company research, with a one-click read-only demo.",
  repositoryUrl: "https://github.com/JasonServito/portfolio-scope",
} as const;

export const publicNavigation = [
  { href: "/stocks/aapl", label: "Stock detail" },
  { href: "/research", label: "Sample research" },
] as const;

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  try {
    return new URL(configured || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}
