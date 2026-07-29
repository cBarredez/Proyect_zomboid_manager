import type { FastifyInstance } from "fastify";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../app.js";
import { findMissingDependencies, resolveModsInWorkshopItem, type ModInfo } from "../domain/modResolver.js";
import { loadStartupSettings, normalizeStartupSettings, saveStartupSettings } from "../domain/startupSettings.js";
import { fetchCollectionItemIds, parseWorkshopId, SteamWorkshopError } from "../domain/steamWorkshop.js";
import { syncManagedIniFields } from "../domain/iniSync.js";
import { recordAudit } from "../infra/auditLog.js";

async function listInstalledWorkshopIds(ctx: AppContext): Promise<string[]> {
  try {
    return await readdir(ctx.paths.workshopContentDir);
  } catch {
    return [];
  }
}

async function getAllInstalledMods(ctx: AppContext): Promise<ModInfo[]> {
  const workshopIds = await listInstalledWorkshopIds(ctx);
  const perItem = await Promise.all(
    workshopIds.map((id) => resolveModsInWorkshopItem(path.join(ctx.paths.workshopContentDir, id))),
  );
  return perItem.flat();
}

export async function registerModRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/mods", async () => ({ settings: loadStartupSettings(ctx.store, ctx.config.server.serverName) }));

  app.get("/api/workshop/installed", async () => {
    const workshopIds = await listInstalledWorkshopIds(ctx);
    const items = await Promise.all(
      workshopIds.map(async (workshopId) => ({
        workshopId,
        mods: await resolveModsInWorkshopItem(path.join(ctx.paths.workshopContentDir, workshopId)),
      })),
    );
    const missingDependencies = findMissingDependencies(items.flatMap((item) => item.mods));

    return { items, missingDependencies };
  });

  app.post<{ Body: { workshopId?: string } }>("/api/workshop/install", async (req, reply) => {
    const rawWorkshopId = req.body?.workshopId;
    if (!rawWorkshopId) return reply.code(400).send({ error: "workshopId is required" });

    const workshopId = parseWorkshopId(rawWorkshopId);
    if (!workshopId) {
      return reply.code(400).send({ error: "workshopId must be a numeric ID or a Workshop item URL" });
    }

    await ctx.backups.create("pre-mod-change");
    try {
      await ctx.steamCmd.downloadWorkshopItem(workshopId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Workshop download failed";
      return reply.code(502).send({ error: message });
    }
    const mods = await resolveModsInWorkshopItem(path.join(ctx.paths.workshopContentDir, workshopId));
    if (mods.length === 0) {
      return reply.code(422).send({ error: "no mod.info found in downloaded workshop item" });
    }

    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    const merged = normalizeStartupSettings(settings.serverName, {
      ...settings,
      mods: [...settings.mods, ...mods.map((m) => m.id)],
      workshopItems: [...settings.workshopItems, workshopId],
    });
    saveStartupSettings(ctx.store, merged);
    await syncManagedIniFields(ctx.paths, ctx.config, merged);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "mods.install", { workshopId });

    const missingDependencies = findMissingDependencies(await getAllInstalledMods(ctx));
    return { mods, settings: merged, missingDependencies };
  });

  app.post<{ Body: { collectionId?: string } }>("/api/workshop/install-collection", async (req, reply) => {
    const rawCollectionId = req.body?.collectionId;
    if (!rawCollectionId) return reply.code(400).send({ error: "collectionId is required" });

    const collectionId = parseWorkshopId(rawCollectionId);
    if (!collectionId) {
      return reply.code(400).send({ error: "collectionId must be a numeric ID or a Workshop collection URL" });
    }

    let itemIds: string[];
    try {
      itemIds = await fetchCollectionItemIds(collectionId);
    } catch (err) {
      const message = err instanceof SteamWorkshopError ? err.message : "failed to resolve Workshop collection";
      return reply.code(502).send({ error: message });
    }
    if (itemIds.length === 0) {
      return reply.code(422).send({ error: "collection is empty or contains no downloadable items" });
    }

    await ctx.backups.create("pre-mod-change");

    const installedModIds: string[] = [];
    const installedWorkshopIds: string[] = [];
    const failed: string[] = [];

    for (const workshopId of itemIds) {
      try {
        await ctx.steamCmd.downloadWorkshopItem(workshopId);
        const mods = await resolveModsInWorkshopItem(path.join(ctx.paths.workshopContentDir, workshopId));
        if (mods.length === 0) {
          failed.push(workshopId);
          continue;
        }
        installedWorkshopIds.push(workshopId);
        installedModIds.push(...mods.map((m) => m.id));
      } catch {
        failed.push(workshopId);
      }
    }

    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    const merged = normalizeStartupSettings(settings.serverName, {
      ...settings,
      mods: [...settings.mods, ...installedModIds],
      workshopItems: [...settings.workshopItems, ...installedWorkshopIds],
    });
    saveStartupSettings(ctx.store, merged);
    await syncManagedIniFields(ctx.paths, ctx.config, merged);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "mods.install-collection", {
      collectionId,
      installed: installedWorkshopIds,
      failed,
    });

    const missingDependencies = findMissingDependencies(await getAllInstalledMods(ctx));
    return {
      installedWorkshopIds,
      failedWorkshopIds: failed,
      settings: merged,
      missingDependencies,
    };
  });

  app.delete<{ Params: { workshopId: string } }>("/api/workshop/:workshopId", async (req, reply) => {
    const { workshopId } = req.params;
    if (!/^\d+$/.test(workshopId)) {
      return reply.code(400).send({ error: "invalid Workshop ID" });
    }
    if (ctx.runtime.isRunning()) {
      return reply.code(409).send({ error: "stop the game server before removing Workshop items" });
    }
    await ctx.backups.create("pre-mod-change");

    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    const removedModIds = new Set(
      (await resolveModsInWorkshopItem(path.join(ctx.paths.workshopContentDir, workshopId))).map(
        (m) => m.id,
      ),
    );

    const updated = normalizeStartupSettings(settings.serverName, {
      ...settings,
      workshopItems: settings.workshopItems.filter((id) => id !== workshopId),
      mods: settings.mods.filter((id) => !removedModIds.has(id)),
    });
    saveStartupSettings(ctx.store, updated);
    await syncManagedIniFields(ctx.paths, ctx.config, updated);
    await rm(path.join(ctx.paths.workshopContentDir, workshopId), {
      recursive: true,
      force: true,
    });
    recordAudit(ctx.store, req.pzUser ?? "unknown", "mods.remove", { workshopId });

    return { removed: workshopId, settings: updated };
  });
}
