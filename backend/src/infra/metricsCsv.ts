import type { MetricsSample } from "./sqliteStore.js";

/** CSV export for one session's metrics samples, mirroring arma_server's MetricsCsv. */
export function metricsSessionCsv(samples: MetricsSample[]): string {
  const header = "sampled_at,cpu_percent,cores_capacity,memory_used_mb,memory_percent,active_players";
  const rows = samples.map((sample) =>
    [
      sample.sampledAt,
      sample.cpuPercent ?? "",
      sample.coresCapacity,
      (sample.memoryUsedBytes / 1024 / 1024).toFixed(1),
      sample.memoryPercent,
      sample.activePlayers ?? "",
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}
