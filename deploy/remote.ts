import { spawn } from "node:child_process";
import path from "node:path";
import type { DeployTarget } from "./validate.js";

export const PROJECT_LABEL = "project=pz-manager";
const CONTROL_PATH_TEMPLATE = "~/.ssh/pz-manager-deploy-%r@%h:%p";

function controlFlags(): string[] {
  return [
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${CONTROL_PATH_TEMPLATE}`,
    "-o",
    "ControlPersist=60s",
  ];
}

function run(cmd: string, args: string[], opts: { input?: string } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} ${args.join(" ")} failed (${code}): ${stderr || stdout}`));
    });
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export async function verifyTools(): Promise<void> {
  for (const tool of ["ssh", "scp", "tar", "podman"]) {
    try {
      await run("sh", ["-c", `command -v ${tool}`]);
    } catch {
      throw new Error(`required local tool not found on PATH: ${tool}`);
    }
  }
}

export function sshTarget(target: DeployTarget): string {
  return `${target.username}@${target.server}`;
}

export function sshExec(target: DeployTarget, remoteCommand: string): Promise<string> {
  return run("ssh", [...controlFlags(), sshTarget(target), remoteCommand]);
}

export async function checkPodmanReachable(target: DeployTarget): Promise<void> {
  await sshExec(target, "podman info >/dev/null");
}

export async function uploadRelease(target: DeployTarget, repoRoot: string): Promise<string> {
  const releaseTs = new Date().toISOString().replace(/[:.]/g, "-");
  const remoteDir = `~/.local/share/pz-manager/releases/${releaseTs}`;
  await sshExec(target, `mkdir -p ${remoteDir}`);

  await new Promise<void>((resolve, reject) => {
    const tar = spawn(
      "tar",
      [
        "-czf",
        "-",
        "--exclude=.git",
        "--exclude=node_modules",
        "--exclude=dist",
        "--exclude=config/manager.secrets.toml",
        "-C",
        repoRoot,
        ".",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const ssh = spawn("ssh", [...controlFlags(), sshTarget(target), `tar -xzf - -C ${remoteDir}`], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    tar.stdout.pipe(ssh.stdin);
    let failed = false;
    tar.on("error", (err) => {
      failed = true;
      reject(err);
    });
    ssh.on("error", (err) => {
      failed = true;
      reject(err);
    });
    ssh.on("exit", (code) => {
      if (failed) return;
      if (code === 0) resolve();
      else reject(new Error(`remote extract failed (${code})`));
    });
  });

  return remoteDir;
}

export async function uploadSecrets(target: DeployTarget, secretsPath: string, remoteDir: string): Promise<void> {
  await run("scp", [...controlFlags(), secretsPath, `${sshTarget(target)}:${remoteDir}/config/manager.secrets.toml`]);
  await sshExec(target, `chmod 600 ${remoteDir}/config/manager.secrets.toml`);
}

export async function ensureRuntime(target: DeployTarget): Promise<void> {
  await sshExec(
    target,
    [
      "podman network exists pz-net || podman network create pz-net",
      "for v in pz-install pz-data pz-steamcmd; do podman volume inspect $v >/dev/null 2>&1 || podman volume create --label " +
        PROJECT_LABEL +
        " $v; done",
    ].join(" && "),
  );
}

export type Service = "api" | "frontend";

export function imageTag(service: Service, release: string): string {
  return `localhost/pz-manager-${service}:${release}`;
}

export async function buildImage(
  target: DeployTarget,
  remoteDir: string,
  service: Service,
  release: string,
  repoRoot: string,
): Promise<void> {
  const containerfile = service === "api" ? "Containerfile.api" : "Containerfile.frontend";
  const commit = await run("git", ["-C", repoRoot, "rev-parse", "HEAD"])
    .then((out) => out.trim())
    .catch(() => "unknown");
  const buildDate = new Date().toISOString();
  await sshExec(
    target,
    `cd ${remoteDir} && podman build --label ${PROJECT_LABEL} --build-arg GIT_COMMIT=${commit} --build-arg BUILD_DATE=${buildDate} -f ${containerfile} -t ${imageTag(service, release)} .`,
  );
}

export interface ReplaceOptions {
  service: Service;
  image: string;
}

function runArgsForService(opts: ReplaceOptions): string {
  if (opts.service === "api") {
    return [
      "--replace --name pz-manager-api -d",
      `--label ${PROJECT_LABEL}`,
      "--network pz-net",
      "-p 16261:16261/udp -p 16262:16262/udp -p 27015:27015/tcp",
      "-v ./config:/app/config:ro",
      "-v pz-install:/pz/install -v pz-data:/pz/data -v pz-steamcmd:/pz/steamcmd",
      '--health-cmd "curl -fsS http://127.0.0.1:8080/api/health || exit 1"',
      "--health-interval 30s --health-timeout 5s --health-retries 3",
      opts.image,
    ].join(" ");
  }
  return [
    "--replace --name pz-manager-frontend -d",
    `--label ${PROJECT_LABEL}`,
    "--network pz-net",
    "-p 127.0.0.1:8080:80",
    "-e PZ_MANAGER_API_BACKEND=api:8080",
    opts.image,
  ].join(" ");
}

export async function replaceContainer(target: DeployTarget, opts: ReplaceOptions): Promise<void> {
  await sshExec(target, `podman run ${runArgsForService(opts)}`);
}

export async function waitHealthy(target: DeployTarget, service: Service, timeoutMs = 120_000): Promise<boolean> {
  const containerName = `pz-manager-${service}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const state = (
        await sshExec(target, `podman inspect --format '{{.State.Health.Status}}' ${containerName}`)
      ).trim();
      if (state === "healthy") return true;
      if (state === "unhealthy") return false;
    } catch {
      // container may not have a health check yet, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

export async function currentImage(target: DeployTarget, service: Service): Promise<string | null> {
  try {
    const out = await sshExec(
      target,
      `podman inspect --format '{{.ImageName}}' pz-manager-${service}`,
    );
    return out.trim() || null;
  } catch {
    return null;
  }
}

export async function restartContainer(target: DeployTarget, service: Service): Promise<void> {
  await sshExec(target, `podman restart pz-manager-${service}`);
}

export async function pruneProjectImages(target: DeployTarget): Promise<void> {
  await sshExec(target, `podman image prune -a -f --filter label=${PROJECT_LABEL}`);
}

export async function status(target: DeployTarget): Promise<string> {
  return sshExec(target, "podman ps --filter label=" + PROJECT_LABEL);
}

export async function logs(target: DeployTarget, service: Service, tail = 200): Promise<string> {
  return sshExec(target, `podman logs --tail ${tail} pz-manager-${service}`);
}

export function repoRootFrom(deployDir: string): string {
  return path.resolve(deployDir, "..");
}
