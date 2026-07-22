import { z } from "zod";

import supportedCompaniesJson from "@/data/supported-companies.json";

const supportedCompanySchema = z.object({
  ticker: z.string().regex(/^[A-Z]{1,5}$/),
  cik: z.string().regex(/^\d{10}$/),
  companyName: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sector: z.string().min(1),
  industry: z.string().min(1),
  exchange: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export type SupportedCompany = z.infer<typeof supportedCompanySchema>;

const supportedCompaniesSchema = z
  .array(supportedCompanySchema)
  .min(20)
  .max(30)
  .superRefine((companies, context) => {
    for (const field of ["ticker", "cik", "slug"] as const) {
      const seen = new Set<string>();
      for (const [index, company] of companies.entries()) {
        if (seen.has(company[field])) {
          context.addIssue({
            code: "custom",
            message: `Duplicate supported-company ${field}.`,
            path: [index, field],
          });
        }
        seen.add(company[field]);
      }
    }
  });

export const supportedCompanies = supportedCompaniesSchema.parse(
  supportedCompaniesJson,
);

const companiesByTicker = new Map(
  supportedCompanies.map((company) => [company.ticker, company]),
);

export function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

export function formatCik(cik: string | number) {
  const digits = String(cik).trim();

  if (!/^\d{1,10}$/.test(digits)) {
    throw new Error("CIK must contain between 1 and 10 digits.");
  }

  return digits.padStart(10, "0");
}

export function getSupportedCompany(ticker: string) {
  return companiesByTicker.get(normalizeTicker(ticker)) ?? null;
}

export function isSupportedTicker(ticker: string) {
  return getSupportedCompany(ticker) !== null;
}
