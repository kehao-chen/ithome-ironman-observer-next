# Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | push to `main` (source changes), PR | lint, typecheck, test, build |
| `scheduled-update.yml` | `workflow_dispatch` from the Cloudflare Worker, every 15 min | incremental scrape → commit → deploy |
| `deep-calibrate.yml` | cron `15 */2 * * *`, plus `50 15 * * *` | full re-scrape; the 23:50 Taipei run also writes the daily history snapshot |

`ci.yml` ignores `data/**` so the ~96 scraper commits a day do not queue source checks.

## Secrets

### Repository secrets (GitHub → Settings → Secrets → Actions)

- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with `Cloudflare Pages — Edit`. Create at https://dash.cloudflare.com/profile/api-tokens.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account the Pages project lives in.
- The GitHub token is automatic (`permissions.contents.write`).

### Worker secrets (`worker/`, set with `wrangler secret put <NAME>`)

- `GITHUB_TOKEN`: fine-grained PAT with `actions:write` on this repo.
- `GITHUB_REPO`: `owner/name`.
- `DISPATCH_SECRET`: shared secret for `POST /dispatch`.

  **Required.** `POST /dispatch` fires a full scrape run, so it authenticates with
  `Authorization: Bearer <DISPATCH_SECRET>`; the endpoint returns 500 rather than
  dispatching if the secret is unset. Without it, anyone who guessed the
  `workers.dev` hostname could trigger unlimited Actions runs and hammer
  ithelp.ithome.com.tw from the runner IPs.

  ```sh
  cd worker
  # generate + store
  openssl rand -hex 32 | wrangler secret put DISPATCH_SECRET
  # manual trigger
  curl -X POST https://<worker-host>/dispatch -H "Authorization: Bearer $DISPATCH_SECRET"
  ```

  `GET /` stays public as an unauthenticated health check.

## History snapshots

`data/history/<year>/<taipei-date>.json` is an append-only archive; nothing in the
site reads it. It is written only when `scripts/scrape.ts` gets `--history`, which
happens once a day. Writing it on every run re-committed the same ~1.9MB file
about 96 times a day — the main driver of git history growth.

To take one by hand: run `deep-calibrate` via `workflow_dispatch` with the
`history` input checked.
