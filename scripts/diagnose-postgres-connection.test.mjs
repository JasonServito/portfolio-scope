import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  POSTGRES_DIAGNOSTIC_CATEGORIES,
  classifyPostgresConnectionFailure,
  createPostgresDiagnosticInvocation,
  runPostgresDiagnostic,
} from "./diagnose-postgres-connection.mjs";

const fakeDirectUrl =
  "postgresql://sensitive-user:sensitive-password@private.example.invalid:5432/sensitive-db";

const classificationCases = [
  [
    "password authentication failed for user sensitive-user",
    POSTGRES_DIAGNOSTIC_CATEGORIES.authentication,
  ],
  [
    'could not translate host name "private.example.invalid" to address',
    POSTGRES_DIAGNOSTIC_CATEGORIES.dns,
  ],
  [
    'connection to server at "203.0.113.8", port 5432 failed: Connection timed out',
    POSTGRES_DIAGNOSTIC_CATEGORIES.tcp,
  ],
  [
    'invalid URI query parameter: "channel_binding"',
    POSTGRES_DIAGNOSTIC_CATEGORIES.tls,
  ],
  [
    'FATAL: database "sensitive-db" does not exist',
    POSTGRES_DIAGNOSTIC_CATEGORIES.databaseRole,
  ],
  [
    "connection rejected because the source IP address is not allowed by the network access policy",
    POSTGRES_DIAGNOSTIC_CATEGORIES.networkPolicy,
  ],
  [
    "provider returned an unexpected response",
    POSTGRES_DIAGNOSTIC_CATEGORIES.unknown,
  ],
];

for (const [rawError, expectedCategory] of classificationCases) {
  test(`classifies a sanitized ${expectedCategory}`, () => {
    const category = classifyPostgresConnectionFailure(rawError);

    assert.equal(category, expectedCategory);
    assert.doesNotMatch(category, /sensitive|203\.0\.113\.8|private\.example/);
  });
}

test("builds a psql invocation with session and transaction read-only protections", () => {
  const invocation = createPostgresDiagnosticInvocation({
    DIRECT_URL: fakeDirectUrl,
    PGOPTIONS: "-c statement_timeout=10000",
  });

  assert.equal(invocation.command, "psql");
  assert.equal(invocation.args[0], fakeDirectUrl);
  assert.ok(invocation.args.includes("-q"));
  assert.match(invocation.args.at(-1), /BEGIN READ ONLY;/);
  assert.match(invocation.args.at(-1), /transaction_read_only/);
  assert.match(
    invocation.options.env.PGOPTIONS,
    /default_transaction_read_only=on/,
  );
  assert.deepEqual(invocation.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(invocation.options.shell, false);
});

function createSpawnStub({ stdout = "", stderr = "", code = 0 }) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();

    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.stderr.end(stderr);
      child.emit("close", code);
    });

    return child;
  };
}

test("returns only a safe category when psql fails", async () => {
  const rawError =
    'password authentication failed for user "sensitive-user" at private.example.invalid';
  const result = await runPostgresDiagnostic({
    environment: { DIRECT_URL: fakeDirectUrl },
    spawnProcess: createSpawnStub({ stderr: rawError, code: 2 }),
  });

  assert.deepEqual(result, {
    ok: false,
    category: POSTGRES_DIAGNOSTIC_CATEGORIES.authentication,
  });
  assert.doesNotMatch(JSON.stringify(result), /sensitive|private\.example/);
});

test("does not infer TLS solely from a hostname containing ssl", () => {
  const category = classifyPostgresConnectionFailure(
    'connection to server at "ssl-private.example.invalid" failed: connection timed out',
  );

  assert.equal(category, POSTGRES_DIAGNOSTIC_CATEGORIES.tcp);
});

test("requires the read-only confirmation before reporting success", async () => {
  const success = await runPostgresDiagnostic({
    environment: { DIRECT_URL: fakeDirectUrl },
    spawnProcess: createSpawnStub({ stdout: "READ_ONLY_OK\n" }),
  });
  const missingConfirmation = await runPostgresDiagnostic({
    environment: { DIRECT_URL: fakeDirectUrl },
    spawnProcess: createSpawnStub({ stdout: "unexpected\n" }),
  });

  assert.deepEqual(success, { ok: true });
  assert.deepEqual(missingConfirmation, {
    ok: false,
    category: POSTGRES_DIAGNOSTIC_CATEGORIES.unknown,
  });
});

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

test("diagnostic-only dispatch cannot invoke pg_dump or the R2 backup path", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/database-backup.yml", import.meta.url),
    "utf8",
  );
  const nonDiagnosticGuard =
    "if: ${{ github.event_name == 'schedule' || inputs.diagnostic_only != true }}";

  assert.match(
    workflow,
    /workflow_dispatch:\s+inputs:\s+diagnostic_only:\s+description:[^\n]+\s+required: true\s+type: boolean\s+default: false/,
  );
  assert.match(workflow, /schedule:\s+- cron: "17 6 \* \* \*"/);
  assert.match(workflow, /environment: production/);

  const diagnostic = workflowStep(
    workflow,
    "Classify PostgreSQL connection readiness",
  );
  assert.match(diagnostic, /node scripts\/diagnose-postgres-connection\.mjs/);
  assert.doesNotMatch(diagnostic, /if:|pg_dump|R2_|backup:postgres/);

  const dependencies = workflowStep(workflow, "Install dependencies");
  assert.match(
    dependencies,
    new RegExp(nonDiagnosticGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  const diagnosticStart = workflow.indexOf(
    "      - name: Classify PostgreSQL connection readiness",
  );
  const preDiagnosticSteps = workflow
    .slice(workflow.indexOf("    steps:"), diagnosticStart)
    .split("\n      - name:");
  for (const step of preDiagnosticSteps) {
    if (step.includes("secrets.DIRECT_URL")) {
      assert.match(
        step,
        new RegExp(nonDiagnosticGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  }

  const tooling = workflowStep(workflow, "Verify PostgreSQL backup tooling");
  assert.match(
    tooling,
    new RegExp(nonDiagnosticGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(tooling, /pg_dump --version/);

  const backup = workflowStep(workflow, "Create compressed logical backup");
  assert.match(
    backup,
    new RegExp(nonDiagnosticGuard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(backup, /npm run backup:postgres/);
  assert.match(backup, /R2_ACCOUNT_ID:/);
  assert.match(backup, /R2_BUCKET_NAME:/);
});
