-- M29 adds PortfolioScope-derived research evidence (deterministic metrics,
-- summary tables, trend excerpts, and peer comparisons) as an additive evidence
-- source kind. Existing evidence references keep their original kinds.
ALTER TYPE "EvidenceSourceKind" ADD VALUE 'DERIVED';
