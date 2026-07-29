import type { SqliteStore } from "./sqliteStore.js";

export interface AuditEntry {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  detail: Record<string, unknown> | null;
}

/** Records admin actions (start/stop, config changes, mod changes, resets) for accountability. */
export function recordAudit(
  store: SqliteStore,
  username: string,
  action: string,
  detail: Record<string, unknown> | null = null,
): void {
  store.insertAudit(username, action, detail === null ? null : JSON.stringify(detail));
}

export function listAudit(store: SqliteStore, limit = 200): AuditEntry[] {
  return store.listAudit(limit).map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    username: row.username,
    action: row.action,
    detail: row.detail ? (JSON.parse(row.detail) as Record<string, unknown>) : null,
  }));
}
