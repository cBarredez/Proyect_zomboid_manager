import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { verifyPassword } from "../security/passwordHasher.js";
import { getOrSeedPanelAuth } from "../security/panelAuth.js";
import { eraseWorldSave, worldSaveExists } from "../domain/worldSave.js";
import { recordAudit } from "../infra/auditLog.js";
import { activatePendingMapConfig } from "../domain/mapMods.js";

const CONFIRMATION_PHRASE = "RESET ALL ZOMBOID DATA";
const WORLD_CONFIRMATION_PHRASE = "ERASE CURRENT WORLD";

export async function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/system/world", async () => ({
    exists: await worldSaveExists(ctx.paths, ctx.config.server.serverName),
    serverName: ctx.config.server.serverName,
  }));

  app.post<{ Body: { confirmation?: string } }>("/api/system/world/erase", async (req, reply) => {
    if (ctx.runtime.isRunning()) {
      return reply.code(409).send({ error: "stop the game server before erasing the world" });
    }
    if (req.body?.confirmation !== WORLD_CONFIRMATION_PHRASE) {
      return reply.code(400).send({
        error: `confirmation must be exactly "${WORLD_CONFIRMATION_PHRASE}"`,
      });
    }
    const existed = await worldSaveExists(ctx.paths, ctx.config.server.serverName);
    if (!existed) return { erased: false, backup: null };

    const backup = await ctx.backups.create("pre-world-reset");
    await eraseWorldSave(ctx.paths, ctx.config.server.serverName);
    const activatedPendingMaps = await activatePendingMapConfig(ctx.store, ctx.paths);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "world.erase", { backupId: backup.id });
    return { erased: true, backup, activatedPendingMaps };
  });

  app.post("/api/system/restart", async () => {
    setTimeout(() => process.exit(0), 250);
    return { restarting: true };
  });

  app.post<{ Body: { currentPassword?: string; confirmation?: string } }>(
    "/api/system/factory-reset",
    async (req, reply) => {
      const { currentPassword, confirmation } = req.body ?? {};

      if (ctx.runtime.isRunning()) {
        return reply.code(409).send({ error: "stop the game server before resetting" });
      }
      if (confirmation !== CONFIRMATION_PHRASE) {
        return reply.code(400).send({ error: `confirmation must be exactly "${CONFIRMATION_PHRASE}"` });
      }

      const auth = getOrSeedPanelAuth(ctx.store, ctx.config);
      if (!currentPassword || !verifyPassword(currentPassword, auth.passwordHash)) {
        return reply.code(401).send({ error: "current password is incorrect" });
      }

      await ctx.factoryReset.prepare();
      setTimeout(() => process.exit(0), 750);
      return { scheduled: true };
    },
  );
}
