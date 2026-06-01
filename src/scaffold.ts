import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderAppCompose } from "./render.js";
import { serviceSchema, type ServiceConfig } from "./schemas.js";
import type { CommandResult } from "./output.js";

export type ScaffoldKind = "static-astro" | "astro-node" | "node";

export async function scaffoldApp(input: {
  cwd: string;
  kind: ScaffoldKind;
  serviceId: string;
  domain: string;
  container?: string;
  port: number;
  image?: string;
  network?: string;
  force?: boolean;
  migrationCommand?: string;
  dryRun?: boolean;
}): Promise<CommandResult> {
  const service = serviceSchema.parse({
    id: input.serviceId,
    domains: [input.domain],
    wwwRedirect: false,
    upstream: {
      container: input.container ?? `${input.serviceId}-web`,
      port: input.port,
    },
    image: input.image,
    deploy: {
      path: `/opt/${input.serviceId}`,
      migrationCommand: input.migrationCommand,
    },
  });

  const files = new Map<string, string>([
    ["Dockerfile", dockerfileFor(input.kind, input.port)],
    ["docker-compose.yml", renderAppCompose(service, input.network ?? "porch")],
    [".github/workflows/deploy.yml", deployWorkflow(service)],
    ["PORCH.md", agentInstructions(service)],
  ]);

  const planned = [...files.keys()].map((file) => `write ${file}`);
  if (!input.dryRun) {
    for (const [relativePath, contents] of files) {
      await writeIfAllowed(path.join(input.cwd, relativePath), contents, Boolean(input.force));
    }
  }

  return {
    ok: true,
    command: "scaffold app",
    dryRun: input.dryRun,
    summary: `Scaffolded Porch deployment for ${service.id}`,
    planned,
    applied: input.dryRun ? [] : planned,
    data: { service, files: [...files.keys()] },
  };
}

function dockerfileFor(kind: ScaffoldKind, port: number): string {
  if (kind === "static-astro") {
    return `FROM node:22.13-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2.9-alpine AS runner
COPY --from=build /app/dist /srv
EXPOSE ${port}
CMD ["caddy", "file-server", "--root", "/srv", "--listen", ":${port}"]
`;
  }

  if (kind === "astro-node") {
    return `FROM node:22.13-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=${port}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
EXPOSE ${port}
CMD ["node", "dist/server/entry.mjs"]
`;
  }

  return `FROM node:22.13-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/.output ./.output
EXPOSE ${port}
CMD ["npm", "run", "start"]
`;
}

function deployWorkflow(service: ServiceConfig): string {
  const migration = service.deploy.migrationCommand
    ? `            --migration-command ${shellArg(service.deploy.migrationCommand)} \\\n`
    : "";

  return `name: Deploy

on:
  workflow_dispatch:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22.13.0
          cache: npm
      - run: npm ci
      - run: npm run build
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/\${{ github.repository }}:\${{ github.sha }},ghcr.io/\${{ github.repository }}:latest
      - uses: appleboy/ssh-action@v1.2.0
        with:
          host: \${{ secrets.PORCH_HOST }}
          username: \${{ secrets.PORCH_USER }}
          key: \${{ secrets.PORCH_SSH_KEY }}
          script: |
            set -eu
            npx @lindale/porch service register \\
              --service-id ${service.id} \\
              --domain ${service.domains[0]} \\
              --container ${service.upstream.container} \\
              --port ${service.upstream.port} \\
              --image ghcr.io/\${{ github.repository }}:\${{ github.sha }} \\
              --deploy-path ${service.deploy.path} \\
${migration}              --json
`;
}

function agentInstructions(service: ServiceConfig): string {
  return `# Porch Deployment

This service is managed by Porch.

- Service id: \`${service.id}\`
- Domain: \`${service.domains[0]}\`
- Container: \`${service.upstream.container}\`
- Internal port: \`${service.upstream.port}\`

Agents should update app build/runtime details in this repo, then use the generated deploy workflow. Host routing, DNS, TLS, and Caddy reloads are owned by \`npx @lindale/porch service register --json\` on the VPS.
`;
}

async function writeIfAllowed(filePath: string, contents: string, force: boolean): Promise<void> {
  if (!force) {
    try {
      await readFile(filePath, "utf8");
      throw new Error(`${filePath} already exists. Use --force to overwrite.`);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

function shellArg(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
