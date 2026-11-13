const ACTIVE_STATUSES = ["queued", "in_progress", "requested", "waiting", "pending"];
const INTERVAL_MS = 24 * 60 * 60 * 1000;

async function isDue({ env, fetch, now = Date.now() }) {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SOURCE, JOB_TYPE } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SOURCE || !JOB_TYPE) {
    throw new Error("Missing discovery scheduler configuration");
  }

  const url = new URL("/rest/v1/chnscraping_crawl_jobs", SUPABASE_URL);
  url.search = new URLSearchParams({
    select: "id",
    source: `eq.${SOURCE}`,
    job_type: `eq.${JOB_TYPE}`,
    crawl_type: "eq.discovery",
    started_at: `gt.${new Date(now - INTERVAL_MS).toISOString()}`,
    limit: "1",
  }).toString();
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    throw new Error(`Supabase crawl history request failed (${response.status}): ${(await response.text()).slice(0, 1000)}`);
  }
  const jobs = await response.json();
  if (!Array.isArray(jobs)) {
    throw new Error("Supabase crawl history response was not an array");
  }
  return jobs.length === 0;
}

async function scheduleDiscovery({ github, context, core, env, fetch, now = Date.now() }) {
  const { SOURCE, WORKFLOW } = env;
  if (!WORKFLOW) {
    throw new Error("Missing discovery workflow");
  }
  if (!await isDue({ env, fetch, now })) {
    core.info(`${SOURCE} discovery started less than 24 hours ago.`);
    return;
  }

  for (const status of ACTIVE_STATUSES) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...context.repo,
      workflow_id: WORKFLOW,
      status,
      per_page: 1,
    });
    if (data.workflow_runs.length) {
      core.info(`${SOURCE} discovery already has a ${status} workflow run.`);
      return;
    }
  }

  await github.rest.actions.createWorkflowDispatch({
    ...context.repo,
    workflow_id: WORKFLOW,
    ref: context.ref.replace(/^refs\/heads\//, ""),
    inputs: { enforce_interval: "true" },
  });
  core.info(`Dispatched ${SOURCE} discovery.`);
}

module.exports = scheduleDiscovery;
module.exports.isDue = isDue;
