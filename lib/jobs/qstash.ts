import { Client, Receiver } from "@upstash/qstash";
import { z } from "zod";

import { JobErrorCode, JobRequestError } from "@/lib/jobs/errors";
import { getApplicationOrigin } from "@/lib/jobs/config";
import { jobDeliverySchema } from "@/lib/jobs/types";

const qstashClientEnvironmentSchema = z.object({
  QSTASH_TOKEN: z.string().trim().min(1),
});

const qstashReceiverEnvironmentSchema = z.object({
  QSTASH_CURRENT_SIGNING_KEY: z.string().trim().min(1),
  QSTASH_NEXT_SIGNING_KEY: z.string().trim().min(1),
});

export interface JobPublisher {
  publishJSON(input: {
    url: string;
    body: { jobId: string };
    retries: number;
    retryDelay: string;
    timeout: number;
    deduplicationId: string;
    label: string[];
    headers: { "x-correlation-id": string };
    redact: { body: true };
  }): Promise<{ messageId: string }>;
}

export interface SignatureReceiver {
  verify(input: {
    signature: string;
    body: string;
    url: string;
    clockTolerance: number;
  }): Promise<boolean>;
}

let sharedClient: Client | undefined;
let sharedReceiver: Receiver | undefined;

export function getQstashClient(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = qstashClientEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Background job delivery is not configured.",
      { cause: parsed.error },
    );
  }

  sharedClient ??= new Client({ token: parsed.data.QSTASH_TOKEN });
  return sharedClient;
}

export function getQstashReceiver(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const parsed = qstashReceiverEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "Background worker verification is not configured.",
      { cause: parsed.error },
    );
  }

  sharedReceiver ??= new Receiver({
    currentSigningKey: parsed.data.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: parsed.data.QSTASH_NEXT_SIGNING_KEY,
  });
  return sharedReceiver;
}

export async function publishJobMessage(input: {
  jobId: string;
  type: string;
  maxAttempts: number;
  timeoutMs: number;
  correlationId: string;
  deduplicationId?: string;
  publisher?: JobPublisher;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = input.environment ?? process.env;
  const origin = getApplicationOrigin(environment);
  if (!origin) {
    throw new JobRequestError(
      JobErrorCode.CONFIGURATION_ERROR,
      503,
      "The public application origin is not configured for job delivery.",
    );
  }

  const publisher = input.publisher ?? getQstashClient(environment);
  const response = await publisher.publishJSON({
    url: `${origin}/api/internal/jobs/worker`,
    body: { jobId: input.jobId },
    retries: Math.max(0, input.maxAttempts - 1),
    retryDelay: "min(300000, 15000 * pow(2, retried))",
    timeout: Math.max(1, Math.ceil(input.timeoutMs / 1000)),
    deduplicationId: input.deduplicationId ?? input.jobId,
    label: ["portfolioscope", input.type.toLowerCase()],
    headers: { "x-correlation-id": input.correlationId },
    redact: { body: true },
  });
  if (!("messageId" in response) || typeof response.messageId !== "string") {
    throw new JobRequestError(
      JobErrorCode.PUBLISH_FAILED,
      503,
      "QStash returned an invalid publish response.",
    );
  }
  return { messageId: response.messageId };
}

export async function verifyQstashRequest(
  request: Request,
  input: {
    receiver?: SignatureReceiver;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const body = await verifyQstashSignature(request, input);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(body);
  } catch (error) {
    throw new JobRequestError(
      JobErrorCode.INVALID_PAYLOAD,
      400,
      "The worker payload is invalid.",
      { cause: error },
    );
  }

  const parsed = jobDeliverySchema.safeParse(parsedBody);
  if (!parsed.success) {
    throw new JobRequestError(
      JobErrorCode.INVALID_PAYLOAD,
      400,
      "The worker payload is invalid.",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

export async function verifyQstashSignature(
  request: Request,
  input: {
    receiver?: SignatureReceiver;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    throw new JobRequestError(
      JobErrorCode.WORKER_SIGNATURE_MISSING,
      401,
      "A valid worker signature is required.",
    );
  }

  const body = await request.text();
  const receiver =
    input.receiver ?? getQstashReceiver(input.environment ?? process.env);
  try {
    const valid = await receiver.verify({
      signature,
      body,
      url: request.url,
      clockTolerance: 5,
    });
    if (!valid) throw new Error("Signature did not validate.");
  } catch (error) {
    throw new JobRequestError(
      JobErrorCode.WORKER_AUTH_FAILED,
      401,
      "The worker signature is invalid.",
      { cause: error },
    );
  }

  return body;
}
