import {
  claimKey,
  stableHash,
  type ModelClaim,
  type ResearchEvidence,
  type SynthesisModelOutput,
} from "@/lib/research/ai/schemas";

export type StructuredResearchReportSnapshot = {
  rating: SynthesisModelOutput["rating"];
  confidence: number;
  claims: ModelClaim[];
  evidence: ResearchEvidence[];
  sourceSnapshotSha256: string | null;
  sourceDataVersion: string | null;
};

export type EvidenceModification = {
  previousId: string;
  currentId: string;
};

export type EvidenceDelta = {
  addedIds: string[];
  removedIds: string[];
  modified: EvidenceModification[];
  changed: boolean;
};

export type ClaimEvidenceChange = {
  previousClaimKey: string;
  currentClaimKey: string;
  supporting: EvidenceDelta;
  counter: EvidenceDelta;
};

export type MaterialClaimChange = {
  previousClaimKey: string;
  currentClaimKey: string;
  previous: ModelClaim;
  current: ModelClaim;
  similarity: number;
  reasons: Array<
    | "statement"
    | "confidence"
    | "assumptions"
    | "supporting-evidence"
    | "counter-evidence"
  >;
};

export type ResearchReportDiff = {
  rating: {
    previous: StructuredResearchReportSnapshot["rating"];
    current: StructuredResearchReportSnapshot["rating"];
    changed: boolean;
  };
  confidence: {
    previous: number;
    current: number;
    delta: number;
    materiallyChanged: boolean;
  };
  newClaims: Array<{ claimKey: string; claim: ModelClaim }>;
  removedClaims: Array<{ claimKey: string; claim: ModelClaim }>;
  changedClaims: MaterialClaimChange[];
  evidenceChanges: ClaimEvidenceChange[];
  source: {
    previousSnapshotSha256: string | null;
    currentSnapshotSha256: string | null;
    snapshotChanged: boolean;
    previousDataVersion: string | null;
    currentDataVersion: string | null;
    dataChanged: boolean;
  };
  hasMaterialChanges: boolean;
};

export type ResearchReportDiffOptions = {
  confidenceThreshold?: number;
  claimMatchThreshold?: number;
  materialStatementThreshold?: number;
};

type IndexedClaim = {
  claim: ModelClaim;
  index: number;
  key: string;
};

type ClaimMatch = {
  previous: IndexedClaim;
  current: IndexedClaim;
  similarity: number;
};

const DEFAULT_CONFIDENCE_THRESHOLD = 0.1;
const DEFAULT_CLAIM_MATCH_THRESHOLD = 0.55;
const DEFAULT_MATERIAL_STATEMENT_THRESHOLD = 0.86;

function round(value: number, places = 6) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

function textTokens(value: string) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function textSimilarity(left: string, right: string) {
  const leftNormalized = normalizeText(left);
  const rightNormalized = normalizeText(right);
  if (leftNormalized === rightNormalized) return 1;

  const leftTokens = textTokens(left);
  const rightTokens = textTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function normalizedStrings(values: string[]) {
  return values.map(normalizeText).sort();
}

function equalStrings(left: string[], right: string[]) {
  const normalizedLeft = normalizedStrings(left);
  const normalizedRight = normalizedStrings(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  );
}

function evidenceLocator(evidence: ResearchEvidence) {
  return stableHash({
    sourceKind: evidence.sourceKind,
    sourceReference: evidence.sourceReference,
    accessionNumber: evidence.accessionNumber,
    section: evidence.section,
    objectKey: evidence.objectKey,
    passageStart: evidence.passageStart,
    passageEnd: evidence.passageEnd,
    secFilingId: evidence.secFilingId,
    secRawSourceId: evidence.secRawSourceId,
    secFinancialFactId: evidence.secFinancialFactId,
  });
}

function evidenceFingerprint(evidence: ResearchEvidence) {
  return stableHash(evidence);
}

function evidenceDelta(
  previousIds: string[],
  currentIds: string[],
  previousEvidence: Map<string, ResearchEvidence>,
  currentEvidence: Map<string, ResearchEvidence>,
): EvidenceDelta {
  const previousByLocator = new Map<
    string,
    { id: string; evidence: ResearchEvidence | null }
  >();
  const currentByLocator = new Map<
    string,
    { id: string; evidence: ResearchEvidence | null }
  >();

  for (const id of previousIds) {
    const evidence = previousEvidence.get(id) ?? null;
    previousByLocator.set(
      evidence ? evidenceLocator(evidence) : `missing:${id}`,
      { id, evidence },
    );
  }
  for (const id of currentIds) {
    const evidence = currentEvidence.get(id) ?? null;
    currentByLocator.set(
      evidence ? evidenceLocator(evidence) : `missing:${id}`,
      { id, evidence },
    );
  }

  const addedIds: string[] = [];
  const removedIds: string[] = [];
  const modified: EvidenceModification[] = [];

  for (const [locator, previous] of previousByLocator) {
    const current = currentByLocator.get(locator);
    if (!current) {
      removedIds.push(previous.id);
      continue;
    }
    if (
      previous.evidence &&
      current.evidence &&
      evidenceFingerprint(previous.evidence) !==
        evidenceFingerprint(current.evidence)
    ) {
      modified.push({ previousId: previous.id, currentId: current.id });
    }
  }

  for (const [locator, current] of currentByLocator) {
    if (!previousByLocator.has(locator)) addedIds.push(current.id);
  }

  addedIds.sort();
  removedIds.sort();
  modified.sort((left, right) =>
    `${left.previousId}:${left.currentId}`.localeCompare(
      `${right.previousId}:${right.currentId}`,
    ),
  );

  return {
    addedIds,
    removedIds,
    modified,
    changed:
      addedIds.length > 0 || removedIds.length > 0 || modified.length > 0,
  };
}

function matchClaims(
  previousClaims: ModelClaim[],
  currentClaims: ModelClaim[],
  claimMatchThreshold: number,
) {
  const previous = previousClaims.map((claim, index) => ({
    claim,
    index,
    key: claimKey(claim),
  }));
  const current = currentClaims.map((claim, index) => ({
    claim,
    index,
    key: claimKey(claim),
  }));
  const matchedPrevious = new Set<number>();
  const matchedCurrent = new Set<number>();
  const matches: ClaimMatch[] = [];

  for (const currentClaim of current) {
    const exact = previous.find(
      (previousClaim) =>
        !matchedPrevious.has(previousClaim.index) &&
        previousClaim.key === currentClaim.key,
    );
    if (!exact) continue;
    matchedPrevious.add(exact.index);
    matchedCurrent.add(currentClaim.index);
    matches.push({ previous: exact, current: currentClaim, similarity: 1 });
  }

  const candidates: ClaimMatch[] = [];
  for (const previousClaim of previous) {
    if (matchedPrevious.has(previousClaim.index)) continue;
    for (const currentClaim of current) {
      if (
        matchedCurrent.has(currentClaim.index) ||
        previousClaim.claim.category !== currentClaim.claim.category
      ) {
        continue;
      }
      const similarity = textSimilarity(
        previousClaim.claim.statement,
        currentClaim.claim.statement,
      );
      if (similarity >= claimMatchThreshold) {
        candidates.push({
          previous: previousClaim,
          current: currentClaim,
          similarity,
        });
      }
    }
  }

  candidates.sort(
    (left, right) =>
      right.similarity - left.similarity ||
      left.previous.index - right.previous.index ||
      left.current.index - right.current.index,
  );
  for (const candidate of candidates) {
    if (
      matchedPrevious.has(candidate.previous.index) ||
      matchedCurrent.has(candidate.current.index)
    ) {
      continue;
    }
    matchedPrevious.add(candidate.previous.index);
    matchedCurrent.add(candidate.current.index);
    matches.push(candidate);
  }

  matches.sort((left, right) => left.current.index - right.current.index);
  return {
    matches,
    removed: previous.filter((claim) => !matchedPrevious.has(claim.index)),
    added: current.filter((claim) => !matchedCurrent.has(claim.index)),
  };
}

export function diffResearchReports(
  previous: StructuredResearchReportSnapshot,
  current: StructuredResearchReportSnapshot,
  options: ResearchReportDiffOptions = {},
): ResearchReportDiff {
  const confidenceThreshold =
    options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const claimMatchThreshold =
    options.claimMatchThreshold ?? DEFAULT_CLAIM_MATCH_THRESHOLD;
  const materialStatementThreshold =
    options.materialStatementThreshold ?? DEFAULT_MATERIAL_STATEMENT_THRESHOLD;

  const { matches, added, removed } = matchClaims(
    previous.claims,
    current.claims,
    claimMatchThreshold,
  );
  const previousEvidence = new Map(
    previous.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const currentEvidence = new Map(
    current.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const evidenceChanges: ClaimEvidenceChange[] = [];
  const changedClaims: MaterialClaimChange[] = [];

  for (const match of matches) {
    const supporting = evidenceDelta(
      match.previous.claim.evidenceIds,
      match.current.claim.evidenceIds,
      previousEvidence,
      currentEvidence,
    );
    const counter = evidenceDelta(
      match.previous.claim.counterEvidenceIds,
      match.current.claim.counterEvidenceIds,
      previousEvidence,
      currentEvidence,
    );
    if (supporting.changed || counter.changed) {
      evidenceChanges.push({
        previousClaimKey: match.previous.key,
        currentClaimKey: match.current.key,
        supporting,
        counter,
      });
    }

    const reasons: MaterialClaimChange["reasons"] = [];
    if (match.similarity < materialStatementThreshold)
      reasons.push("statement");
    if (
      Math.abs(
        match.current.claim.confidence - match.previous.claim.confidence,
      ) >= confidenceThreshold
    ) {
      reasons.push("confidence");
    }
    if (
      !equalStrings(
        match.previous.claim.assumptions,
        match.current.claim.assumptions,
      )
    ) {
      reasons.push("assumptions");
    }
    if (supporting.changed) reasons.push("supporting-evidence");
    if (counter.changed) reasons.push("counter-evidence");

    if (reasons.length > 0) {
      changedClaims.push({
        previousClaimKey: match.previous.key,
        currentClaimKey: match.current.key,
        previous: match.previous.claim,
        current: match.current.claim,
        similarity: round(match.similarity),
        reasons,
      });
    }
  }

  const confidenceDelta = round(current.confidence - previous.confidence);
  const ratingChanged = previous.rating !== current.rating;
  const confidenceMateriallyChanged =
    Math.abs(confidenceDelta) >= confidenceThreshold;
  const snapshotChanged =
    previous.sourceSnapshotSha256 !== current.sourceSnapshotSha256;
  const dataChanged = previous.sourceDataVersion !== current.sourceDataVersion;
  const newClaims = added.map(({ claim, key }) => ({ claimKey: key, claim }));
  const removedClaims = removed.map(({ claim, key }) => ({
    claimKey: key,
    claim,
  }));

  return {
    rating: {
      previous: previous.rating,
      current: current.rating,
      changed: ratingChanged,
    },
    confidence: {
      previous: previous.confidence,
      current: current.confidence,
      delta: confidenceDelta,
      materiallyChanged: confidenceMateriallyChanged,
    },
    newClaims,
    removedClaims,
    changedClaims,
    evidenceChanges,
    source: {
      previousSnapshotSha256: previous.sourceSnapshotSha256,
      currentSnapshotSha256: current.sourceSnapshotSha256,
      snapshotChanged,
      previousDataVersion: previous.sourceDataVersion,
      currentDataVersion: current.sourceDataVersion,
      dataChanged,
    },
    hasMaterialChanges:
      ratingChanged ||
      confidenceMateriallyChanged ||
      newClaims.length > 0 ||
      removedClaims.length > 0 ||
      changedClaims.length > 0 ||
      evidenceChanges.length > 0 ||
      snapshotChanged ||
      dataChanged,
  };
}
