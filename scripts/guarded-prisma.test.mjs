import assert from "node:assert/strict";
import test from "node:test";

import {
  expectedConfirmation,
  validateDatabaseTarget,
} from "./guarded-prisma.mjs";

const localTarget = {
  databaseUrl: "postgresql://app:secret@localhost:5432/portfolio_scope",
  directUrl: "postgresql://admin:secret@127.0.0.1:5432/portfolio_scope",
};

test("routine migration commands accept matching local database URLs", () => {
  assert.deepEqual(
    validateDatabaseTarget({
      operation: "migrate-deploy",
      ...localTarget,
    }),
    { scope: "local" },
  );
});

test("routine migration commands reject remote database URLs", () => {
  assert.throws(
    () =>
      validateDatabaseTarget({
        operation: "migrate-deploy",
        databaseUrl:
          "postgresql://app:do-not-print@prod-pooler.example/db_name",
        directUrl: "postgresql://admin:do-not-print@prod.example/db_name",
      }),
    (error) => {
      assert.match(error.message, /restricted to local database hosts/);
      assert.doesNotMatch(error.message, /do-not-print/);
      return true;
    },
  );
});

test("routine commands reject mixed local and remote targets", () => {
  assert.throws(
    () =>
      validateDatabaseTarget({
        operation: "seed",
        databaseUrl: localTarget.databaseUrl,
        directUrl: "postgresql://admin:secret@preview.example/portfolio_scope",
      }),
    /restricted to local database hosts/,
  );
});

test("routine commands reject Production even through a loopback target", () => {
  assert.throws(
    () =>
      validateDatabaseTarget({
        operation: "migrate-deploy",
        ...localTarget,
        vercelEnvironment: "production",
      }),
    /disabled in Production environments/,
  );
});

test("all guarded commands require matching database names", () => {
  assert.throws(
    () =>
      validateDatabaseTarget({
        operation: "migrate-dev",
        databaseUrl: localTarget.databaseUrl,
        directUrl: "postgresql://admin:secret@localhost:5432/other_database",
      }),
    /same database name/,
  );
});

test("approved remote migrations require the exact target confirmation", () => {
  assert.throws(
    () =>
      validateDatabaseTarget({
        operation: "migrate-deploy",
        ...localTarget,
        approvedRemote: true,
        target: "production",
        confirmation: "yes",
      }),
    /APPLY_PRODUCTION_MIGRATIONS/,
  );

  assert.deepEqual(
    validateDatabaseTarget({
      operation: "migrate-deploy",
      ...localTarget,
      approvedRemote: true,
      target: "production",
      confirmation: expectedConfirmation("migrate-deploy", "production"),
    }),
    { scope: "production" },
  );
});

test("approved remote seeds use a distinct explicit confirmation", () => {
  assert.equal(
    expectedConfirmation("seed", "preview"),
    "SEED_PREVIEW_DATABASE",
  );
  assert.throws(
    () => expectedConfirmation("migrate-dev", "preview"),
    /not supported/,
  );
});
