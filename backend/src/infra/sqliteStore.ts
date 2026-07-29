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
    `);
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
