import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "postgres",
  "host.docker.internal",
]);

const REMOTE_TARGETS = new Set(["preview", "production", "restore-drill"]);

const PRISMA_ARGUMENTS = {
  "migrate-dev": ["migrate", "dev"],
  "migrate-deploy": ["migrate", "deploy"],
};
const SUPPORTED_OPERATIONS = new Set([
  ...Object.keys(PRISMA_ARGUMENTS),
  "seed",
]);

function parseDatabaseUrl(label, value) {
  if (!value) {
    throw new Error(`${label} is required.`);
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      throw new Error("unsupported protocol");
    }
    return parsed;
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }
}

function databaseName(parsed) {
  return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
}

export function expectedConfirmation(operation, target) {
  const normalizedTarget = target.toUpperCase().replaceAll("-", "_");
  if (operation === "migrate-deploy") {
    return `APPLY_${normalizedTarget}_MIGRATIONS`;
  }
  if (operation === "seed") {
    return `SEED_${normalizedTarget}_DATABASE`;
  }
  throw new Error("Remote development migrations are not supported.");
}

export function validateDatabaseTarget({
  operation,
  databaseUrl,
  directUrl,
  approvedRemote = false,
  target,
  confirmation,
  nodeEnvironment,
  vercelEnvironment,
}) {
  if (!SUPPORTED_OPERATIONS.has(operation)) {
    throw new Error("Unknown guarded Prisma operation.");
  }

  const runtime = parseDatabaseUrl("DATABASE_URL", databaseUrl);
  const migration = parseDatabaseUrl("DIRECT_URL", directUrl);

  if (
    !databaseName(runtime) ||
    databaseName(runtime) !== databaseName(migration)
  ) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL must identify the same database name.",
    );
  }

  if (!approvedRemote) {
    if (
      nodeEnvironment?.toLowerCase() === "production" ||
      vercelEnvironment?.toLowerCase() === "production"
    ) {
      throw new Error(
        "Routine Prisma commands are disabled in Production environments.",
      );
    }

    for (const connection of [runtime, migration]) {
      if (!LOCAL_HOSTS.has(connection.hostname.toLowerCase())) {
        throw new Error(
          "Routine Prisma commands are restricted to local database hosts. Use the approved remote procedure for Preview or Production.",
        );
      }
    }
    return { scope: "local" };
  }

  if (!REMOTE_TARGETS.has(target)) {
    throw new Error(
      "MIGRATION_TARGET must be preview, production, or restore-drill.",
    );
  }

  const expected = expectedConfirmation(operation, target);
  if (confirmation !== expected) {
    throw new Error(`MIGRATION_CONFIRMATION must equal ${expected}.`);
  }

  return { scope: target };
}

export function operationCommand(
  operation,
  { cwd = process.cwd(), nodeExecutable = process.execPath } = {},
) {
  if (operation === "seed") {
    return {
      command: nodeExecutable,
      arguments: [join(cwd, "prisma", "seed.mjs")],
    };
  }

  if (!Object.hasOwn(PRISMA_ARGUMENTS, operation)) {
    throw new Error("Unknown guarded Prisma operation.");
  }

  return {
    command: nodeExecutable,
    arguments: [
      join(cwd, "node_modules", "prisma", "build", "index.js"),
      ...PRISMA_ARGUMENTS[operation],
    ],
  };
}

function loadRepositoryEnvironment() {
  if (process.env.DATABASE_URL && process.env.DIRECT_URL) {
    return;
  }

  try {
    process.loadEnvFile(resolve(process.cwd(), ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function run() {
  const [operation, ...flags] = process.argv.slice(2);
  const approvedRemote = flags.includes("--approved-remote");

  loadRepositoryEnvironment();
  const result = validateDatabaseTarget({
    operation,
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
    approvedRemote,
    target: process.env.MIGRATION_TARGET,
    confirmation: process.env.MIGRATION_CONFIRMATION,
    nodeEnvironment: process.env.NODE_ENV,
    vercelEnvironment: process.env.VERCEL_ENV,
  });

  const childCommand = operationCommand(operation);

  console.log(`Running guarded Prisma operation for ${result.scope}.`);
  const child = spawnSync(childCommand.command, childCommand.arguments, {
    env: process.env,
    stdio: "inherit",
  });

  if (child.error) {
    throw child.error;
  }
  process.exitCode = child.status ?? 1;
}

const isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    run();
  } catch (error) {
    console.error(`Prisma guard blocked execution: ${error.message}`);
    process.exitCode = 1;
  }
}
