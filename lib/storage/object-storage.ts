import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";

const r2EnvironmentSchema = z.object({
  R2_ACCOUNT_ID: z.string().trim().min(1),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
  R2_BUCKET_NAME: z.string().trim().min(1),
  R2_ENDPOINT: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().url().optional(),
  ),
});

export class R2ConfigurationError extends Error {
  readonly name = "R2ConfigurationError";
}

export type StoredObject = {
  key: string;
  contentType: string;
  byteLength: number;
};

export interface ObjectStorage {
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array | null>;
}

export function validateObjectKey(key: string) {
  if (
    key.length === 0 ||
    key.length > 1024 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error("Object key is not valid.");
  }

  return key;
}

export function validateObjectPrefix(prefix: string) {
  const normalized = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (
    normalized.length === 0 ||
    normalized.length > 1023 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized
      .split("/")
      .some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error("Object prefix is not valid.");
  }
  return `${normalized}/`;
}

export class R2ObjectStorage implements ObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(environment: Record<string, string | undefined> = process.env) {
    const parsed = r2EnvironmentSchema.safeParse(environment);
    if (!parsed.success) {
      throw new R2ConfigurationError(
        "R2 account, bucket, and server credentials are required.",
        { cause: parsed.error },
      );
    }
    const config = parsed.data;
    this.bucket = config.R2_BUCKET_NAME;
    this.client = new S3Client({
      region: "auto",
      endpoint:
        config.R2_ENDPOINT ??
        `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  async put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<StoredObject> {
    const key = validateObjectKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );

    return {
      key,
      contentType: input.contentType,
      byteLength: input.body.byteLength,
    };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: validateObjectKey(key),
        }),
      );

      return response.Body
        ? Uint8Array.from(await response.Body.transformToByteArray())
        : null;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "NoSuchKey" || error.name === "NotFound")
      ) {
        return null;
      }

      throw error;
    }
  }

  async list(prefix: string, take = 20) {
    const response = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: validateObjectPrefix(prefix),
        MaxKeys: Math.min(Math.max(Math.floor(take), 1), 100),
      }),
    );

    return (response.Contents ?? [])
      .filter(
        (
          object,
        ): object is typeof object & {
          Key: string;
        } => Boolean(object.Key),
      )
      .map((object) => ({
        key: object.Key,
        byteLength: object.Size ?? 0,
        lastModified: object.LastModified ?? null,
      }))
      .sort((left, right) => {
        const leftTime = left.lastModified?.getTime() ?? 0;
        const rightTime = right.lastModified?.getTime() ?? 0;
        return rightTime - leftTime;
      });
  }
}

export class InMemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();

  async put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<StoredObject> {
    const key = validateObjectKey(input.key);
    this.objects.set(key, Uint8Array.from(input.body));

    return {
      key,
      contentType: input.contentType,
      byteLength: input.body.byteLength,
    };
  }

  async get(key: string) {
    const value = this.objects.get(validateObjectKey(key));
    return value ? Uint8Array.from(value) : null;
  }
}
