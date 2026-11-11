const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function loadTypeScript(relativePath, dependencies = {}) {
  const filename = path.join(__dirname, "..", "src", relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (name) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return require(name);
  };
  new Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return module.exports;
}

const articleSearch = loadTypeScript("lib/article-search.ts");
const validation = loadTypeScript("lib/alert-validation.ts", {
  "@/lib/article-search": articleSearch,
});
const schedule = loadTypeScript("lib/alert-schedule.ts");
const settings = {
  searchTerms: "china",
  timeSpan: "last_week",
  frequency: "daily",
  deliveryTimeUtc: "09:00",
  emails: "reader@example.com",
  consent: true,
};
const nextServer = {
  NextResponse: {
    json: (body, options) => ({ body, status: options?.status ?? 200 }),
  },
};

test("validates the article limit as an integer from 1 to 100", () => {
  for (const maxArticles of [1, 25, 100]) {
    assert.equal(validation.validateAlertSettings({ ...settings, maxArticles }).settings.maxArticles, maxArticles);
  }
  for (const maxArticles of [undefined, null, "", "25", 0, -1, 1.5, 101]) {
    assert.match(validation.validateAlertSettings({ ...settings, maxArticles }).error, /whole number between 1 and 100/);
  }
});

test("creation and editing persist the selected article limit", async () => {
  let created;
  let updated;
  let selected;
  const query = {
    select(columns) { selected = columns; return this; },
    eq() { return this; },
    order() { return Promise.resolve({ data: [], error: null }); },
    update(values) { updated = values; return this; },
    maybeSingle() { return Promise.resolve({ data: { id: "alert" }, error: null }); },
  };
  const admin = {
    from() { return query; },
    rpc(name, values) {
      created = { name, values };
      return Promise.resolve({ data: "alert", error: null });
    },
  };
  const dependencies = {
    "next/server": nextServer,
    "@/lib/alert-auth": { getAlertUserId: async () => "user" },
    "@/lib/alert-schedule": schedule,
    "@/lib/alert-validation": validation,
    "@/lib/supabase-admin": { supabaseAdmin: admin },
  };
  const previousKey = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_SERVICE_KEY = "test-key";
  try {
    const createRoute = loadTypeScript("app/api/alerts/route.ts", dependencies);
    const editRoute = loadTypeScript("app/api/alerts/[id]/route.ts", dependencies);
    const request = {
      headers: new Headers(),
      json: async () => ({ ...settings, maxArticles: 42 }),
    };
    assert.equal((await createRoute.POST(request)).status, 201);
    assert.equal(created.name, "chnscraping_create_alert_subscription");
    assert.equal(created.values.p_max_articles, 42);
    assert.equal((await createRoute.GET(request)).status, 200);
    assert.match(selected, /\bmax_articles\b/);
    assert.equal((await editRoute.PATCH(request, {
      params: { id: "00000000-0000-0000-0000-000000000001" },
    })).status, 200);
    assert.equal(updated.max_articles, 42);
  } finally {
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previousKey;
  }
});

test("delivery searches and renders no more than each alert's configured limit", async () => {
  const names = ["ALERTS_CRON_SECRET", "SUPABASE_SERVICE_KEY", "RESEND_API_KEY", "ALERTS_FROM_EMAIL", "ALERTS_SITE_URL"];
  const previousEnvironment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = global.fetch;
  Object.assign(process.env, {
    ALERTS_CRON_SECRET: "test-secret",
    SUPABASE_SERVICE_KEY: "test-key",
    RESEND_API_KEY: "test-key",
    ALERTS_FROM_EMAIL: "alerts@example.com",
    ALERTS_SITE_URL: "https://example.com",
  });
  try {
    for (const [limit, total] of [[1, 120], [25, 120], [100, 120], [25, 3], [25, 0]]) {
      let requestedLimit;
      let email;
      const expectedArticles = Math.min(limit, total);
      const results = Array.from({ length: expectedArticles }, (_, index) => ({
        id: String(index),
        source: "Source",
        headline: `Headline ${index}`,
        display_date: "2026-01-01",
        total_count: total,
      }));
      const alert = {
        subscription_id: "alert",
        unsubscribe_token: "token",
        search_terms: "china",
        time_span: "last_week",
        frequency: "daily",
        schedule_day: 1,
        emails: ["reader@example.com"],
        next_delivery_at: "2026-01-01T09:00:00Z",
        lock_expires_at: "2026-01-01T09:15:00Z",
        max_articles: limit,
      };
      const admin = {
        async rpc(name, args) {
          if (name === "chnscraping_claim_due_alerts") return { data: [alert], error: null };
          requestedLimit = args.result_page_size;
          return { data: results, error: null };
        },
        from(table) {
          if (table === "chnscraping_articles") {
            return {
              select() { return this; },
              async in() {
                return { data: results.map(({ id }) => ({ id, url: `https://example.com/${id}` })), error: null };
              },
            };
          }
          return {
            update() { return this; },
            eq() { return this; },
            then(resolve) { resolve({ error: null }); },
          };
        },
      };
      global.fetch = async (_url, options) => {
        email = JSON.parse(options.body);
        return { ok: true };
      };
      const route = loadTypeScript("app/api/alerts/send/route.ts", {
        "next/server": nextServer,
        "@/lib/article-search": articleSearch,
        "@/lib/alert-schedule": schedule,
        "@/lib/supabase-admin": { supabaseAdmin: admin },
      });
      const response = await route.POST({ headers: new Headers({ authorization: "Bearer test-secret" }) });
      assert.deepEqual(response.body, { processed: 1, sent: total > 0 ? 1 : 0 });
      assert.equal(requestedLimit, limit);
      if (total === 0) {
        assert.equal(email, undefined);
        continue;
      }
      assert.equal((email.html.match(/<li /g) ?? []).length, expectedArticles);
      assert.equal((email.text.match(/^- Headline /gm) ?? []).length, expectedArticles);
      if (total > limit) {
        assert.match(email.text, new RegExp(`Showing ${limit} of ${total} matching articles`));
      } else {
        assert.doesNotMatch(email.text, /Showing .* matching articles/);
      }
    }
  } finally {
    global.fetch = previousFetch;
    for (const name of names) {
      if (previousEnvironment[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnvironment[name];
    }
  }
});
