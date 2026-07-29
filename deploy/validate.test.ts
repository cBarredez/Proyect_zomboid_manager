import { describe, expect, it } from "vitest";
import {
  parseDeployToml,
  validateDeployTarget,
  validateManagerSecretsToml,
  validateManagerToml,
} from "./validate.js";

const DEPLOY_TOML = `
[dev]
server = "192.168.1.20"
username = "pz"

[prod]
server = "203.0.113.20"
username = "pz"
`;

describe("parseDeployToml / validateDeployTarget", () => {
  it("parses targets", () => {
    const targets = parseDeployToml(DEPLOY_TOML);
    expect(targets.dev).toEqual({ server: "192.168.1.20", username: "pz" });
    expect(targets.prod).toEqual({ server: "203.0.113.20", username: "pz" });
  });

  it("accepts a known target", () => {
    const targets = parseDeployToml(DEPLOY_TOML);
    expect(validateDeployTarget("dev", targets)).toEqual([]);
  });

  it("rejects an unknown target", () => {
    const targets = parseDeployToml(DEPLOY_TOML);
    expect(validateDeployTarget("staging", targets)).toEqual([
      'unknown deploy target "staging" — check deploy.toml',
    ]);
  });
});

const VALID_MANAGER = `
[web]
port = 8080
public_port = 8081
username = "admin"

[server]
zomboid_install_dir = "/pz/install"
zomboid_data_dir = "/pz/data"
steamcmd_dir = "/pz/steamcmd"
server_name = "servertest"
game_port = 16261
rcon_port = 27015
network_mode = "bridge"

[history]
retention_days = 30
`;

describe("validateManagerToml", () => {
  it("accepts a valid config", () => {
    expect(validateManagerToml(VALID_MANAGER)).toEqual([]);
  });

  it("rejects an invalid network_mode", () => {
    const bad = VALID_MANAGER.replace('network_mode = "bridge"', 'network_mode = "weird"');
    expect(validateManagerToml(bad)).toContain('server.network_mode must be "bridge" or "host"');
  });

  it("rejects an empty server_name", () => {
    const bad = VALID_MANAGER.replace('server_name = "servertest"', 'server_name = ""');
    expect(validateManagerToml(bad)).toContain("server.server_name must not be empty");
  });
});

const VALID_SECRETS = `
[web]
password = "a-real-password"
session_secret = "0123456789abcdef0123456789abcdef0123456789"

[server]
rcon_password = "rcon-secret"
`;

describe("validateManagerSecretsToml", () => {
  it("accepts a valid secrets file", () => {
    expect(validateManagerSecretsToml(VALID_SECRETS)).toEqual([]);
  });

  it("rejects the default placeholder password", () => {
    const bad = VALID_SECRETS.replace('password = "a-real-password"', 'password = "change-me"');
    expect(validateManagerSecretsToml(bad)).toContain("web.password must be set to a non-default value");
  });

  it("rejects a short session secret", () => {
    const bad = VALID_SECRETS.replace(
      'session_secret = "0123456789abcdef0123456789abcdef0123456789"',
      'session_secret = "short"',
    );
    expect(validateManagerSecretsToml(bad)).toContain("web.session_secret must be at least 32 characters");
  });
});
