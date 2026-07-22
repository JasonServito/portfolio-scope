import { cachePolicies, ephemeralStore, type EphemeralStore } from "@/lib/cache/redis";
import { getSecEdgarClient, type SecEdgarClient } from "@/lib/sec/client";
import { formatCik } from "@/lib/sec/company-registry";
import {
  secCompanyFactsSchema,
  secSubmissionsSchema,
} from "@/lib/sec/schemas";

type SourceClient = Pick<
  SecEdgarClient,
  "getSubmissions" | "getCompanyFacts"
>;

type CacheStore = Pick<EphemeralStore, "getJson" | "setJson">;

export class CachedSecEdgarClient implements SourceClient {
  constructor(
    private readonly source: SourceClient,
    private readonly cache: CacheStore = ephemeralStore,
  ) {}

  async getSubmissions(cik: string) {
    const identifier = `submissions:${formatCik(cik)}`;
    const cached = secSubmissionsSchema.safeParse(
      await this.cache.getJson("sec-source", identifier),
    );
    if (cached.success) return cached.data;

    const value = await this.source.getSubmissions(cik);
    await this.cache.setJson(
      "sec-source",
      identifier,
      value,
      cachePolicies.secSource.ttlSeconds,
    );
    return value;
  }

  async getCompanyFacts(cik: string) {
    const identifier = `company-facts:${formatCik(cik)}`;
    const cached = secCompanyFactsSchema.safeParse(
      await this.cache.getJson("sec-source", identifier),
    );
    if (cached.success) return cached.data;

    const value = await this.source.getCompanyFacts(cik);
    await this.cache.setJson(
      "sec-source",
      identifier,
      value,
      cachePolicies.secSource.ttlSeconds,
    );
    return value;
  }
}

let sharedCachedClient: CachedSecEdgarClient | undefined;

export function getCachedSecEdgarClient() {
  sharedCachedClient ??= new CachedSecEdgarClient(getSecEdgarClient());
  return sharedCachedClient;
}
