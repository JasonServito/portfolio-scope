-- PostgreSQL requires new enum values to be committed before a later
-- migration can reference them in indexes or data changes.
ALTER TYPE "ResearchStatus" ADD VALUE 'PARTIALLY_COMPLETED' BEFORE 'COMPLETED';
ALTER TYPE "ResearchStatus" ADD VALUE 'CANCELLED';

ALTER TYPE "AgentStatus" ADD VALUE 'RUNNING' BEFORE 'COMPLETED';
