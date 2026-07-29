import { useRef, useState, type KeyboardEvent } from "react";
import { POST } from "../api/client.js";

interface Exchange {
  id: number;
  command: string;
  response?: string;
  error?: string;
}

let nextId = 1;

export function Console() {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);

  const run = async () => {
    const trimmed = command.trim();
    if (!trimmed || busy) return;

    historyRef.current.push(trimmed);
    historyIndexRef.current = historyRef.current.length;
    setCommand("");
    setBusy(true);

    const id = nextId++;
    setExchanges((prev) => [...prev.slice(-99), { id, command: trimmed }]);

    try {
      const result = await POST<{ response: string }>("/api/server/rcon", { command: trimmed });
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, response: result.response } : e)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, error: message } : e)));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      run();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
        setCommand(historyRef.current[historyIndexRef.current] ?? "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndexRef.current < historyRef.current.length - 1) {
        historyIndexRef.current += 1;
        setCommand(historyRef.current[historyIndexRef.current] ?? "");
      } else {
        historyIndexRef.current = historyRef.current.length;
        setCommand("");
      }
    }
  };

  return (
    <section>
      <h2>RCON console</h2>
      <pre className="log-box">
        {exchanges.length === 0
          ? "No commands run yet. Try: players, save, servermsg \"hello\""
          : exchanges.map((e) => (
              <span className="log-line" key={e.id}>
                <span className="log-source">{"> "}</span>
                {e.command}
                {e.response !== undefined && `\n${e.response}`}
                {e.error !== undefined && `\n[error] ${e.error}`}
              </span>
            ))}
      </pre>
      <div className="row">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type an RCON command, ↑/↓ for history"
          style={{ flex: 1, fontFamily: "ui-monospace, Consolas, monospace" }}
        />
        <button className="btn-primary" disabled={busy} onClick={run}>
          Run
        </button>
      </div>
    </section>
  );
}
