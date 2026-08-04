import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import type { LogHub } from "../infra/logHub.js";
import { rconCommand } from "./rconClient.js";

type ServerChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export type ServerStatus = "idle" | "starting" | "running" | "stopping" | "crashed";

export interface RunStartedInfo {
  runId: string;
  startedAt: string;
  pid: number | null;
}

export interface RunEndedInfo {
  runId: string;
  endedAt: string;
  exitCode: number | null;
  reason: string;
}

export interface RuntimeStateOptions {
  installDir: string;
  dataDir: string;
  serverName: string;
  memoryMinMb: number;
  memoryMaxMb: number;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  adminPassword: string;
  logHub: LogHub;
  mock?: boolean;
  onRunStarted?: (info: RunStartedInfo) => void;
  onRunEnded?: (info: RunEndedInfo) => void;
}

function startScriptPath(installDir: string): string {
  return process.platform === "win32"
    ? `${installDir}\\StartServer64.bat`
    : `${installDir}/start-server.sh`;
}

export function isServerReadyLine(line: string): boolean {
  return /dedicated server is now started|zomboid server is vac secure|server steam id \d+/i.test(
    line,
  );
}

/** Wraps the PZ dedicated server process; mirrors arma_server's RuntimeState. */
export class RuntimeState {
  private child: ServerChildProcess | null = null;
  private running = false;
  private status: ServerStatus = "idle";
  private runId = "";
  private stopRequestedRunId: string | null = null;

  constructor(private readonly opts: RuntimeStateOptions) {}

  getStatus(): ServerStatus {
    return this.status;
  }

  isRunning(): boolean {
    return this.running;
  }

  /** The active run's id, or null when the server isn't running — identifies a session for metrics history. */
  getRunId(): string | null {
    return this.running ? this.runId : null;
  }

  /** Sends an arbitrary RCON command if the server is actually up (mock mode and "not running" both no-op instead of throwing). Used to force a `save` before taking a backup, so the snapshot isn't caught mid-write. */
  async sendRconCommand(command: string): Promise<string | null> {
    if (!this.running || this.opts.mock) return null;
    return rconCommand(
      { host: this.opts.rconHost, port: this.opts.rconPort, password: this.opts.rconPassword },
      command,
    );
  }

  start(): void {
    if (this.running) throw new Error("server is already running");

    this.runId = randomUUID();
    this.status = "starting";
    this.running = true;
    this.stopRequestedRunId = null;
    const startedAt = new Date().toISOString();

    if (this.opts.mock) {
      this.opts.logHub.append("server", this.runId, "[mock] server started");
      this.status = "running";
      this.opts.onRunStarted?.({ runId: this.runId, startedAt, pid: null });
      return;
    }

    const args = [
      "-servername",
      this.opts.serverName,
      `-cachedir=${this.opts.dataDir}`,
      "-adminpassword",
      this.opts.adminPassword,
      "-Xms" + this.opts.memoryMinMb + "m",
      "-Xmx" + this.opts.memoryMaxMb + "m",
    ];

    const child = spawn(startScriptPath(this.opts.installDir), args, {
      cwd: this.opts.installDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split(/\r?\n/).filter(Boolean)) {
        this.opts.logHub.append("server", this.runId, line);
        if (this.child === child && this.running && isServerReadyLine(line)) {
          this.status = "running";
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf-8").split(/\r?\n/).filter(Boolean)) {
        this.opts.logHub.append("server", this.runId, `[stderr] ${line}`);
      }
    });
    const endingRunId = this.runId;
    child.on("exit", (code) => {
      this.opts.logHub.append("server", endingRunId, `process exited with code ${code}`);
      const wasStopRequested = this.stopRequestedRunId === endingRunId;
      if (this.child === child) {
        this.status = code === 0 || this.status === "stopping" ? "idle" : "crashed";
        this.child = null;
        this.running = false;
      }
      const reason = wasStopRequested ? "stopped" : code === 0 ? "process_exit" : "crash";
      this.stopRequestedRunId = null;
      this.opts.onRunEnded?.({ runId: endingRunId, endedAt: new Date().toISOString(), exitCode: code, reason });
    });

    this.child = child;
    this.opts.onRunStarted?.({ runId: this.runId, startedAt, pid: child.pid ?? null });
  }

  async stop(timeoutMs = 15_000): Promise<void> {
    if (!this.running) {
      this.status = "idle";
      return;
    }

    this.status = "stopping";
    const stoppingRunId = this.runId;

    if (this.opts.mock) {
      this.opts.logHub.append("server", this.runId, "[mock] server stopped");
      this.child = null;
      this.running = false;
      this.status = "idle";
      this.opts.onRunEnded?.({ runId: stoppingRunId, endedAt: new Date().toISOString(), exitCode: 0, reason: "stopped" });
      return;
    }

    this.stopRequestedRunId = stoppingRunId;
    const child = this.child;
    if (!child) {
      this.running = false;
      this.status = "idle";
      this.opts.onRunEnded?.({ runId: stoppingRunId, endedAt: new Date().toISOString(), exitCode: null, reason: "stopped" });
      return;
    }
    try {
      await rconCommand(
        { host: this.opts.rconHost, port: this.opts.rconPort, password: this.opts.rconPassword },
        "quit",
      );
    } catch {
      // fall through to SIGTERM/SIGKILL below
    }

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);
      child.once("exit", () => {
        clearTimeout(killTimer);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
}
