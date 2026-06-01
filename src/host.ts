import { mkdir } from "node:fs/promises";
import path from "node:path";
import { renderAppCompose, renderCaddyfile, renderEdgeCompose } from "./render.js";
import { commandExists, run } from "./system.js";
import type { CommandResult } from "./output.js";
import type { HostConfig, ServiceConfig } from "./schemas.js";
import type { PorchPaths } from "./paths.js";
import { loadHostConfig, loadRegistry, removeService, upsertService, writeHostConfig } from "./registry.js";
import { hostConfigSchema, serviceSchema } from "./schemas.js";
import { writeTextAtomic } from "./fs.js";
import { createDnsProvider } from "./providers.js";

export async function initHost(
  paths: PorchPaths,
  input: {
    acmeEmail: string;
    defaultDomain?: string;
    hostIp?: string;
    network?: string;
    provider?: "digitalocean";
    tokenEnv?: string;
    dryRun?: boolean;
  },
): Promise<CommandResult> {
  const config = hostConfigSchema.parse({
    version: 1,
    acmeEmail: input.acmeEmail,
    defaultDomain: input.defaultDomain,
    hostIp: input.hostIp,
    network: input.network ?? "porch",
    provider: input.provider
      ? { type: input.provider, tokenEnv: input.tokenEnv ?? "DIGITALOCEAN_TOKEN" }
      : undefined,
    paths: {
      configDir: paths.configDir,
      runtimeDir: paths.runtimeDir,
      appsDir: "/opt",
    },
  });

  const planned = [
    `create ${paths.configDir}`,
    `create ${paths.runtimeDir}`,
    `write ${paths.hostConfigPath}`,
    `write ${paths.caddyfilePath}`,
    `write ${paths.edgeComposePath}`,
    "ensure Docker service is enabled and started",
    `ensure Docker network ${config.network}`,
    "start porch edge stack",
  ];

  if (!input.dryRun) {
    await assertHostPrerequisites();
    await ensureDockerService();
    await mkdir(paths.servicesDir, { recursive: true });
    await mkdir(paths.runtimeDir, { recursive: true });
    await writeHostConfig(paths, config);
    await writeEdgeFiles(paths, config);
    await ensureDockerNetwork(config.network);
    await run("docker", ["compose", "up", "-d"], { cwd: paths.runtimeDir });
  }

  return {
    ok: true,
    command: "host init",
    dryRun: input.dryRun,
    summary: "Porch host initialized",
    planned,
    applied: input.dryRun ? [] : planned,
    data: { paths, config },
  };
}

export async function doctorHost(paths: PorchPaths): Promise<CommandResult> {
  const warnings: string[] = [];
  const checks = {
    docker: await commandExists("docker"),
    dockerCompose: false,
    systemctl: await commandExists("systemctl"),
    dockerServiceActive: undefined as boolean | undefined,
    dockerServiceEnabled: undefined as boolean | undefined,
    node: await commandExists("node"),
  };
  if (checks.docker) {
    checks.dockerCompose = await dockerComposeAvailable();
  }
  if (checks.systemctl) {
    checks.dockerServiceActive = await systemctlCheck("is-active", "docker");
    checks.dockerServiceEnabled = await systemctlCheck("is-enabled", "docker");
  }

  if (!checks.docker) warnings.push("docker is not installed or not on PATH");
  if (checks.docker && !checks.dockerCompose) warnings.push("docker compose is not available");
  if (checks.systemctl && checks.dockerServiceActive === false) warnings.push("docker service is not active");
  if (checks.systemctl && checks.dockerServiceEnabled === false) warnings.push("docker service is not enabled at boot");
  if (!checks.node) warnings.push("node is not installed or not on PATH");

  let host: HostConfig | undefined;
  try {
    host = await loadHostConfig(paths);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  const registry = host ? await loadRegistry(paths) : undefined;

  return {
    ok: warnings.length === 0,
    command: "host doctor",
    summary: warnings.length === 0 ? "Porch host looks healthy" : "Porch host has warnings",
    warnings,
    data: { checks, paths, host, services: registry?.services ?? [] },
  };
}

export async function registerService(
  paths: PorchPaths,
  input: ServiceConfig & { dryRun?: boolean },
): Promise<CommandResult> {
  const host = await loadHostConfig(paths);
  const service = serviceSchema.parse(input);
  const provider = createDnsProvider(host.provider);
  const dnsChanges = provider
    ? input.dryRun
      ? await provider.planServiceRecords(service, host)
      : await provider.applyServiceRecords(service, host)
    : [];

  const planned = [
    `upsert service ${service.id}`,
    ...(service.image && service.deploy.path
      ? [
          `write app compose in ${service.deploy.path}`,
          `pull ${service.image}`,
          ...(service.deploy.migrationCommand ? [`run migration: ${service.deploy.migrationCommand}`] : []),
          `start app container ${service.upstream.container}`,
        ]
      : []),
    `render ${paths.caddyfilePath}`,
    `render ${paths.edgeComposePath}`,
    "validate Caddy config",
    "reload Caddy",
    ...dnsChanges.map((change) => `${change.action} ${change.record}.${change.domain} ${change.type} ${change.value}`),
  ];

  if (!input.dryRun) {
    if (service.image && service.deploy.path) {
      await writeAppDeployment(service, host.network);
    }
    await upsertService(paths, service);
    await writeEdgeFiles(paths, host);
    await validateAndReloadCaddy();
  }

  return {
    ok: true,
    command: "service register",
    dryRun: input.dryRun,
    summary: `${service.id} registered`,
    planned,
    applied: input.dryRun ? [] : planned,
    data: { service, dnsChanges },
  };
}

export async function unregisterService(
  paths: PorchPaths,
  input: { id: string; deleteDns?: boolean; dryRun?: boolean },
): Promise<CommandResult> {
  const host = await loadHostConfig(paths);
  const registry = await loadRegistry(paths);
  const service = registry.services.find((candidate) => candidate.id === input.id);
  if (!service) throw new Error(`Service not found: ${input.id}`);

  const provider = input.deleteDns ? createDnsProvider(host.provider) : undefined;
  const dnsChanges = provider && !input.dryRun ? await provider.deleteServiceRecords(service, host) : [];
  const planned = [
    `remove service ${input.id}`,
    `render ${paths.caddyfilePath}`,
    "validate Caddy config",
    "reload Caddy",
    ...(input.deleteDns ? service.domains.map((domain) => `delete DNS for ${domain}`) : []),
  ];

  if (!input.dryRun) {
    await removeService(paths, input.id);
    await writeEdgeFiles(paths, host);
    await validateAndReloadCaddy();
  }

  return {
    ok: true,
    command: "service remove",
    dryRun: input.dryRun,
    summary: `${input.id} removed`,
    planned,
    applied: input.dryRun ? [] : planned,
    data: { service, dnsChanges },
  };
}

export async function serviceStatus(paths: PorchPaths, id?: string): Promise<CommandResult> {
  const host = await loadHostConfig(paths);
  const registry = await loadRegistry(paths);
  const services = id ? registry.services.filter((service) => service.id === id) : registry.services;
  if (id && services.length === 0) throw new Error(`Service not found: ${id}`);

  return {
    ok: true,
    command: "service status",
    summary: id ? `Status for ${id}` : "Porch service status",
    data: {
      host: { network: host.network, defaultDomain: host.defaultDomain, hostIp: host.hostIp },
      services,
    },
  };
}

export async function renderHost(paths: PorchPaths, dryRun?: boolean): Promise<CommandResult> {
  const host = await loadHostConfig(paths);
  const planned = [`render ${paths.caddyfilePath}`, `render ${paths.edgeComposePath}`];
  if (!dryRun) await writeEdgeFiles(paths, host);

  return {
    ok: true,
    command: "render",
    dryRun,
    summary: "Rendered Porch edge files",
    planned,
    applied: dryRun ? [] : planned,
  };
}

async function writeEdgeFiles(paths: PorchPaths, host: HostConfig): Promise<void> {
  const registry = await loadRegistry(paths);
  await mkdir(paths.runtimeDir, { recursive: true });
  await writeTextAtomic(paths.caddyfilePath, renderCaddyfile(host, registry));
  await writeTextAtomic(paths.edgeComposePath, renderEdgeCompose(host));
}

async function writeAppDeployment(service: ServiceConfig, network: string): Promise<void> {
  if (!service.deploy.path) return;
  await mkdir(service.deploy.path, { recursive: true });
  await writeTextAtomic(path.join(service.deploy.path, "docker-compose.yml"), renderAppCompose(service, network));
  await run("docker", ["compose", "pull", "web"], { cwd: service.deploy.path });
  if (service.deploy.migrationCommand) {
    await run("sh", ["-c", `docker compose run --rm web ${service.deploy.migrationCommand}`], {
      cwd: service.deploy.path,
    });
  }
  await run("docker", ["compose", "up", "-d"], { cwd: service.deploy.path });
}

async function ensureDockerNetwork(network: string): Promise<void> {
  try {
    await run("docker", ["network", "inspect", network]);
  } catch {
    await run("docker", ["network", "create", network]);
  }
}

async function assertHostPrerequisites(): Promise<void> {
  if (!(await commandExists("docker"))) {
    throw new Error("docker is required before running porch host init");
  }
  if (!(await dockerComposeAvailable())) {
    throw new Error("docker compose is required before running porch host init");
  }
}

async function ensureDockerService(): Promise<void> {
  if (!(await commandExists("systemctl"))) return;
  await runSystemctl(["enable", "docker"]);
  await runSystemctl(["start", "docker"]);
}

async function systemctlCheck(action: "is-active" | "is-enabled", service: string): Promise<boolean> {
  try {
    await run("systemctl", [action, "--quiet", service]);
    return true;
  } catch {
    return false;
  }
}

async function runSystemctl(args: string[]): Promise<void> {
  const command = process.getuid?.() === 0 ? "systemctl" : "sudo";
  const fullArgs = command === "systemctl" ? args : ["-n", "systemctl", ...args];
  try {
    await run(command, fullArgs);
  } catch (error) {
    const action = args.join(" ");
    throw new Error(
      `Failed to run systemctl ${action}. Re-run as root or configure passwordless sudo for Docker service management.`,
      { cause: error },
    );
  }
}

async function dockerComposeAvailable(): Promise<boolean> {
  try {
    await run("docker", ["compose", "version"]);
    return true;
  } catch {
    return false;
  }
}

async function validateAndReloadCaddy(): Promise<void> {
  await run("docker", ["exec", "porch-caddy", "caddy", "validate", "--config", "/etc/caddy/Caddyfile"]);
  await run("docker", ["exec", "porch-caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile"]);
}
