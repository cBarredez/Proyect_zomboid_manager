import { readFile } from "node:fs/promises";
import * as TOML from "smol-toml";

export interface AppConfig {
  web: {
    port: number;
    publicPort: number;
    bindIp: string;
    username: string;
    baseUrl: string;
    password: string;
    sessionSecret: string;
  };
  server: {
    zomboidInstallDir: string;
    zomboidDataDir: string;
    steamcmdDir: string;
    serverName: string;
    publicAddress: string;
    gamePort: number;
    rconPort: number;
    rconPassword: string;
    adminPassword: string;
    memoryLimitMb: number;
    networkMode: string;
  };
  steam: {
    ownerIds: string[];
    password: string;
  };
  runtime: {
    timezone: string;
    mockSteamcmd: boolean;
    mockServerBinary: boolean;
  };
  history: {
    retentionDays: number;
  };
  backups: {
    dir: string;
    retainScheduledCount: number;
    scheduleIntervalHours: number;
  };
}

interface RawToml {
  [key: string]: unknown;
}

function str(section: RawToml | undefined, key: string, fallback = ""): string {
  const value = section?.[key];
  return typeof value === "string" ? value : fallback;
}

function num(section: RawToml | undefined, key: string, fallback: number): number {
  const value = section?.[key];
  return typeof value === "number" ? value : fallback;
}

function bool(section: RawToml | undefined, key: string, fallback: boolean): boolean {
  const value = section?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function strArray(section: RawToml | undefined, key: string): string[] {
  const value = section?.[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export async function loadConfig(
  mainPath: string,
  secretsPath: string,
): Promise<AppConfig> {
  const [mainRaw, secretsRaw] = await Promise.all([
    readFile(mainPath, "utf-8"),
    readFile(secretsPath, "utf-8"),
  ]);

  const main = TOML.parse(mainRaw) as RawToml;
  const secrets = TOML.parse(secretsRaw) as RawToml;

  const mainWeb = main.web as RawToml | undefined;
  const mainServer = main.server as RawToml | undefined;
  const mainSteam = main.steam as RawToml | undefined;
  const mainRuntime = main.runtime as RawToml | undefined;
  const mainHistory = main.history as RawToml | undefined;
  const mainBackups = main.backups as RawToml | undefined;

  const secretsWeb = secrets.web as RawToml | undefined;
  const secretsServer = secrets.server as RawToml | undefined;
  const secretsSteam = secrets.steam as RawToml | undefined;

  const config: AppConfig = {
    web: {
      port: num(mainWeb, "port", 8080),
      publicPort: num(mainWeb, "public_port", 8081),
      bindIp: str(mainWeb, "bind_ip", "127.0.0.1"),
      username: str(mainWeb, "username", "admin"),
      baseUrl: str(mainWeb, "base_url", ""),
      password: str(secretsWeb, "password"),
      sessionSecret: str(secretsWeb, "session_secret"),
    },
    server: {
      zomboidInstallDir: str(mainServer, "zomboid_install_dir", "/pz/install"),
      zomboidDataDir: str(mainServer, "zomboid_data_dir", "/pz/data"),
      steamcmdDir: str(mainServer, "steamcmd_dir", "/pz/steamcmd"),
      serverName: str(mainServer, "server_name", "servertest"),
      publicAddress: str(mainServer, "public_address", ""),
      gamePort: num(mainServer, "game_port", 16261),
      rconPort: num(mainServer, "rcon_port", 27015),
      rconPassword: str(secretsServer, "rcon_password"),
      adminPassword: str(secretsServer, "admin_password"),
      memoryLimitMb: num(mainServer, "memory_limit_mb", 4096),
      networkMode: str(mainServer, "network_mode", "bridge"),
    },
    steam: {
      ownerIds: strArray(mainSteam, "owner_ids"),
      password: str(secretsSteam, "password"),
    },
    runtime: {
      timezone: str(mainRuntime, "timezone", "UTC"),
      mockSteamcmd: bool(mainRuntime, "mock_steamcmd", false),
      mockServerBinary: bool(mainRuntime, "mock_server_binary", false),
    },
    history: {
      retentionDays: num(mainHistory, "retention_days", 30),
    },
    backups: {
      dir: str(mainBackups, "dir", "/pz/backups"),
      retainScheduledCount: num(mainBackups, "retain_scheduled_count", 10),
      scheduleIntervalHours: num(mainBackups, "schedule_interval_hours", 0),
    },
  };

  validateConfig(config);
  return config;
}

export class ConfigValidationError extends Error {}

export function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  if (!Number.isInteger(config.web.port) || config.web.port < 1 || config.web.port > 65535) {
    errors.push("web.port must be an integer between 1 and 65535");
  }
  if (
    !Number.isInteger(config.web.publicPort) ||
    config.web.publicPort < 1 ||
    config.web.publicPort > 65535
  ) {
    errors.push("web.public_port must be an integer between 1 and 65535");
  }
  if (!config.web.username.trim()) {
    errors.push("web.username must not be empty");
  }
  if (!config.web.password || config.web.password === "change-me") {
    errors.push("web.password secret must be set to a non-default value");
  }
  if (!config.web.sessionSecret || config.web.sessionSecret.length < 32) {
    errors.push("web.session_secret secret must be at least 32 characters");
  }
  if (
    config.web.sessionSecret.includes("replace-with") ||
    config.web.sessionSecret.includes("random-64-char")
  ) {
    errors.push("web.session_secret secret must not be the placeholder value");
  }

  if (!config.server.zomboidInstallDir.trim()) {
    errors.push("server.zomboid_install_dir must not be empty");
  }
  if (!config.server.zomboidDataDir.trim()) {
    errors.push("server.zomboid_data_dir must not be empty");
  }
  if (!config.server.steamcmdDir.trim()) {
    errors.push("server.steamcmd_dir must not be empty");
  }
  if (!config.server.serverName.trim()) {
    errors.push("server.server_name must not be empty");
  }
  if (
    !Number.isInteger(config.server.gamePort) ||
    config.server.gamePort < 1 ||
    config.server.gamePort > 65535
  ) {
    errors.push("server.game_port must be an integer between 1 and 65535");
  }
  if (
    !Number.isInteger(config.server.rconPort) ||
    config.server.rconPort < 1 ||
    config.server.rconPort > 65535
  ) {
    errors.push("server.rcon_port must be an integer between 1 and 65535");
  }
  if (!config.server.adminPassword.trim()) {
    errors.push("server.admin_password secret must not be empty");
  }
  if (config.server.memoryLimitMb < 512) {
    errors.push("server.memory_limit_mb must be at least 512");
  }
  if (!["bridge", "host"].includes(config.server.networkMode)) {
    errors.push('server.network_mode must be "bridge" or "host"');
  }

  if (config.history.retentionDays < 1) {
    errors.push("history.retention_days must be at least 1");
  }

  if (!config.backups.dir.trim()) {
    errors.push("backups.dir must not be empty");
  }
  if (config.backups.retainScheduledCount < 1) {
    errors.push("backups.retain_scheduled_count must be at least 1");
  }
  if (config.backups.scheduleIntervalHours < 0) {
    errors.push("backups.schedule_interval_hours must be 0 (disabled) or greater");
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(`Invalid configuration:\n- ${errors.join("\n- ")}`);
  }
}
