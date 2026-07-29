import * as TOML from "smol-toml";

export interface DeployTarget {
  server: string;
  username: string;
}

export type DeployTargets = Record<string, DeployTarget>;

export function parseDeployToml(raw: string): DeployTargets {
  const parsed = TOML.parse(raw) as Record<string, unknown>;
  const targets: DeployTargets = {};

  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "object" || value === null) continue;
    const obj = value as Record<string, unknown>;
    if (typeof obj.server === "string" && typeof obj.username === "string") {
      targets[name] = { server: obj.server, username: obj.username };
    }
  }

  return targets;
}

export function validateDeployTarget(name: string, targets: DeployTargets): string[] {
  const errors: string[] = [];
  const target = targets[name];

  if (!target) {
    errors.push(`unknown deploy target "${name}" — check deploy.toml`);
    return errors;
  }
  if (!target.server.trim()) errors.push(`[${name}].server must not be empty`);
  if (!target.username.trim()) errors.push(`[${name}].username must not be empty`);

  return errors;
}

function section(parsed: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parsed[key];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isValidPort(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function validateManagerToml(raw: string): string[] {
  const errors: string[] = [];
  const parsed = TOML.parse(raw) as Record<string, unknown>;
  const web = section(parsed, "web");
  const server = section(parsed, "server");
  const history = section(parsed, "history");

  if (!isValidPort(web.port)) errors.push("web.port must be an integer between 1 and 65535");
  if (!isValidPort(web.public_port)) {
    errors.push("web.public_port must be an integer between 1 and 65535");
  }
  if (typeof web.username !== "string" || !web.username.trim()) {
    errors.push("web.username must not be empty");
  }

  for (const key of ["zomboid_install_dir", "zomboid_data_dir", "steamcmd_dir", "server_name"]) {
    if (typeof server[key] !== "string" || !(server[key] as string).trim()) {
      errors.push(`server.${key} must not be empty`);
    }
  }
  if (!isValidPort(server.game_port)) errors.push("server.game_port must be an integer between 1 and 65535");
  if (!isValidPort(server.rcon_port)) errors.push("server.rcon_port must be an integer between 1 and 65535");
  if (server.network_mode !== "bridge" && server.network_mode !== "host") {
    errors.push('server.network_mode must be "bridge" or "host"');
  }

  if (typeof history.retention_days !== "number" || history.retention_days < 1) {
    errors.push("history.retention_days must be at least 1");
  }

  return errors;
}

const PLACEHOLDER_PASSWORD = "change-me";
const PLACEHOLDER_SECRET_MARKERS = ["replace-with", "random-64-char"];

export function validateManagerSecretsToml(raw: string): string[] {
  const errors: string[] = [];
  const parsed = TOML.parse(raw) as Record<string, unknown>;
  const web = section(parsed, "web");
  const server = section(parsed, "server");

  const password = web.password;
  if (typeof password !== "string" || !password || password === PLACEHOLDER_PASSWORD) {
    errors.push("web.password must be set to a non-default value");
  }

  const sessionSecret = web.session_secret;
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
    errors.push("web.session_secret must be at least 32 characters");
  } else if (PLACEHOLDER_SECRET_MARKERS.some((marker) => sessionSecret.includes(marker))) {
    errors.push("web.session_secret must not be the placeholder value");
  }

  if (typeof server.rcon_password !== "string") {
    errors.push("server.rcon_password must be a string (may be empty to disable RCON)");
  }

  return errors;
}
