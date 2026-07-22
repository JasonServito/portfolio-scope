import { Client } from "@upstash/qstash";

const token = process.env.QSTASH_TOKEN?.trim();
const originValue = process.env.NEXT_PUBLIC_APP_URL?.trim();
if (!token || !originValue) {
  throw new Error("QSTASH_TOKEN and NEXT_PUBLIC_APP_URL are required.");
}

const origin = new URL(originValue).origin;
if (!origin.startsWith("https://")) {
  throw new Error("QStash production schedules require an HTTPS application URL.");
}

const client = new Client({ token });
const destination = `${origin}/api/internal/schedules/maintenance`;
const schedules = [
  {
    scheduleId: "portfolioscope-recover-stale-jobs",
    cron: "0 * * * *",
    operation: "RECOVER_STALE_JOBS",
  },
  {
    scheduleId: "portfolioscope-refresh-stale-sec",
    cron: "15 2,14 * * *",
    operation: "REFRESH_STALE_SEC",
  },
];

for (const schedule of schedules) {
  await client.schedules.create({
    scheduleId: schedule.scheduleId,
    destination,
    cron: schedule.cron,
    body: JSON.stringify({ operation: schedule.operation }),
    headers: { "Content-Type": "application/json" },
    retries: 2,
    retryDelay: "min(300000, 15000 * pow(2, retried))",
    timeout: 30,
    label: ["portfolioscope", "maintenance"],
    redact: { body: true },
  });
  process.stdout.write(`Configured ${schedule.scheduleId}\n`);
}
