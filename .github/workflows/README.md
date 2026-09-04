# Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | push to `main` (source changes), PR | lint, typecheck, test, build |
| `scheduled-update.yml` | `workflow_dispatch` from the Cloudflare Worker, every 2 hours | incremental scrape → commit → deploy |
| `deep-calibrate.yml` | cron `0 20 * * *` (daily 04:00 Taipei) | full re-scrape (re-reads every series page instead of the RSS fast path) |

`ci.yml` ignores `data/**` so the ~12 scraper commits a day do not queue source checks.

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
site reads it. It is written on every scrape run, and that is intentional.

It looks like waste — the file is keyed by Taipei date, so the 15-minute scraper
rewrites and re-commits the same ~1.9MB file about 96 times a day. It is not:
the snapshot is byte-identical to the `data/<year>.json` written in the same run,
so git content-addressing stores one shared blob, not two. Measured on the real
packed repository:

| path | packed size | blobs |
|---|---|---|
| `data/<year>.json` | 30.37 MiB | 2924 |
| `data/history/` | 1.26 MiB | 28 |
| everything else | 2.35 MiB | 529 |

A 15-minute cadence of full-dataset commits costs roughly 1 MB/day, ~30 MB per
season; a fresh clone is 38 MB and takes about 5 seconds. The snapshots are not
the driver, and gating them to once a day was tried and reverted: it saved no
space and introduced one chance per day to capture a snapshot, hung on a GitHub
`schedule` cron — the exact trigger this project abandoned as unreliable.
