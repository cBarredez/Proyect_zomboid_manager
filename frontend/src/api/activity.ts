export interface ApiActivityEntry {
  id: number;
  method: string;
  path: string;
  status: number | "error";
  durationMs: number;
  timestamp: string;
  error?: string;
}

type Listener = (entry: ApiActivityEntry) => void;

const listeners = new Set<Listener>();
let nextId = 1;

/** Pub-sub for frontend API calls, so any component (e.g. the console drawer) can observe them live. */
export function subscribeApiActivity(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordApiActivity(entry: Omit<ApiActivityEntry, "id">): void {
  const full: ApiActivityEntry = { id: nextId++, ...entry };
  for (const listener of listeners) listener(full);
}
