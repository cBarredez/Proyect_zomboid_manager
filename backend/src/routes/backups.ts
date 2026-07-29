import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { recordAudit } from "../infra/auditLog.js";

export async function registerBackupRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/backups", async () => ({ backups: await ctx.backups.list() }));

  app.post("/api/backups", async (req) => {
    const info = await ctx.backups.create("manual");
    recordAudit(ctx.store, req.pzUser ?? "unknown", "backup.create", { id: info.id });
    return { backup: info };
  });

  app.post<{ Params: { id: string } }>("/api/backups/:id/restore", async (req, reply) => {
    if (ctx.runtime.isRunning()) {
      return reply.code(409).send({ error: "stop the server before restoring a backup" });
    }

    try {
      await ctx.backups.create("pre-restore");
      await ctx.backups.restore(req.params.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "restore failed" });
    }

    recordAudit(ctx.store, req.pzUser ?? "unknown", "backup.restore", { id: req.params.id });
    return { restored: true };
  });

  app.delete<{ Params: { id: string } }>("/api/backups/:id", async (req, reply) => {
    try {
      await ctx.backups.delete(req.params.id);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "delete failed" });
    }
    recordAudit(ctx.store, req.pzUser ?? "unknown", "backup.delete", { id: req.params.id });
    return { deleted: true };
  });
}
