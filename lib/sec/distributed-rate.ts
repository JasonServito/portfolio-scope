import { ephemeralStore, type EphemeralStore } from "@/lib/cache/redis";

type PermitStore = Pick<EphemeralStore, "acquireIntervalPermit">;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForDistributedSecPermit(
  dependencies: {
    store?: PermitStore;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const permit = await (
    dependencies.store ?? ephemeralStore
  ).acquireIntervalPermit({
    category: "sec-provider",
    identifier: "global",
    intervalMs: 125,
  });
  if (permit.unavailable) return { coordinated: false, delayMs: 0 };
  if (permit.delayMs > 0) {
    await (dependencies.sleep ?? sleep)(permit.delayMs);
  }
  return { coordinated: true, delayMs: permit.delayMs };
}
