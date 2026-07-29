import { useState } from "react";
import { GET, PUT } from "../api/client.js";

export function ConfigEditor() {
  const [path, setPath] = useState("Server/servertest.ini");
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await GET<{ content: string }>(`/api/files/content?path=${encodeURIComponent(path)}`);
      setContent(data.content);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await PUT("/api/files/content", { path, content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Config editor</h2>
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <input value={path} onChange={(e) => setPath(e.target.value)} style={{ minWidth: 320, flex: 1 }} />
        <button disabled={busy} onClick={load}>
          Load
        </button>
        <button className="btn-primary" disabled={busy || !loaded} onClick={save}>
          Save
        </button>
      </div>
      <textarea
        className="code-editor"
        rows={20}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={!loaded}
      />
    </section>
  );
}
