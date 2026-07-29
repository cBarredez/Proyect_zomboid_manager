import { useEffect, useRef, useState } from "react";
import { subscribeApiActivity } from "./api/activity.js";
import { IconPanelBottom } from "./icons.js";

interface ConsoleEntry {
  id: number;
  source: "frontend" | "backend";
  text: string;
  isError: boolean;
}

const MAX_ENTRIES = 300;
let nextEntryId = 1;

function timeLabel(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

/**
 * A persistent bottom drawer, mounted once for the whole app, that answers
 * "did clicking that button actually do anything?" — it shows every API
 * call the frontend makes (method, path, status, timing) interleaved with
 * the live backend log stream (manager/steamcmd/server), so a long-running
 * action like Install has visible progress instead of just a disabled button.
 */
export function ActivityConsole() {
  const [open, setOpen] = useState(false);
  const [hasUnseen, setHasUnseen] = useState(false);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const boxRef = useRef<HTMLPreElement>(null);

  const push = (entry: Omit<ConsoleEntry, "id">) => {
    setEntries((prev) => [...prev.slice(-(MAX_ENTRIES - 1)), { id: nextEntryId++, ...entry }]);
    setHasUnseen((prevUnseen) => prevUnseen || !open);
  };

  useEffect(() => {
    const unsubscribe = subscribeApiActivity((activity) => {
      const statusText = activity.status === "error" ? "error" : activity.status;
      const text = `[${timeLabel()}] [frontend] ${activity.method} ${activity.path} → ${statusText} (${activity.durationMs}ms)${
        activity.error ? ` — ${activity.error}` : ""
      }`;
      push({ source: "frontend", text, isError: activity.status === "error" || (typeof activity.status === "number" && activity.status >= 400) });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/logs/stream", { withCredentials: true });
    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as { source: string; line: string };
        push({ source: "backend", text: `[${timeLabel()}] [${entry.source}] ${entry.line}`, isError: false });
      } catch {
        // ignore malformed SSE payloads
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (open && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [entries, open]);

  const toggle = () => {
    setOpen((v) => !v);
    setHasUnseen(false);
  };

  return (
    <div className={`console-drawer ${open ? "is-open" : ""}`}>
      <button className="console-drawer-toggle" onClick={toggle}>
        <IconPanelBottom />
        Console
        {hasUnseen && !open && <span className="console-drawer-dot" />}
      </button>
      {open && (
        <pre className="log-box console-drawer-body" ref={boxRef}>
          {entries.length === 0
            ? "Waiting for activity…"
            : entries.map((e) => (
                <span className={`log-line${e.isError ? " console-entry-error" : ""}`} key={e.id}>
                  {e.text}
                </span>
              ))}
        </pre>
      )}
    </div>
  );
}
