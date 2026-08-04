import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config/index.js";
import { detectServerPaths } from "./domain/serverPaths.js";
import { SqliteStore } from "./infra/sqliteStore.js";
import { LogHub } from "./infra/logHub.js";
import { FactoryResetExecutor } from "./infra/factoryResetExecutor.js";
import { BackupManager } from "./infra/backupManager.js";
import { MetricsSampler } from "./infra/metricsSampler.js";
import { SessionRecorder } from "./infra/sessionRecorder.js";
import { RuntimeState, type RunEndedInfo, type RunStartedInfo } from "./process/runtimeState.js";
import { SteamCmdRunner } from "./process/steamCmdRunner.js";
import { rconCommand } from "./process/rconClient.js";
import { parsePlayersResponse } from "./domain/playerList.js";
import { buildApp, type AppContext } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

async function main(): Promise<void> {
  const configDir = process.env.PZ_MANAGER_CONFIG_DIR ?? path.join(REPO_ROOT, "config");
  const config = await loadConfig(
    path.join(configDir, "manager.toml"),
    path.join(configDir, "manager.secrets.toml"),
  );

  const paths = await detectServerPaths(config);

  const factoryReset = new FactoryResetExecutor(
    path.join(config.server.zomboidDataDir, ".factory-reset-request.json"),
    [
      config.server.zomboidInstallDir,
      config.server.zomboidDataDir,
      config.server.steamcmdDir,
      config.backups.dir,
    ],
  );
  await factoryReset.executePending();

  const store = new SqliteStore(path.join(config.server.zomboidDataDir, "manager.sqlite3"));
  const logHub = new LogHub();

  // SessionRecorder needs a `runtime` reference for isRunning()/getRunId(), but RuntimeState
  // needs its onRunStarted/onRunEnded callbacks at construction time — this indirection lets
  // both be built in the natural order without a circular constructor dependency.
  const runHooks: { onRunStarted?: (info: RunStartedInfo) => void; onRunEnded?: (info: RunEndedInfo) => void } = {};
  const runtime = new RuntimeState({
    installDir: paths.installDir,
    dataDir: paths.dataDir,
    serverName: config.server.serverName,
    memoryMinMb: Math.floor(config.server.memoryLimitMb / 2),
    memoryMaxMb: config.server.memoryLimitMb,
    rconHost: "127.0.0.1",
    rconPort: config.server.rconPort,
    rconPassword: config.server.rconPassword,
    adminPassword: config.server.adminPassword,
    logHub,
    mock: config.runtime.mockServerBinary,
    onRunStarted: (info) => runHooks.onRunStarted?.(info),
    onRunEnded: (info) => runHooks.onRunEnded?.(info),
  });

  const steamCmd = new SteamCmdRunner(paths, logHub, config.runtime.mockSteamcmd);
  const backups = new BackupManager({
    backupsDir: config.backups.dir,
    sourceDir: config.server.zomboidDataDir,
    retainScheduledCount: config.backups.retainScheduledCount,
    retainOtherCount: config.backups.retainOtherCount,
    // Forces a world save immediately before every backup so the snapshot
    // isn't taken mid-write — best-effort inside BackupManager itself if
    // the server isn't running or RCON is unreachable.
    beforeCreate: async () => {
      await runtime.sendRconCommand("save");
      // "save" returns once the command is accepted, not once the write is
      // flushed to disk — a short grace period covers that gap.
      await new Promise((resolve) => setTimeout(resolve, 2000));
    },
  });
  const metrics = new MetricsSampler();
  metrics.start();

  const sessionRecorder = new SessionRecorder(store, runtime, metrics, async () => {
    if (!runtime.isRunning() || config.runtime.mockServerBinary) return null;
    const response = await rconCommand(
      { host: "127.0.0.1", port: config.server.rconPort, password: config.server.rconPassword },
      "players",
    );
    return parsePlayersResponse(response).length;
  });
  runHooks.onRunStarted = (info) => sessionRecorder.handleRunStarted(info);
  runHooks.onRunEnded = (info) => sessionRecorder.handleRunEnded(info);
  store.pruneMetricsSessions(30);
  sessionRecorder.start();

  const ctx: AppContext = { config, paths, store, logHub, runtime, factoryReset, steamCmd, backups, metrics };
  const app = await buildApp(ctx);

  if (config.backups.scheduleIntervalHours > 0) {
    const intervalMs = config.backups.scheduleIntervalHours * 60 * 60 * 1000;
    setInterval(() => {
      backups.create("scheduled").catch((err) => app.log.error(err, "scheduled backup failed"));
    }, intervalMs);
  }

  await app.listen({ port: config.web.port, host: config.web.bindIp });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
