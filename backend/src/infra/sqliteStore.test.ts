import { describe, expect, it } from "vitest";
import { SqliteStore } from "./sqliteStore.js";

function sample(overrides: Partial<Parameters<SqliteStore["insertMetricsSample"]>[0]> = {}) {
  return {
    runId: "run-1",
    sampledAt: new Date().toISOString(),
    cpuPercent: 42,
    coresCapacity: 4,
    memoryUsedBytes: 1024 * 1024 * 512,
    memoryPercent: 50,
    activePlayers: 2,
    ...overrides,
  };
}

describe("SqliteStore session metrics", () => {
  it("aggregates avg/peak CPU, RAM, and players across a session's samples", () => {
    const store = new SqliteStore(":memory:");
    store.startServerSession("run-1", "2026-01-01T00:00:00.000Z", 1234);
    store.insertMetricsSample(sample({ sampledAt: "2026-01-01T00:00:05.000Z", cpuPercent: 20, memoryPercent: 40, activePlayers: 1 }));
    store.insertMetricsSample(sample({ sampledAt: "2026-01-01T00:00:10.000Z", cpuPercent: 60, memoryPercent: 55, activePlayers: 3 }));
    store.endServerSession("run-1", "2026-01-01T00:00:15.000Z", 0, "stopped");

    const [summary] = store.getMetricsSessions(null, 10);
    expect(summary.runId).toBe("run-1");
    expect(summary.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(summary.endedAt).toBe("2026-01-01T00:00:15.000Z");
    expect(summary.sampleCount).toBe(2);
    expect(summary.avgCpuPercent).toBe(40);
    expect(summary.peakCpuPercent).toBe(60);
    expect(summary.avgMemoryPercent).toBe(47.5);
    expect(summary.peakMemoryPercent).toBe(55);
    expect(summary.peakPlayers).toBe(3);

    store.close();
  });

  it("reports the currently running session as ongoing (null endedAt) until it's closed", () => {
    const store = new SqliteStore(":memory:");
    store.startServerSession("run-live", "2026-01-01T00:00:00.000Z", null);
    store.insertMetricsSample(sample({ runId: "run-live", sampledAt: "2026-01-01T00:00:05.000Z" }));

    const [summary] = store.getMetricsSessions("run-live", 10);
    expect(summary.endedAt).toBeNull();

    store.close();
  });

  it("falls back to the last sample time for a session that never got an explicit end (e.g. a crash)", () => {
    const store = new SqliteStore(":memory:");
    store.insertMetricsSample(sample({ runId: "run-orphan", sampledAt: "2026-01-01T00:00:05.000Z" }));

    const [summary] = store.getMetricsSessions(null, 10);
    expect(summary.endedAt).toBe("2026-01-01T00:00:05.000Z");

    store.close();
  });

  it("returns full sample history for a session via getMetricsSessionDetail, ordered by time", () => {
    const store = new SqliteStore(":memory:");
    store.startServerSession("run-2", "2026-01-01T00:00:00.000Z", 42);
    store.insertMetricsSample(sample({ runId: "run-2", sampledAt: "2026-01-01T00:00:10.000Z" }));
    store.insertMetricsSample(sample({ runId: "run-2", sampledAt: "2026-01-01T00:00:05.000Z" }));

    const detail = store.getMetricsSessionDetail("run-2");
    expect(detail).toBeDefined();
    expect(detail!.samples.map((s) => s.sampledAt)).toEqual([
      "2026-01-01T00:00:05.000Z",
      "2026-01-01T00:00:10.000Z",
    ]);

    store.close();
  });

  it("returns undefined for a session that was never recorded", () => {
    const store = new SqliteStore(":memory:");
    expect(store.getMetricsSessionDetail("does-not-exist")).toBeUndefined();
    store.close();
  });

  it("prunes whole sessions beyond the retained count, never partial history", () => {
    const store = new SqliteStore(":memory:");
    for (const runId of ["a", "b", "c"]) {
      store.startServerSession(runId, `2026-01-0${"abc".indexOf(runId) + 1}T00:00:00.000Z`, null);
      store.insertMetricsSample(sample({ runId, sampledAt: `2026-01-0${"abc".indexOf(runId) + 1}T00:00:05.000Z` }));
      store.endServerSession(runId, `2026-01-0${"abc".indexOf(runId) + 1}T00:01:00.000Z`, 0, "stopped");
    }

    store.pruneMetricsSessions(2);

    const remaining = store.getMetricsSessions(null, 10).map((s) => s.runId);
    expect(remaining.sort()).toEqual(["b", "c"]);

    store.close();
  });
});
