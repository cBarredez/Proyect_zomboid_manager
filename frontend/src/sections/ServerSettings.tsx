import { useEffect, useState } from "react";
import { GET, PUT } from "../api/client.js";

type FieldValue = boolean | number | string;

interface IniField {
  key: string;
  label: string;
  type: "boolean" | "number" | "string";
  value: FieldValue;
}

interface ServerSettingsResponse {
  fields: IniField[];
  maxPlayers: number;
  betaBranch: string;
}

export function ServerSettings() {
  const [fields, setFields] = useState<IniField[] | null>(null);
  const [maxPlayers, setMaxPlayers] = useState<number | null>(null);
  const [maxPlayersEdit, setMaxPlayersEdit] = useState<number | null>(null);
  const [edits, setEdits] = useState<Record<string, FieldValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const data = await GET<ServerSettingsResponse>("/api/server-settings");
      setFields(data.fields);
      setMaxPlayers(data.maxPlayers);
      setMaxPlayersEdit(null);
      setEdits({});
    } catch (err) {
      setFields(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (key: string, value: FieldValue) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    const updates = Object.entries(edits).map(([key, value]) => ({ key, value }));
    if (updates.length === 0 && maxPlayersEdit === null) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await PUT<ServerSettingsResponse>("/api/server-settings", {
        ...(updates.length > 0 ? { updates } : {}),
        ...(maxPlayersEdit !== null ? { maxPlayers: maxPlayersEdit } : {}),
      });
      setFields(data.fields);
      setMaxPlayers(data.maxPlayers);
      setMaxPlayersEdit(null);
      setEdits({});
      setMessage("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <section>
        <h2>Server settings</h2>
        <p role="alert">{error}</p>
        <div className="row">
          <button onClick={load}>Retry</button>
        </div>
      </section>
    );
  }

  if (!fields) {
    return (
      <section>
        <h2>Server settings</h2>
        <p className="empty-state">Loading…</p>
      </section>
    );
  }

  const dirty = Object.keys(edits).length > 0 || maxPlayersEdit !== null;

  return (
    <section>
      <h2>Server settings</h2>
      <p className="empty-state">
        Map, join password, visibility, PVP, and everything else in the server's <code>.ini</code> — except
        mods and RCON, which are managed automatically from the Mods and Settings pages.
      </p>
      {message && <p>{message}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1.5rem" }}>
        <label>
          Max Players
          <input
            type="number"
            value={maxPlayersEdit ?? maxPlayers ?? 16}
            onChange={(e) => setMaxPlayersEdit(Number(e.target.value))}
          />
        </label>
      </div>

      {fields.length === 0 ? (
        <p className="empty-state">No other editable fields found in the server ini yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1.5rem" }}>
          {fields.map((field) => {
            const current = edits[field.key] ?? field.value;
            return (
              <label key={field.key}>
                {field.label}
                {field.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={current as boolean}
                    onChange={(e) => setField(field.key, e.target.checked)}
                    style={{ width: "auto", alignSelf: "flex-start" }}
                  />
                ) : field.type === "number" ? (
                  <input
                    type="number"
                    value={current as number}
                    onChange={(e) => setField(field.key, Number(e.target.value))}
                  />
                ) : (
                  <input type="text" value={current as string} onChange={(e) => setField(field.key, e.target.value)} />
                )}
              </label>
            );
          })}
        </div>
      )}

      <div className="row">
        <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
          Save changes
        </button>
        <button disabled={busy} onClick={load}>
          Discard &amp; reload
        </button>
      </div>
    </section>
  );
}
