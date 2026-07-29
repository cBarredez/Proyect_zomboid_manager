import { useEffect, useState } from "react";
import { DELETE, GET, POST } from "../api/client.js";
import { IconArchive, IconHistory, IconTrash } from "../icons.js";

interface BackupInfo {
  id: string;
  reason: string;
  createdAt: string;
  sizeBytes: number;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Backups() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const data = await GET<{ backups: BackupInfo[] }>("/api/backups");
    setBackups(data.backups);
  };

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const createBackup = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await POST("/api/backups");
      setMessage("Backup created.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    if (!confirm(`Restore backup ${id}? This overwrites current save data (a pre-restore snapshot is taken first).`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await POST(`/api/backups/${encodeURIComponent(id)}/restore`);
      setMessage("Backup restored.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await DELETE(`/api/backups/${encodeURIComponent(id)}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Backups</h2>
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}

      <div className="row">
        <button className="btn-primary" disabled={busy} onClick={createBackup}>
          <IconArchive />
          Create backup now
        </button>
      </div>

      {backups.length === 0 ? (
        <p className="empty-state">No backups yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Reason</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.createdAt).toLocaleString()}</td>
                <td className="mod-id">{b.reason}</td>
                <td>{formatSize(b.sizeBytes)}</td>
                <td style={{ textAlign: "right" }}>
                  <button disabled={busy} onClick={() => restore(b.id)} style={{ marginRight: "0.4rem" }}>
                    <IconHistory />
                    Restore
                  </button>
                  <button disabled={busy} onClick={() => remove(b.id)}>
                    <IconTrash />
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
