import type { FastifyInstance } from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import type { AppContext } from "../app.js";
import { applySandboxUpdates, parseSandboxVars, type SandboxUpdate } from "../domain/sandboxVars.js";
import { recordAudit } from "../infra/auditLog.js";

export async function registerSandboxRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get("/api/sandbox", async (req, reply) => {
    let source: string;
    try {
      source = await readFile(ctx.paths.sandboxVarsPath, "utf-8");
    } catch {
      return reply
        .code(404)
        .send({ error: "SandboxVars.lua not found yet — start the server once to generate default config files" });
    }

    try {
      return { groups: parseSandboxVars(source) };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "failed to parse SandboxVars.lua" });
    }
  });

  app.put<{ Body: { updates?: SandboxUpdate[] } }>("/api/sandbox", async (req, reply) => {
    const updates = req.body?.updates;
    if (!updates || updates.length === 0) {
      return reply.code(400).send({ error: "updates must be a non-empty array" });
    }

    let source: string;
    try {
      source = await readFile(ctx.paths.sandboxVarsPath, "utf-8");
    } catch {
      return reply.code(404).send({ error: "SandboxVars.lua not found yet" });
    }

    let updated: string;
    try {
      updated = applySandboxUpdates(source, updates);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid sandbox update" });
    }

    await writeFile(ctx.paths.sandboxVarsPath, updated, "utf-8");
    recordAudit(ctx.store, req.pzUser ?? "unknown", "sandbox.update", { paths: updates.map((u) => u.path) });

    return { groups: parseSandboxVars(updated) };
  });
}
