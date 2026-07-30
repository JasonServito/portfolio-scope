import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBackupChecksum,
  validateBackupKey,
  validateRestoreTarget,
} from "./restore-postgres.mjs";

const target =
  "postgresql://restore_user:restore_password@restore.local:5432/restore_db";

test("accepts an explicitly confirmed non-production restore target", () => {
  assert.equal(
    validateRestoreTarget({
      RESTORE_CONFIRMATION: "RESTORE_NON_PRODUCTION",
      RESTORE_ALLOWED_HOSTS: "restore.local",
      RESTORE_DATABASE_URL: target,
      RESTORE_TARGET_ENVIRONMENT: "restore-drill",
      DATABASE_URL:
        "postgresql://app_user:app_password@app.local:5432/portfolio_scope",
    }),
    target,
  );
});

test("rejects a production restore target", () => {
  assert.throws(
    () =>
      validateRestoreTarget({
        RESTORE_CONFIRMATION: "RESTORE_NON_PRODUCTION",
        RESTORE_ALLOWED_HOSTS: "restore.local",
        RESTORE_DATABASE_URL: target,
        RESTORE_TARGET_ENVIRONMENT: "production",
      }),
    /Production restore targets are prohibited/,
  );
});

test("rejects a target that shares an application database host", () => {
  assert.throws(
    () =>
      validateRestoreTarget({
        RESTORE_CONFIRMATION: "RESTORE_NON_PRODUCTION",
        RESTORE_ALLOWED_HOSTS: "restore.local",
        RESTORE_DATABASE_URL: target,
        DIRECT_URL:
          "postgresql://production:secret@restore.local:5432/portfolio_scope",
      }),
    /shares a host with an application database/,
  );
});

test("accepts only PortfolioScope backup object keys", () => {
  assert.equal(
    validateBackupKey(
      "backups/postgres/production/daily/2026-07-27.sql.gz",
    ),
    "backups/postgres/production/daily/2026-07-27.sql.gz",
  );
  assert.throws(
    () => validateBackupKey("../production.sql.gz"),
    /not a PortfolioScope backup key/,
  );
});

test("requires matching SHA-256 object metadata before restore", () => {
  const checksum = "a".repeat(64);
  assert.doesNotThrow(() => assertBackupChecksum(checksum, checksum));
  assert.throws(
    () => assertBackupChecksum(undefined, checksum),
    /missing valid SHA-256 metadata/,
  );
  assert.throws(
    () => assertBackupChecksum(checksum, "b".repeat(64)),
    /failed SHA-256 verification/,
  );
});
