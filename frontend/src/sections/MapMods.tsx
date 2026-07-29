import { useEffect, useMemo, useState } from "react";
import { GET, PUT } from "../api/client.js";
import { IconMap, IconWarning } from "../icons.js";

type Compatibility = "build41" | "build42" | "universal";
interface MapComponent {
  key: string;
  workshopId: string;
  modId: string;
  modName: string;
  mapFolder: string;
  compatibility: Compatibility;
  hasSpawnPoints: boolean;
  cells: string[];
}
interface ConfigEntry {
  key: string;
  enabled: boolean;
  spawnEnabled: boolean;
}
interface MapResponse {
  components: MapComponent[];
  config: { entries: ConfigEntry[] };
  pending: { entries: ConfigEntry[] } | null;
  conflicts: { cell: string; maps: string[] }[];
  worldExists: boolean;
}

const CONFIRMATION = "ERASE CURRENT WORLD";

export function MapMods() {
  const [components, setComponents] = useState<MapComponent[]>([]);
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [worldExists, setWorldExists] = useState(false);
  const [conflicts, setConflicts] = useState<MapResponse["conflicts"]>([]);
  const [mode, setMode] = useState<"next-world" | "erase">("next-world");
  const [confirmation, setConfirmation] = useState("");
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = async () => {
    const data = await GET<MapResponse>("/api/maps");
    setComponents(data.components);
    setEntries((data.pending ?? data.config).entries);
    setPending(Boolean(data.pending));
    setWorldExists(data.worldExists);
    setConflicts(data.conflicts);
  };

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const byKey = useMemo(() => new Map(components.map((item) => [item.key, item])), [components]);
  const ordered = entries
    .map((entry) => ({ entry, component: byKey.get(entry.key) }))
    .filter((item): item is { entry: ConfigEntry; component: MapComponent } => Boolean(item.component));

  const updateEntry = (key: string, patch: Partial<ConfigEntry>) => {
    setEntries((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );
  };

  const move = (key: string, delta: number) => {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const dropBefore = (targetKey: string) => {
    if (!draggedKey || draggedKey === targetKey) return;
    setEntries((current) => {
      const dragged = current.find((entry) => entry.key === draggedKey);
      if (!dragged) return current;
      const without = current.filter((entry) => entry.key !== draggedKey);
      const target = without.findIndex((entry) => entry.key === targetKey);
      without.splice(target, 0, dragged);
      return without;
    });
    setDraggedKey(null);
  };

  const apply = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await PUT<{ applied: boolean; pending: boolean }>("/api/maps", {
        config: { entries },
        mode: worldExists ? mode : "erase",
        confirmation: mode === "erase" ? confirmation : undefined,
      });
      setMessage(
        result.pending
          ? "Map preset saved for the next new world. Erase the current world later to activate it."
          : "Map configuration applied. You can start the server.",
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const enabledFolders = ordered
    .filter(({ entry }) => entry.enabled)
    .map(({ component }) => component.mapFolder);

  return (
    <div className="map-mods-page">
      <section>
        <div className="section-heading">
          <div>
            <span className="section-kicker">AUTOMATIC DISCOVERY</span>
            <h2><IconMap /> Map mods</h2>
          </div>
          {pending && <span className="status-pill" data-tone="warning">Pending next world</span>}
        </div>
        <p className="info-help">
          The panel detected map folders and spawn files from installed Workshop items. Drag rows
          to control map load order. Higher rows load first.
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}

        {ordered.length === 0 ? (
          <p className="empty-state">No map components detected in installed Workshop items.</p>
        ) : (
          <div className="map-component-list">
            {ordered.map(({ entry, component }, index) => (
              <article
                className="map-component"
                key={entry.key}
                draggable
                onDragStart={() => setDraggedKey(entry.key)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropBefore(entry.key)}
              >
                <span className="drag-handle" title="Drag to reorder">⋮⋮</span>
                <span className="map-order">{index + 1}</span>
                <div className="map-component-main">
                  <strong>{component.modName}</strong>
                  <span>
                    Folder: <code>{component.mapFolder}</code> · Mod: <code>{component.modId}</code>
                  </span>
                  <span>
                    {component.cells.length
                      ? `${component.cells.length} world cell(s)`
                      : "Overlay / spawn-only map (no world cells)"}
                  </span>
                </div>
                <a
                  href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${component.workshopId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {component.workshopId}
                </a>
                <span className="compatibility-badge" data-compatibility={component.compatibility}>
                  {component.compatibility === "build42"
                    ? "Build 42"
                    : component.compatibility === "build41"
                      ? "Build 41"
                      : "Universal"}
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(event) => updateEntry(entry.key, { enabled: event.target.checked })}
                  />
                  Enabled
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={entry.spawnEnabled}
                    disabled={!entry.enabled || !component.hasSpawnPoints}
                    onChange={(event) =>
                      updateEntry(entry.key, { spawnEnabled: event.target.checked })
                    }
                  />
                  Spawn region
                </label>
                <div className="map-order-buttons">
                  <button disabled={index === 0} onClick={() => move(entry.key, -1)}>↑</button>
                  <button disabled={index === ordered.length - 1} onClick={() => move(entry.key, 1)}>↓</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Configuration preview</h2>
        <dl className="info-list">
          <div><dt>Map=</dt><dd><code>{[...enabledFolders, "Muldraugh, KY"].join(";")}</code></dd></div>
          <div><dt>Spawn regions</dt><dd>{ordered.filter(({ entry, component }) => entry.enabled && entry.spawnEnabled && component.hasSpawnPoints).length} custom</dd></div>
          <div><dt>Current world</dt><dd>{worldExists ? "Exists" : "No world detected"}</dd></div>
        </dl>
        {conflicts.length > 0 && (
          <div className="notice-warning" role="alert">
            <IconWarning /> Cell conflicts detected:
            {conflicts.map((conflict) => (
              <div key={conflict.cell}><code>{conflict.cell}</code>: {conflict.maps.join(", ")}</div>
            ))}
          </div>
        )}
      </section>

      <section className={mode === "erase" ? "danger-zone" : ""}>
        <h2>Apply map preset</h2>
        {worldExists ? (
          <>
            <label>
              <input type="radio" checked={mode === "next-world"} onChange={() => setMode("next-world")} />
              Save for the next new world (keep the current world unchanged)
            </label>
            <label>
              <input type="radio" checked={mode === "erase"} onChange={() => setMode("erase")} />
              Back up, erase the current world, and apply now
            </label>
            {mode === "erase" && (
              <label>
                Type <code>{CONFIRMATION}</code>
                <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </label>
            )}
          </>
        ) : (
          <p>No current world exists; this preset can be applied immediately.</p>
        )}
        <button
          className={mode === "erase" && worldExists ? "btn-danger" : "btn-primary"}
          disabled={
            busy ||
            conflicts.length > 0 ||
            (worldExists && mode === "erase" && confirmation !== CONFIRMATION)
          }
          onClick={apply}
        >
          {mode === "next-world" && worldExists ? "Save for next world" : "Apply map preset"}
        </button>
      </section>
    </div>
  );
}
