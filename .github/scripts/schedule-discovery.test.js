const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const scheduleDiscovery = require("./schedule-discovery.js");

function setup(activeStatus = null) {
  const dispatches = [];
  let historyRequests = 0;
  return {
    dispatches,
    get historyRequests() { return historyRequests; },
    options: {
      env: { SOURCE: "people", WORKFLOW: "people-sitemap.yml" },
      context: { repo: { owner: "owner", repo: "repo" }, ref: "refs/heads/main" },
      core: { info: () => {} },
      fetch: async () => {
        historyRequests++;
        return { ok: true, json: async () => [{ id: 1 }] };
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

test("dispatches without checking recent crawl history", async () => {
  const state = setup();
  await scheduleDiscovery(state.options);
  assert.equal(state.historyRequests, 0);
  assert.deepEqual(state.dispatches, [{
    owner: "owner",
    repo: "repo",
    workflow_id: "people-sitemap.yml",
    ref: "main",
  }]);
});

test("does not dispatch while discovery is active", async () => {
  for (const status of ["queued", "in_progress", "requested", "waiting", "pending"]) {
    const state = setup(status);
    await scheduleDiscovery(state.options);
    assert.equal(state.dispatches.length, 0, status);
  }
});

test("surfaces GitHub errors instead of dispatching", async () => {
  const state = setup();
  state.options.github.rest.actions.listWorkflowRuns = async () => {
    throw new Error("GitHub unavailable");
  };
  await assert.rejects(scheduleDiscovery(state.options), /GitHub unavailable/);
  assert.equal(state.dispatches.length, 0);
});

test("discovery workflows do not enforce a crawl interval", () => {
  for (const file of [
    "people-sitemap.yml",
    "bjnews-sitemap.yml",
    "gmw-sitemap.yml",
    "cankaoxiaoxi-search.yml",
  ]) {
    const workflow = readFileSync(join(__dirname, "..", "workflows", file), "utf8");
    assert.doesNotMatch(workflow, /enforce_interval|steps\.interval|Check discovery interval/, file);
  }
});
