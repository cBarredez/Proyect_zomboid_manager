import { useEffect, useMemo, useState } from "react";
import { API_BASE, GET, type MetricsSessionDetail, type MetricsSessionSummary } from "../api/client.js";
import { MetricsChart } from "./MetricsChart.js";
import { formatDateTime, formatDuration, formatPercentPair } from "./sessionFormat.js";

interface SessionExplorerProps {
  open: boolean;
  initialRunId?: string;
  onClose: () => void;
}

type QuickRange = "1" | "7" | "30" | "90" | "all";

const QUICK_RANGES: { value: QuickRange; label: string }[] = [
  { value: "1", label: "24H" },
  { value: "7", label: "7D" },
  { value: "30", label: "30D" },
  { value: "90", label: "90D" },
  { value: "all", label: "All" },
];

/** Session history browser: date-range filtered run index + a timeline chart per run, mirroring arma_server's Session Explorer modal. */
export function SessionExplorer({ open, initialRunId, onClose }: SessionExplorerProps) {
  const [sessions, setSessions] = useState<MetricsSessionSummary[]>([]);
  const [range, setRange] = useState<QuickRange>("90");
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(initialRunId);
  const [detail, setDetail] = useState<MetricsSessionDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoadingList(true);
    GET<{ sessions: MetricsSessionSummary[] }>("/api/metrics/sessions?limit=100")
      .then((data) => setSessions(data.sessions))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingList(false));
  }, [open]);

  useEffect(() => {
    if (open) setSelectedRunId(initialRunId);
  }, [open, initialRunId]);

  const filteredSessions = useMemo(() => {
    if (range === "all") return sessions;
    const cutoff = Date.now() - Number(range) * 24 * 60 * 60 * 1000;
    return sessions.filter((s) => new Date(s.startedAt).getTime() >= cutoff);
  }, [sessions, range]);

  useEffect(() => {
    if (!selectedRunId && filteredSessions.length > 0) setSelectedRunId(filteredSessions[0].runId);
  }, [selectedRunId, filteredSessions]);

  useEffect(() => {
    if (!open || !selectedRunId) {
      setDetail(null);
      return;
    }
    setError(null);
    setLoadingDetail(true);
    GET<MetricsSessionDetail>(`/api/metrics/sessions/${encodeURIComponent(selectedRunId)}`)
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingDetail(false));
  }, [open, selectedRunId]);

  if (!open) return null;

  const downloadCsv = async () => {
    if (!selectedRunId) return;
    const res = await fetch(`${API_BASE}/api/metrics/sessions/${encodeURIComponent(selectedRunId)}/csv`, {
      credentials: "include",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `session-${selectedRunId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="session-explorer-backdrop" role="presentation" onClick={onClose}>
      <div
        className="session-explorer-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Session explorer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-explorer-header">
          <div>
            <span className="session-panel-kicker">CORRELATED RUN TELEMETRY</span>
            <h2>Session explorer</h2>
          </div>
          <button className="session-explorer-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="session-quick-ranges" role="group" aria-label="Quick date range">
          {QUICK_RANGES.map((r) => (
            <button key={r.value} className={r.value === range ? "active" : ""} onClick={() => setRange(r.value)}>
              {r.label}
            </button>
          ))}
        </div>

        {error && <p role="alert">{error}</p>}

        <div className="session-explorer-workspace">
          <aside className="session-run-index">
            <div className="session-run-index-head">
              <span>RUN INDEX</span>
              <strong>{filteredSessions.length}</strong>
            </div>
            {loadingList ? (
              <p className="empty-state">Loading sessions…</p>
            ) : filteredSessions.length === 0 ? (
              <p className="empty-state">No sessions in this range.</p>
            ) : (
              <div className="session-run-list">
                {filteredSessions.map((s) => (
                  <button
                    key={s.runId}
                    className={`session-run-item${s.runId === selectedRunId ? " active" : ""}`}
                    onClick={() => setSelectedRunId(s.runId)}
                  >
                    <span className="session-run-rail" />
                    <span className="session-run-main">
                      <strong>{formatDateTime(s.startedAt)}</strong>
                      <small>{s.endedAt ? formatDuration(s.startedAt, s.endedAt) : "Running"}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="session-run-detail">
            {loadingDetail ? (
              <div className="session-detail-empty">
                <strong>Loading…</strong>
              </div>
            ) : !detail ? (
              <div className="session-detail-empty">
                <strong>Select a run</strong>
                <span>CPU, RAM and player counts will align on the same timeline.</span>
              </div>
            ) : (
              <>
                <div className="session-detail-heading">
                  <div>
                    <div className={`session-detail-status${detail.session.endedAt ? "" : " live"}`}>
                      {detail.session.endedAt ? "ENDED" : "LIVE"}
                    </div>
                    <h3>{formatDateTime(detail.session.startedAt)}</h3>
                    <code>{detail.session.runId}</code>
                  </div>
                  <button onClick={downloadCsv}>Download CSV</button>
                </div>

                <div className="session-detail-stats">
                  <div>
                    <span>DURATION</span>
                    <strong>{formatDuration(detail.session.startedAt, detail.session.endedAt)}</strong>
                  </div>
                  <div>
                    <span>CPU AVG / PEAK</span>
                    <strong>{formatPercentPair(detail.session.avgCpuPercent, detail.session.peakCpuPercent)}</strong>
                  </div>
                  <div>
                    <span>RAM AVG / PEAK</span>
                    <strong>
                      {formatPercentPair(detail.session.avgMemoryPercent, detail.session.peakMemoryPercent)}
                    </strong>
                  </div>
                  <div>
                    <span>PEAK PLAYERS</span>
                    <strong>{detail.session.peakPlayers ?? "—"}</strong>
                  </div>
                </div>

                {detail.samples.length > 0 ? (
                  <div className="session-chart-shell">
                    <div className="session-chart-title">
                      <span>SESSION TIMELINE</span>
                      <small>{detail.samples.length} samples</small>
                    </div>
                    <MetricsChart
                      series={[
                        {
                          label: "CPU %",
                          color: "var(--series-1)",
                          values: detail.samples.map((s) => s.cpuPercent ?? 0),
                        },
                        {
                          label: "Memory %",
                          color: "var(--series-2)",
                          values: detail.samples.map((s) => s.memoryPercent),
                        },
                      ]}
                    />
                  </div>
                ) : (
                  <p className="empty-state">No samples recorded for this run.</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
