import type { FastifyInstance } from "fastify";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppContext } from "../app.js";

/**
 * Resolves a user-supplied relative path against the Zomboid data dir and
 * rejects anything that escapes it (mirrors arma_server's file editor scope
 * restriction to `/arma3`).
 */
function resolveScopedPath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error("path escapes the allowed directory");
  }
  return resolved;
}

export async function registerFileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const root = ctx.paths.dataDir;

  app.get<{ Querystring: { path?: string } }>("/api/files", async (req, reply) => {
    const relPath = req.query.path ?? ".";
    let target: string;
    try {
      target = resolveScopedPath(root, relPath);
    } catch {
      return reply.code(400).send({ error: "invalid path" });
    }

    const info = await stat(target);
    if (!info.isDirectory()) return reply.code(400).send({ error: "path is not a directory" });

    const entries = await readdir(target, { withFileTypes: true });
    return {
      entries: entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      })),
    };
  });

  app.get<{ Querystring: { path: string } }>("/api/files/content", async (req, reply) => {
    let target: string;
    try {
      target = resolveScopedPath(root, req.query.path);
    } catch {
      return reply.code(400).send({ error: "invalid path" });
    }

    try {
      const content = await readFile(target, "utf-8");
      return { path: req.query.path, content };
    } catch {
      return reply.code(404).send({ error: "file not found" });
    }
  });

  app.put<{ Body: { path?: string; content?: string } }>("/api/files/content", async (req, reply) => {
    const { path: relPath, content } = req.body ?? {};
    if (!relPath || content === undefined) {
      return reply.code(400).send({ error: "path and content are required" });
    }

    let target: string;
    try {
      target = resolveScopedPath(root, relPath);
    } catch {
      return reply.code(400).send({ error: "invalid path" });
    }

    await writeFile(target, content, "utf-8");
    return { saved: true };
  });
}
