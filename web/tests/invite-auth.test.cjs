const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { NextRequest } = require("next/server");
const { AuthRetryableFetchError } = require("@supabase/supabase-js");

function load(relativePath, dependencies = {}) {
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

async function withBrowser(url, setSession, run, dependencies = {}) {
  const previousWindow = global.window;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const location = new URL(url);
  const redirects = [];
  location.replace = (destination) => redirects.push(destination);
  global.window = {
    location,
    history: {
      state: null,
      replaceState(_state, _title, destination) {
        location.href = new URL(destination, location).href;
      },
    },
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";

  try {
    const authRedirect = load("lib/auth-redirect.ts");
    const browser = load("lib/supabase-browser.ts", {
      "@/lib/auth-redirect": authRedirect,
      "@supabase/ssr": {
        createBrowserClient: () => {
          assert.equal(location.hash, "");
          return { auth: { setSession } };
        },
      },
      ...dependencies,
    });
    await run(browser, redirects);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
}

test("invite and recovery fragments establish a session before password setup", async () => {
  for (const type of ["invite", "recovery"]) {
    let calls = 0;
    await withBrowser(
      `https://example.com/login?next=%2Farticles%2F123#access_token=access&refresh_token=refresh&type=${type}`,
      async (tokens) => {
        calls++;
        assert.deepEqual(tokens, { access_token: "access", refresh_token: "refresh" });
        return { data: { session: {} }, error: null };
      },
      async ({ handleAuthLink }, redirects) => {
        assert.deepEqual(await Promise.all([handleAuthLink(), handleAuthLink()]), [true, true]);
        assert.equal(calls, 1);
        assert.deepEqual(redirects, ["/set-password?next=%2Farticles%2F123"]);
      }
    );
  }
});

test("expired links show an error instead of using an existing session", async () => {
  await withBrowser(
    "https://example.com/login#error_code=otp_expired&error_description=expired",
    () => assert.fail("an expired link must not establish a session"),
    async ({ handleAuthLink }, redirects) => {
      assert.equal(await handleAuthLink(), true);
      assert.deepEqual(redirects, ["/login?error=invalid-link"]);
    }
  );
});

test("authentication service failures are not reported as expired links", async () => {
  await withBrowser(
    "https://example.com/#access_token=access&refresh_token=refresh&type=invite",
    async () => ({
      data: { session: null },
      error: new AuthRetryableFetchError("Service unavailable", 503),
    }),
    async ({ handleAuthLink }, redirects) => {
      assert.equal(await handleAuthLink(), true);
      assert.deepEqual(redirects, ["/login?error=auth-unavailable"]);
    }
  );
});

test("ordinary visits do not change the session or redirect", async () => {
  await withBrowser(
    "https://example.com/login",
    () => assert.fail("an ordinary visit must not establish a session"),
    async ({ handleAuthLink }, redirects) => {
      assert.equal(await handleAuthLink(), false);
      assert.deepEqual(redirects, []);
    }
  );
});

test("password setup emails use a separate implicit recovery client", async () => {
  let requests = 0;
  await withBrowser(
    "https://example.com/login",
    () => assert.fail("requesting recovery must not change the current session"),
    async ({ sendPasswordSetupEmail }) => {
      await sendPasswordSetupEmail("invited@example.com");
      assert.equal(requests, 1);
    },
    {
      "@supabase/supabase-js": {
        ...require("@supabase/supabase-js"),
        createClient(url, key, options) {
          assert.equal(url, "https://example.supabase.co");
          assert.equal(key, "test-key");
          assert.deepEqual(options.auth, {
            flowType: "implicit",
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          });
          return {
            auth: {
              async resetPasswordForEmail(email, options) {
                requests++;
                assert.equal(email, "invited@example.com");
                assert.equal(options.redirectTo, "https://example.com/");
                return { error: null };
              },
            },
          };
        },
      },
    }
  );
});

test("an invite cannot redirect password setup to an external site", async () => {
  await withBrowser(
    "https://example.com/login?next=%2F%2Fevil.example#access_token=access&refresh_token=refresh&type=invite",
    async () => ({ data: { session: {} }, error: null }),
    async ({ handleAuthLink }, redirects) => {
      assert.equal(await handleAuthLink(), true);
      assert.deepEqual(redirects, ["/set-password?next=%2F"]);
    }
  );
});

test("the token-hash callback still establishes a session and redirects to password setup", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
  try {
    const { GET } = load("app/auth/callback/route.ts", {
      "@/lib/auth-redirect": load("lib/auth-redirect.ts"),
      "@supabase/ssr": {
        createServerClient: (_url, _key, options) => ({
          auth: {
            async verifyOtp(params) {
              assert.deepEqual(params, { token_hash: "invite-token", type: "invite" });
              options.cookies.setAll([{ name: "session", value: "session-value", options: { path: "/" } }]);
              return { error: null };
            },
          },
        }),
      },
    });
    const response = await GET(new NextRequest(
      "https://example.com/auth/callback?token_hash=invite-token&type=invite&next=%2Farticles%2F123"
    ));
    assert.equal(response.status, 307);
    assert.equal(response.headers.get("location"), "https://example.com/set-password?next=%2Farticles%2F123");
    assert.equal(response.cookies.get("session").value, "session-value");
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});
