import { describe, expect, it } from "vitest";
import { computeCpuPercent, MetricsSampler, parseCpuMaxCores, parseCpuStatUsageUsec } from "./metricsSampler.js";

describe("parseCpuStatUsageUsec", () => {
  it("extracts usage_usec from cgroup v2 cpu.stat", () => {
    const content = "usage_usec 123456\nuser_usec 100000\nsystem_usec 23456\n";
    expect(parseCpuStatUsageUsec(content)).toBe(123456);
  });

  it("returns null when the field is missing", () => {
    expect(parseCpuStatUsageUsec("nr_periods 0\n")).toBeNull();
  });
});

describe("parseCpuMaxCores", () => {
  it("computes fractional cores from quota/period", () => {
    expect(parseCpuMaxCores("200000 100000\n", 8)).toBe(2);
    expect(parseCpuMaxCores("50000 100000\n", 8)).toBe(0.5);
  });

  it("falls back to the host core count when quota is 'max'", () => {
    expect(parseCpuMaxCores("max 100000\n", 4)).toBe(4);
  });

  it("falls back on malformed content", () => {
    expect(parseCpuMaxCores("garbage", 4)).toBe(4);
  });
});

describe("computeCpuPercent", () => {
  it("computes 50% for half the elapsed time spent on-CPU (1 core)", () => {
    // 500ms of CPU time used over a 1000ms wall-clock window on 1 core.
    expect(computeCpuPercent(500_000, 1000, 1)).toBe(50);
  });

  it("clamps to cores*100 for multi-core usage", () => {
    // 4000ms of CPU time over a 1000ms window (4 cores fully busy) on a 4-core limit.
    expect(computeCpuPercent(4_000_000, 1000, 4)).toBe(400);
    // Can't exceed the configured core count even if usage math would suggest more.
    expect(computeCpuPercent(8_000_000, 1000, 4)).toBe(400);
  });

  it("returns 0 when elapsed time is zero or negative", () => {
    expect(computeCpuPercent(1000, 0, 1)).toBe(0);
    expect(computeCpuPercent(1000, -5, 1)).toBe(0);
  });
});

describe("MetricsSampler", () => {
  it("provides a sane snapshot immediately without crashing (no cgroup fs on this host)", () => {
    const sampler = new MetricsSampler(1000);
    sampler.start();
    try {
      const snapshot = sampler.getCurrent();
      expect(snapshot.cpu.cores).toBeGreaterThan(0);
      expect(snapshot.memory.totalBytes).toBeGreaterThan(0);
      expect(snapshot.process.rssBytes).toBeGreaterThan(0);
    } finally {
      sampler.stop();
    }
  });
});
