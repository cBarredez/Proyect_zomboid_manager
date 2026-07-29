import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { rconCommand, RconAuthError, RconConnectionError } from "../process/rconClient.js";
import { parsePlayersResponse, quoteRconArg } from "../domain/playerList.js";
import { loadStartupSettings, normalizeStartupSettings, saveStartupSettings } from "../domain/startupSettings.js";
import { syncManagedIniFields } from "../domain/iniSync.js";
import { recordAudit } from "../infra/auditLog.js";
import { inspectServerInstallation } from "../domain/serverInstallation.js";
import { SteamCmdError } from "../process/steamCmdRunner.js";
import os from "node:os";
import { eraseWorldSave, worldSaveExists } from "../domain/worldSave.js";

const MOCK_PLAYERS = ["Alice", "Bob"];
const WORLD_CONFIRMATION_PHRASE = "ERASE CURRENT WORLD";

function applyBetaBranchOverride(ctx: AppContext, betaBranch: string | undefined) {
  const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
  if (betaBranch === undefined) return settings;

  const updated = normalizeStartupSettings(settings.serverName, { ...settings, betaBranch });
  saveStartupSettings(ctx.store, updated);
  return updated;
}

async function runRcon(ctx: AppContext, command: string): Promise<string> {
  if (ctx.config.runtime.mockServerBinary) {
    if (command === "players") {
      return `Players connected (${MOCK_PLAYERS.length}):\n${MOCK_PLAYERS.map((p) => `-${p}`).join("\n")}`;
    }
    return `[mock] executed: ${command}`;
  }

  return rconCommand(
    { host: "127.0.0.1", port: ctx.config.server.rconPort, password: ctx.config.server.rconPassword },
    command,
  );
}

function rconErrorMessage(error: unknown): string {
  if (error instanceof RconAuthError) return error.message;
  if (error instanceof RconConnectionError) return `RCON unavailable: ${error.message}`;
  return "RCON command failed";
}

function localIpv4Addresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address)
    .filter((address, index, all) => all.indexOf(address) === index);
}

export async function registerServerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post<{ Body: { betaBranch?: string } }>("/api/server/install", async (req, reply) => {
    if (ctx.runtime.isRunning()) {
      return reply.code(409).send({ error: "stop the server before installing/updating" });
    }
    const settings = applyBetaBranchOverride(ctx, req.body?.betaBranch);
    try {
      await ctx.steamCmd.installOrUpdateServer({}, settings.betaBranch);
    } catch (error) {
      const message =
        error instanceof SteamCmdError ? error.message : "SteamCMD installation failed";
      return reply.code(502).send({ error: message });
    }
    const installation = await inspectServerInstallation(ctx.paths, ctx.config.runtime.mockSteamcmd);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "server.install", { betaBranch: settings.betaBranch || "stable" });
    return { installation, betaBranch: settings.betaBranch };
  });

  app.post<{ Body: { betaBranch?: string; eraseWorld?: boolean; confirmation?: string } }>(
    "/api/server/update",
    async (req, reply) => {
    if (ctx.runtime.isRunning()) {
      return reply.code(409).send({ error: "stop the server before installing/updating" });
    }
    const currentSettings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    const requestedBranch = req.body?.betaBranch;
    const changingBranch =
      requestedBranch !== undefined && requestedBranch.trim() !== currentSettings.betaBranch;
    const hasWorld = await worldSaveExists(ctx.paths, ctx.config.server.serverName);
    if (changingBranch && hasWorld && !req.body?.eraseWorld) {
      return reply.code(409).send({
        error: "Build 41 and Build 42 saves are incompatible. Enable world erasure to switch builds.",
      });
    }
    if (
      changingBranch &&
      hasWorld &&
      req.body?.confirmation !== WORLD_CONFIRMATION_PHRASE
    ) {
      return reply.code(400).send({
        error: `confirmation must be exactly "${WORLD_CONFIRMATION_PHRASE}"`,
      });
    }

    await ctx.backups.create("pre-update");
    try {
      await ctx.steamCmd.installOrUpdateServer({}, requestedBranch ?? currentSettings.betaBranch);
    } catch (error) {
      const message =
        error instanceof SteamCmdError ? error.message : "SteamCMD update failed";
      return reply.code(502).send({ error: message });
    }
    if (changingBranch && hasWorld) {
      await eraseWorldSave(ctx.paths, ctx.config.server.serverName);
    }
    const settings = applyBetaBranchOverride(ctx, requestedBranch);
    const installation = await inspectServerInstallation(ctx.paths, ctx.config.runtime.mockSteamcmd);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "server.update", {
      betaBranch: settings.betaBranch || "stable",
      worldErased: changingBranch && hasWorld,
    });
    return { installation, betaBranch: settings.betaBranch, worldErased: changingBranch && hasWorld };
  });

  app.get("/api/server/status", async () => {
    const installation = await inspectServerInstallation(ctx.paths, ctx.config.runtime.mockSteamcmd);
    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    return {
      status: ctx.runtime.getStatus(),
      running: ctx.runtime.isRunning(),
      installation,
      mockServer: ctx.config.runtime.mockServerBinary,
      connection: {
        serverName: ctx.config.server.serverName,
        publicAddress: ctx.config.server.publicAddress,
        localAddresses: localIpv4Addresses(),
        gamePort: ctx.config.server.gamePort,
        playerPortStart: ctx.config.server.gamePort + 1,
        playerPortEnd: ctx.config.server.gamePort + settings.maxPlayers,
        rconPort: ctx.config.server.rconPort,
        webPort: ctx.config.web.publicPort,
        maxPlayers: settings.maxPlayers,
        networkMode: ctx.config.server.networkMode,
      },
    };
  });

  app.post("/api/server/start", async (req, reply) => {
    if (ctx.runtime.isRunning()) {
      return reply.code(409).send({ error: "server is already running" });
    }
    const installation = await inspectServerInstallation(ctx.paths, ctx.config.runtime.mockSteamcmd);
    if (!ctx.config.runtime.mockServerBinary && !installation.installed) {
      return reply.code(409).send({
        error: "server files are not installed; complete a real SteamCMD install first",
      });
    }
    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    await syncManagedIniFields(ctx.paths, ctx.config, settings);
    ctx.runtime.start();
    recordAudit(ctx.store, req.pzUser ?? "unknown", "server.start");
    return { status: ctx.runtime.getStatus() };
  });

  app.post("/api/server/stop", async (req) => {
    await ctx.runtime.stop();
    recordAudit(ctx.store, req.pzUser ?? "unknown", "server.stop");
    return { status: ctx.runtime.getStatus() };
  });

  app.post("/api/server/restart", async (req, reply) => {
    await ctx.runtime.stop();
    const installation = await inspectServerInstallation(ctx.paths, ctx.config.runtime.mockSteamcmd);
    if (!ctx.config.runtime.mockServerBinary && !installation.installed) {
      return reply.code(409).send({
        error: "server files are not installed; complete a real SteamCMD install first",
      });
    }
    const settings = loadStartupSettings(ctx.store, ctx.config.server.serverName);
    await syncManagedIniFields(ctx.paths, ctx.config, settings);
    ctx.runtime.start();
    recordAudit(ctx.store, req.pzUser ?? "unknown", "server.restart");
    return { status: ctx.runtime.getStatus() };
  });

  app.post<{ Body: { command?: string } }>("/api/server/rcon", async (req, reply) => {
    const command = req.body?.command;
    if (!command) return reply.code(400).send({ error: "command is required" });
    if (!ctx.runtime.isRunning()) return reply.code(409).send({ error: "server is not running" });

    try {
      const response = await runRcon(ctx, command);
      recordAudit(ctx.store, req.pzUser ?? "unknown", "server.rcon", { command });
      ctx.logHub.append("server", "rcon", `> ${command}\n${response}`);
      return { response };
    } catch (err) {
      return reply.code(502).send({ error: rconErrorMessage(err) });
    }
  });

  app.get("/api/server/players", async (req, reply) => {
    if (!ctx.runtime.isRunning()) return reply.code(409).send({ error: "server is not running" });
    try {
      const response = await runRcon(ctx, "players");
      return { players: parsePlayersResponse(response) };
    } catch (error) {
      return reply.code(502).send({ error: rconErrorMessage(error) });
    }
  });

  app.post<{ Params: { username: string } }>("/api/server/players/:username/kick", async (req, reply) => {
    if (!ctx.runtime.isRunning()) return reply.code(409).send({ error: "server is not running" });
    await runRcon(ctx, `kickuser ${quoteRconArg(req.params.username)}`);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "player.kick", { username: req.params.username });
    return { kicked: req.params.username };
  });

  app.post<{ Params: { username: string } }>("/api/server/players/:username/ban", async (req, reply) => {
    if (!ctx.runtime.isRunning()) return reply.code(409).send({ error: "server is not running" });
    await runRcon(ctx, `banuser ${quoteRconArg(req.params.username)}`);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "player.ban", { username: req.params.username });
    return { banned: req.params.username };
  });

  app.post<{ Body: { username?: string } }>("/api/server/players/unban", async (req, reply) => {
    const username = req.body?.username;
    if (!username) return reply.code(400).send({ error: "username is required" });
    if (!ctx.runtime.isRunning()) return reply.code(409).send({ error: "server is not running" });

    await runRcon(ctx, `unbanuser ${quoteRconArg(username)}`);
    recordAudit(ctx.store, req.pzUser ?? "unknown", "player.unban", { username });
    return { unbanned: username };
  });

  app.get("/api/logs", async () => ({ entries: ctx.logHub.recent() }));

  app.get("/api/logs/stream", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    for (const entry of ctx.logHub.recent(100)) {
      reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const unsubscribe = ctx.logHub.subscribe((entry) => {
      reply.raw.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    req.raw.on("close", unsubscribe);
  });
}
