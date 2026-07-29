import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { AppConfig } from "./config/index.js";
import type { ServerPaths } from "./domain/serverPaths.js";
import { SqliteStore } from "./infra/sqliteStore.js";
import { LogHub } from "./infra/logHub.js";
import { FactoryResetExecutor } from "./infra/factoryResetExecutor.js";
import { BackupManager } from "./infra/backupManager.js";
import { MetricsSampler } from "./infra/metricsSampler.js";
import { RuntimeState } from "./process/runtimeState.js";
import { SteamCmdRunner } from "./process/steamCmdRunner.js";
import { registerAuthRoutes, requireAuth } from "./routes/auth.js";
import { registerServerRoutes } from "./routes/server.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerModRoutes } from "./routes/mods.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerSandboxRoutes } from "./routes/sandbox.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerServerSettingsRoutes } from "./routes/serverSettings.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerMapRoutes } from "./routes/maps.js";

export interface AppContext {
  config: AppConfig;
  paths: ServerPaths;
  store: SqliteStore;
  logHub: LogHub;
  runtime: RuntimeState;
  factoryReset: FactoryResetExecutor;
  steamCmd: SteamCmdRunner;
  backups: BackupManager;
  metrics: MetricsSampler;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cookie);

  app.get("/api/health", async () => ({ status: "ok" }));

  await registerAuthRoutes(app, ctx);

  await app.register(
    async (protectedApp) => {
      protectedApp.addHook("onRequest", requireAuth(ctx));
      await registerServerRoutes(protectedApp, ctx);
      await registerSystemRoutes(protectedApp, ctx);
      await registerModRoutes(protectedApp, ctx);
      await registerFileRoutes(protectedApp, ctx);
      await registerSandboxRoutes(protectedApp, ctx);
      await registerBackupRoutes(protectedApp, ctx);
      await registerAuditRoutes(protectedApp, ctx);
      await registerServerSettingsRoutes(protectedApp, ctx);
      await registerMetricsRoutes(protectedApp, ctx);
      await registerMapRoutes(protectedApp, ctx);
    },
    { prefix: "/" },
  );

  return app;
}
