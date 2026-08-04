import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { metricsSessionCsv } from "../infra/metricsCsv.js";

export async function registerMetricsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/metrics", async () => ctx.metrics.getCurrent());

  // A "session" is one game-server run, identified by RuntimeState's run id; the
  // SessionRecorder background service records a sample every 5s into metrics_samples
  // while it's running, so history survives after the run ends.
  app.get<{ Querystring: { limit?: string } }>("/api/metrics/sessions", async (req) => {
    const requested = Number(req.query.limit);
    const limit = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 10, 1), 100);
    const currentRunId = ctx.runtime.getRunId();
    return { sessions: ctx.store.getMetricsSessions(currentRunId, limit) };
  });

  app.get<{ Params: { runId: string } }>("/api/metrics/sessions/:runId", async (req, reply) => {
    const detail = ctx.store.getMetricsSessionDetail(req.params.runId);
    if (!detail) return reply.code(404).send({ error: "Session not found" });
    return detail;
  });

  app.get<{ Params: { runId: string } }>("/api/metrics/sessions/:runId/csv", async (req, reply) => {
    const samples = ctx.store.getMetricsSamples(req.params.runId);
    if (samples.length === 0) return reply.code(404).send({ error: "No metrics recorded for that session" });
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="session-${req.params.runId}.csv"`);
    return metricsSessionCsv(samples);
  });
}
