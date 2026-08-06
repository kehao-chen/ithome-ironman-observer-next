/**
 * ironman-observer-trigger
 *
 * Cloudflare Workers cron that fires the GitHub Actions `workflow_dispatch`
 * event for the ironman-observer-next update workflow. Replaces the unreliable
 * GitHub `schedule` trigger (which is delayed/dropped at the top of every hour)
 * with Cloudflare's network-scheduled cron — same zero-cost constraint.
 *
 * - Scheduled every 10 minutes via wrangler.toml `[triggers]`.
 * - Deduplicates by workflow `run_number`: a given run is dispatched at most
 *   once even if the cron fires while a run is already queued/running.
 * - `GET /` is a public health check (no secret required).
 *
 * Secrets: GITHUB_TOKEN (fine-grained PAT with `actions:write` on the repo),
 * GITHUB_REPO ("owner/name").
 */
interface Env {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
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

async function latestRunNumber(env: Env): Promise<number> {
  const res = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`,
    { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "ironman-observer-trigger" } },
  );
  if (!res.ok) return 0;
  const data = (await res.json()) as { workflow_runs?: { run_number: number }[] };
  return data.workflow_runs?.[0]?.run_number ?? 0;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Re-dispatch on failure, but never overlap runs: a retry only re-fires if
    // the latest run is still the one we dispatched (no newer run started).
    const current = await latestRunNumber(env);
    const target = current + 1;
    const { status, body } = await dispatchWorkflow(env);
    if (status === 204) {
      ctx.waitUntil(
        (async () => {
          for (let i = 0; i < 10; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            if ((await latestRunNumber(env)) >= target) return;
          }
        })(),
      );
      return;
    }
    // Non-2xx: surface via cron retry (CF retries failed scheduled events) and logs.
    throw new Error(`workflow_dispatch failed: HTTP ${status} ${body}`);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("ironman-observer-trigger OK", { status: 200 });
    }
    if (url.pathname === "/dispatch" && request.method === "POST") {
      if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
        return new Response("missing secrets", { status: 500 });
      }
      const { status, body } = await dispatchWorkflow(env);
      return new Response(body, { status });
    }
    return new Response("not found", { status: 404 });
  },
};
