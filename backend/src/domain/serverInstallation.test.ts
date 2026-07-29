import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectServerInstallation } from "./serverInstallation.js";
import type { ServerPaths } from "./serverPaths.js";

async function pathsFixture(): Promise<ServerPaths> {
  const installDir = await mkdtemp(path.join(tmpdir(), "pz-install-"));
  return {
    installDir,
    dataDir: path.join(installDir, "data"),
    steamcmdDir: path.join(installDir, "steamcmd"),
    steamcmdBinary: path.join(installDir, "steamcmd", "steamcmd.sh"),
    serverConfigDir: path.join(installDir, "data", "Server"),
    serverIniPath: path.join(installDir, "data", "Server", "servertest.ini"),
    sandboxVarsPath: path.join(installDir, "data", "Server", "servertest_SandboxVars.lua"),
    spawnRegionsPath: path.join(installDir, "data", "Server", "servertest_spawnregions.lua"),
    spawnPointsPath: path.join(installDir, "data", "Server", "servertest_spawnpoints.lua"),
    workshopContentDir: path.join(installDir, "workshop"),
    modsCacheDir: path.join(installDir, "mods"),
  };
}

describe("inspectServerInstallation", () => {
  it("reports an empty install directory as not installed", async () => {
    const paths = await pathsFixture();
    expect(await inspectServerInstallation(paths, true)).toMatchObject({
      installed: false,
      simulated: true,
      executablePresent: false,
      manifestPresent: false,
    });
  });

  it("reads the installed build from the Steam app manifest", async () => {
    const paths = await pathsFixture();
    const script = process.platform === "win32" ? "StartServer64.bat" : "start-server.sh";
    await writeFile(path.join(paths.installDir, script), "");
    await mkdir(path.join(paths.installDir, "steamapps"), { recursive: true });
    await writeFile(
      path.join(paths.installDir, "steamapps", "appmanifest_380870.acf"),
      '"AppState"\n{\n  "appid" "380870"\n  "buildid" "19283746"\n  "LastUpdated" "1720000000"\n}\n',
    );

    expect(await inspectServerInstallation(paths, false)).toMatchObject({
      installed: true,
      simulated: false,
      buildId: "19283746",
      executablePresent: true,
      manifestPresent: true,
    });
  });

  it("does not claim a partial installation is complete", async () => {
    const paths = await pathsFixture();
    const script = process.platform === "win32" ? "StartServer64.bat" : "start-server.sh";
    await writeFile(path.join(paths.installDir, script), "");

    expect(await inspectServerInstallation(paths, false)).toMatchObject({
      installed: false,
      executablePresent: true,
      manifestPresent: false,
    });
  });
});
