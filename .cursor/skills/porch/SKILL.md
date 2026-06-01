---
name: porch
description: Set up and deploy services with Porch on a shared VPS. Use when adding Dockerfiles, GitHub deploy workflows, service registration, DNS routing, Caddy/HTTPS routing, or agent-managed deployments using @lindale/porch.
---

# Porch

## Purpose

Porch manages public services on a shared VPS. It owns host bootstrap, Docker network attachment, hostname-to-container routing, DigitalOcean DNS records, Caddy HTTPS routing, and stable JSON output for agents.

Service repos own app code, app build/test commands, runtime environment variables, migrations, and Docker images. Do not move app-specific behavior into Porch unless the user explicitly asks.

## Agent Rules

- Prefer `npx @lindale/porch scaffold app` when creating deploy artifacts for a new service.
- Use `--json` for CI, GitHub Actions, and agent automation.
- Use `--dry-run --json` before mutating host state when uncertain.
- Do not create paid resources such as droplets or domain registrations. Humans do that.
- Do not hand-edit `/etc/porch`, `/opt/porch/Caddyfile`, or generated Porch runtime files unless the user explicitly asks for emergency repair.
- Do not use the legacy `edge` Docker network. Services attach to the external `porch` network.
- Do not publish host ports from app containers. Caddy is the only public edge on ports 80 and 443.
- Keep `container_name` stable and ensure it matches the Porch service registration.
- Do not configure a separate host reverse proxy per app. Shared Caddy routing is managed by Porch.
- Do not add custom reboot startup scripts for normal services. Porch relies on Docker being enabled at boot and containers using `restart: unless-stopped`.
- Never commit SSH keys, DigitalOcean tokens, `.env` secrets, or provider credentials.

## New App Workflow

1. Identify the runtime kind and internal port.
2. Scaffold deploy artifacts.
3. Review and adapt the generated Dockerfile/workflow for app-specific build, test, env, and migration needs.
4. Ensure the deploy workflow calls Porch with `--json`.
5. Validate locally with normal app checks before changing host state.

```bash
npx @lindale/porch scaffold app \
  --kind node \
  --service-id my-app \
  --domain my-app.example.com \
  --port 3000
```

Generated files usually include:

- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/deploy.yml`
- `PORCH.md`

## Choosing The App Kind

- `static-astro`: Astro static output served by Caddy inside the app image. Common internal port: `80`.
- `astro-node`: Astro SSR using `@astrojs/node`. Common internal port: `4321`.
- `node`: Generic Node server, TanStack Start, Vite SSR, Express, Fastify, or similar. Common internal port: `3000`.

If the framework is unclear, inspect `package.json`, framework config, build output, and start command before choosing.

## Service Registration

Use this command on the VPS, or from CI over SSH:

```bash
npx @lindale/porch service register \
  --service-id my-app \
  --domain my-app.example.com \
  --container my-app-web \
  --port 3000 \
  --image ghcr.io/owner/repo:sha \
  --deploy-path /opt/my-app \
  --json
```

Useful optional flags:

- `--www-redirect`
- `--env KEY=value`
- `--migration-command "node scripts/migrate.js"`
- `--health-url https://my-app.example.com`
- `--dry-run`

When `--image` and `--deploy-path` are present, Porch writes the app compose file, pulls the image, starts the app container on the `porch` network, updates DNS if configured, renders Caddy config, reloads Caddy, and returns structured output.

## GitHub Actions Guidance

Deploy workflows should:

- Build and test the app using the repo's own package manager and scripts.
- Build and push a Docker image to GHCR or the user's chosen registry.
- SSH to the Porch host or use the Porch composite action.
- Run `npx @lindale/porch service register ... --json` on the host.
- Keep app-specific migrations explicit with `--migration-command` or a clearly named workflow step.

Expected secrets:

- `PORCH_HOST`
- `PORCH_USER`
- `PORCH_SSH_KEY`
- App-specific secrets, if the service needs them.

## Host Setup

Only run host setup when the user is intentionally configuring a VPS that already exists and SSH access is ready.

```bash
npx @lindale/porch host init \
  --acme-email ops@example.com \
  --host-ip 203.0.113.10 \
  --default-domain example.com \
  --provider digitalocean \
  --json
```

Check host health with:

```bash
npx @lindale/porch host doctor --json
```

On systemd hosts, `host init` enables and starts Docker. `host doctor` reports whether Docker is active and enabled at boot.

## IMPORTANT

When Porch relies on Node installed via NVM on the VPS, SSH deploy steps must source "$HOME/.nvm/nvm.sh" before calling npx; bash -lc alone may not be enough.

## Validation Checklist

- Dockerfile builds successfully.
- App listens on `0.0.0.0` inside the container.
- Internal app port matches `--port`.
- `container_name` matches `--container`.
- Compose network is external `porch`.
- Deploy workflow uses `--json`.
- The DNS zone already exists in DigitalOcean.
- App containers do not publish host ports.
- Required runtime secrets are configured outside committed files.
- Migrations are explicit when needed.
