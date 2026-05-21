import { describe, expect, it } from "vitest";
import { config, SNAPSHOT_BODY_WARNING_RATIO } from "./env";

describe("Snapshot body-limit config", () => {
  it("config.snapshotBodyLimitDefault defaults to 10000 (Snapshot Sequencer's default bucket)", () => {
    expect(config.snapshotBodyLimitDefault).toBe(10000);
  });

  it("config.snapshotBodyLimitTurbo defaults to 50000 (live DB value)", () => {
    expect(config.snapshotBodyLimitTurbo).toBe(50000);
  });

  it("turbo limit is strictly greater than default limit", () => {
    expect(config.snapshotBodyLimitTurbo).toBeGreaterThan(config.snapshotBodyLimitDefault);
  });

  it("SNAPSHOT_BODY_WARNING_RATIO is a fraction between 0 and 1", () => {
    expect(SNAPSHOT_BODY_WARNING_RATIO).toBeGreaterThan(0);
    expect(SNAPSHOT_BODY_WARNING_RATIO).toBeLessThan(1);
  });
});
