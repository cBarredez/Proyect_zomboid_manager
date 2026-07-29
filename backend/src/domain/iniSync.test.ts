import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { syncManagedIniFields } from "./iniSync.js";
import { parseServerIni } from "./serverIni.js";
import { normalizeStartupSettings } from "./startupSettings.js";
import type { AppConfig } from "../config/index.js";
import type { ServerPaths } from "./serverPaths.js";

function fakeConfig(): AppConfig {
  return {
    web: { port: 8080, publicPort: 8081, bindIp: "0.0.0.0", username: "admin", baseUrl: "", password: "p", sessionSecret: "s".repeat(32) },
    server: {
      zomboidInstallDir: "/pz/install",
      zomboidDataDir: "/pz/data",
      steamcmdDir: "/pz/steamcmd",
      serverName: "servertest",
      publicAddress: "",
      gamePort: 16261,
      rconPort: 27015,
      rconPassword: "rcon-secret",
      adminPassword: "admin-secret",
      memoryLimitMb: 4096,
      networkMode: "bridge",
    },
    steam: { ownerIds: [], password: "" },
    runtime: { timezone: "UTC", mockSteamcmd: true, mockServerBinary: true },
    history: { retentionDays: 30 },
    backups: { dir: "/pz/backups", retainScheduledCount: 10, scheduleIntervalHours: 0 },
  };
}

describe("syncManagedIniFields", () => {
  it("creates the ini and writes managed keys when none exists yet", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-inisync-"));
    try {
      const iniPath = path.join(dir, "servertest.ini");
      const paths = { serverIniPath: iniPath } as ServerPaths;
      const settings = normalizeStartupSettings("servertest", { mods: ["ModA"], workshopItems: ["123"], maxPlayers: 24 });

      await syncManagedIniFields(paths, fakeConfig(), settings);

      const fields = parseServerIni(await readFile(iniPath, "utf-8"));
      expect(fields.find((f) => f.key === "Mods")?.value).toBe("ModA");
      // A single numeric-looking Workshop ID reads back as a number through the
      // generic ini parser's type inference — harmless since WorkshopItems is
      // excluded from the user-facing editor and never round-tripped through it.
      expect(fields.find((f) => f.key === "WorkshopItems")?.value).toBe(123);
      expect(fields.find((f) => f.key === "RCONPassword")?.value).toBe("rcon-secret");
      expect(fields.find((f) => f.key === "RCONPort")?.value).toBe(27015);
      expect(fields.find((f) => f.key === "MaxPlayers")?.value).toBe(24);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves unrelated existing fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-inisync-"));
    try {
      const iniPath = path.join(dir, "servertest.ini");
      await mkdir(dir, { recursive: true });
      await writeFile(iniPath, "PVP=true\nMap=Muldraugh, KY\n", "utf-8");
      const paths = { serverIniPath: iniPath } as ServerPaths;

      await syncManagedIniFields(paths, fakeConfig(), normalizeStartupSettings("servertest"));

      const fields = parseServerIni(await readFile(iniPath, "utf-8"));
      expect(fields.find((f) => f.key === "PVP")?.value).toBe(true);
      expect(fields.find((f) => f.key === "Map")?.value).toBe("Muldraugh, KY");
      expect(fields.find((f) => f.key === "RCONPort")?.value).toBe(27015);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("re-syncing updates values instead of duplicating lines", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pz-inisync-"));
    try {
      const iniPath = path.join(dir, "servertest.ini");
      const paths = { serverIniPath: iniPath } as ServerPaths;

      await syncManagedIniFields(paths, fakeConfig(), normalizeStartupSettings("servertest", { mods: ["ModA"] }));
      await syncManagedIniFields(paths, fakeConfig(), normalizeStartupSettings("servertest", { mods: ["ModA", "ModB"] }));

      const content = await readFile(iniPath, "utf-8");
      expect(content.match(/^Mods=/gm)).toHaveLength(1);
      expect(parseServerIni(content).find((f) => f.key === "Mods")?.value).toBe("ModA;ModB");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
