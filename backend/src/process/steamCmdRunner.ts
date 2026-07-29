import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { LogHub } from "../infra/logHub.js";
import {
  PZ_DEDICATED_SERVER_APP_ID,
  PZ_WORKSHOP_APP_ID,
  type ServerPaths,
} from "../domain/serverPaths.js";

export interface SteamCmdCredentials {
  username?: string;
  password?: string;
}

export class SteamCmdError extends Error {
  constructor(
    message: string,
    readonly exitCode?: number | null,
  ) {
    super(message);
    this.name = "SteamCmdError";
  }
}

function redact(line: string): string {
  return line.replace(/(\+login\s+\S+\s+)\S+/i, "$1********");
}

/**
 * Serializes SteamCMD invocations (install/update/workshop download) through
 * one in-flight task per key, so duplicate clicks in the UI dedupe onto the
 * same promise instead of racing two SteamCMD processes.
 */
export class SteamCmdRunner {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly paths: ServerPaths,
    private readonly logHub: LogHub,
    private readonly mock = false,
  ) {}

  /**
   * `betaBranch` maps to SteamCMD's `-beta <branch>` flag, e.g. "unstable"
   * (PZ's Build 42 public test branch) or "iwillbackupmysave" (the older
   * IWBUMS branch). Empty/undefined installs the default stable branch.
   */
  installOrUpdateServer(creds: SteamCmdCredentials = {}, betaBranch = ""): Promise<void> {
    return this.runDeduped("install-server", [
      "+force_install_dir",
      this.paths.installDir,
      ...loginArgs(creds),
      "+app_update",
      PZ_DEDICATED_SERVER_APP_ID,
      ...(betaBranch ? ["-beta", betaBranch] : []),
      "validate",
      "+quit",
    ]);
  }

  downloadWorkshopItem(workshopId: string): Promise<void> {
    return this.runDeduped(`workshop-${workshopId}`, [
      "+login",
      "anonymous",
      "+workshop_download_item",
      PZ_WORKSHOP_APP_ID,
      workshopId,
      "+quit",
    ]).then(async () => {
      if (this.mock) return;
      const itemDir = path.join(this.paths.workshopContentDir, workshopId);
      try {
        if (!(await stat(itemDir)).isDirectory()) throw new Error("not a directory");
      } catch {
        throw new SteamCmdError(
          `SteamCMD did not download Workshop item ${workshopId}; verify that it exists, is public, and allows anonymous server downloads`,
        );
      }
    });
  }

  private runDeduped(key: string, args: string[]): Promise<void> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.run(key, args).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private async run(key: string, args: string[]): Promise<void> {
    if (this.mock) {
      this.logHub.append("steamcmd", key, `[mock] steamcmd ${args.map(redact).join(" ")}`);
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const recentOutput: string[] = [];
      const remember = (line: string) => {
        recentOutput.push(line);
        if (recentOutput.length > 5) recentOutput.shift();
      };
      const child = spawn(this.paths.steamcmdBinary, args, {
        stdio: ["ignore", "pipe", "pipe"],
        // Workshop downloads always use $HOME/Steam; keep that on the persistent volume.
        env: { ...process.env, HOME: this.paths.steamcmdDir },
      });

      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf-8").split(/\r?\n/).filter(Boolean)) {
          remember(redact(line));
          this.logHub.append("steamcmd", key, redact(line));
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString("utf-8").split(/\r?\n/).filter(Boolean)) {
          remember(redact(line));
          this.logHub.append("steamcmd", key, redact(`[stderr] ${line}`));
        }
      });
      child.on("error", (error) => {
        reject(new SteamCmdError(`could not start SteamCMD: ${error.message}`));
      });
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else {
          const detail = recentOutput.at(-1);
          reject(
            new SteamCmdError(
              `SteamCMD exited with code ${code}${detail ? `: ${detail}` : ""}`,
              code,
            ),
          );
        }
      });
    });
  }
}

function loginArgs(creds: SteamCmdCredentials): string[] {
  if (creds.username && creds.password) {
    return ["+login", creds.username, creds.password];
  }
  return ["+login", "anonymous"];
}
