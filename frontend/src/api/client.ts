import { recordApiActivity } from "./activity.js";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const startedAt = performance.now();
  let status: number | "error" = "error";
  let errorMessage: string | undefined;

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: "include",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    status = res.status;

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errorMessage = typeof data.error === "string" ? data.error : `request failed (${res.status})`;
      throw new Error(errorMessage);
    }
    return data as T;
  } catch (err) {
    errorMessage ??= err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    recordApiActivity({
      method,
      path,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
      error: errorMessage,
    });
  }
}

export const GET = <T>(path: string): Promise<T> => request<T>("GET", path);
export const POST = <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body);
export const PUT = <T>(path: string, body?: unknown): Promise<T> => request<T>("PUT", path, body);
export const DELETE = <T>(path: string): Promise<T> => request<T>("DELETE", path);

export interface AuthCheckResponse {
  authenticated: boolean;
  username?: string;
}

export const authCheck = (): Promise<AuthCheckResponse> => GET<AuthCheckResponse>("/api/auth/check");

export interface HealthResponse {
  status: string;
  commit: string;
  buildDate?: string;
}

export const getHealth = (): Promise<HealthResponse> => GET<HealthResponse>("/api/health");

export interface ServerStatusResponse {
  status: "idle" | "starting" | "running" | "stopping" | "crashed";
  running: boolean;
  mockServer: boolean;
  installation: {
    installed: boolean;
    simulated: boolean;
    buildId: string | null;
    lastUpdated: string | null;
    executablePresent: boolean;
    manifestPresent: boolean;
  };
  connection: {
    serverName: string;
    publicAddress: string;
    localAddresses: string[];
    gamePort: number;
    playerPortStart: number;
    playerPortEnd: number;
    rconPort: number;
    webPort: number;
    maxPlayers: number;
    networkMode: string;
  };
}

/** Pure presentation mapping for a server status, kept separate from fetching so it's unit-testable. */
export function statusPresentation(status: ServerStatusResponse["status"]): {
  label: string;
  tone: "neutral" | "positive" | "warning" | "negative";
} {
  switch (status) {
    case "running":
      return { label: "Running", tone: "positive" };
    case "starting":
      return { label: "Starting…", tone: "warning" };
    case "stopping":
      return { label: "Stopping…", tone: "warning" };
    case "crashed":
      return { label: "Crashed", tone: "negative" };
    case "idle":
    default:
      return { label: "Stopped", tone: "neutral" };
  }
}
