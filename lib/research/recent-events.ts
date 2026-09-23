import type { ResearchEvidence } from "@/lib/research/ai/schemas";
import type { AgentResult, ResearchRecentEvent } from "@/lib/research/types";

const MAX_RECENT_EVENTS = 6;

function currentReportFilingDate(item: ResearchEvidence) {
  const formType = item.metadata.formType;
  if (
    item.sourceKind !== "SEC_FILING" ||
    typeof formType !== "string" ||
    !/^8-K(?:\/A)?$/.test(formType)
  ) {
    return null;
  }
  const filingDate = item.metadata.filingDate;
  const value = typeof filingDate === "string" ? filingDate : item.sourceDate;
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? { filingDate: value, formType, accessionNumber: item.accessionNumber }
    : null;
}

/**
 * The recent events shown in What to Watch: one per validated News
 * specialist claim, dated by the newest Form 8-K current report or
 * press-release passage the claim cites. A claim that cites no 8-K is not
 * an event and is left out, so the report never describes an event without
 * a cited, dated filing. Computed from persisted runs and the snapshot; the
 * model never supplies a date.
 */
export function recentEventsFromResearch(
  agents: readonly AgentResult[],
  evidence: readonly ResearchEvidence[],
): ResearchRecentEvent[] {
  const news = agents.find((agent) => agent.agentName === "NEWS");
  if (
    !news ||
    news.status !== "COMPLETED" ||
    news.availability === "NOT_AVAILABLE"
  ) {
    return [];
  }
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const events: ResearchRecentEvent[] = [];
  for (const claim of news.claims ?? []) {
    const cited = claim.evidenceIds
      .map((id) => evidenceById.get(id))
      .flatMap((item) => (item ? [currentReportFilingDate(item)] : []))
      .filter((report) => report !== null)
      .sort((left, right) => right.filingDate.localeCompare(left.filingDate));
    const newest = cited[0];
    if (!newest) continue;
    events.push({
      filingDate: newest.filingDate,
      formType: newest.formType,
      accessionNumber: newest.accessionNumber,
      statement: claim.statement,
    });
  }
  return events
    .sort((left, right) => right.filingDate.localeCompare(left.filingDate))
    .slice(0, MAX_RECENT_EVENTS);
}
