import type { RunEndedInfo, RunStartedInfo, RuntimeState } from "../process/runtimeState.js";
import type { MetricsSampler } from "./metricsSampler.js";
import type { SqliteStore } from "./sqliteStore.js";

/**
 * Persists one CPU/RAM/player sample per tick for the currently running game
 * session, and opens/closes server_sessions rows as RuntimeState reports run
 * start/end — mirrors arma_server's approach of reconstructing "how much did
 * this run use" from a background sampler instead of only showing it live.
 */
export class SessionRecorder {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: SqliteStore,
    private readonly runtime: RuntimeState,
    private readonly metrics: MetricsSampler,
    private readonly getPlayerCount: () => Promise<number | null>,
    private readonly intervalMs = 5000,
  ) {}

  handleRunStarted(info: RunStartedInfo): void {
    this.store.startServerSession(info.runId, info.startedAt, info.pid);
  }

  handleRunEnded(info: RunEndedInfo): void {
    this.store.endServerSession(info.runId, info.endedAt, info.exitCode, info.reason);
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const runId = this.runtime.getRunId();
    if (!runId) return;

    const snapshot = this.metrics.getCurrent();
    let players: number | null = null;
    try {
      players = await this.getPlayerCount();
    } catch {
      players = null;
    }

    this.store.insertMetricsSample({
      runId,
      sampledAt: new Date().toISOString(),
      cpuPercent: snapshot.cpu.percent,
      coresCapacity: snapshot.cpu.cores,
      memoryUsedBytes: snapshot.memory.usedBytes,
      memoryPercent: snapshot.memory.percent,
      activePlayers: players,
    });
  }
}
