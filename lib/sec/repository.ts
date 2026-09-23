import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import type { SupportedCompany } from "@/lib/sec/company-registry";
import type {
  NormalizedSecFact,
  ParsedSecFiling,
} from "@/lib/sec/normalization";
import type { SecSubmissions } from "@/lib/sec/schemas";

const SEC_FACT_PERSISTENCE_TRANSACTION_TIMEOUT_MS = 30_000;

export type SecIdentity = {
  companyId: string;
  secEntityId: string;
};

export type RawSourceRecord = {
  id: string;
  objectKey: string;
};

export interface SecRepository {
  ensureIdentity(company: SupportedCompany): Promise<SecIdentity>;
  updateEntityMetadata(
    identity: SecIdentity,
    submissions: SecSubmissions,
  ): Promise<void>;
  startRun(input: {
    secEntityId: string;
    requestedByUserId: string | null;
    trigger: string;
    correlationId: string;
    startedAt: Date;
  }): Promise<{ id: string }>;
  saveRawSource(input: {
    secEntityId: string;
    kind: "SUBMISSIONS" | "COMPANY_FACTS" | "FILING_DOCUMENT";
    sourceUrl: string;
    objectKey: string;
    sha256: string;
    contentType: string;
    byteLength: number;
    retrievedAt: Date;
  }): Promise<RawSourceRecord>;
  saveFilings(
    secEntityId: string,
    filings: ParsedSecFiling[],
  ): Promise<Map<string, string>>;
  saveFacts(input: {
    secEntityId: string;
    rawSourceId: string;
    facts: NormalizedSecFact[];
    filingIds: Map<string, string>;
  }): Promise<{ processed: number; selected: number; ambiguous: number }>;
  completeRun(input: {
    runId: string;
    companyId: string;
    completedAt: Date;
    filingsProcessed: number;
    factsProcessed: number;
    factsSelected: number;
    ambiguousFacts: number;
  }): Promise<void>;
  failRun(input: {
    runId: string;
    completedAt: Date;
    partiallyCompleted: boolean;
    filingsProcessed: number;
    factsProcessed: number;
    factsSelected: number;
    ambiguousFacts: number;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
}

export class PrismaSecRepository implements SecRepository {
  async ensureIdentity(company: SupportedCompany): Promise<SecIdentity> {
    return db.$transaction(async (transaction) => {
      const companyRecord = await transaction.company.upsert({
        where: { slug: company.slug },
        update: {
          name: company.companyName,
          currency: company.currency,
          isActive: true,
          isSupported: true,
        },
        create: {
          slug: company.slug,
          name: company.companyName,
          currency: company.currency,
          isActive: true,
          isSupported: true,
        },
      });
      const secEntity = await transaction.secEntity.upsert({
        where: { cik: company.cik },
        update: {
          companyId: companyRecord.id,
          legalName: company.companyName,
        },
        create: {
          companyId: companyRecord.id,
          cik: company.cik,
          legalName: company.companyName,
        },
      });

      await transaction.stock.upsert({
        where: { ticker: company.ticker },
        update: {
          companyId: companyRecord.id,
          companyName: company.companyName,
          sector: company.sector,
          industry: company.industry,
          exchange: company.exchange,
          currency: company.currency,
        },
        create: {
          companyId: companyRecord.id,
          ticker: company.ticker,
          companyName: company.companyName,
          sector: company.sector,
          industry: company.industry,
          exchange: company.exchange,
          currency: company.currency,
        },
      });

      return {
        companyId: companyRecord.id,
        secEntityId: secEntity.id,
      };
    });
  }

  async updateEntityMetadata(
    identity: SecIdentity,
    submissions: SecSubmissions,
  ) {
    await db.secEntity.update({
      where: { id: identity.secEntityId },
      data: {
        legalName: submissions.name,
        sic: submissions.sic ?? null,
        sicDescription: submissions.sicDescription ?? null,
        fiscalYearEnd: submissions.fiscalYearEnd ?? null,
        stateOfIncorporation: submissions.stateOfIncorporation ?? null,
      },
    });
  }

  async startRun(input: {
    secEntityId: string;
    requestedByUserId: string | null;
    trigger: string;
    correlationId: string;
    startedAt: Date;
  }) {
    return db.secIngestionRun.create({
      data: {
        secEntityId: input.secEntityId,
        requestedByUserId: input.requestedByUserId,
        trigger: input.trigger,
        correlationId: input.correlationId,
        startedAt: input.startedAt,
      },
      select: { id: true },
    });
  }

  async saveRawSource(input: {
    secEntityId: string;
    kind: "SUBMISSIONS" | "COMPANY_FACTS" | "FILING_DOCUMENT";
    sourceUrl: string;
    objectKey: string;
    sha256: string;
    contentType: string;
    byteLength: number;
    retrievedAt: Date;
  }) {
    return db.secRawSource.upsert({
      where: { objectKey: input.objectKey },
      update: {
        sourceUrl: input.sourceUrl,
        lastRetrievedAt: input.retrievedAt,
      },
      create: {
        secEntityId: input.secEntityId,
        kind: input.kind,
        sourceUrl: input.sourceUrl,
        objectKey: input.objectKey,
        sha256: input.sha256,
        contentType: input.contentType,
        byteLength: BigInt(input.byteLength),
        firstRetrievedAt: input.retrievedAt,
        lastRetrievedAt: input.retrievedAt,
      },
      select: { id: true, objectKey: true },
    });
  }

  async saveFilings(secEntityId: string, filings: ParsedSecFiling[]) {
    return db.$transaction(async (transaction) => {
      const filingIds = new Map<string, string>();

      for (const filing of filings) {
        const record = await transaction.secFiling.upsert({
          where: { accessionNumber: filing.accessionNumber },
          update: {
            secEntityId,
            formType: filing.formType,
            filingDate: filing.filingDate,
            reportDate: filing.reportDate,
            acceptanceDateTime: filing.acceptanceDateTime,
            primaryDocument: filing.primaryDocument,
            primaryDocumentDescription: filing.primaryDocumentDescription,
            sourceUrl: filing.sourceUrl,
            isAmendment: filing.isAmendment,
            amendsAccessionNumber: filing.amendsAccessionNumber,
            itemCodes: filing.itemCodes,
          },
          create: {
            secEntityId,
            ...filing,
          },
          select: { id: true, accessionNumber: true },
        });
        filingIds.set(record.accessionNumber, record.id);
      }

      return filingIds;
    });
  }

  async saveFacts(input: {
    secEntityId: string;
    rawSourceId: string;
    facts: NormalizedSecFact[];
    filingIds: Map<string, string>;
  }) {
    await db.$transaction(
      async (transaction) => {
        if (input.facts.length > 0) {
          const incomingExternalKeys = input.facts.map(
            ({ externalKey }) => externalKey,
          );
          const normalizationVersions = [
            ...new Set(
              input.facts.map(
                ({ normalizationVersion }) => normalizationVersion,
              ),
            ),
          ];

          await transaction.secFinancialFact.updateMany({
            where: {
              secEntityId: input.secEntityId,
              normalizationVersion: { in: normalizationVersions },
              selection: { in: ["SELECTED", "AMBIGUOUS"] },
              externalKey: { notIn: incomingExternalKeys },
            },
            data: {
              selection: "SUPERSEDED",
              ambiguityReason: null,
            },
          });
        }

        for (const normalizedFact of input.facts) {
          const { conceptPriority, ...fact } = normalizedFact;
          void conceptPriority;
          const data = {
            ...fact,
            secEntityId: input.secEntityId,
            filingId: input.filingIds.get(fact.accessionNumber) ?? null,
            rawSourceId: input.rawSourceId,
          } satisfies Prisma.SecFinancialFactUncheckedCreateInput;

          await transaction.secFinancialFact.upsert({
            where: { externalKey: fact.externalKey },
            update: data,
            create: data,
          });
        }
      },
      { timeout: SEC_FACT_PERSISTENCE_TRANSACTION_TIMEOUT_MS },
    );

    return {
      processed: input.facts.length,
      selected: input.facts.filter((fact) => fact.selection === "SELECTED")
        .length,
      ambiguous: input.facts.filter((fact) => fact.selection === "AMBIGUOUS")
        .length,
    };
  }

  async completeRun(input: {
    runId: string;
    companyId: string;
    completedAt: Date;
    filingsProcessed: number;
    factsProcessed: number;
    factsSelected: number;
    ambiguousFacts: number;
  }) {
    await db.$transaction([
      db.secIngestionRun.update({
        where: { id: input.runId },
        data: {
          status: "COMPLETED",
          completedAt: input.completedAt,
          filingsProcessed: input.filingsProcessed,
          factsProcessed: input.factsProcessed,
          factsSelected: input.factsSelected,
          ambiguousFacts: input.ambiguousFacts,
          errorCode: null,
          errorMessage: null,
        },
      }),
      db.company.update({
        where: { id: input.companyId },
        data: { lastSyncedAt: input.completedAt },
      }),
    ]);
  }

  async failRun(input: {
    runId: string;
    completedAt: Date;
    partiallyCompleted: boolean;
    filingsProcessed: number;
    factsProcessed: number;
    factsSelected: number;
    ambiguousFacts: number;
    errorCode: string;
    errorMessage: string;
  }) {
    await db.secIngestionRun.update({
      where: { id: input.runId },
      data: {
        status: input.partiallyCompleted ? "PARTIALLY_COMPLETED" : "FAILED",
        completedAt: input.completedAt,
        filingsProcessed: input.filingsProcessed,
        factsProcessed: input.factsProcessed,
        factsSelected: input.factsSelected,
        ambiguousFacts: input.ambiguousFacts,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage.slice(0, 500),
      },
    });
  }
}

export const prismaSecRepository = new PrismaSecRepository();
