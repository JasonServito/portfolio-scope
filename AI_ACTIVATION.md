# M27 External AI Activation Record

## Status

M27 validation is Preview-only. Production external AI remains disabled and no
M27 Production configuration, credential, migration, provider call, billing,
database, deployment, or feature-flag change is authorized by this record.
Passing Preview is evidence for a later decision; it is not Production
readiness or approval.

As of 2026-08-25, repository implementation and offline verification are
complete. Live Preview validation is not complete. The linked Vercel Preview
environment currently has AI, research generation, and background jobs disabled;
its database variables are placeholders rather than valid PostgreSQL URLs; and
separately scoped Preview OpenAI, Redis, QStash, R2, and monitoring resources
have not been evidenced. No migration or provider call was attempted against
that environment. Provider usage and cost attributable to M27 remain zero.

## Approved Preview boundary

- Provider: the existing OpenAI Responses adapter with `store: false`.
- Model: only pinned `gpt-5.4-mini-2026-03-17` for newly queued work.
- Application limits: `$5` global per UTC month, `$1` per user per UTC month,
  `$0.25` per job, and `50,000` aggregate tokens per job. Configuration may
  lower but cannot raise these limits.
- Generation policy: at most one fresh external job per user, stock, and UTC
  day. Eligible work is reused. Regeneration, a changed evidence snapshot, a
  changed source/version fingerprint, and a cancelled earlier attempt do not
  bypass the daily boundary.
- Live allowance: at most one charged AAPL report for one controlled Preview
  user. Deterministic and recorded-provider checks do not consume this allowance.
- Failure drills: timeout, malformed-output, and kill-switch-before-repair
  checks use deterministic or recorded zero-network providers and finish before
  the bounded live call. They never consume an additional charged attempt.
- Review: automated schema, grounding, citation, unsupported-claim, privacy,
  advice, budget, and usage checks never replace mandatory human citation and
  financial-advice safety review.
- Kill switch: `AI_RESEARCH_ENABLED=false` before and after the bounded call.
  `RESEARCH_GENERATION_ENABLED=false` is the secondary research stop; generic
  background delivery is disabled only if the shared job system is unsafe.

## Authoritative provider review

Reviewed 2026-08-25 against OpenAI's official model documentation:

- [`gpt-5.4-mini-2026-03-17`](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
  is a published snapshot supported by the Responses endpoint. Its documented
  standard rates are `$0.75` per million input tokens, `$0.075` per million
  cached input tokens, and `$4.50` per million output tokens.
- The prior repository default,
  [`gpt-5-mini-2025-08-07`](https://developers.openai.com/api/docs/models/gpt-5-mini),
  is documented as deprecated. It is rejected from current environment
  configuration. Its historical rate tuple remains readable only so already
  queued jobs retain immutable accounting provenance.

Pricing is versioned as `openai-pricing-2026-08-24`. Recheck the official model
page and deprecation status immediately before any live call; a price or status
change stops activation until the code, tests, reservation math, and this record
are reviewed again.

## Reconciliation contract

For the single allowed live report, record non-secret job/report identifiers,
every provider request ID, the stored model/pricing/prompt/retrieval/schema/report
version tuple, and per-attempt input, cached-input, output, reasoning, and total
tokens.

The application estimate is:

```text
uncached input tokens * $0.75 / 1,000,000
+ cached input tokens * $0.075 / 1,000,000
+ output tokens * $4.50 / 1,000,000
```

Application cost is conservatively rounded upward to `$0.000001`. Acceptance
requires:

- exact agreement between provider response usage and stored application token
  counts for every request;
- exact agreement between stored application cost and the formula above after
  the application's upward micro-dollar rounding;
- a provider-console project-usage/charge delta within `$0.01` of the summed
  application cost, using an isolated Preview project and a bounded time window
  so console aggregation or currency rounding is the only allowed difference;
- zero unresolved `UNCONFIRMED` usage before any further external call; and
- settled totals within all four application limits.

Any request without reconcilable usage, any charge outside tolerance, pricing
drift, or evidence of unrelated project traffic fails the gate and leaves AI
disabled.

## Repository and local evidence

Executed 2026-08-25 against the isolated local database and recorded/zero-network
providers:

| Check                      | Result                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`           | Passed on the remediated tree: ESLint, TypeScript, 528 unit tests, 14 operational checks, and Next.js 16.3 production build |
| `npm run verify:db`        | Passed locally: Prisma generated/validated; 11 migrations present and none pending in local `portfolio_scope`               |
| `npm run test:integration` | Passed: seed/auth persistence and 43 PostgreSQL integration cases, including all 19 AI cases                                |
| `npm run test:e2e`         | Passed: 18 Chromium journeys, including authenticated citation focus and 390px public research disclosure/overflow checks   |
| `npm run verify:security`  | Passed: `npm audit --audit-level=high` reported 0 vulnerabilities                                                           |
| Focused kill-switch checks | Passed: provider/reservation are not called while disabled; a flag change after invalid output blocks the repair attempt    |
| Local visual inspection    | Passed for the deterministic sample at 1440px and 390px; checked-in `public/screenshots/research.png` refreshed             |
| Fresh-context review       | Passed after remediation with a 30/30 independent focused rerun; no blocking or important repository findings remain        |

The local visual and E2E evidence validates the component behavior but is not the
required desktop/mobile review of actual generated Preview output. No external
provider request ran: provider input tokens `0`, cached input tokens `0`, output
tokens `0`, reasoning tokens `0`, provider total tokens `0`, application cost
`$0`, and provider charge `$0`.

The linked Vercel project is `portfolio-scope`. Its 2026-08-25 Preview variable
name inventory still contained no OpenAI, Redis, QStash, R2, or monitoring
configuration. The prior guarded value inspection found the AI/research/job
flags disabled and the database values to be placeholders. No secret value was
recorded. The in-app browser runtime exposed no browser instance, so actual-output
desktop/mobile review remains an external/manual gate rather than local evidence.

## Required live Preview evidence

| Gate                                                           | Status                                   | Required evidence                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Isolated Preview database and backup/restore target            | Blocked                                  | Valid non-Production pooled/direct URLs, backup metadata, restore or rollback target                                            |
| Required additive AI migrations with AI disabled               | Not run                                  | M18 status plus the M27 per-attempt usage fields; only if required, approved Preview deploy log and deterministic-history check |
| Isolated Preview Redis, QStash, R2, and signed delivery        | Not verified                             | Non-secret resource references, signed callback/replay result, source provenance check                                          |
| Preview OpenAI project/key and provider billing control        | Not configured                           | Non-secret project reference, separately scoped key evidence, `$5` or lower alert/spending control                              |
| Official pricing/deprecation review                            | Verified 2026-08-25                      | Official links and rates above; must be rechecked immediately before the live call                                              |
| Offline/recorded regression and mandatory human rubric         | Automated gates passed; human pending    | Executable results above; named human reviewer, disposition, and no critical 0 score still required                             |
| One bounded AAPL external report                               | Not run                                  | Job/report/request IDs, timestamps, version tuple, terminal status                                                              |
| Source, unsupported-claim, privacy, and advice review          | Not run                                  | Claim-by-claim human review, request/log/browser/analytics inspection, reviewer disposition                                     |
| Token and cost reconciliation                                  | Not run                                  | Stored usage, formula result, console delta, no unresolved usage                                                                |
| Daily reuse, duplicate, regeneration, and source-change policy | Offline verified; live pending           | Same-day reuse/rejection evidence without a second charged report                                                               |
| Desktop/mobile usability with actual output                    | Local deterministic passed; live not run | Browser notes/screenshots for hierarchy, disclosure, links, focus, overflow                                                     |
| Monitoring and alerts                                          | Not verified                             | Preview event/heartbeat/job/cost evidence without private payloads                                                              |
| Kill switch and rollback                                       | Offline kill switch passed; live pending | Flag-off state after the sole report, usable stock/history pages, rollback target, and zero-network next-call proof             |

## Separate Production activation gate

The following steps are deliberately outside M27 and each Production mutation
requires a new explicit approval:

1. Review the completed Preview record, unresolved risks, current official
   pricing/deprecation status, and a named Production rollback owner/target.
2. Re-verify Production authentication, ownership, SEC/R2 provenance, isolated
   Redis/QStash delivery, monitoring, backup, restore, and abuse controls while
   `AI_RESEARCH_ENABLED=false`.
3. If any required additive M18 or M27 AI-usage migration is absent, take and
   verify a Production backup, then separately approve and run
   `MIGRATION_TARGET=production MIGRATION_CONFIRMATION=APPLY_PRODUCTION_MIGRATIONS npm run db:deploy:approved`
   with AI still disabled. Never down-migrate the additive records.
4. Create a Production-only OpenAI project/key and independent provider billing
   alert or spending stop. Do not copy the Preview key, project, budget, or
   usage history.
5. Configure the exact pinned model and limits above in Production, deploy the
   reviewed commit with external AI still disabled, and rerun migration,
   deterministic/recorded, integration, E2E, security, readiness, and monitoring
   checks against Production-safe test identities.
6. Obtain a second explicit approval for a single bounded Production AAPL
   report. Enable external AI only for that controlled window, perform the same
   source/privacy/advice/token/cost/browser review, and immediately restore the
   kill switch.
7. Record the Production job/report/request IDs, reconciliation, provider bill,
   monitor evidence, rollback proof, reviewer disposition, and whether ongoing
   enablement is approved. A successful one-call proof does not itself authorize
   continuous Production activation.
