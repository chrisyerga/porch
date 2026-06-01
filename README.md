# Porch

Porch manages multiple public services on a shared VPS. It gives humans a readable CLI and gives agents stable JSON output for host bootstrap, DNS mapping, Caddy routing, Docker deployment, and service status.

The first provider implementation is DigitalOcean DNS. Droplets and domain ownership stay human-created; Porch automates the host and records inside zones you already control.

## Install

```bash
npx @lindale/porch --help
```

## Host Setup

Run this on the VPS after SSH access is configured:

```bash
npx @lindale/porch host init \
  --acme-email hello@example.com \
  --host-ip 203.0.113.10 \
  --default-domain example.com \
  --provider digitalocean
```

Porch stores host config in `/etc/porch`, generated edge files in `/opt/porch`, creates the `porch` Docker network, and runs Caddy as the edge container. Caddy owns Let's Encrypt certificates.

Use `--dry-run` to inspect planned changes and `--json` for agent-friendly output.

## Register A Service

From the VPS, or from CI over SSH:

```bash
npx @lindale/porch service register \
  --service-id my-app \
  --domain my-app.example.com \
  --container my-app-web \
  --port 3000 \
  --image ghcr.io/acme/my-app:latest \
  --deploy-path /opt/my-app \
  --json
```

If DigitalOcean is configured, Porch upserts DNS records. If `--image` and `--deploy-path` are provided, Porch writes the app compose file, pulls the image, starts the app container on the `porch` network, renders Caddy, reloads Caddy, and reports the result.

## Scaffold An App Repo

```bash
npx @lindale/porch scaffold app \
  --kind astro-node \
  --service-id my-app \
  --domain my-app.example.com \
  --port 4321
```

This creates a Dockerfile, `docker-compose.yml`, GitHub deploy workflow, and `PORCH.md` agent instructions. Supported v1 archetypes are `static-astro`, `astro-node`, and `node`.

## GitHub Action

This repo also exposes a thin composite action. It delegates host mutation to the same CLI humans and agents use:

```yaml
- uses: lindale-labs/porch@v0.1.0
  with:
    host: ${{ secrets.PORCH_HOST }}
    user: ${{ secrets.PORCH_USER }}
    ssh-key: ${{ secrets.PORCH_SSH_KEY }}
    service-id: my-app
    domain: my-app.example.com
    container: my-app-web
    port: "3000"
    image: ghcr.io/${{ github.repository }}:${{ github.sha }}
    deploy-path: /opt/my-app
```
