export const JobErrorCode = {
  INVALID_PAYLOAD: "JOB_INVALID_PAYLOAD",
  PUBLISH_FAILED: "JOB_PUBLISH_FAILED",
  CONFIGURATION_ERROR: "JOB_CONFIGURATION_ERROR",
  TIMEOUT: "JOB_TIMEOUT",
  LOCKED: "JOB_LOCKED",
  NOT_FOUND: "JOB_NOT_FOUND",
  NOT_RETRYABLE: "JOB_NOT_RETRYABLE",
  UNSUPPORTED_TYPE: "JOB_UNSUPPORTED_TYPE",
  DATABASE_ERROR: "JOB_DATABASE_ERROR",
  WORKER_AUTH_FAILED: "JOB_WORKER_AUTH_FAILED",
  WORKER_SIGNATURE_MISSING: "JOB_WORKER_SIGNATURE_MISSING",
  CANCELLED: "JOB_CANCELLED",
} as const;

export type JobErrorCode =
  (typeof JobErrorCode)[keyof typeof JobErrorCode];

export class JobExecutionError extends Error {
  readonly name = "JobExecutionError";

  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
    public readonly partiallyCompleted = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class JobRequestError extends Error {
  readonly name = "JobRequestError";

  constructor(
    public readonly code: JobErrorCode,
    public readonly status: 400 | 401 | 404 | 409 | 429 | 503,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function classifyJobError(error: unknown) {
  if (error instanceof JobExecutionError) return error;

  if (
    error instanceof Error &&
    (error.name === "ZodError" || error.name === "SyntaxError")
  ) {
    return new JobExecutionError(
      JobErrorCode.INVALID_PAYLOAD,
      false,
      "The stored job payload is invalid.",
      false,
      { cause: error },
    );
  }

  return new JobExecutionError(
    JobErrorCode.DATABASE_ERROR,
    true,
    "The job failed before it could complete safely.",
    false,
    { cause: error },
  );
}
