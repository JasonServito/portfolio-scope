import { createCipheriv, createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import {
  formatM27QstashReplayResults,
  runM27QstashReplayProof,
} from "./m27-qstash-replay-proof.mjs";

const proofJobId = "m27-qstash-replay-proof-20260901T160500Z";
const workerUrl = "https://m27-preview.example.test/api/internal/jobs/worker";
const rawBody = Buffer.from(JSON.stringify({ jobId: proofJobId }));
const key = Buffer.alloc(32, 11);
const signatureSecret = "signature-must-never-be-printed";

function jwt(exp) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"),
    Buffer.from(JSON.stringify({ exp })).toString("base64url"),
    signatureSecret,
  ].join(".");
}

function captureRecord(signature) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${proofJobId}\n${workerUrl}`));
  const plaintext = Buffer.from(
    JSON.stringify({
      version: 1,
      jobId: proofJobId,
      url: workerUrl,
      rawBodyBase64: rawBody.toString("base64"),
      signature,
      capturedAt: "2026-09-01T16:06:00.000Z",
    }),
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function redisKey() {
  const digest = createHash("sha256")
    .update(proofJobId)
    .digest("hex")
    .slice(0, 32);
  return `portfolioscope:preview:m27:qstash-replay-capture:${digest}`;
}

test("replays the same decrypted request, waits for expiry, and deletes capture", async () => {
  const now = Date.parse("2026-09-01T16:06:00.000Z");
  const signature = jwt(Math.floor(now / 1000) + 30);
  const values = new Map([[redisKey(), captureRecord(signature)]]);
  const redis = {
    async get(keyName) {
      return values.get(keyName) ?? null;
    },
    async del(keyName) {
      return values.delete(keyName) ? 1 : 0;
    },
    async exists(keyName) {
      return values.has(keyName) ? 1 : 0;
    },
  };
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({
      url,
      signature: init.headers["Upstash-Signature"],
      body: Buffer.from(init.body),
      redirect: init.redirect,
    });
    return requests.length === 1
      ? Response.json(
          { jobId: proofJobId, status: "COMPLETED", duplicate: true },
          { status: 200 },
        )
      : Response.json(
          {
            error: "The worker signature is invalid.",
            code: "JOB_WORKER_AUTH_FAILED",
          },
          { status: 401 },
        );
  };
  const waits = [];

  const results = await runM27QstashReplayProof({
    environment: {
      M27_QSTASH_REPLAY_CAPTURE_KEY: key.toString("base64"),
      M27_PREVIEW_WORKER_URL: workerUrl,
      M27_VERCEL_BYPASS_SECRET: "preview-bypass",
    },
    redis,
    fetchImpl,
    now: () => now,
    sleep: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(results.passed, true);
  assert.equal(results.captureFound, true);
  assert.equal(results.captureDeleted, true);
  assert.equal(results.validReplay.status, 200);
  assert.equal(results.validReplay.duplicate, true);
  assert.equal(results.expiredReplay.status, 401);
  assert.equal(results.expiredReplay.code, "JOB_WORKER_AUTH_FAILED");
  assert.deepEqual(waits, [36_000]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, workerUrl);
  assert.equal(requests[1].url, workerUrl);
  assert.equal(requests[0].signature, signature);
  assert.equal(requests[1].signature, signature);
  assert.deepEqual(requests[0].body, rawBody);
  assert.deepEqual(requests[1].body, rawBody);
  assert.equal(requests[0].redirect, "manual");
  assert.equal(requests[1].redirect, "manual");

  const output = formatM27QstashReplayResults(results);
  assert.equal(output.includes(signature), false);
  assert.equal(output.includes(signatureSecret), false);
  assert.equal(
    output,
    [
      "captureFound=true",
      "validReplay.status=200",
      "validReplay.duplicate=true",
      "expiredReplay.status=401",
      "expiredReplay.code=JOB_WORKER_AUTH_FAILED",
      "captureDeleted=true",
    ].join("\n"),
  );
});

test("does not reveal a signature when replay fails", async () => {
  const now = Date.parse("2026-09-01T16:06:00.000Z");
  const signature = jwt(Math.floor(now / 1000) + 30);
  const values = new Map([[redisKey(), captureRecord(signature)]]);
  const results = await runM27QstashReplayProof({
    environment: {
      M27_QSTASH_REPLAY_CAPTURE_KEY: key.toString("base64"),
      M27_PREVIEW_WORKER_URL: workerUrl,
    },
    redis: {
      async get(keyName) {
        return values.get(keyName) ?? null;
      },
      async del(keyName) {
        return values.delete(keyName) ? 1 : 0;
      },
      async exists(keyName) {
        return values.has(keyName) ? 1 : 0;
      },
    },
    fetchImpl: async () => {
      throw new Error(`request failed for ${signature}`);
    },
    now: () => now,
    sleep: async () => undefined,
  });

  const output = formatM27QstashReplayResults(results);
  assert.equal(results.passed, false);
  assert.equal(results.captureDeleted, true);
  assert.equal(output.includes(signature), false);
  assert.equal(output.includes(signatureSecret), false);
});

test("allowlists the expired-response code before printing it", async () => {
  const now = Date.parse("2026-09-01T16:06:00.000Z");
  const signature = jwt(Math.floor(now / 1000) + 30);
  const values = new Map([[redisKey(), captureRecord(signature)]]);
  let requestCount = 0;
  const results = await runM27QstashReplayProof({
    environment: {
      M27_QSTASH_REPLAY_CAPTURE_KEY: key.toString("base64"),
      M27_PREVIEW_WORKER_URL: workerUrl,
    },
    redis: {
      async get(keyName) {
        return values.get(keyName) ?? null;
      },
      async del(keyName) {
        return values.delete(keyName) ? 1 : 0;
      },
      async exists(keyName) {
        return values.has(keyName) ? 1 : 0;
      },
    },
    fetchImpl: async () => {
      requestCount += 1;
      return requestCount === 1
        ? Response.json(
            { jobId: proofJobId, status: "COMPLETED", duplicate: true },
            { status: 200 },
          )
        : Response.json(
            { code: `${signature}\ninjected-output=true` },
            { status: 401 },
          );
    },
    now: () => now,
    sleep: async () => undefined,
  });

  const output = formatM27QstashReplayResults(results);
  assert.equal(results.passed, false);
  assert.equal(results.expiredReplay.code, "unexpected");
  assert.equal(output.includes(signature), false);
  assert.equal(output.includes(signatureSecret), false);
  assert.equal(output.includes("injected-output"), false);
});
