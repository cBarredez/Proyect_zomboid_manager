#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import {
  parseDeployToml,
  validateDeployTarget,
  validateManagerSecretsToml,
  validateManagerToml,
  type DeployTarget,
} from "./validate.js";
import {
  buildImage,
  checkPodmanReachable,
  currentImage,
  ensureRuntime,
  imageTag,
  logs,
  pruneProjectImages,
  replaceContainer,
  repoRootFrom,
  restartContainer,
  status,
  uploadRelease,
  uploadSecrets,
  verifyTools,
  waitHealthy,
  type Service,
} from "./remote.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = repoRootFrom(__dirname);

interface Args {
  target?: string;
  check: boolean;
  frontend: boolean;
  backend: boolean;
  yes: boolean;
  status: boolean;
  logsService?: Service;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { check: false, frontend: false, backend: false, yes: false, status: false };
  const rest = [...argv];

  const first = rest[0];
  if (first && !first.startsWith("--")) {
    args.target = first;
    rest.shift();
  }

  for (let i = 0; i < rest.length; i++) {
    switch (rest[i]) {
      case "--check":
        args.check = true;
        break;
      case "--frontend":
        args.frontend = true;
        break;
      case "--backend":
        args.backend = true;
        break;
      case "--yes":
        args.yes = true;
        break;
      case "--status":
        args.status = true;
        break;
      case "--logs":
        args.logsService = rest[++i] as Service;
        break;
      default:
        throw new Error(`unknown argument: ${rest[i]}`);
    }
  }

  return args;
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} (type DEPLOY to continue): `);
  rl.close();
  return answer.trim() === "DEPLOY";
}

async function validateLocal(target: DeployTarget): Promise<void> {
  const managerToml = await readFile(path.join(REPO_ROOT, "config", "manager.toml"), "utf-8");
  const secretsToml = await readFile(path.join(REPO_ROOT, "config", "manager.secrets.toml"), "utf-8");

  const errors = [
    ...validateManagerToml(managerToml),
    ...validateManagerSecretsToml(secretsToml),
  ];
  if (errors.length > 0) {
    throw new Error(`Invalid local configuration:\n- ${errors.join("\n- ")}`);
  }
  void target;
}

async function deployService(target: DeployTarget, remoteDir: string, service: Service): Promise<void> {
  const release = path.basename(remoteDir);
  const newTag = imageTag(service, release);
  const previousImage = await currentImage(target, service);

  console.log(`[${service}] building ${newTag}...`);
  await buildImage(target, remoteDir, service, release);

  console.log(`[${service}] replacing container (previous image: ${previousImage ?? "none"})...`);
  await replaceContainer(target, { service, image: newTag });

  console.log(`[${service}] waiting for health check...`);
  const healthy = await waitHealthy(target, service);
  if (healthy) {
    console.log(`[${service}] healthy.`);
    return;
  }

  console.error(`[${service}] failed its health check.`);
  if (previousImage && previousImage !== newTag) {
    console.error(`[${service}] rolling back to ${previousImage}...`);
    await replaceContainer(target, { service, image: previousImage });
    const rolledBackHealthy = await waitHealthy(target, service);
    console.error(
      rolledBackHealthy
        ? `[${service}] rollback succeeded, previous image is healthy again.`
        : `[${service}] rollback image is also unhealthy — manual intervention required.`,
    );
  }
  throw new Error(`${service} deploy failed and was rolled back — see: podman logs pz-manager-${service}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    console.error("usage: deploy.ts <target> [--check] [--frontend] [--backend] [--yes] [--status] [--logs <service>]");
    process.exit(1);
  }

  const deployTomlPath = path.join(REPO_ROOT, "deploy.toml");
  const targets = parseDeployToml(await readFile(deployTomlPath, "utf-8"));
  const targetErrors = validateDeployTarget(args.target, targets);
  if (targetErrors.length > 0) {
    console.error(targetErrors.join("\n"));
    process.exit(1);
  }
  const target = targets[args.target];

  await validateLocal(target);

  if (args.status) {
    console.log(await status(target));
    return;
  }
  if (args.logsService) {
    console.log(await logs(target, args.logsService));
    return;
  }

  await verifyTools();
  await checkPodmanReachable(target);

  if (args.check) {
    console.log("Configuration and connectivity check passed.");
    return;
  }

  if (!args.frontend && !args.backend) {
    console.error("specify --frontend and/or --backend");
    process.exit(1);
  }

  if (args.backend && !args.yes) {
    const proceed = await confirm(
      "Redeploying the backend stops the running Zomboid server process.",
    );
    if (!proceed) {
      console.log("Aborted.");
      return;
    }
  }

  console.log("Uploading release...");
  const remoteDir = await uploadRelease(target, REPO_ROOT);
  await uploadSecrets(target, path.join(REPO_ROOT, "config", "manager.secrets.toml"), remoteDir);
  await ensureRuntime(target);

  const deployed: Service[] = [];
  try {
    if (args.backend) {
      await deployService(target, remoteDir, "api");
      deployed.push("api");
    }
    if (args.frontend) {
      await deployService(target, remoteDir, "frontend");
      deployed.push("frontend");
    }

    if (args.backend && !args.frontend) {
      console.log("Restarting frontend so nginx re-resolves the api container...");
      await restartContainer(target, "frontend");
    }

    await pruneProjectImages(target);
    console.log("Deploy complete.");
  } catch (err) {
    console.error(`Deploy failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
