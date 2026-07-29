import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";

export async function registerMetricsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/metrics", async () => ctx.metrics.getCurrent());
}
