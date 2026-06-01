#!/usr/bin/env node
import { Command, Option } from "commander";
import { initHost, doctorHost, registerService, renderHost, serviceStatus, unregisterService } from "./host.js";
import { printResult, outputMode } from "./output.js";
import { resolvePorchPaths } from "./paths.js";
import { scaffoldApp, type ScaffoldKind } from "./scaffold.js";

const program = new Command();

program
  .name("porch")
  .description("Manage shared VPS edge deployments with Docker, Caddy, and provider-backed DNS.")
  .version("0.1.0")
  .option("--config-dir <path>", "Porch config directory", process.env.PORCH_CONFIG_DIR)
  .option("--runtime-dir <path>", "Porch runtime directory", process.env.PORCH_RUNTIME_DIR);

const host = program.command("host").description("Manage the Porch host");

host
  .command("init")
  .description("Initialize a VPS as a Porch host")
  .requiredOption("--acme-email <email>", "Email used by Caddy for ACME")
  .option("--default-domain <domain>", "Default domain for generated service hostnames")
  .option("--host-ip <ip>", "Public IP address for DNS records")
  .option("--network <name>", "Docker network name", "porch")
  .addOption(new Option("--provider <provider>", "DNS provider").choices(["digitalocean"]))
  .option("--token-env <name>", "Environment variable containing provider token", "DIGITALOCEAN_TOKEN")
  .option("--dry-run", "Show planned changes without applying them")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () =>
      initHost(paths(), {
        acmeEmail: options.acmeEmail,
        defaultDomain: options.defaultDomain,
        hostIp: options.hostIp,
        network: options.network,
        provider: options.provider,
        tokenEnv: options.tokenEnv,
        dryRun: options.dryRun,
      }),
    );
  });

host
  .command("doctor")
  .description("Check host prerequisites and Porch state")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () => doctorHost(paths()));
  });

const service = program.command("service").description("Manage Porch services");

service
  .command("register")
  .description("Register or update a service on this host")
  .requiredOption("--service-id <id>", "Stable service id")
  .option("--name <name>", "Human-readable service name")
  .requiredOption("--domain <domain...>", "Domain routed to this service")
  .option("--www-redirect", "Redirect www.<primary-domain> to the primary domain")
  .requiredOption("--container <name>", "Docker container name on the Porch network")
  .requiredOption("--port <port>", "Container port to proxy", parsePort)
  .option("--image <image>", "Container image reference")
  .option("--env <key=value...>", "Environment entries for generated compose")
  .option("--deploy-path <path>", "Host app directory")
  .option("--repository <repo>", "Source repository")
  .option("--migration-command <command>", "Optional deploy migration command")
  .option("--health-url <url>", "URL to check after deploy")
  .option("--dry-run", "Show planned changes without applying them")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () =>
      registerService(paths(), {
        id: options.serviceId,
        name: options.name,
        environment: "production",
        domains: options.domain,
        wwwRedirect: Boolean(options.wwwRedirect),
        upstream: {
          container: options.container,
          port: options.port,
        },
        image: options.image,
        env: parseEnv(options.env),
        deploy: {
          path: options.deployPath,
          repository: options.repository,
          migrationCommand: options.migrationCommand,
        },
        metadata: {},
        health: options.healthUrl
          ? {
              url: options.healthUrl,
              interval: "60s",
              timeout: "10s",
              expectStatus: [200, 301, 302],
              checkContainer: true,
            }
          : undefined,
        dryRun: options.dryRun,
      }),
    );
  });

service
  .command("remove")
  .description("Remove a service from host routing")
  .requiredOption("--service-id <id>", "Stable service id")
  .option("--delete-dns", "Delete managed DNS records too")
  .option("--dry-run", "Show planned changes without applying them")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () =>
      unregisterService(paths(), {
        id: options.serviceId,
        deleteDns: options.deleteDns,
        dryRun: options.dryRun,
      }),
    );
  });

service
  .command("status")
  .description("Show service registry status")
  .option("--service-id <id>", "Filter to one service")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () => serviceStatus(paths(), options.serviceId));
  });

program
  .command("render")
  .description("Render edge Caddy and Docker Compose files from the host registry")
  .option("--dry-run", "Show planned changes without applying them")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () => renderHost(paths(), options.dryRun));
  });

const scaffold = program.command("scaffold").description("Generate app deployment artifacts");

scaffold
  .command("app")
  .description("Scaffold Docker, compose, workflow, and agent deployment instructions")
  .addOption(
    new Option("--kind <kind>", "Application runtime archetype")
      .choices(["static-astro", "astro-node", "node"])
      .default("node"),
  )
  .requiredOption("--service-id <id>", "Stable service id")
  .requiredOption("--domain <domain>", "Primary domain")
  .requiredOption("--port <port>", "Container port", parsePort)
  .option("--container <name>", "Docker container name")
  .option("--image <image>", "Default container image")
  .option("--network <name>", "External Docker network", "porch")
  .option("--migration-command <command>", "Optional deploy migration command")
  .option("--force", "Overwrite existing generated files")
  .option("--dry-run", "Show planned changes without applying them")
  .option("--json", "Emit structured JSON output")
  .action(async (options) => {
    await runCli(options, async () =>
      scaffoldApp({
        cwd: process.cwd(),
        kind: options.kind as ScaffoldKind,
        serviceId: options.serviceId,
        domain: options.domain,
        container: options.container,
        port: options.port,
        image: options.image,
        network: options.network,
        migrationCommand: options.migrationCommand,
        force: options.force,
        dryRun: options.dryRun,
      }),
    );
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function paths() {
  const options = program.opts<{ configDir?: string; runtimeDir?: string }>();
  return resolvePorchPaths(options);
}

async function runCli(
  options: { json?: boolean },
  action: () => Promise<Awaited<ReturnType<typeof initHost>>>,
): Promise<void> {
  try {
    const result = await action();
    printResult(result, outputMode(options));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    const result = {
      ok: false,
      command: program.args.join(" "),
      summary: error instanceof Error ? error.message : String(error),
    };
    printResult(result, outputMode(options));
    process.exitCode = 1;
  }
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function parseEnv(values: string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const value of values ?? []) {
    const index = value.indexOf("=");
    if (index === -1) throw new Error(`Expected --env KEY=value, got ${value}`);
    env[value.slice(0, index)] = value.slice(index + 1);
  }
  return env;
}
