import assert from "node:assert/strict";
import test from "node:test";

import {
  backupGenerationsForDate,
  selectExpiredBackupKeys,
} from "./backup-postgres.mjs";

test("backup generations include bounded daily, weekly, and monthly keys", () => {
  assert.deepEqual(
    backupGenerationsForDate(new Date("2026-11-01T06:00:00.000Z")),
    [
      { name: "daily", label: "2026-11-01" },
      { name: "weekly", label: "2026-W44" },
      { name: "monthly", label: "2026-11" },
    ],
  );
});

test("retention removes only objects beyond the newest generation count", () => {
  const objects = Array.from({ length: 9 }, (_, index) => ({
    Key: `backups/postgres/test/daily/backup-${index}.sql.gz`,
    LastModified: new Date(Date.UTC(2026, 6, index + 1)),
  }));
  assert.deepEqual(selectExpiredBackupKeys(objects, 7), [
    "backups/postgres/test/daily/backup-1.sql.gz",
    "backups/postgres/test/daily/backup-0.sql.gz",
  ]);
});
