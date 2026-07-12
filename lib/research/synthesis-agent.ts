import type { ResearchSignal } from "@/lib/research/types";

export function synthesizeResearch(signals: ResearchSignal[]) {
  if (signals.length === 0) {
    return "Research synthesis placeholder. No live LLM calls are configured.";
  }

  return signals.map((signal) => signal.summary).join(" ");
}
