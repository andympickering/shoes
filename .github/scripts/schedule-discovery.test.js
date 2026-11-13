const assert = require("node:assert/strict");
const { test } = require("node:test");
const scheduleDiscovery = require("./schedule-discovery.js");

const now = Date.parse("2026-11-13T12:00:00Z");
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_KEY: "test-key",
  SOURCE: "people",
  JOB_TYPE: "weekly",
  WORKFLOW: "people-sitemap.yml",
};

function setup(rows = [], activeStatus = null) {
  const calls = [];
  const dispatches = [];
  return {
    calls,
    dispatches,
    options: {
      now,
      env,
      context: { repo: { owner: "owner", repo: "repo" }, ref: "refs/heads/main" },
      core: { info: () => {} },
      fetch: async (url) => {
        calls.push(url);
        const params = url.searchParams;
        const filtered = rows.filter((row) =>
          `eq.${row.source}` === params.get("source") &&
          `eq.${row.job_type}` === params.get("job_type") &&
          `eq.${row.crawl_type}` === params.get("crawl_type") &&
          Date.parse(row.started_at) > Date.parse(params.get("started_at").slice(3))
        );
        return { ok: true, json: async () => filtered };
      },
      github: { rest: { actions: {
        listWorkflowRuns: async ({ status }) => ({
          data: { workflow_runs: status === activeStatus ? [{}] : [] },
        }),
        createWorkflowDispatch: async (args) => { dispatches.push(args); },
      } } },
    },
  };
}

function row(source, job_type, crawl_type, started_at) {
  return { source, job_type, crawl_type, started_at };
}

test("dispatches at 24 hours, but not before", async () => {
  for (const [startedAt, expected] of [
    ["2026-11-12T12:00:00.001Z", 0],
    ["2026-11-12T12:00:00.000Z", 1],
    ["2026-11-12T11:59:59.999Z", 1],
  ]) {
    const state = setup([row("people", "weekly", "discovery", startedAt)]);
    await scheduleDiscovery(state.options);
    assert.equal(state.dispatches.length, expected, startedAt);
  }
});

test("uses publisher and sitemap job type, ignoring RSS and extraction", async () => {
  const state = setup([
    row("bjnews", "daily", "discovery", "2026-11-13T11:00:00Z"),
    row("people", "hourly", "discovery", "2026-11-13T11:00:00Z"),
    row("people", "weekly", "extraction", "2026-11-13T11:00:00Z"),
  ]);
  await scheduleDiscovery(state.options);
  assert.equal(state.dispatches.length, 1);
  assert.equal(state.dispatches[0].workflow_id, "people-sitemap.yml");
  assert.equal(state.dispatches[0].ref, "main");
  assert.deepEqual(state.dispatches[0].inputs, { enforce_interval: "true" });

  state.options.env = { ...env, SOURCE: "bjnews", JOB_TYPE: "daily", WORKFLOW: "bjnews-sitemap.yml" };
  await scheduleDiscovery(state.options);
  assert.equal(state.dispatches.length, 1);
});

test("does not dispatch while discovery is active", async () => {
  for (const status of ["queued", "in_progress", "requested", "waiting", "pending"]) {
    const state = setup([], status);
    await scheduleDiscovery(state.options);
    assert.equal(state.dispatches.length, 0, status);
  }
});

test("rechecks the interval when a dispatched workflow starts", async () => {
  const state = setup([row("people", "weekly", "discovery", "2026-11-13T11:00:00Z")]);
  assert.equal(await scheduleDiscovery.isDue(state.options), false);
  state.options.env = { ...env, SOURCE: "bjnews", JOB_TYPE: "daily" };
  assert.equal(await scheduleDiscovery.isDue(state.options), true);
});

test("surfaces Supabase errors instead of dispatching", async () => {
  const state = setup();
  state.options.fetch = async () => ({ ok: false, status: 503, text: async () => "unavailable" });
  await assert.rejects(scheduleDiscovery(state.options), /503.*unavailable/);
  assert.equal(state.dispatches.length, 0);
});
