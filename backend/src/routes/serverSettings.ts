import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import type { AppContext } from "../app.js";
import { parseServerIni, upsertIniFields, type IniUpdate } from "../domain/serverIni.js";
import { MANAGED_INI_KEYS } from "../domain/iniSync.js";
import { loadStartupSettings, normalizeStartupSettings, saveStartupSettings } from "../domain/startupSettings.js";
import { recordAudit } from "../infra/auditLog.js";

export async function registerServerSettingsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/server-settings", async () => {
    let fields: ReturnType<typeof parseServerIni> = [];
    try {
      const source = await readFile(ctx.paths.serverIniPath, "utf-8");
      fields = parseServerIni(source).filter((f) => !MANAGED_INI_KEYS.has(f.key));
    } catch {
      // ini doesn't exist yet (server never started) — maxPlayers/betaBranch
      // still come from our own settings store, so return those with no fields.
    }

    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    return { fields, maxPlayers: settings.maxPlayers, betaBranch: settings.betaBranch };
  });

  app.put<{ Body: { updates?: IniUpdate[]; maxPlayers?: number; betaBranch?: string } }>(
    "/api/server-settings",
    async (req, reply) => {
      const { updates, maxPlayers, betaBranch } = req.body ?? {};

      if (updates && updates.length > 0) {
        let source: string;
        try {
          source = await readFile(ctx.paths.serverIniPath, "utf-8");
        } catch {
          return reply.code(404).send({ error: "server ini not found yet" });
        }

        let updated: string;
        try {
          updated = upsertIniFields(source, updates, { guardedKeys: MANAGED_INI_KEYS });
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid update" });
        }

        await writeFile(ctx.paths.serverIniPath, updated, "utf-8");
        recordAudit(ctx.store, req.pzUser ?? "unknown", "server-settings.update", {
          keys: updates.map((u) => u.key),
        });
      }

      if (maxPlayers !== undefined || betaBranch !== undefined) {
        const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
        const merged = normalizeStartupSettings(settings.serverName, {
          ...settings,
          ...(maxPlayers !== undefined ? { maxPlayers } : {}),
          ...(betaBranch !== undefined ? { betaBranch } : {}),
        });
        saveStartupSettings(ctx.store, merged);
        recordAudit(ctx.store, req.pzUser ?? "unknown", "server-settings.update-managed", {
          maxPlayers: merged.maxPlayers,
          betaBranch: merged.betaBranch || "stable",
        });
      }

      let fields: ReturnType<typeof parseServerIni> = [];
      try {
        const source = await readFile(ctx.paths.serverIniPath, "utf-8");
        fields = parseServerIni(source).filter((f) => !MANAGED_INI_KEYS.has(f.key));
      } catch {
        // ini may not exist yet if only maxPlayers/betaBranch were changed
      }

      const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
      return { fields, maxPlayers: settings.maxPlayers, betaBranch: settings.betaBranch };
    },
  );
}
