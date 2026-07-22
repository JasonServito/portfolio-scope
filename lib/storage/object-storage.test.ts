import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }

  return {
    S3Client: class {
      send = sdkMocks.send;
    },
    PutObjectCommand: Command,
    GetObjectCommand: Command,
  };
});

import {
  InMemoryObjectStorage,
  R2ConfigurationError,
  R2ObjectStorage,
  validateObjectKey,
} from "@/lib/storage/object-storage";

describe("SEC object storage", () => {
  beforeEach(() => {
    sdkMocks.send.mockReset();
  });

  it("stores and retrieves private fixture bytes by a validated key", async () => {
    const storage = new InMemoryObjectStorage();
    const body = new TextEncoder().encode('{"source":"sec"}');

    await expect(
      storage.put({
        key: "sec/0000320193/company-facts/abc123.json",
        body,
        contentType: "application/json",
      }),
    ).resolves.toMatchObject({ byteLength: body.byteLength });
    await expect(
      storage.get("sec/0000320193/company-facts/abc123.json"),
    ).resolves.toEqual(body);
  });

  it.each(["", "/sec/a.json", "sec\\a.json", "sec/../a.json"])(
    "rejects unsafe object key %j",
    (key) => {
      expect(() => validateObjectKey(key)).toThrow(/key/i);
    },
  );

  it("fails closed when R2 server credentials are incomplete", () => {
    expect(
      () =>
        new R2ObjectStorage({
          R2_ACCOUNT_ID: "account",
          R2_ACCESS_KEY_ID: "key",
        }),
    ).toThrow(R2ConfigurationError);
  });

  it("derives the standard account endpoint when the optional endpoint is blank", () => {
    expect(
      () =>
        new R2ObjectStorage({
          R2_ACCOUNT_ID: "account",
          R2_ACCESS_KEY_ID: "key",
          R2_SECRET_ACCESS_KEY: "secret",
          R2_BUCKET_NAME: "private-sec-raw",
          R2_ENDPOINT: "",
        }),
    ).not.toThrow();
  });

  it("writes and reads objects through the private S3-compatible adapter", async () => {
    const storage = new R2ObjectStorage({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET_NAME: "private-sec-raw",
      R2_ENDPOINT: "",
    });
    const body = new TextEncoder().encode('{"source":"sec"}');
    sdkMocks.send.mockResolvedValueOnce({}).mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () => body,
      },
    });

    await expect(
      storage.put({
        key: "sec/0000320193/submissions/abc123.json",
        body,
        contentType: "application/json",
      }),
    ).resolves.toMatchObject({ byteLength: body.byteLength });
    await expect(
      storage.get("sec/0000320193/submissions/abc123.json"),
    ).resolves.toEqual(body);

    expect(sdkMocks.send).toHaveBeenCalledTimes(2);
    expect(sdkMocks.send.mock.calls[0][0]).toMatchObject({
      input: {
        Bucket: "private-sec-raw",
        Key: "sec/0000320193/submissions/abc123.json",
        ContentType: "application/json",
      },
    });
  });
});
