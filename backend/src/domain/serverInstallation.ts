import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ServerPaths } from "./serverPaths.js";
import { PZ_DEDICATED_SERVER_APP_ID } from "./serverPaths.js";

export interface ServerInstallation {
  installed: boolean;
  simulated: boolean;
  buildId: string | null;
  lastUpdated: string | null;
  executablePresent: boolean;
  manifestPresent: boolean;
}

function startScriptPath(installDir: string): string {
  return path.join(
    installDir,
    process.platform === "win32" ? "StartServer64.bat" : "start-server.sh",
  );
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function acfValue(contents: string, key: string): string | null {
  const match = contents.match(new RegExp(`"${key}"\\s+"([^"]*)"`, "i"));
  return match?.[1] ?? null;
}

export async function inspectServerInstallation(
  paths: ServerPaths,
  simulated: boolean,
): Promise<ServerInstallation> {
  const manifestPath = path.join(
    paths.installDir,
    "steamapps",
    `appmanifest_${PZ_DEDICATED_SERVER_APP_ID}.acf`,
  );
  const executablePresent = await exists(startScriptPath(paths.installDir));

  let manifest: string | null = null;
  try {
    manifest = await readFile(manifestPath, "utf8");
  } catch {
    // Missing or unreadable manifests are reported in the status response.
  }

  const buildId = manifest ? acfValue(manifest, "buildid") : null;
  const updatedEpoch = manifest ? Number(acfValue(manifest, "LastUpdated")) : Number.NaN;

  return {
    installed: executablePresent && manifest !== null,
    simulated,
    buildId,
    lastUpdated: Number.isFinite(updatedEpoch)
      ? new Date(updatedEpoch * 1000).toISOString()
      : null,
    executablePresent,
    manifestPresent: manifest !== null,
  };
}
