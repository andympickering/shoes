const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { NextRequest } = require("next/server");
const { AuthRetryableFetchError } = require("@supabase/supabase-js");

function loadMiddleware(dependencies = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "middleware.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
    module,
    module.exports
  );
  return module.exports.middleware;
}

test("site authentication redirects signed-out visitors and protects APIs", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";

  try {
    const middleware = loadMiddleware();
    const page = await middleware(new NextRequest("https://example.com/articles/123?filter=test"));
    assert.equal(page.status, 307);
    const location = new URL(page.headers.get("location"));
    assert.equal(location.pathname, "/login");
    assert.equal(location.searchParams.get("next"), "/articles/123?filter=test");

    const api = await middleware(new NextRequest("https://example.com/api/articles"));
    assert.equal(api.status, 401);
    assert.equal((await api.json()).error, "Sign in to access this resource.");
    assert.equal((await middleware(new NextRequest("https://example.com/login"))).status, 200);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});

test("verified users pass through and authentication outages fail closed", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  let result = { data: { user: { id: "user-id" } }, error: null };
  const middleware = loadMiddleware({
    "@supabase/ssr": {
      createServerClient: () => ({ auth: { getUser: async () => result } }),
    },
  });

  try {
    assert.equal((await middleware(new NextRequest("https://example.com/"))).status, 200);
    result = {
      data: { user: null },
      error: new AuthRetryableFetchError("Authentication unavailable", 503),
    };
    const response = await middleware(new NextRequest("https://example.com/"));
    assert.equal(response.status, 503);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});
