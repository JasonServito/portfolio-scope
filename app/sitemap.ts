import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/site";

const publicRoutes = [
  "",
  "/privacy",
  "/disclaimer",
  "/research",
  "/dashboard",
  "/holdings",
  "/watchlist",
  "/alerts",
  "/stocks/aapl",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getSiteUrl();

  return publicRoutes.map((route, index) => ({
    url: new URL(route || "/", origin).toString(),
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : route === "/dashboard" ? 0.9 : 0.7,
  }));
}
