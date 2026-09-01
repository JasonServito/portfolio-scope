import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

import { Redis } from "@upstash/redis";

const PROOF_JOB_ID = "m27-qstash-replay-proof-20260901T160500Z";
const CAPTURE_CATEGORY = "m27:qstash-replay-capture";
const WORKER_PATH = "/api/internal/jobs/worker";
const CANONICAL_BODY = Buffer.from(
  JSON.stringify({ jobId: PROOF_JOB_ID }),
  "utf8",
);
const MAXIMUM_EXPIRY_WAIT_MS = 600_000;

function requiredEnvironment(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error("invalid proof configuration");
  return value;
}

function encryptionKey(environment) {
  const encoded = requiredEnvironment(
    environment,
    "M27_QSTASH_REPLAY_CAPTURE_KEY",
  );
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw new Error("invalid proof configuration");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    throw new Error("invalid proof configuration");
  }
  return key;
}

function expectedWorkerUrl(environment) {
  const value = requiredEnvironment(environment, "M27_PREVIEW_WORKER_URL");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== WORKER_PATH ||
    url.search ||
    url.hash ||
    url.toString() !== value
  ) {
    throw new Error("invalid proof configuration");
  }
  return value;
}

function captureKey() {
  const digest = createHash("sha256")
    .update(PROOF_JOB_ID)
    .digest("hex")
    .slice(0, 32);
  return `portfolioscope:preview:${CAPTURE_CATEGORY}:${digest}`;
}

function encryptedRecord(value) {
  const record =
    typeof value === "string" ? JSON.parse(value) : structuredClone(value);
  if (
    !record ||
    record.version !== 1 ||
    typeof record.iv !== "string" ||
    typeof record.tag !== "string" ||
    typeof record.ciphertext !== "string"
  ) {
    throw new Error("invalid capture");
  }
  return record;
}

function decryptCapture(record, key, workerUrl) {
  const iv = Buffer.from(record.iv, "base64");
  const tag = Buffer.from(record.tag, "base64");
  const ciphertext = Buffer.from(record.ciphertext, "base64");
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error("invalid capture");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`${PROOF_JOB_ID}\n${workerUrl}`, "utf8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  try {
    return { capture: JSON.parse(plaintext.toString("utf8")), plaintext };
  } catch {
    plaintext.fill(0);
    throw new Error("invalid capture");
  }
}

function validateCapture(capture, workerUrl) {
  if (
    !capture ||
    capture.version !== 1 ||
    capture.jobId !== PROOF_JOB_ID ||
    capture.url !== workerUrl ||
    typeof capture.rawBodyBase64 !== "string" ||
    typeof capture.signature !== "string" ||
    capture.signature.length === 0 ||
    typeof capture.capturedAt !== "string"
  ) {
    throw new Error("invalid capture");
  }

  const rawBody = Buffer.from(capture.rawBodyBase64, "base64");
  if (
    rawBody.length !== CANONICAL_BODY.length ||
    !timingSafeEqual(rawBody, CANONICAL_BODY)
  ) {
    rawBody.fill(0);
    throw new Error("invalid capture");
  }

  const segments = capture.signature.split(".");
  if (segments.length !== 3) {
    rawBody.fill(0);
    throw new Error("invalid capture");
  }
  const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString());
  if (!Number.isSafeInteger(claims.exp) || claims.exp <= 0) {
    rawBody.fill(0);
    throw new Error("invalid capture");
  }

  return { rawBody, expiresAtMs: claims.exp * 1_000 };
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function initialResults() {
  return {
    captureFound: false,
    validReplay: { status: "not-run", duplicate: false },
    expiredReplay: { status: "not-run", code: "not-run" },
    captureDeleted: false,
    passed: false,
  };
}

export async function runM27QstashReplayProof({
  environment = process.env,
  redis,
  fetchImpl = fetch,
  now = () => Date.now(),
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const results = initialResults();
  let client = redis;
  let key;
  let keyBytes;
  let plaintext;
  let rawBody;
  let capture;

  try {
    const workerUrl = expectedWorkerUrl(environment);
    keyBytes = encryptionKey(environment);
    key = captureKey();
    client ??= new Redis({
      url: requiredEnvironment(environment, "UPSTASH_REDIS_REST_URL"),
      token: requiredEnvironment(environment, "UPSTASH_REDIS_REST_TOKEN"),
      enableAutoPipelining: false,
    });

    const stored = await client.get(key);
    if (stored === null) throw new Error("capture missing");
    results.captureFound = true;

    const decrypted = decryptCapture(
      encryptedRecord(stored),
      keyBytes,
      workerUrl,
    );
    capture = decrypted.capture;
    plaintext = decrypted.plaintext;
    const validated = validateCapture(capture, workerUrl);
    rawBody = validated.rawBody;

    const remainingValidityMs = validated.expiresAtMs - now();
    if (remainingValidityMs <= 10_000) {
      throw new Error("capture is too close to expiry");
    }

    const headers = {
      "Content-Type": "application/json",
      "Upstash-Signature": capture.signature,
    };
    const bypass = environment.M27_VERCEL_BYPASS_SECRET?.trim();
    if (bypass) headers["x-vercel-protection-bypass"] = bypass;

    const validResponse = await fetchImpl(workerUrl, {
      method: "POST",
      redirect: "manual",
      headers,
      body: rawBody,
    });
    const validBody = await responseJson(validResponse);
    results.validReplay.status = validResponse.status;
    results.validReplay.duplicate = validBody?.duplicate === true;
    if (
      validResponse.status !== 200 ||
      validBody?.jobId !== PROOF_JOB_ID ||
      validBody?.status !== "COMPLETED" ||
      validBody?.duplicate !== true
    ) {
      throw new Error("valid replay failed");
    }

    const expiryWaitMs = Math.max(0, validated.expiresAtMs + 6_000 - now());
    if (expiryWaitMs > MAXIMUM_EXPIRY_WAIT_MS) {
      throw new Error("invalid expiry window");
    }
    if (expiryWaitMs > 0) await sleep(expiryWaitMs);

    const expiredResponse = await fetchImpl(workerUrl, {
      method: "POST",
      redirect: "manual",
      headers,
      body: rawBody,
    });
    const expiredBody = await responseJson(expiredResponse);
    results.expiredReplay.status = expiredResponse.status;
    results.expiredReplay.code =
      expiredBody?.code === "JOB_WORKER_AUTH_FAILED"
        ? "JOB_WORKER_AUTH_FAILED"
        : "unexpected";
    if (
      expiredResponse.status !== 401 ||
      results.expiredReplay.code !== "JOB_WORKER_AUTH_FAILED"
    ) {
      throw new Error("expired replay failed");
    }

    results.passed = true;
  } catch {
    results.passed = false;
  } finally {
    if (capture && typeof capture === "object") capture.signature = "";
    rawBody?.fill(0);
    plaintext?.fill(0);
    keyBytes?.fill(0);

    if (client && key) {
      try {
        await client.del(key);
        results.captureDeleted = (await client.exists(key)) === 0;
      } catch {
        results.captureDeleted = false;
      }
    }
  }

  return results;
}

export function formatM27QstashReplayResults(results) {
  return [
    `captureFound=${results.captureFound}`,
    `validReplay.status=${results.validReplay.status}`,
    `validReplay.duplicate=${results.validReplay.duplicate}`,
    `expiredReplay.status=${results.expiredReplay.status}`,
    `expiredReplay.code=${results.expiredReplay.code}`,
    `captureDeleted=${results.captureDeleted}`,
  ].join("\n");
}

async function main() {
  const results = await runM27QstashReplayProof();
  process.stdout.write(`${formatM27QstashReplayResults(results)}\n`);
  process.exitCode = results.passed && results.captureDeleted ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
