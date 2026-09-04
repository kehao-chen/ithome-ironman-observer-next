/**
 * ironman-observer-trigger
 *
 * Cloudflare Workers cron that fires the GitHub Actions `workflow_dispatch`
 * event for the ironman-observer-next update workflow. Replaces the unreliable
 * GitHub `schedule` trigger (which is delayed/dropped at the top of every hour)
 * with Cloudflare's network-scheduled cron — same zero-cost constraint.
 *
 * - Scheduled every 2 hours via wrangler.toml `[triggers]`.
 * - Skips dispatch while the latest workflow run is still queued/in_progress:
 *   prevents overlapping runs (each run takes ~2-5 min, well under the 2-hour
 *   interval, but a slow scrape must not stack a second run → push conflicts).
 * - `GET /` is a public health check (no secret required).
 * - `POST /dispatch` is a privileged manual trigger and REQUIRES
 *   `Authorization: Bearer <DISPATCH_SECRET>`. Without it anyone who guesses the
 *   workers.dev hostname could fire unlimited scrapes.
 *
 * Secrets: GITHUB_TOKEN (fine-grained PAT with `actions:write` on the repo),
 * GITHUB_REPO ("owner/name"), DISPATCH_SECRET (shared secret for POST /dispatch;
 * set with `wrangler secret put DISPATCH_SECRET`).
 */
import { authorizeDispatch } from "./auth";

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  DISPATCH_SECRET: string;
}

const WORKFLOW_FILE = "scheduled-update.yml";

async function dispatchWorkflow(env: Env): Promise<{ status: number; body: string }> {
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ironman-observer-trigger",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  return { status: res.status, body: await res.text() };
}

/** True when the most recent workflow run is queued or in progress. */
async function hasActiveRun(env: Env): Promise<boolean> {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`,
    { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "ironman-observer-trigger" } },
  );
  if (!res.ok) return false; // be permissive on read errors; dispatch will still validate
  const data = (await res.json()) as { workflow_runs?: { status: string }[] };
  const status = data.workflow_runs?.[0]?.status;
  return status === "queued" || status === "in_progress";
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (await hasActiveRun(env)) {
      // A run is still going — skip this tick rather than stacking a parallel
      // scrape (which races on `git push` and can trigger ithelp rate limits).
      console.log("skip: latest workflow run still active");
      return;
    }
    const { status, body } = await dispatchWorkflow(env);
    if (status === 204) return;
    // Non-2xx: surface via cron retry (CF retries failed scheduled events) and logs.
    throw new Error(`workflow_dispatch failed: HTTP ${status} ${body}`);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("ironman-observer-trigger OK", { status: 200 });
    }
    if (url.pathname === "/dispatch") {
      // Reject non-POST before authenticating so probes never reach the secret check.
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      const auth = await authorizeDispatch(request.headers.get("authorization"), env.DISPATCH_SECRET);
      if (!auth.ok) {
        return new Response(auth.message, { status: auth.status });
      }
      if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return new Response("missing secrets", { status: 500 });
      }
      const { status, body } = await dispatchWorkflow(env);
      return new Response(body, { status });
    }
    return new Response("not found", { status: 404 });
  },
};
