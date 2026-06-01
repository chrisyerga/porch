# Lindale App Redeployment Notes

`../lindale-infra` is retired input only. These notes capture how the existing Lindale apps should move onto the new Porch host-managed infrastructure.

## Shared Changes

- Replace the legacy external Docker network `edge` with `porch`.
- Let Porch generate or own the service compose file on the VPS via `service register --image --deploy-path`.
- Replace repeated SSH deploy scripts with either `npx @lindale/porch service register` or the thin Porch GitHub Action.
- Keep application-specific build, test, environment, and migration commands in each service repo.

## Services

| Repo | Service id | Domain | Container | Port | Kind |
| --- | --- | --- | --- | --- | --- |
| `../website` | `lindale` | `lindale.tech` | `lindale-web` | `80` | `static-astro` |
| `../lbbb` | `cafezoe` | `cafezoe.lol` | `cafezoe-web` | `3000` | `node` |
| `../kenzieskandles` | `kenzies` | `kenzieskandles.com` | `kenzies-web` | `4321` | `astro-node` |

## Example Registration Commands

```bash
npx @lindale/porch service register \
  --service-id lindale \
  --domain lindale.tech \
  --www-redirect \
  --container lindale-web \
  --port 80 \
  --image ghcr.io/chrisyerga/lindale-website:latest \
  --deploy-path /opt/lindale

npx @lindale/porch service register \
  --service-id cafezoe \
  --domain cafezoe.lol \
  --www-redirect \
  --container cafezoe-web \
  --port 3000 \
  --image ghcr.io/chrisyerga/lbbb:latest \
  --deploy-path /opt/cafezoe \
  --env SITE_URL=https://cafezoe.lol

npx @lindale/porch service register \
  --service-id kenzies \
  --domain kenzieskandles.com \
  --www-redirect \
  --container kenzies-web \
  --port 4321 \
  --image ghcr.io/chrisyerga/kenzies-kandles:latest \
  --deploy-path /opt/kenzieskandles \
  --migration-command "node scripts/migrate.js"
```
