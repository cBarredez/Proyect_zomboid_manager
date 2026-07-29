import { useEffect, useState } from "react";
import { GET, PUT } from "../api/client.js";

type FieldValue = boolean | number | string;

interface SandboxField {
  path: string;
  label: string;
  type: "boolean" | "number" | "string";
  value: FieldValue;
}

interface SandboxGroup {
  name: string;
  fields: SandboxField[];
}

export function Sandbox() {
  const [groups, setGroups] = useState<SandboxGroup[] | null>(null);
  const [edits, setEdits] = useState<Record<string, FieldValue>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const data = await GET<{ groups: SandboxGroup[] }>("/api/sandbox");
      setGroups(data.groups);
      setEdits({});
    } catch (err) {
      setGroups(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setField = (path: string, value: FieldValue) => {
    setEdits((prev) => ({ ...prev, [path]: value }));
  };

  const save = async () => {
    const updates = Object.entries(edits).map(([path, value]) => ({ path, value }));
    if (updates.length === 0) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const data = await PUT<{ groups: SandboxGroup[] }>("/api/sandbox", { updates });
      setGroups(data.groups);
      setEdits({});
      setMessage(`Saved ${updates.length} setting${updates.length === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <section>
        <h2>Sandbox settings</h2>
        <p role="alert">{error}</p>
        <div className="row">
          <button onClick={load}>Retry</button>
        </div>
      </section>
    );
  }

  if (!groups) {
    return (
      <section>
        <h2>Sandbox settings</h2>
        <p className="empty-state">Loading…</p>
      </section>
    );
  }

  const dirty = Object.keys(edits).length > 0;

  return (
    <>
      {message && (
        <section>
          <p>{message}</p>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.name}>
          <h2>{group.name}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem 1.5rem" }}>
            {group.fields.map((field) => {
              const current = edits[field.path] ?? field.value;
              return (
                <label key={field.path}>
                  {field.label}
                  {field.type === "boolean" ? (
                    <input
                      type="checkbox"
                      checked={current as boolean}
                      onChange={(e) => setField(field.path, e.target.checked)}
                      style={{ width: "auto", alignSelf: "flex-start" }}
                    />
                  ) : field.type === "number" ? (
                    <input
                      type="number"
                      value={current as number}
                      onChange={(e) => setField(field.path, Number(e.target.value))}
                    />
                  ) : (
                    <input
                      type="text"
                      value={current as string}
                      onChange={(e) => setField(field.path, e.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </section>
      ))}
      <section>
        <div className="row">
          <button className="btn-primary" disabled={!dirty || busy} onClick={save}>
            Save changes
          </button>
          <button disabled={busy} onClick={load}>
            Discard &amp; reload
          </button>
        </div>
      </section>
    </>
  );
}
