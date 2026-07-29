import { useEffect, useRef, useState } from "react";
import { GET } from "../api/client.js";
import { MetricsChart } from "./MetricsChart.js";
import { formatSize } from "./Backups.js";

export interface MetricsSnapshot {
  timestamp: string;
  cpu: { percent: number; cores: number };
  memory: { usedBytes: number; totalBytes: number; percent: number };
  process: { rssBytes: number };
}

const MAX_HISTORY = 30;
const POLL_MS = 2000;

export function Metrics() {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cpuHistoryRef = useRef<number[]>([]);
  const memHistoryRef = useRef<number[]>([]);
  const [, forceRender] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const data = await GET<MetricsSnapshot>("/api/metrics");
        if (cancelled) return;
        setSnapshot(data);
        setError(null);

        cpuHistoryRef.current = [...cpuHistoryRef.current, data.cpu.percent].slice(-MAX_HISTORY);
        memHistoryRef.current = [...memHistoryRef.current, data.memory.percent].slice(-MAX_HISTORY);
        forceRender((n) => n + 1);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="metrics-page">
      <div className="section-heading">
        <div>
          <span className="section-kicker">CONTAINER TELEMETRY · 2S REFRESH</span>
          <h2>Live resources</h2>
        </div>
        <span className="live-indicator"><i />Live</span>
      </div>
      {error && <p role="alert">{error}</p>}

      <div className="stat-tiles">
        <div className="stat-tile" data-series="1">
          <span className="stat-tile-label">CPU</span>
          <span className="stat-tile-value">{snapshot ? `${snapshot.cpu.percent}%` : "—"}</span>
          <span className="stat-tile-sub">{snapshot ? `${snapshot.cpu.cores} core(s) available` : ""}</span>
        </div>
        <div className="stat-tile" data-series="2">
          <span className="stat-tile-label">Memory</span>
          <span className="stat-tile-value">{snapshot ? `${snapshot.memory.percent}%` : "—"}</span>
          <span className="stat-tile-sub">
            {snapshot ? `${formatSize(snapshot.memory.usedBytes)} / ${formatSize(snapshot.memory.totalBytes)}` : ""}
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-label">Panel process</span>
          <span className="stat-tile-value">{snapshot ? formatSize(snapshot.process.rssBytes) : "—"}</span>
          <span className="stat-tile-sub">resident memory</span>
        </div>
      </div>

      {cpuHistoryRef.current.length > 0 && (
        <div className="metrics-chart-panel">
          <div className="chart-panel-title">Resource history · last 60 seconds</div>
          <MetricsChart
            series={[
              { label: "CPU %", color: "var(--series-1)", values: cpuHistoryRef.current },
              { label: "Memory %", color: "var(--series-2)", values: memHistoryRef.current },
            ]}
          />
        </div>
      )}
    </section>
  );
}
