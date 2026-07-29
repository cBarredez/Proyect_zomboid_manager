import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigValidationError, loadConfig } from "./index.js";

async function withTempConfig(
  mainToml: string,
  secretsToml: string,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "pz-config-"));
  try {
    await writeFile(path.join(dir, "manager.toml"), mainToml, "utf-8");
    await writeFile(path.join(dir, "manager.secrets.toml"), secretsToml, "utf-8");
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const VALID_MAIN = `
[web]
port = 8080
public_port = 8081
bind_ip = "127.0.0.1"
username = "admin"

[server]
zomboid_install_dir = "/pz/install"
zomboid_data_dir = "/pz/data"
steamcmd_dir = "/pz/steamcmd"
server_name = "servertest"
game_port = 16261
rcon_port = 27015
memory_limit_mb = 4096
network_mode = "bridge"

[steam]
owner_ids = []

[runtime]
timezone = "UTC"

[history]
retention_days = 30
`;

const VALID_SECRETS = `
[web]
password = "super-secret-password"
session_secret = "0123456789abcdef0123456789abcdef0123456789"

[server]
rcon_password = "rcon-secret"
admin_password = "admin-secret"

[steam]
password = ""
`;

describe("loadConfig", () => {
  it("parses a valid config pair", async () => {
    await withTempConfig(VALID_MAIN, VALID_SECRETS, async (dir) => {
      const config = await loadConfig(
        path.join(dir, "manager.toml"),
        path.join(dir, "manager.secrets.toml"),
      );
      expect(config.web.port).toBe(8080);
      expect(config.server.serverName).toBe("servertest");
      expect(config.web.password).toBe("super-secret-password");
    });
  });

  it("rejects a placeholder password", async () => {
    const badSecrets = VALID_SECRETS.replace("super-secret-password", "change-me");
    await withTempConfig(VALID_MAIN, badSecrets, async (dir) => {
      await expect(
        loadConfig(path.join(dir, "manager.toml"), path.join(dir, "manager.secrets.toml")),
      ).rejects.toThrow(ConfigValidationError);
    });
  });

  it("rejects an out-of-range port", async () => {
    const badMain = VALID_MAIN.replace("port = 8080", "port = 99999");
    await withTempConfig(badMain, VALID_SECRETS, async (dir) => {
      await expect(
        loadConfig(path.join(dir, "manager.toml"), path.join(dir, "manager.secrets.toml")),
      ).rejects.toThrow(/web.port/);
    });
  });

  it("rejects a short session secret", async () => {
    const badSecrets = VALID_SECRETS.replace(
      "session_secret = \"0123456789abcdef0123456789abcdef0123456789\"",
      "session_secret = \"tooshort\"",
    );
    await withTempConfig(VALID_MAIN, badSecrets, async (dir) => {
      await expect(
        loadConfig(path.join(dir, "manager.toml"), path.join(dir, "manager.secrets.toml")),
      ).rejects.toThrow(/session_secret/);
    });
  });
});
