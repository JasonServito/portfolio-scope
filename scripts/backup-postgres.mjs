import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdtemp,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";

const retentionCounts = {
  daily: 7,
  weekly: 4,
  monthly: 3,
};

function required(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeEnvironmentName(environment = process.env) {
  const value =
    environment.BACKUP_ENVIRONMENT?.trim() ||
    environment.VERCEL_ENV?.trim() ||
    environment.NODE_ENV?.trim() ||
    "development";
  if (!/^[a-z0-9-]{1,32}$/i.test(value)) {
    throw new Error("BACKUP_ENVIRONMENT is invalid.");
  }
  return value.toLowerCase();
}

function r2Client(environment = process.env) {
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

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    child.stderr?.resume();
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(
          new Error(
            `${command} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
          ),
        );
      }
    });
  });
}

function isoWeek(date) {
  const value = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((value - yearStart) / 86_400_000 + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function backupGenerationsForDate(date) {
  const generations = [
    {
      name: "daily",
      label: date.toISOString().slice(0, 10),
    },
  ];
  if (date.getUTCDay() === 0) {
    generations.push({ name: "weekly", label: isoWeek(date) });
  }
  if (date.getUTCDate() === 1) {
    generations.push({
      name: "monthly",
      label: date.toISOString().slice(0, 7),
    });
  }
  return generations;
}

export function selectExpiredBackupKeys(objects, keep) {
  return objects
    .filter((object) => typeof object.Key === "string")
    .sort((left, right) => {
      const leftTime = left.LastModified?.getTime() ?? 0;
      const rightTime = right.LastModified?.getTime() ?? 0;
      if (rightTime !== leftTime) return rightTime - leftTime;
      return right.Key.localeCompare(left.Key);
    })
    .slice(keep)
    .map((object) => object.Key);
}

async function uploadBackup({
  bucket,
  client,
  filePath,
  key,
  sha256,
  sourceEnvironment,
}) {
  const file = await stat(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: file.size,
      ContentType: "application/sql",
      ContentEncoding: "gzip",
      Metadata: {
        sha256,
        environment: sourceEnvironment,
        format: "postgres-plain-sql",
      },
    }),
  );
  return file.size;
}

async function pruneGeneration({
  bucket,
  client,
  prefix,
  keep,
}) {
  const listed = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: 1_000,
    }),
  );
  const expired = selectExpiredBackupKeys(listed.Contents ?? [], keep).filter(
    (key) => key.startsWith(prefix),
  );
  if (expired.length === 0) return 0;

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Quiet: true,
        Objects: expired.map((Key) => ({ Key })),
      },
    }),
  );
  return expired.length;
}

async function sendHeartbeat(urlValue) {
  if (!urlValue?.trim()) return false;
  const url = new URL(urlValue);
  if (url.protocol !== "https:") {
    throw new Error("Production backup heartbeat URLs must use HTTPS.");
  }
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Backup heartbeat returned ${response.status}.`);
  }
  return true;
}

async function safeCleanup(directory) {
  const resolvedDirectory = resolve(directory);
  const resolvedTemp = resolve(tmpdir());
  if (
    resolvedDirectory === resolvedTemp ||
    (!resolvedDirectory.startsWith(`${resolvedTemp}\\`) &&
      !resolvedDirectory.startsWith(`${resolvedTemp}/`))
  ) {
    throw new Error("Temporary backup directory failed its cleanup guard.");
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

export async function createPostgresBackup(environment = process.env) {
  const databaseUrl = required("DIRECT_URL", environment);
  const sourceEnvironment = safeEnvironmentName(environment);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "portfolioscope-backup-"),
  );
  const sqlPath = join(temporaryDirectory, `portfolioscope-${stamp}.sql`);
  const gzipPath = `${sqlPath}.gz`;

  try {
    await run(
      environment.PG_DUMP_COMMAND?.trim() || "pg_dump",
      [
        "--format=plain",
        "--no-owner",
        "--no-privileges",
        "--encoding=UTF8",
        "--file",
        sqlPath,
      ],
      {
        env: {
          ...environment,
          PGDATABASE: databaseUrl,
        },
      },
    );
    await pipeline(
      createReadStream(sqlPath),
      createGzip({ level: 9 }),
      createWriteStream(gzipPath, { flags: "wx" }),
    );

    const sha256 = await sha256File(gzipPath);
    const { bucket, client } = r2Client(environment);
    const uploaded = [];
    let byteLength = 0;

    for (const generation of backupGenerationsForDate(now)) {
      const prefix = `backups/postgres/${sourceEnvironment}/${generation.name}/`;
      const key = `${prefix}${generation.label}-${stamp}.sql.gz`;
      byteLength = await uploadBackup({
        bucket,
        client,
        filePath: gzipPath,
        key,
        sha256,
        sourceEnvironment,
      });
      const pruned = await pruneGeneration({
        bucket,
        client,
        prefix,
        keep: retentionCounts[generation.name],
      });
      uploaded.push({ generation: generation.name, pruned });
    }

    await sendHeartbeat(environment.BETTER_STACK_BACKUP_HEARTBEAT_URL);
    return {
      status: "completed",
      environment: sourceEnvironment,
      byteLength,
      sha256,
      uploaded,
    };
  } finally {
    await safeCleanup(temporaryDirectory);
  }
}

async function main() {
  try {
    const result = await createPostgresBackup();
    console.info(JSON.stringify(result));
  } catch {
    try {
      await sendHeartbeat(process.env.BETTER_STACK_BACKUP_FAILURE_HEARTBEAT_URL);
    } catch {
      // The primary categorized failure remains the operator signal.
    }
    console.error(
      JSON.stringify({
        status: "failed",
        errorCode: "BACKUP_EXPORT_FAILED",
        errorMessage:
          "Logical database backup failed. Inspect the categorized workflow step and failure heartbeat.",
      }),
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
