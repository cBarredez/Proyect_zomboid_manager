import { EventEmitter } from "node:events";

export type LogSource = "manager" | "steamcmd" | "server";

export interface LogEntry {
  id: number;
  source: LogSource;
  runId: string;
  line: string;
  timestamp: string;
}

const MAX_BUFFER = 5000;

/** In-memory ring buffer + pub/sub, mirrors arma_server's LogHub. */
export class LogHub {
  private readonly emitter = new EventEmitter();
  private readonly buffer: LogEntry[] = [];
  private nextId = 1;

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  append(source: LogSource, runId: string, line: string): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      source,
      runId,
      line,
      timestamp: new Date().toISOString(),
    };
    this.buffer.push(entry);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    this.emitter.emit("entry", entry);
    return entry;
  }

  recent(limit = 500): LogEntry[] {
    return this.buffer.slice(-limit);
  }

  subscribe(onEntry: (entry: LogEntry) => void): () => void {
    this.emitter.on("entry", onEntry);
    return () => this.emitter.off("entry", onEntry);
  }
}
