import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import {
  applyMapConfig,
  discoverMapComponents,
  loadMapConfig,
  loadPendingMapConfig,
  mapConflicts,
  mergeMapConfig,
  savePendingMapConfig,
  type MapConfig,
} from "../domain/mapMods.js";
import { eraseWorldSave, worldSaveExists } from "../domain/worldSave.js";
import { recordAudit } from "../infra/auditLog.js";

const CONFIRMATION = "ERASE CURRENT WORLD";

export async function registerMapRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/maps", async () => {
    const components = await discoverMapComponents(ctx.paths);
    const config = loadMapConfig(ctx.store, components);
    const pending = loadPendingMapConfig(ctx.store);
    return {
      components,
      config,
      pending: pending ? mergeMapConfig(components, pending) : null,
      conflicts: mapConflicts(components, pending ?? config),
      worldExists: await worldSaveExists(ctx.paths, ctx.config.server.serverName),
    };
  });

  app.put<{
    Body: { config?: MapConfig; mode?: "erase" | "next-world"; confirmation?: string };
  }>("/api/maps", async (req, reply) => {
    if (ctx.runtime.isRunning()) return reply.code(409).send({ error: "stop the server before changing maps" });
    const components = await discoverMapComponents(ctx.paths);
    const requestedKeys = new Set(components.map((entry) => entry.key));
    if (!req.body?.config || req.body.config.entries.some((entry) => !requestedKeys.has(entry.key))) {
      return reply.code(400).send({ error: "map configuration contains unknown components" });
    }
    const config = mergeMapConfig(components, req.body.config);
    const conflicts = mapConflicts(components, config);
    if (conflicts.length > 0) {
      return reply.code(409).send({ error: "enabled maps contain overlapping world cells", conflicts });
    }
    const hasWorld = await worldSaveExists(ctx.paths, ctx.config.server.serverName);
    if (hasWorld && req.body.mode === "next-world") {
      savePendingMapConfig(ctx.store, config);
      recordAudit(ctx.store, req.pzUser ?? "unknown", "maps.schedule", { entries: config.entries });
      return { applied: false, pending: true, conflicts };
    }
    if (hasWorld && req.body.mode !== "erase") {
      return reply.code(400).send({ error: "choose next-world or erase mode" });
    }
    if (hasWorld && req.body.confirmation !== CONFIRMATION) {
      return reply.code(400).send({ error: `confirmation must be exactly "${CONFIRMATION}"` });
    }
    let backup = null;
    if (hasWorld) {
      backup = await ctx.backups.create("pre-world-reset");
      await eraseWorldSave(ctx.paths, ctx.config.server.serverName);
    }
    await applyMapConfig(ctx.store, ctx.paths, components, config);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "maps.apply", {
      entries: config.entries,
      worldErased: hasWorld,
      backupId: backup?.id,
    });
    return { applied: true, pending: false, conflicts, backup };
  });
}
