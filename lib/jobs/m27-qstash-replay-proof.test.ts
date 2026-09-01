import { createDecipheriv } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  captureM27QstashReplayRequest,
  M27_QSTASH_REPLAY_PROOF_JOB_ID,
  prepareM27QstashReplayCapture,
} from "@/lib/jobs/m27-qstash-replay-proof";

const stableOrigin = "https://stable-staging.example.test";
const disposableOrigin =
  "https://portfolio-scope-git-c-31d069-jasonservito000-gmailcoms-projects.vercel.app";
const workerUrl = `${disposableOrigin}/api/internal/jobs/worker`;
const canonicalBody = JSON.stringify({
  jobId: M27_QSTASH_REPLAY_PROOF_JOB_ID,
});
const signature = "qstash-generated-signature-value";
const captureKey = Buffer.alloc(32, 7).toString("base64");

function previewEnvironment(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_APP_URL: stableOrigin,
    M27_QSTASH_REPLAY_CAPTURE_JOB_ID: M27_QSTASH_REPLAY_PROOF_JOB_ID,
    M27_QSTASH_REPLAY_CAPTURE_KEY: captureKey,
    M27_QSTASH_REPLAY_CAPTURE_WORKER_URL: workerUrl,
    ...overrides,
  };
}

function request(
  input: { url?: string; body?: string; signature?: string | null } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (input.signature !== null) {
    headers.set("Upstash-Signature", input.signature ?? signature);
  }
  return new Request(input.url ?? workerUrl, {
    method: "POST",
    headers,
    body: input.body ?? canonicalBody,
  });
}

function completedDuplicate(
  overrides: Partial<{
    jobId: string;
    status: string;
    duplicate: boolean;
  }> = {},
) {
  return {
    jobId: M27_QSTASH_REPLAY_PROOF_JOB_ID,
    status: "COMPLETED",
    duplicate: true,
    ...overrides,
  };
}

class FakeCaptureRedis {
  readonly calls: Array<{
    key: string;
    value: unknown;
    options: { ex?: number; nx?: boolean } | undefined;
  }> = [];
  readonly values = new Map<string, unknown>();

  async set(
    key: string,
    value: unknown,
    options?: { ex?: number; nx?: boolean },
  ) {
    this.calls.push({ key, value, options });
    if (options?.nx && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }
}

describe("temporary M27 QStash replay capture", () => {
  it("never prepares or captures in Production", async () => {
    const redis = new FakeCaptureRedis();
    const environment = previewEnvironment({ VERCEL_ENV: "production" });
    const incoming = request();

    expect(prepareM27QstashReplayCapture(incoming, environment)).toBeNull();
    await captureM27QstashReplayRequest(incoming, completedDuplicate(), {
      environment,
      redis,
    });

    expect(redis.calls).toHaveLength(0);
  });

  it.each([
    ["missing proof job", { M27_QSTASH_REPLAY_CAPTURE_JOB_ID: undefined }],
    ["wrong proof job", { M27_QSTASH_REPLAY_CAPTURE_JOB_ID: "wrong-job" }],
    ["missing key", { M27_QSTASH_REPLAY_CAPTURE_KEY: undefined }],
    ["non-base64 key", { M27_QSTASH_REPLAY_CAPTURE_KEY: "not-base64" }],
    ["missing worker URL", { M27_QSTASH_REPLAY_CAPTURE_WORKER_URL: undefined }],
    [
      "wrong key length",
      { M27_QSTASH_REPLAY_CAPTURE_KEY: Buffer.alloc(31).toString("base64") },
    ],
  ])("does not prepare or capture with %s", async (_label, overrides) => {
    const redis = new FakeCaptureRedis();
    const environment = previewEnvironment(overrides);
    expect(prepareM27QstashReplayCapture(request(), environment)).toBeNull();
    await captureM27QstashReplayRequest(request(), completedDuplicate(), {
      environment,
      redis,
    });
    expect(redis.calls).toHaveLength(0);
  });

  it("clones only the exact canonical Preview worker request", () => {
    const incoming = request();
    const prepared = prepareM27QstashReplayCapture(
      incoming,
      previewEnvironment(),
    );

    expect(prepared).toBeInstanceOf(Request);
    expect(prepared).not.toBe(incoming);
  });

  it.each([
    ["wrong host", { requestUrl: `${stableOrigin}/api/internal/jobs/worker` }],
    [
      "wrong path",
      {
        configuredUrl: `${disposableOrigin}/api/internal/jobs/worker/`,
      },
    ],
    [
      "HTTP URL",
      {
        configuredUrl: workerUrl.replace("https://", "http://"),
      },
    ],
    [
      "credentials",
      {
        configuredUrl: workerUrl.replace("https://", "https://user:password@"),
      },
    ],
    ["query", { configuredUrl: `${workerUrl}?proof=true` }],
    ["fragment", { configuredUrl: `${workerUrl}#proof` }],
  ])("rejects a worker URL with %s", async (_label, input) => {
    const redis = new FakeCaptureRedis();
    const configuredUrl =
      "configuredUrl" in input ? input.configuredUrl : workerUrl;
    const requestUrl = "requestUrl" in input ? input.requestUrl : workerUrl;
    const environment = previewEnvironment({
      M27_QSTASH_REPLAY_CAPTURE_WORKER_URL: configuredUrl,
    });
    const incoming = request({ url: requestUrl });

    expect(prepareM27QstashReplayCapture(incoming, environment)).toBeNull();
    await captureM27QstashReplayRequest(incoming, completedDuplicate(), {
      environment,
      redis,
    });
    expect(redis.calls).toHaveLength(0);
  });

  it.each([
    [
      "wrong URL",
      request({ url: `${disposableOrigin}/api/internal/jobs/worker/` }),
      {},
    ],
    ["wrong body", request({ body: `${canonicalBody}\n` }), {}],
    ["missing signature", request({ signature: null }), {}],
    ["wrong job", request(), { jobId: "another-job" }],
    ["wrong status", request(), { status: "FAILED" }],
    ["non-duplicate result", request(), { duplicate: false }],
  ])("does not capture a request with %s", async (_label, incoming, result) => {
    const redis = new FakeCaptureRedis();

    await captureM27QstashReplayRequest(incoming, completedDuplicate(result), {
      environment: previewEnvironment(),
      redis,
    });

    expect(redis.calls).toHaveLength(0);
  });

  it("stores only AES-GCM ciphertext with NX and a 600-second TTL", async () => {
    const redis = new FakeCaptureRedis();
    await captureM27QstashReplayRequest(request(), completedDuplicate(), {
      environment: previewEnvironment(),
      redis,
    });

    expect(redis.calls).toHaveLength(1);
    const call = redis.calls[0]!;
    expect(call.options).toEqual({ ex: 600, nx: true });
    expect(call.key).toMatch(
      /^portfolioscope:preview:m27:qstash-replay-capture:[a-f0-9]{32}$/,
    );
    expect(call.value).toEqual({
      version: 1,
      iv: expect.any(String),
      tag: expect.any(String),
      ciphertext: expect.any(String),
    });

    const serialized = JSON.stringify(call.value);
    expect(serialized).not.toContain(signature);
    expect(serialized).not.toContain(workerUrl);
    expect(serialized).not.toContain(canonicalBody);
    expect(serialized).not.toContain(M27_QSTASH_REPLAY_PROOF_JOB_ID);

    const encrypted = call.value as {
      iv: string;
      tag: string;
      ciphertext: string;
    };
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(captureKey, "base64"),
      Buffer.from(encrypted.iv, "base64"),
    );
    decipher.setAAD(
      Buffer.from(`${M27_QSTASH_REPLAY_PROOF_JOB_ID}\n${workerUrl}`, "utf8"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");

    expect(JSON.parse(plaintext)).toEqual({
      version: 1,
      jobId: M27_QSTASH_REPLAY_PROOF_JOB_ID,
      url: workerUrl,
      rawBodyBase64: Buffer.from(canonicalBody).toString("base64"),
      signature,
      capturedAt: expect.any(String),
    });
  });

  it("cannot overwrite the first capture", async () => {
    const redis = new FakeCaptureRedis();
    const dependencies = { environment: previewEnvironment(), redis };

    await captureM27QstashReplayRequest(
      request(),
      completedDuplicate(),
      dependencies,
    );
    const firstValue = [...redis.values.values()][0];
    await captureM27QstashReplayRequest(
      request({ signature: "later-signature" }),
      completedDuplicate(),
      dependencies,
    );

    expect(redis.calls).toHaveLength(2);
    expect([...redis.values.values()][0]).toBe(firstValue);
  });

  it("silently swallows capture and storage failures", async () => {
    const redis = {
      set: vi
        .fn()
        .mockRejectedValue(new Error(`failed command contained ${signature}`)),
    };

    await expect(
      captureM27QstashReplayRequest(request(), completedDuplicate(), {
        environment: previewEnvironment(),
        redis,
      }),
    ).resolves.toBeUndefined();
  });
});
