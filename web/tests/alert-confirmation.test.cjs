const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function load(relativePath, dependencies) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    module,
    module.exports
  );
  return module.exports;
}

class MockResponse {
  constructor(body, options) {
    this.body = body;
    this.status = options?.status ?? 200;
    this.headers = options?.headers;
  }
  static json(body, options) { return new MockResponse(body, options); }
}

test("confirmation requires a POST, handles repeated confirmation and rejects removed recipients", async () => {
  const token = "00000000-0000-0000-0000-000000000001";
  let confirmed = false;
  let removed = false;
  let updates = 0;
  let updating = false;
  const query = {
    update() { updates++; updating = true; return this; },
    eq(_column, value) { assert.equal(value, token); return this; },
    is() { return this; },
    select() { return this; },
    async maybeSingle() {
      if (removed) return { data: null, error: null };
      if (updating) {
        updating = false;
        if (confirmed) return { data: null, error: null };
        confirmed = true;
      }
      return { data: { subscription_id: "id" }, error: null };
    },
  };
  const previous = process.env.SUPABASE_SERVICE_KEY;
  process.env.SUPABASE_SERVICE_KEY = "test-key";
  try {
    const route = load("app/api/alerts/confirm/route.ts", {
      "next/server": { NextResponse: MockResponse },
      "@/lib/supabase-admin": { supabaseAdmin: { from: () => query } },
    });
    const landing = await route.GET({ url: `https://example.com/api/alerts/confirm?token=${token}` });
    assert.equal(landing.status, 200);
    assert.match(landing.body, /method="post"/);
    assert.equal(updates, 0);
    const request = { formData: async () => new Map([["token", token]]) };
    assert.equal((await route.POST(request)).status, 200);
    assert.equal((await route.POST(request)).status, 200);
    removed = true;
    assert.equal((await route.POST(request)).status, 404);
    assert.equal((await route.POST({ formData: async () => new Map([["token", "bad"]]) })).status, 400);
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = previous;
  }
});

test("confirmation invitations are individual and failures are surfaced", async () => {
  const names = ["RESEND_API_KEY", "ALERTS_FROM_EMAIL", "ALERTS_SITE_URL"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = global.fetch;
  Object.assign(process.env, {
    RESEND_API_KEY: "test-key",
    ALERTS_FROM_EMAIL: "alerts@example.com",
    ALERTS_SITE_URL: "https://example.com",
  });
  let messages;
  try {
    const admin = {
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          async is() { return { data: [{ email: "one@example.com" }, { email: "two@example.com" }], error: null }; },
        };
      },
      async rpc(_name, args) {
        return { data: [{ email: args.p_email, confirmation_token: "token", search_terms: "<test>" }], error: null };
      },
    };
    let succeeds = true;
    global.fetch = async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails/batch");
      messages = JSON.parse(options.body);
      return { ok: succeeds, status: 500 };
    };
    const { sendPendingConfirmations } = load("lib/alert-confirmation.ts", {
      "@/lib/supabase-admin": { supabaseAdmin: admin },
    });
    assert.deepEqual(await sendPendingConfirmations("id", "owner"), []);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages[0].to, ["one@example.com"]);
    assert.deepEqual(messages[1].to, ["two@example.com"]);
    assert.match(messages[0].html, /&lt;test&gt;/);
    assert.match(messages[0].text, /https:\/\/example.com\/api\/alerts\/confirm\?token=token/);
    succeeds = false;
    assert.deepEqual(await sendPendingConfirmations("id", "owner"), ["one@example.com", "two@example.com"]);
  } finally {
    global.fetch = previousFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
