import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const MAX_CAPTURED_OUTPUT_BYTES = 64 * 1024;
const READ_ONLY_CONFIRMATION = "READ_ONLY_OK";

export const POSTGRES_DIAGNOSTIC_CATEGORIES = Object.freeze({
  authentication: "Authentication failure",
  dns: "DNS failure",
  tcp: "TCP connection failure",
  tls: "TLS/channel-binding failure",
  databaseRole: "Database/role failure",
  networkPolicy: "Network-policy failure",
  unknown: "Unknown failure",
});

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

export function classifyPostgresConnectionFailure(stderr) {
  const value = String(stderr ?? "").toLowerCase();

  if (
    matchesAny(value, [
      /could not translate host name/,
      /name or service not known/,
      /temporary failure in name resolution/,
      /getaddrinfo/,
      /nodename nor servname provided/,
      /no such host/,
    ])
  ) {
    return POSTGRES_DIAGNOSTIC_CATEGORIES.dns;
  }

  if (
    matchesAny(value, [
      /(?:ip|network|address).{0,80}(?:not allowed|not permitted|blocked)/,
      /access denied.{0,80}(?:ip|network|address)/,
      /network access/,
      /allowlist/,
      /no pg_hba\.conf entry/,
      /endpoint.{0,80}(?:disabled|suspended)/,
      /compute.{0,80}(?:disabled|suspended)/,
    ])
  ) {
    return POSTGRES_DIAGNOSTIC_CATEGORIES.networkPolicy;
  }

  if (
    matchesAny(value, [
      /channel[_ -]binding/,
      /ssl (?:error|connection|certificate|is required|was required|is not enabled)/,
      /server does not support ssl/,
      /sslmode/,
      /tls (?:error|handshake|connection|certificate)/,
      /certificate (?:verify|verification|has expired|is not trusted|problem|error)/,
      /connection is insecure/,
      /scram authentication requires/,
    ])
  ) {
    return POSTGRES_DIAGNOSTIC_CATEGORIES.tls;
  }

  if (
    matchesAny(value, [
      /password authentication failed/,
      /authentication failed/,
      /no password supplied/,
      /password has expired/,
      /invalid password/,
      /sasl authentication failed/,
    ])
  ) {
    return POSTGRES_DIAGNOSTIC_CATEGORIES.authentication;
  }

  if (
    matchesAny(value, [
      /database .{0,120} does not exist/,
      /role .{0,120} does not exist/,
      /permission denied/,
      /insufficient privilege/,
      /must be owner/,
      /does not have connect privilege/,
      /not permitted to log in/,
      /too many connections/,
      /remaining connection slots/,
    ])
  ) {
    return POSTGRES_DIAGNOSTIC_CATEGORIES.databaseRole;
  }

  if (
    matchesAny(value, [
      /connection refused/,
      /connection timed out/,
      /timeout expired/,
      /could not connect to server/,
      /no route to host/,
      /network is unreachable/,
      /connection reset/,
    ])
  ) {
    return POSTGRES_DIAGNOSTIC_CATEGORIES.tcp;
  }

  return POSTGRES_DIAGNOSTIC_CATEGORIES.unknown;
}

function appendBounded(current, chunk) {
  const combined = `${current}${String(chunk)}`;
  return combined.slice(-MAX_CAPTURED_OUTPUT_BYTES);
}

export function createPostgresDiagnosticInvocation(environment = process.env) {
  const directUrl = environment.DIRECT_URL?.trim();
  if (!directUrl) {
    throw new Error("PostgreSQL diagnostic configuration is unavailable.");
  }

  const existingPgOptions = environment.PGOPTIONS?.trim();
  const readOnlyPgOption = "-c default_transaction_read_only=on";

  return {
    command: "psql",
    args: [
      directUrl,
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-tA",
      "-c",
      [
        "BEGIN READ ONLY;",
        "SELECT CASE",
        "  WHEN current_setting('default_transaction_read_only') = 'on'",
        "   AND current_setting('transaction_read_only') = 'on'",
        `  THEN '${READ_ONLY_CONFIRMATION}'`,
        "  ELSE 'READ_ONLY_FAILED'",
        "END;",
        "ROLLBACK;",
      ].join("\n"),
    ],
    options: {
      env: {
        ...environment,
        PGOPTIONS: existingPgOptions
          ? `${existingPgOptions} ${readOnlyPgOption}`
          : readOnlyPgOption,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    },
  };
}

export async function runPostgresDiagnostic({
  environment = process.env,
  spawnProcess = spawn,
} = {}) {
  let invocation;
  try {
    invocation = createPostgresDiagnosticInvocation(environment);
  } catch {
    return {
      ok: false,
      category: POSTGRES_DIAGNOSTIC_CATEGORIES.unknown,
    };
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      stdout = "";
      stderr = "";
      resolve(result);
    };

    let child;
    try {
      child = spawnProcess(
        invocation.command,
        invocation.args,
        invocation.options,
      );
    } catch {
      finish({
        ok: false,
        category: POSTGRES_DIAGNOSTIC_CATEGORIES.unknown,
      });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on("error", () => {
      finish({
        ok: false,
        category: POSTGRES_DIAGNOSTIC_CATEGORIES.unknown,
      });
    });
    child.on("close", (code) => {
      if (code === 0 && stdout.trim() === READ_ONLY_CONFIRMATION) {
        finish({ ok: true });
        return;
      }

      finish({
        ok: false,
        category: classifyPostgresConnectionFailure(stderr),
      });
    });
  });
}

async function main() {
  const result = await runPostgresDiagnostic();

  if (result.ok) {
    console.info(
      "PostgreSQL diagnostic result: read-only connection verified.",
    );
    return;
  }

  console.error(`::error::PostgreSQL diagnostic result: ${result.category}`);
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
