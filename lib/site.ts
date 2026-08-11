export const siteConfig = {
  name: "PortfolioScope",
  description:
    "A production-oriented portfolio analytics and investment research platform with transparent calculations, SEC provenance, and a one-click recruiter demo.",
  repositoryUrl: "https://github.com/JasonServito/portfolio-scope",
} as const;

export const publicNavigation = [
  { href: "/architecture", label: "Architecture" },
  { href: "/methodology", label: "Methodology" },
  { href: "/data-sources", label: "Data sources" },
] as const;

export function getSiteUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();

  try {
    return new URL(configured || "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}
