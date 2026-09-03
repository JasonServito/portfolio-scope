import type { Metadata } from "next";
import {
  Activity,
  Archive,
  Database,
  ExternalLink,
  Radio,
  ShieldCheck,
} from "lucide-react";

import { JobDiagnostics } from "@/components/admin/job-diagnostics";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { listBackgroundJobsForAdmin } from "@/lib/jobs/service";
import {
  type DependencyStatus,
  getOperationalDiagnostics,
} from "@/lib/operations/diagnostics";

export const metadata: Metadata = { title: "Job diagnostics" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const [jobs, companies, diagnostics] = await Promise.all([
    listBackgroundJobsForAdmin({ take: 100 }),
    db.company.findMany({
      where: { isSupported: true },
      select: {
        id: true,
        name: true,
        lastSyncedAt: true,
        securities: { select: { ticker: true }, take: 1 },
      },
      orderBy: { name: "asc" },
    }),
    getOperationalDiagnostics(),
  ]);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10">
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          Administrator operations
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Durable job diagnostics</h1>
        <p className="mt-2 max-w-3xl leading-7 text-muted-foreground">
          PostgreSQL is authoritative for job state. QStash transports signed
          work, while Redis coordinates short-lived locks and limits.
        </p>
      </div>

      <section aria-labelledby="service-status-heading" className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold" id="service-status-heading">
            Production readiness
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Privacy-safe dependency probes generated{" "}
            {new Date(diagnostics.generatedAt).toLocaleString("en-US")}.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Object.entries(diagnostics.services).map(([name, service]) => (
            <ServiceCard
              detail={service.detail}
              key={name}
              name={name}
              status={service.status}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Database}
          label="Database size"
          value={
            diagnostics.metrics.databaseSizeBytes === null
              ? "Unavailable"
              : formatBytes(diagnostics.metrics.databaseSizeBytes)
          }
        />
        <MetricCard
          icon={Activity}
          label="Failed or partial jobs"
          value={
            diagnostics.metrics.failedJobs === null
              ? "Unavailable"
              : String(diagnostics.metrics.failedJobs)
          }
        />
        <MetricCard
          icon={Archive}
          label="Last logical backup"
          value={
            diagnostics.lastBackup?.createdAt
              ? new Date(diagnostics.lastBackup.createdAt).toLocaleString(
                  "en-US",
                )
              : "Not recorded"
          }
        />
        <MetricCard
          icon={Radio}
          label="Latest worker heartbeat"
          value={
            diagnostics.latestWorkerHeartbeat?.at
              ? new Date(diagnostics.latestWorkerHeartbeat.at).toLocaleString(
                  "en-US",
                )
              : "Not recorded"
          }
        />
        <MetricCard
          icon={ShieldCheck}
          label="Last restore drill"
          value={
            diagnostics.lastRestoreDrill?.completedAt
              ? new Date(
                  diagnostics.lastRestoreDrill.completedAt,
                ).toLocaleString("en-US")
              : "Not recorded"
          }
        />
        <MetricCard
          icon={Activity}
          label="Supported companies"
          value={
            diagnostics.metrics.supportedCompanies === null
              ? "Unavailable"
              : String(diagnostics.metrics.supportedCompanies)
          }
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Runtime database target</CardTitle>
        </CardHeader>
        <CardContent>
          {diagnostics.databaseIdentity ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <DatabaseIdentityField
                label="Database"
                value={diagnostics.databaseIdentity.database}
              />
              <DatabaseIdentityField
                label="Schema"
                value={diagnostics.databaseIdentity.schema ?? "None"}
              />
              <DatabaseIdentityField
                label="reasoningTokens column"
                value={
                  diagnostics.databaseIdentity.hasReasoningTokens
                    ? "Present"
                    : "Missing"
                }
              />
              <DatabaseIdentityField
                label="Database OID"
                value={diagnostics.databaseIdentity.databaseOid}
              />
              <DatabaseIdentityField
                label="Server address"
                value={
                  diagnostics.databaseIdentity.serverAddress ?? "Local socket"
                }
              />
              <DatabaseIdentityField
                label="Server port"
                value={String(
                  diagnostics.databaseIdentity.serverPort ?? "None",
                )}
              />
              <DatabaseIdentityField
                label="PostgreSQL version number"
                value={diagnostics.databaseIdentity.serverVersionNumber}
              />
              <DatabaseIdentityField
                label="System identifier"
                value={diagnostics.databaseIdentity.systemIdentifier}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">
              Runtime database identity is unavailable.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Feature flags and kill switches
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(diagnostics.featureFlags).map(([name, flag]) => (
              <div className="rounded-lg border p-4" key={name}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-xs">{name}</p>
                  <Badge variant={flag.enabled ? "default" : "outline"}>
                    {flag.enabled ? "enabled" : "disabled"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {flag.source.replaceAll("-", " ")}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
            <ShieldCheck className="mt-0.5 size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Flags are server controlled and expose state only, never secret
              values. Missing Production flags default to disabled.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Monthly cost guardrails</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>
              ${diagnostics.costReview.expectedUsd.minimum}–
              {diagnostics.costReview.expectedUsd.maximum} expected
            </Badge>
            <Badge variant="outline">
              Below ${diagnostics.costReview.budgetUsd} hard limit
            </Badge>
            <span className="text-sm text-muted-foreground">
              Last reviewed{" "}
              {diagnostics.costReview.lastReviewedAt
                ? new Date(
                    diagnostics.costReview.lastReviewedAt,
                  ).toLocaleDateString("en-US")
                : "not recorded"}
            </span>
          </div>
          {diagnostics.aiUsage ? (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-muted-foreground">AI monthly used</p>
                <p className="mt-1 font-semibold">
                  ${diagnostics.aiUsage.usedUsd.toFixed(6)} / $
                  {diagnostics.aiUsage.limitUsd.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">AI reserved</p>
                <p className="mt-1 font-semibold">
                  ${diagnostics.aiUsage.reservedUsd.toFixed(6)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Model calls</p>
                <p className="mt-1 font-semibold">
                  {diagnostics.aiUsage.calls}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Needs reconciliation</p>
                <p className="mt-1 font-semibold">
                  {diagnostics.aiUsage.reconciliationRequired}
                </p>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              AI usage tables are unavailable. The external-research kill switch
              remains independently visible above.
            </p>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {diagnostics.costReview.services.map((service) => (
              <a
                className="rounded-lg border p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={service.dashboardUrl}
                key={service.name}
                rel="noreferrer"
                target="_blank"
              >
                <span className="flex items-center justify-between gap-3 font-medium">
                  {service.name}
                  <ExternalLink className="size-4 text-muted-foreground" />
                </span>
                <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                  Review {service.measure.toLowerCase()}. {service.guardrail}
                </span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      <JobDiagnostics
        jobs={jobs.map((job) => ({
          id: job.id,
          type: job.type,
          status: job.status,
          target:
            job.company?.securities[0]?.ticker ??
            job.researchJob?.stock.ticker ??
            job.portfolio?.name ??
            "System",
          correlationId: job.correlationId,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          errorCode: job.errorCode,
          errorMessage: job.errorMessage,
          queuedAt: job.queuedAt.toISOString(),
        }))}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            SEC freshness by supported ticker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => (
              <div className="rounded-lg border p-4" key={company.id}>
                <p className="font-medium">
                  {company.securities[0]?.ticker ?? "No ticker"} ·{" "}
                  {company.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {company.lastSyncedAt
                    ? `Last completed ${company.lastSyncedAt.toLocaleString("en-US")}`
                    : "No completed SEC synchronization"}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1_024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1_024; index += 1) {
    value /= 1_024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function ServiceCard({
  detail,
  name,
  status,
}: {
  detail: string;
  name: string;
  status: DependencyStatus;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="capitalize">{name}</CardTitle>
          <Badge
            variant={
              status === "ok"
                ? "default"
                : status === "failed"
                  ? "destructive"
                  : "outline"
            }
          >
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader>
        <Icon className="size-4 text-muted-foreground" />
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function DatabaseIdentityField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-mono">{value}</dd>
    </div>
  );
}
