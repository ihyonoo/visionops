import { describe, expect, it } from "vitest";

import {
  ACTIVE_WORK_REFETCH_MS,
  isActiveWorkStatus,
  shouldRefetchPredictionResults,
  workRunsRefetchInterval,
} from "../src/api/realtime";

describe("realtime query helpers", () => {
  it("treats queued, pending, running, and cancellation requests as active work", () => {
    expect(isActiveWorkStatus("queued")).toBe(true);
    expect(isActiveWorkStatus("pending")).toBe(true);
    expect(isActiveWorkStatus("running")).toBe(true);
    expect(isActiveWorkStatus("cancel_requested")).toBe(true);
    expect(isActiveWorkStatus("completed")).toBe(false);
    expect(isActiveWorkStatus("failed")).toBe(false);
  });

  it("polls work lists only while at least one run is active", () => {
    expect(workRunsRefetchInterval([{ status: "completed" }, { status: "failed" }])).toBe(false);
    expect(workRunsRefetchInterval([{ status: "completed" }, { status: "queued" }])).toBe(
      ACTIVE_WORK_REFETCH_MS,
    );
    expect(workRunsRefetchInterval(undefined)).toBe(false);
  });

  it("keeps prediction results fresh until an inference run reaches a terminal status", () => {
    expect(shouldRefetchPredictionResults({ status: "queued" })).toBe(ACTIVE_WORK_REFETCH_MS);
    expect(shouldRefetchPredictionResults({ status: "running" })).toBe(ACTIVE_WORK_REFETCH_MS);
    expect(shouldRefetchPredictionResults({ status: "completed" })).toBe(false);
    expect(shouldRefetchPredictionResults({ status: "failed" })).toBe(false);
  });
});
