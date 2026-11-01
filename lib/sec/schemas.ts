import { z } from "zod";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().min(10);

const recentFilingsSchema = z
  .object({
    accessionNumber: z.array(z.string()),
    filingDate: z.array(isoDateSchema),
    reportDate: z.array(z.string()),
    acceptanceDateTime: z.array(isoDateTimeSchema).optional(),
    form: z.array(z.string()),
    primaryDocument: z.array(z.string()).optional(),
    primaryDocDescription: z.array(z.string()).optional(),
    // Comma-separated Form 8-K item codes per filing ("2.02,9.01"); empty
    // for other forms.
    items: z.array(z.string()).optional(),
  })
  .passthrough();

export const secSubmissionsSchema = z
  .object({
    cik: z.string().or(z.number()),
    entityType: z.string().optional(),
    sic: z.string().optional(),
    sicDescription: z.string().optional(),
    name: z.string().min(1),
    tickers: z.array(z.string()).default([]),
    exchanges: z.array(z.string()).default([]),
    fiscalYearEnd: z.string().optional(),
    stateOfIncorporation: z.string().optional(),
    filings: z
      .object({
        recent: recentFilingsSchema,
        files: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const secFactObservationSchema = z
  .object({
    start: isoDateSchema.optional(),
    end: isoDateSchema,
    val: z.number().finite(),
    accn: z.string().min(1),
    fy: z.number().int().nullable().optional(),
    fp: z.string().nullable().optional(),
    form: z.string().min(1),
    filed: isoDateSchema,
    frame: z.string().nullable().optional(),
  })
  .passthrough();

const secConceptSchema = z
  .object({
    // SEC occasionally publishes null or empty presentation metadata for
    // otherwise valid concepts. Canonical labels come from our metric
    // definitions, so retain the concept and validate its observations without
    // inventing text.
    label: z.string().nullable(),
    description: z.string().nullable().optional(),
    units: z.record(z.string(), z.array(secFactObservationSchema)),
  })
  .passthrough();

export const secCompanyFactsSchema = z
  .object({
    cik: z.number().int().nonnegative().or(z.string()),
    entityName: z.string().min(1),
    facts: z.record(z.string(), z.record(z.string(), secConceptSchema)),
  })
  .passthrough();

export type SecSubmissions = z.infer<typeof secSubmissionsSchema>;
export type SecCompanyFacts = z.infer<typeof secCompanyFactsSchema>;
