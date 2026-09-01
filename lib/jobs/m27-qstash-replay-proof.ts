import { createCipheriv, randomBytes } from "node:crypto";

import { buildRedisKey, getRedis, type RedisCommands } from "@/lib/cache/redis";

export const M27_QSTASH_REPLAY_PROOF_JOB_ID =
  "m27-qstash-replay-proof-20260901T160500Z";

const CAPTURE_CATEGORY = "m27:qstash-replay-capture";
const CAPTURE_TTL_SECONDS = 600;
const WORKER_PATH = "/api/internal/jobs/worker";
const CANONICAL_BODY = JSON.stringify({
  jobId: M27_QSTASH_REPLAY_PROOF_JOB_ID,
});

type CaptureRedis = Pick<RedisCommands, "set">;

type CompletedDuplicateResult = {
  jobId: string;
  status: string;
  duplicate: boolean;
};

type CaptureDependencies = {
  environment?: NodeJS.ProcessEnv;
  redis?: CaptureRedis | null;
};

function decodeCaptureKey(value: string | undefined) {
  const encoded = value?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return null;

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    key.fill(0);
    return null;
  }
  return key;
}

function captureWorkerUrl(value: string | undefined) {
  const configured = value?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      configured.includes("?") ||
      configured.includes("#") ||
      url.pathname !== WORKER_PATH
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function captureConfiguration(environment: NodeJS.ProcessEnv) {
  if (environment.VERCEL_ENV?.trim().toLowerCase() !== "preview") {
    return null;
  }
  if (
    environment.M27_QSTASH_REPLAY_CAPTURE_JOB_ID?.trim() !==
    M27_QSTASH_REPLAY_PROOF_JOB_ID
  ) {
    return null;
  }

  const encryptionKey = decodeCaptureKey(
    environment.M27_QSTASH_REPLAY_CAPTURE_KEY,
  );
  if (!encryptionKey) return null;

  const workerUrl = captureWorkerUrl(
    environment.M27_QSTASH_REPLAY_CAPTURE_WORKER_URL,
  );
  if (!workerUrl) {
    encryptionKey.fill(0);
    return null;
  }

  return {
    encryptionKey,
    workerUrl,
  };
}

export function prepareM27QstashReplayCapture(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = captureConfiguration(environment);
  if (!configuration) return null;

  configuration.encryptionKey.fill(0);
  if (request.url !== configuration.workerUrl) return null;

  try {
    return request.clone();
  } catch {
    return null;
  }
}

async function captureVerifiedRequest(
  request: Request,
  result: CompletedDuplicateResult,
  dependencies: CaptureDependencies,
) {
  const environment = dependencies.environment ?? process.env;
  const configuration = captureConfiguration(environment);
  if (!configuration) return;

  const { encryptionKey, workerUrl } = configuration;
  let plaintext: Buffer | undefined;
  try {
    if (
      result.jobId !== M27_QSTASH_REPLAY_PROOF_JOB_ID ||
      result.status !== "COMPLETED" ||
      result.duplicate !== true ||
      request.url !== workerUrl
    ) {
      return;
    }

    const signature = request.headers.get("upstash-signature");
    if (!signature) return;

    const rawBody = Buffer.from(await request.arrayBuffer());
    const expectedBody = Buffer.from(CANONICAL_BODY, "utf8");
    if (!rawBody.equals(expectedBody)) return;

    const redis =
      dependencies.redis !== undefined
        ? dependencies.redis
        : getRedis(environment);
    if (!redis) return;

    const additionalData = Buffer.from(
      `${M27_QSTASH_REPLAY_PROOF_JOB_ID}\n${workerUrl}`,
      "utf8",
    );
    const iv = randomBytes(12);
    plaintext = Buffer.from(
      JSON.stringify({
        version: 1,
        jobId: M27_QSTASH_REPLAY_PROOF_JOB_ID,
        url: request.url,
        rawBodyBase64: rawBody.toString("base64"),
        signature,
        capturedAt: new Date().toISOString(),
      }),
      "utf8",
    );

    const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    cipher.setAAD(additionalData);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    const authenticationTag = cipher.getAuthTag();

    await redis.set(
      buildRedisKey(
        CAPTURE_CATEGORY,
        M27_QSTASH_REPLAY_PROOF_JOB_ID,
        environment,
      ),
      {
        version: 1,
        iv: iv.toString("base64"),
        tag: authenticationTag.toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      },
      { ex: CAPTURE_TTL_SECONDS, nx: true },
    );
  } finally {
    plaintext?.fill(0);
    encryptionKey.fill(0);
  }
}

export async function captureM27QstashReplayRequest(
  request: Request,
  result: CompletedDuplicateResult,
  dependencies: CaptureDependencies = {},
) {
  try {
    await captureVerifiedRequest(request, result, dependencies);
  } catch {
    // The temporary proof capture must never affect or report worker behavior.
  }
}
