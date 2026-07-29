import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { listAudit } from "../infra/auditLog.js";

export async function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/audit", async (req) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    return { entries: listAudit(ctx.store, limit) };
  });
}
