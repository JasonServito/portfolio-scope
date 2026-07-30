import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

function required(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export function validateRestoreTarget(environment = process.env) {
  if (environment.RESTORE_CONFIRMATION !== "RESTORE_NON_PRODUCTION") {
    throw new Error(
      "RESTORE_CONFIRMATION must equal RESTORE_NON_PRODUCTION.",
    );
  }
  const target = new URL(required("RESTORE_DATABASE_URL", environment));
  const allowedHosts = required("RESTORE_ALLOWED_HOSTS", environment)
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!allowedHosts.includes(target.hostname.toLowerCase())) {
    throw new Error("Restore target host is not in RESTORE_ALLOWED_HOSTS.");
  }
  if (
    environment.VERCEL_ENV?.trim().toLowerCase() === "production" ||
    environment.RESTORE_TARGET_ENVIRONMENT?.trim().toLowerCase() ===
      "production"
  ) {
    throw new Error("Production restore targets are prohibited.");
  }
  for (const source of [environment.DATABASE_URL, environment.DIRECT_URL]) {
    if (!source?.trim()) continue;
    const sourceUrl = new URL(source);
    if (sourceUrl.hostname.toLowerCase() === target.hostname.toLowerCase()) {
      throw new Error(
        "The restore target shares a host with an application database.",
      );
    }
  }
  return target.toString();
}

export function validateBackupKey(value) {
  const key = value.trim();
  if (
    !/^backups\/postgres\/[a-z0-9-]+\/(daily|weekly|monthly)\/[A-Za-z0-9._-]+\.sql\.gz$/.test(
      key,
    )
  ) {
    throw new Error("BACKUP_OBJECT_KEY is not a PortfolioScope backup key.");
  }
  return key;
}

function r2(environment = process.env) {
  const accountId = required("R2_ACCOUNT_ID", environment);
  return {
    bucket: required("R2_BUCKET_NAME", environment),
    client: new S3Client({
      region: "auto",
      endpoint:
        environment.R2_ENDPOINT?.trim() ||
        `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: required("R2_ACCESS_KEY_ID", environment),
        secretAccessKey: required("R2_SECRET_ACCESS_KEY", environment),
      },
    }),
  };
}

function runPsql(args, databaseUrl, input) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.env.PSQL_COMMAND?.trim() || "psql", args, {
      env: { ...process.env, PGDATABASE: databaseUrl },
      shell: false,
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1_000) {
        stdout += String(chunk).slice(0, 1_000 - stdout.length);
      }
    });
    child.stderr.resume();
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        reject(
          new Error(
            `psql failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
          ),
        );
      }
    });
    if (input) {
      pipeline(input, child.stdin).catch(reject);
    }
  });
}

async function safeCleanup(directory) {
  const resolvedDirectory = resolve(directory);
  const resolvedTemp = resolve(tmpdir());
  if (
    resolvedDirectory === resolvedTemp ||
    (!resolvedDirectory.startsWith(`${resolvedTemp}\\`) &&
      !resolvedDirectory.startsWith(`${resolvedTemp}/`))
  ) {
    throw new Error("Temporary restore directory failed its cleanup guard.");
  }
  await rm(resolvedDirectory, { recursive: true, force: true });
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export function assertBackupChecksum(expected, actual) {
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error("Backup object is missing valid SHA-256 metadata.");
  }
  if (expected.toLowerCase() !== actual.toLowerCase()) {
    throw new Error("Backup object failed SHA-256 verification.");
  }
}

export async function restorePostgresBackup(environment = process.env) {
  const target = validateRestoreTarget(environment);
  const key = validateBackupKey(required("BACKUP_OBJECT_KEY", environment));
  const existingTableCount = Number(
    await runPsql(
      [
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';",
      ],
      target,
    ),
  );
  if (existingTableCount !== 0) {
    throw new Error("Restore target is not a clean database.");
  }

  const { bucket, client } = r2(environment);
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  if (!response.Body) throw new Error("Backup object has no readable body.");

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "portfolioscope-restore-"),
  );
  const gzipPath = join(temporaryDirectory, "backup.sql.gz");
  try {
    const source = Readable.fromWeb(response.Body.transformToWebStream());
    await pipeline(
      source,
      createWriteStream(gzipPath, { flags: "wx" }),
    );
    assertBackupChecksum(
      response.Metadata?.sha256,
      await sha256File(gzipPath),
    );
    await runPsql(
      ["--no-psqlrc", "--set", "ON_ERROR_STOP=on"],
      target,
      createReadStream(gzipPath).pipe(createGunzip()),
    );
  } finally {
    await safeCleanup(temporaryDirectory);
  }
  const restoredTables = Number(
    await runPsql(
      [
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--command",
        "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';",
      ],
      target,
    ),
  );
  if (restoredTables === 0) {
    throw new Error("Restore completed without application tables.");
  }
  return { status: "restored", key, restoredTables };
}

async function main() {
  try {
    const result = await restorePostgresBackup();
    console.info(JSON.stringify(result));
  } catch {
    console.error(
      JSON.stringify({
        status: "failed",
        errorCode: "RESTORE_FAILED",
        errorMessage:
          "Non-production restore failed. Inspect the categorized operator checks.",
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
