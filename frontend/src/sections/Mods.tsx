import { useEffect, useState } from "react";
import { DELETE, GET, POST, type ServerStatusResponse } from "../api/client.js";
import { IconDownload, IconTrash, IconWarning } from "../icons.js";

interface ModInfo {
  id: string;
  name: string;
}

interface WorkshopItemEntry {
  workshopId: string;
  mods: ModInfo[];
}

export function Mods() {
  const [items, setItems] = useState<WorkshopItemEntry[]>([]);
  const [missingDependencies, setMissingDependencies] = useState<string[]>([]);
  const [workshopId, setWorkshopId] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serverRunning, setServerRunning] = useState(false);

  const refresh = async () => {
    const [data, status] = await Promise.all([
      GET<{ items: WorkshopItemEntry[]; missingDependencies: string[] }>("/api/workshop/installed"),
      GET<ServerStatusResponse>("/api/server/status"),
    ]);
    setItems(data.items);
    setMissingDependencies(data.missingDependencies);
    setServerRunning(status.running);
  };

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const install = async () => {
    if (!workshopId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await POST("/api/workshop/install", { workshopId: workshopId.trim() });
      setWorkshopId("");
      await refresh();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(
        detail.includes("no mod.info")
          ? `${detail}. The item may be a map, framework, client-only item, removed item, or incompatible with this server build.`
          : detail,
      );
    } finally {
      setBusy(false);
    }
  };

  const importCollection = async () => {
    if (!collectionId.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await POST<{ installedWorkshopIds: string[]; failedWorkshopIds: string[] }>(
        "/api/workshop/install-collection",
        { collectionId: collectionId.trim() },
      );
      setCollectionId("");
      setMessage(
        `Imported ${result.installedWorkshopIds.length} item(s)` +
          (result.failedWorkshopIds.length > 0
            ? `; ${result.failedWorkshopIds.length} failed (${result.failedWorkshopIds.join(", ")})`
            : "."),
      );
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
    setMessage(null);
    try {
      await DELETE(`/api/workshop/${id}`);
      setMessage(`Workshop item ${id} removed.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section>
        <h2>Workshop mods</h2>
        {error && <p role="alert">{error}</p>}
        {message && <p>{message}</p>}
        {serverRunning && (
          <p className="notice-warning">
            Stop the game server before removing Workshop items.
          </p>
        )}

        <div className="row">
          <input
            value={workshopId}
            onChange={(e) => setWorkshopId(e.target.value)}
            placeholder="Workshop item ID"
            style={{ minWidth: 220 }}
          />
          <button className="btn-primary" disabled={busy} onClick={install}>
            <IconDownload />
            Install
          </button>
        </div>

        <div className="row">
          <input
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            placeholder="Workshop collection ID"
            style={{ minWidth: 220 }}
          />
          <button disabled={busy} onClick={importCollection}>
            <IconDownload />
            Import whole collection
          </button>
        </div>

        {missingDependencies.length > 0 && (
          <p role="alert">
            <IconWarning style={{ verticalAlign: "-3px", marginRight: "0.4rem" }} />
            Missing dependencies: {missingDependencies.join(", ")} — install the Workshop item(s) that
            provide these mod IDs.
          </p>
        )}

        {items.length === 0 ? (
          <p className="empty-state">No Workshop mods installed yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Workshop ID</th>
                <th>Mods</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.workshopId}>
                  <td className="mod-id">
                    <a
                      href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(item.workshopId)}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`Open Workshop item ${item.workshopId}`}
                    >
                      {item.workshopId}
                    </a>
                  </td>
                  <td>{item.mods.map((m) => m.name).join(", ") || "no mod.info found"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button disabled={busy || serverRunning} onClick={() => remove(item.workshopId)}>
                      <IconTrash />
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
