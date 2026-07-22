import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker authentication routing", () => {
  it("keeps the container work directory distinct from the app route segment", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const workDirectories = [...dockerfile.matchAll(/^WORKDIR\s+(\S+)$/gm)].map(
      ([, path]) => path,
    );

    expect(workDirectories).toEqual(["/workspace", "/workspace"]);
    expect(workDirectories).not.toContain("/app");
  });

  it("requires an external secret and pins local callbacks to localhost", () => {
    const compose = readFileSync("docker-compose.yml", "utf8");

    expect(compose).toContain(
      "AUTH_SECRET: ${AUTH_SECRET:?Set AUTH_SECRET in the ignored .env file}",
    );
    expect(compose).toContain("AUTH_URL: ${AUTH_URL:-http://localhost:3000}");
    expect(compose).toContain("AUTH_TRUST_HOST: ${AUTH_TRUST_HOST:-true}");
    expect(compose).toContain(
      "SEC_LOCAL_MANUAL_INGESTION_ENABLED: ${SEC_LOCAL_MANUAL_INGESTION_ENABLED:-false}",
    );
    expect(compose).toContain(
      "LOCAL_DISPOSABLE_AUTH_ENABLED: ${LOCAL_DISPOSABLE_AUTH_ENABLED:-false}",
    );
  });
});
