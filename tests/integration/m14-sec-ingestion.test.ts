import { randomUUID } from "node:crypto";

import type { SecFactSelection } from "@prisma/client";
import { describe, expect, it } from "vitest";

import companyFactsFixture from "@/tests/fixtures/sec/aapl-companyfacts.json";
import submissionsFixture from "@/tests/fixtures/sec/aapl-submissions.json";
import { db } from "@/lib/db";
import { ingestSupportedCompany } from "@/lib/sec/ingestion";
import { prismaSecRepository } from "@/lib/sec/repository";
import { secCompanyFactsSchema, secSubmissionsSchema } from "@/lib/sec/schemas";
import {
  InMemoryObjectStorage,
  type ObjectStorage,
} from "@/lib/storage/object-storage";

function integrationFixtures() {
  const suffix = String(
    (Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) %
      900_000) +
      100_000,
  );
  const annualAccession = `0000320193-99-${suffix}`;
  const quarterlyAccession = `0000320193-98-${suffix}`;
  const submissions = structuredClone(submissionsFixture);
  submissions.filings.recent.accessionNumber = [
    annualAccession,
    quarterlyAccession,
  ];
  const companyFacts = structuredClone(companyFactsFixture);

  for (const concept of Object.values(companyFacts.facts["us-gaap"])) {
    for (const observations of Object.values(concept.units)) {
      for (const observation of observations) {
        observation.accn =
          observation.form === "10-K" ? annualAccession : quarterlyAccession;
      }
    }
  }

  return {
    accessions: [annualAccession, quarterlyAccession],
    submissions: secSubmissionsSchema.parse(submissions),
    companyFacts: secCompanyFactsSchema.parse(companyFacts),
  };
}

describe("M14 PostgreSQL SEC persistence", () => {
  it("links the security, retains raw metadata, stays idempotent, and supersedes corrected facts", async () => {
    const fixtures = integrationFixtures();
    const correlations = [
      `m14-${randomUUID()}`,
      `m14-${randomUUID()}`,
      `m14-${randomUUID()}`,
      `m14-${randomUUID()}`,
    ];
    const storage = new InMemoryObjectStorage();
    const correctedCompanyFacts = structuredClone(fixtures.companyFacts);
    const correctedAnnualRevenue = correctedCompanyFacts.facts[
      "us-gaap"
    ].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.find(
      ({ form }) => form === "10-K",
    );
    if (!correctedAnnualRevenue) {
      throw new Error("The integration fixture is missing annual revenue.");
    }
    correctedAnnualRevenue.val += 1;
    let companyFactsRequest = 0;
    const client = {
      getSubmissions: async () => fixtures.submissions,
      getCompanyFacts: async () => {
        companyFactsRequest += 1;
        return companyFactsRequest <= 2
          ? fixtures.companyFacts
          : correctedCompanyFacts;
      },
    };
    const now = () => new Date("2026-07-15T18:00:00.000Z");
    const existingIdentity = await db.secEntity.findUnique({
      where: { cik: "0000320193" },
      select: {
        id: true,
        companyId: true,
        legalName: true,
        sic: true,
        sicDescription: true,
        fiscalYearEnd: true,
        stateOfIncorporation: true,
        company: { select: { lastSyncedAt: true } },
        financialFacts: {
          select: { id: true, selection: true, ambiguityReason: true },
        },
      },
    });
    const selectionRestorationGroups = new Map<
      string,
      {
        ids: string[];
        selection: SecFactSelection;
        ambiguityReason: string | null;
      }
    >();
    for (const fact of existingIdentity?.financialFacts ?? []) {
      const key = `${fact.selection}:${fact.ambiguityReason ?? ""}`;
      const group = selectionRestorationGroups.get(key) ?? {
        ids: [],
        selection: fact.selection,
        ambiguityReason: fact.ambiguityReason,
      };
      group.ids.push(fact.id);
      selectionRestorationGroups.set(key, group);
    }
    let secEntityId: string | null = existingIdentity?.id ?? null;

    try {
      await ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: correlations[0] },
        { repository: prismaSecRepository, client, storage, now },
      );
      const objectKeys = [...storage.objects.keys()];
      const identity = await db.stock.findUnique({
        where: { ticker: "AAPL" },
        select: {
          companyId: true,
          company: {
            select: { secEntity: { select: { id: true, cik: true } } },
          },
        },
      });
      secEntityId = identity?.company?.secEntity?.id ?? null;
      expect(identity).toMatchObject({
        companyId: expect.any(String),
        company: { secEntity: { cik: "0000320193" } },
      });
      expect(secEntityId).not.toBeNull();

      const rawSourceKinds = await db.secRawSource.findMany({
        where: {
          secEntityId: secEntityId!,
          objectKey: { in: objectKeys },
        },
        select: { kind: true },
      });
      expect(new Set(rawSourceKinds.map(({ kind }) => kind))).toEqual(
        new Set(["SUBMISSIONS", "COMPANY_FACTS"]),
      );

      const firstFactCount = await db.secFinancialFact.count({
        where: {
          secEntityId: secEntityId!,
          accessionNumber: { in: fixtures.accessions },
        },
      });
      expect(firstFactCount).toBeGreaterThan(0);

      await ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: correlations[1] },
        { repository: prismaSecRepository, client, storage, now },
      );

      expect(
        await db.secFinancialFact.count({
          where: {
            secEntityId: secEntityId!,
            accessionNumber: { in: fixtures.accessions },
          },
        }),
      ).toBe(firstFactCount);
      expect(
        await db.secFiling.count({
          where: { accessionNumber: { in: fixtures.accessions } },
        }),
      ).toBe(2);
      expect(
        await db.secRawSource.count({
          where: {
            secEntityId: secEntityId!,
            objectKey: { in: objectKeys },
          },
        }),
      ).toBe(2);
      expect(storage.objects.size).toBe(2);

      await ingestSupportedCompany(
        "AAPL",
        { trigger: "TEST", correlationId: correlations[2] },
        { repository: prismaSecRepository, client, storage, now },
      );

      const annualRevenueHistory = await db.secFinancialFact.findMany({
        where: {
          secEntityId: secEntityId!,
          accessionNumber: fixtures.accessions[0],
          canonicalMetric: "REVENUE",
          periodKind: "ANNUAL",
        },
        select: { normalizedValue: true, selection: true },
      });
      expect(
        annualRevenueHistory.filter(
          ({ selection }) => selection === "SELECTED",
        ),
      ).toHaveLength(1);
      expect(
        annualRevenueHistory.some(
          ({ selection }) => selection === "SUPERSEDED",
        ),
      ).toBe(true);
      expect(
        annualRevenueHistory
          .find(({ selection }) => selection === "SELECTED")
          ?.normalizedValue.toString(),
      ).toBe(correctedAnnualRevenue.val.toString());
      expect(storage.objects.size).toBe(3);
      expect(
        await db.secIngestionRun.count({
          where: {
            correlationId: { in: correlations.slice(0, 3) },
            status: "COMPLETED",
          },
        }),
      ).toBe(3);

      const factsBeforeFailure = await db.secFinancialFact.count({
        where: {
          secEntityId: secEntityId!,
          accessionNumber: { in: fixtures.accessions },
        },
      });
      const selectedBeforeFailure = await db.secFinancialFact.count({
        where: {
          secEntityId: secEntityId!,
          accessionNumber: { in: fixtures.accessions },
          selection: "SELECTED",
        },
      });
      const filingsBeforeFailure = await db.secFiling.count({
        where: { accessionNumber: { in: fixtures.accessions } },
      });
      const rawSourcesBeforeFailure = await db.secRawSource.count({
        where: {
          secEntityId: secEntityId!,
          objectKey: { in: [...storage.objects.keys()] },
        },
      });
      let writes = 0;
      const failingStorage: ObjectStorage = {
        async put(input) {
          writes += 1;
          if (writes === 2) throw new Error("R2 unavailable");
          return storage.put(input);
        },
        get: (key) => storage.get(key),
      };

      await expect(
        ingestSupportedCompany(
          "AAPL",
          { trigger: "TEST", correlationId: correlations[3] },
          {
            repository: prismaSecRepository,
            client,
            storage: failingStorage,
            now,
          },
        ),
      ).rejects.toMatchObject({
        code: "SEC_STORAGE_ERROR",
        partiallyCompleted: true,
      });

      expect(
        await db.secFinancialFact.count({
          where: {
            secEntityId: secEntityId!,
            accessionNumber: { in: fixtures.accessions },
          },
        }),
      ).toBe(factsBeforeFailure);
      expect(
        await db.secFinancialFact.count({
          where: {
            secEntityId: secEntityId!,
            accessionNumber: { in: fixtures.accessions },
            selection: "SELECTED",
          },
        }),
      ).toBe(selectedBeforeFailure);
      expect(
        await db.secFiling.count({
          where: { accessionNumber: { in: fixtures.accessions } },
        }),
      ).toBe(filingsBeforeFailure);
      expect(
        await db.secRawSource.count({
          where: {
            secEntityId: secEntityId!,
            objectKey: { in: [...storage.objects.keys()] },
          },
        }),
      ).toBe(rawSourcesBeforeFailure);
      await expect(
        db.secIngestionRun.findUnique({
          where: { correlationId: correlations[3] },
        }),
      ).resolves.toMatchObject({
        status: "PARTIALLY_COMPLETED",
        errorCode: "SEC_STORAGE_ERROR",
        filingsProcessed: 2,
        factsProcessed: 0,
        completedAt: expect.any(Date),
      });
      expect(
        await db.secIngestionRun.count({
          where: {
            correlationId: { in: correlations },
            status: "RUNNING",
          },
        }),
      ).toBe(0);
    } finally {
      await db.secIngestionRun.deleteMany({
        where: { correlationId: { in: correlations } },
      });
      if (secEntityId) {
        await db.secFinancialFact.deleteMany({
          where: {
            secEntityId,
            accessionNumber: { in: fixtures.accessions },
          },
        });
        await db.secFiling.deleteMany({
          where: { accessionNumber: { in: fixtures.accessions } },
        });
        await db.secRawSource.deleteMany({
          where: {
            secEntityId,
            objectKey: { in: [...storage.objects.keys()] },
          },
        });
        for (const group of selectionRestorationGroups.values()) {
          await db.secFinancialFact.updateMany({
            where: { id: { in: group.ids } },
            data: {
              selection: group.selection,
              ambiguityReason: group.ambiguityReason,
            },
          });
        }
        if (existingIdentity) {
          await db.secEntity.update({
            where: { id: existingIdentity.id },
            data: {
              legalName: existingIdentity.legalName,
              sic: existingIdentity.sic,
              sicDescription: existingIdentity.sicDescription,
              fiscalYearEnd: existingIdentity.fiscalYearEnd,
              stateOfIncorporation: existingIdentity.stateOfIncorporation,
            },
          });
          await db.company.update({
            where: { id: existingIdentity.companyId },
            data: { lastSyncedAt: existingIdentity.company.lastSyncedAt },
          });
        }
      }
    }
  });
});
