import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

export interface AuditRow {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  detail: string | null;
}

export interface MetricsSample {
  runId: string;
  sampledAt: string;
  cpuPercent: number | null;
  coresCapacity: number;
  memoryUsedBytes: number;
  memoryPercent: number;
  activePlayers: number | null;
}

export interface MetricsSessionSummary {
  runId: string;
  startedAt: string;
  endedAt: string | null;
  sampleCount: number;
  avgCpuPercent: number | null;
  peakCpuPercent: number | null;
  coresCapacity: number;
  avgMemoryPercent: number | null;
  peakMemoryPercent: number | null;
  peakPlayers: number | null;
}

export interface MetricsSessionDetail {
  session: MetricsSessionSummary;
  samples: MetricsSample[];
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Generic key-value + typed tables store, mirroring arma_server's
 * SqliteStore: most mutable panel state (panel auth, modlists, run
 * reservations) lives as JSON blobs under a single kv table so new state
 * doesn't require schema migrations.
 */
export class SqliteStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS run_reservations (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        status TEXT NOT NULL,
        started_at TEXT,
        run_id TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT
      );
      CREATE TABLE IF NOT EXISTS server_sessions (
        run_id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        pid INTEGER,
        exit_code INTEGER,
        end_reason TEXT NOT NULL DEFAULT 'running'
      );
      CREATE INDEX IF NOT EXISTS ix_server_sessions_started ON server_sessions(started_at DESC);
      CREATE TABLE IF NOT EXISTS metrics_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        sampled_at TEXT NOT NULL,
        cpu_percent REAL,
        cores_capacity REAL NOT NULL,
        memory_used_bytes INTEGER NOT NULL,
        memory_percent REAL NOT NULL,
        active_players INTEGER
      );
      CREATE INDEX IF NOT EXISTS ix_metrics_samples_run ON metrics_samples(run_id, sampled_at);
    `);
  }

  /** Records that a new server run started, mirroring arma_server's server_sessions table. */
  startServerSession(runId: string, startedAt: string, pid: number | null): void {
    this.db
      .prepare(
        `INSERT INTO server_sessions (run_id, started_at, ended_at, pid, exit_code, end_reason)
         VALUES (?, ?, NULL, ?, NULL, 'running')
         ON CONFLICT(run_id) DO UPDATE SET
           started_at = excluded.started_at, ended_at = NULL, pid = excluded.pid,
           exit_code = NULL, end_reason = 'running'`,
      )
      .run(runId, startedAt, pid);
  }

  endServerSession(runId: string, endedAt: string, exitCode: number | null, reason: string): void {
    this.db
      .prepare(
        `UPDATE server_sessions SET
           ended_at = COALESCE(ended_at, ?), exit_code = COALESCE(exit_code, ?),
           end_reason = CASE WHEN end_reason = 'running' THEN ? ELSE end_reason END
         WHERE run_id = ?`,
      )
      .run(endedAt, exitCode, reason, runId);
  }

  insertMetricsSample(sample: MetricsSample): void {
    this.db
      .prepare(
        `INSERT INTO metrics_samples
           (run_id, sampled_at, cpu_percent, cores_capacity, memory_used_bytes, memory_percent, active_players)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sample.runId,
        sample.sampledAt,
        sample.cpuPercent,
        sample.coresCapacity,
        sample.memoryUsedBytes,
        sample.memoryPercent,
        sample.activePlayers,
      );
  }

  /** Recent sessions with aggregated CPU/RAM/player stats, newest first — backs the Dashboard's Session Metrics panel. */
  getMetricsSessions(currentRunId: string | null, limit: number): MetricsSessionSummary[] {
    const rows = this.db
      .prepare<
        [number],
        {
          runId: string;
          startedAt: string;
          endedAtRaw: string | null;
          lastSampleAt: string;
          sampleCount: number;
          avgCpuPercent: number | null;
          peakCpuPercent: number | null;
          coresCapacity: number;
          avgMemoryPercent: number | null;
          peakMemoryPercent: number | null;
          peakPlayers: number | null;
        }
      >(
        `SELECT m.run_id as runId,
           COALESCE(s.started_at, MIN(m.sampled_at)) as startedAt,
           s.ended_at as endedAtRaw,
           MAX(m.sampled_at) as lastSampleAt,
           COUNT(*) as sampleCount,
           AVG(m.cpu_percent) as avgCpuPercent, MAX(m.cpu_percent) as peakCpuPercent,
           MAX(m.cores_capacity) as coresCapacity,
           AVG(m.memory_percent) as avgMemoryPercent, MAX(m.memory_percent) as peakMemoryPercent,
           MAX(m.active_players) as peakPlayers
         FROM metrics_samples m LEFT JOIN server_sessions s ON s.run_id = m.run_id
         GROUP BY m.run_id
         ORDER BY startedAt DESC
         LIMIT ?`,
      )
      .all(limit);

    return rows.map((row) => ({
      runId: row.runId,
      startedAt: row.startedAt,
      endedAt: row.endedAtRaw ?? (row.runId === currentRunId ? null : row.lastSampleAt),
      sampleCount: row.sampleCount,
      avgCpuPercent: row.avgCpuPercent,
      peakCpuPercent: row.peakCpuPercent,
      coresCapacity: row.coresCapacity,
      avgMemoryPercent: row.avgMemoryPercent,
      peakMemoryPercent: row.peakMemoryPercent,
      peakPlayers: row.peakPlayers,
    }));
  }

  getMetricsSamples(runId: string): MetricsSample[] {
    return this.db
      .prepare<
        [string],
        {
          runId: string;
          sampledAt: string;
          cpuPercent: number | null;
          coresCapacity: number;
          memoryUsedBytes: number;
          memoryPercent: number;
          activePlayers: number | null;
        }
      >(
        `SELECT run_id as runId, sampled_at as sampledAt, cpu_percent as cpuPercent,
                cores_capacity as coresCapacity, memory_used_bytes as memoryUsedBytes,
                memory_percent as memoryPercent, active_players as activePlayers
         FROM metrics_samples WHERE run_id = ? ORDER BY sampled_at`,
      )
      .all(runId);
  }

  getMetricsSessionDetail(runId: string): MetricsSessionDetail | undefined {
    const samples = this.getMetricsSamples(runId);
    const session = this.db
      .prepare<[string], { startedAt: string; endedAt: string | null }>(
        `SELECT started_at as startedAt, ended_at as endedAt FROM server_sessions WHERE run_id = ?`,
      )
      .get(runId);
    if (!session && samples.length === 0) return undefined;

    const cpuValues = samples.map((s) => s.cpuPercent).filter((v): v is number => v !== null);
    const memoryValues = samples.map((s) => s.memoryPercent);
    const playerValues = samples.map((s) => s.activePlayers).filter((v): v is number => v !== null);
    const coresCapacity = samples.reduce((max, s) => Math.max(max, s.coresCapacity), 0);

    const summary: MetricsSessionSummary = {
      runId,
      startedAt: session?.startedAt ?? samples[0]?.sampledAt ?? new Date().toISOString(),
      endedAt: session?.endedAt ?? null,
      sampleCount: samples.length,
      avgCpuPercent: average(cpuValues),
      peakCpuPercent: cpuValues.length ? Math.max(...cpuValues) : null,
      coresCapacity,
      avgMemoryPercent: average(memoryValues),
      peakMemoryPercent: memoryValues.length ? Math.max(...memoryValues) : null,
      peakPlayers: playerValues.length ? Math.max(...playerValues) : null,
    };
    return { session: summary, samples };
  }

  /** Keeps the table from growing forever — drops whole sessions (never partial history) beyond the most recent `keepSessions`. */
  pruneMetricsSessions(keepSessions: number): void {
    this.db
      .prepare(
        `DELETE FROM metrics_samples WHERE run_id NOT IN (
           SELECT run_id FROM metrics_samples GROUP BY run_id ORDER BY MIN(sampled_at) DESC LIMIT ?
         )`,
      )
      .run(keepSessions);
    this.db
      .prepare(`DELETE FROM server_sessions WHERE run_id NOT IN (SELECT DISTINCT run_id FROM metrics_samples)`)
      .run();
  }

  insertAudit(username: string, action: string, detail: string | null): void {
    this.db
      .prepare(`INSERT INTO audit_log (timestamp, username, action, detail) VALUES (datetime('now'), ?, ?, ?)`)
      .run(username, action, detail);
  }

  listAudit(limit: number): AuditRow[] {
    return this.db
      .prepare<
        [number],
        AuditRow
      >(`SELECT id, timestamp, username, action, detail FROM audit_log ORDER BY id DESC LIMIT ?`)
      .all(limit);
  }

  getRaw(key: string): string | undefined {
    const row = this.db
      .prepare<[string], { value: string }>("SELECT value FROM kv_state WHERE key = ?")
      .get(key);
    return row?.value;
  }

  setRaw(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value);
  }

  getJson<T>(key: string): T | undefined {
    const raw = this.getRaw(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  setJson<T>(key: string, value: T): void {
    this.setRaw(key, JSON.stringify(value));
  }

  deleteKey(key: string): void {
    this.db.prepare("DELETE FROM kv_state WHERE key = ?").run(key);
  }

  close(): void {
    this.db.close();
  }
}
