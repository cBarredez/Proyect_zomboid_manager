import { useEffect, useState } from "react";
import { GET } from "../api/client.js";

interface AuditEntry {
  id: number;
  timestamp: string;
  username: string;
  action: string;
  detail: Record<string, unknown> | null;
}

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    GET<{ entries: AuditEntry[] }>("/api/audit")
      .then((data) => setEntries(data.entries))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section>
      <h2>Audit log</h2>
      {error && <p role="alert">{error}</p>}

      {entries.length === 0 ? (
        <p className="empty-state">No admin actions recorded yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Action</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.timestamp.replace(" ", "T") + "Z").toLocaleString()}</td>
                <td>{e.username}</td>
                <td className="mod-id">{e.action}</td>
                <td>{e.detail ? JSON.stringify(e.detail) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
