import { readFileSync } from "node:fs";
import os from "node:os";

export interface MetricsSnapshot {
  timestamp: string;
  cpu: { percent: number; cores: number };
  memory: { usedBytes: number; totalBytes: number; percent: number };
  process: { rssBytes: number };
}

const CGROUP_CPU_STAT = "/sys/fs/cgroup/cpu.stat";
const CGROUP_CPU_MAX = "/sys/fs/cgroup/cpu.max";
const CGROUP_MEMORY_CURRENT = "/sys/fs/cgroup/memory.current";
const CGROUP_MEMORY_MAX = "/sys/fs/cgroup/memory.max";

/** Extracts `usage_usec` (cumulative CPU microseconds) from cgroup v2 `cpu.stat`. */
export function parseCpuStatUsageUsec(content: string): number | null {
  const match = /^usage_usec\s+(\d+)/m.exec(content);
  return match ? Number(match[1]) : null;
}

/** Parses cgroup v2 `cpu.max` ("<quota> <period>" or "max <period>") into an effective core count. */
export function parseCpuMaxCores(content: string, fallbackCores: number): number {
  const [quota, period] = content.trim().split(/\s+/);
  if (quota === "max" || !period) return fallbackCores;
  const cores = Number(quota) / Number(period);
  return Number.isFinite(cores) && cores > 0 ? cores : fallbackCores;
}

/** Computes a 0..(cores*100) CPU percentage from two cumulative usage_usec readings. */
export function computeCpuPercent(deltaUsec: number, elapsedMs: number, cores: number): number {
  if (elapsedMs <= 0) return 0;
  const elapsedUsec = elapsedMs * 1000;
  const percent = (deltaUsec / elapsedUsec) * 100;
  return round1(clamp(percent, 0, cores * 100));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Samples host CPU/RAM every `intervalMs`, mirroring arma_server's approach:
 * read cgroup v2 pseudo-files directly (no shell-out, no external library),
 * falling back to Node's `os` module when they're unavailable (local dev on
 * Windows/macOS, or a host still on cgroup v1). Keeps only the latest
 * snapshot in memory — history/sparklines are the frontend's job, polling
 * this on an interval, same as arma_server's dashboard chart.
 */
export class MetricsSampler {
  private current: MetricsSnapshot;
  private timer: NodeJS.Timeout | null = null;
  private lastUsageUsec: number | null = null;
  private lastSampleAt = 0;

  constructor(private readonly intervalMs = 1000) {
    this.current = {
      timestamp: new Date().toISOString(),
      cpu: { percent: 0, cores: os.cpus().length || 1 },
      memory: { usedBytes: 0, totalBytes: os.totalmem(), percent: 0 },
      process: { rssBytes: process.memoryUsage().rss },
    };
  }

  start(): void {
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getCurrent(): MetricsSnapshot {
    return this.current;
  }

  private sample(): void {
    this.current = {
      timestamp: new Date().toISOString(),
      cpu: this.sampleCpu(),
      memory: this.sampleMemory(),
      process: { rssBytes: process.memoryUsage().rss },
    };
  }

  private sampleCpu(): { percent: number; cores: number } {
    const fallbackCores = os.cpus().length || 1;

    try {
      const usageUsec = parseCpuStatUsageUsec(readFileSync(CGROUP_CPU_STAT, "utf-8"));
      const cores = parseCpuMaxCores(readFileSync(CGROUP_CPU_MAX, "utf-8"), fallbackCores);
      if (usageUsec === null) throw new Error("usage_usec missing");

      const now = Date.now();
      let percent = 0;
      if (this.lastUsageUsec !== null) {
        percent = computeCpuPercent(usageUsec - this.lastUsageUsec, now - this.lastSampleAt, cores);
      }
      this.lastUsageUsec = usageUsec;
      this.lastSampleAt = now;

      return { percent, cores };
    } catch {
      // Not running under cgroup v2 (e.g. local Windows/macOS dev) — approximate
      // from the 1-minute load average, which is the closest os-module analog.
      const load = os.loadavg()[0];
      return { percent: round1(clamp((load / fallbackCores) * 100, 0, 100)), cores: fallbackCores };
    }
  }

  private sampleMemory(): { usedBytes: number; totalBytes: number; percent: number } {
    try {
      const used = Number(readFileSync(CGROUP_MEMORY_CURRENT, "utf-8").trim());
      const maxRaw = readFileSync(CGROUP_MEMORY_MAX, "utf-8").trim();
      const total = maxRaw === "max" ? os.totalmem() : Number(maxRaw);
      if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) throw new Error("invalid cgroup memory");

      return { usedBytes: used, totalBytes: total, percent: round1((used / total) * 100) };
    } catch {
      const total = os.totalmem();
      const used = total - os.freemem();
      return { usedBytes: used, totalBytes: total, percent: round1((used / total) * 100) };
    }
  }
}
