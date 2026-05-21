import { describe, expect, it } from "vitest";
import { config, getSnapshotBodyLimit } from "./env";

// Tests for the Snapshot body-limit config and helper added in U2.
// The `getEnvVar`/`parseInt` pipeline is already exercised by
// `qipCommentsBodyMaxBytes` and other existing config keys; these tests pin
// the new helper's bucket-selection contract.

describe("Snapshot body-limit config", () => {
  it("config.snapshotBodyLimitDefault is a positive integer", () => {
    expect(typeof config.snapshotBodyLimitDefault).toBe("number");
    expect(Number.isInteger(config.snapshotBodyLimitDefault)).toBe(true);
    expect(config.snapshotBodyLimitDefault).toBeGreaterThan(0);
  });

  it("config.snapshotBodyLimitTurbo is a positive integer", () => {
    expect(typeof config.snapshotBodyLimitTurbo).toBe("number");
    expect(Number.isInteger(config.snapshotBodyLimitTurbo)).toBe(true);
    expect(config.snapshotBodyLimitTurbo).toBeGreaterThan(0);
  });

  it("default limit is 10000 without env override (matches Snapshot Sequencer's default-bucket value)", () => {
    // No env override in the test environment, so the parseInt fallback chain
    // returns the default-default literal 10000.
    expect(config.snapshotBodyLimitDefault).toBe(10000);
  });

  it("turbo limit is 50000 without env override (matches live DB value)", () => {
    expect(config.snapshotBodyLimitTurbo).toBe(50000);
  });
});

describe("getSnapshotBodyLimit", () => {
  it("returns the default limit for 'default' bucket", () => {
    expect(getSnapshotBodyLimit("default")).toBe(config.snapshotBodyLimitDefault);
  });

  it("returns the default limit for 'verified' bucket (qidao.eth's bucket)", () => {
    expect(getSnapshotBodyLimit("verified")).toBe(config.snapshotBodyLimitDefault);
  });

  it("returns the default limit for 'flagged' bucket", () => {
    expect(getSnapshotBodyLimit("flagged")).toBe(config.snapshotBodyLimitDefault);
  });

  it("returns the turbo limit for 'turbo' bucket", () => {
    expect(getSnapshotBodyLimit("turbo")).toBe(config.snapshotBodyLimitTurbo);
  });

  it("turbo limit is strictly greater than default limit", () => {
    // Documents the relationship between the two buckets — turbo (Snapshot Pro)
    // is always at least as permissive as default. If this assertion ever fails
    // because Snapshot inverts the buckets, the call sites in U5/U6 should be
    // revisited to handle the new ordering.
    expect(getSnapshotBodyLimit("turbo")).toBeGreaterThan(getSnapshotBodyLimit("verified"));
  });
});
