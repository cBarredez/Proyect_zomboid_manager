import { useEffect, useRef, useState } from "react";

interface LogEntry {
  id: number;
  source: string;
  line: string;
  timestamp: string;
}

export function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/logs/stream", { withCredentials: true });
    es.onmessage = (event) => {
      const entry = JSON.parse(event.data) as LogEntry;
      setEntries((prev) => [...prev.slice(-499), entry]);
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [entries]);

  return (
    <section>
      <h2>Logs</h2>
      <pre className="log-box" ref={boxRef}>
        {entries.length === 0
          ? "Waiting for log output…"
          : entries.map((e) => (
              <span className="log-line" key={e.id}>
                <span className="log-source">[{e.source}]</span> {e.line}
              </span>
            ))}
      </pre>
    </section>
  );
}
