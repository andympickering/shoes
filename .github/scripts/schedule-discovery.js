const ACTIVE_STATUSES = ["queued", "in_progress", "requested", "waiting", "pending"];

async function scheduleDiscovery({ github, context, core, env }) {
  const { SOURCE, WORKFLOW, DISPATCH_TOKEN } = env;
  if (!SOURCE || !WORKFLOW) {
    throw new Error("Missing discovery scheduler configuration");
  }
  if (!DISPATCH_TOKEN) {
    throw new Error("Missing DISCOVERY_DISPATCH_TOKEN repository secret");
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
  });
  core.info(`Dispatched ${SOURCE} discovery.`);
}

module.exports = scheduleDiscovery;
