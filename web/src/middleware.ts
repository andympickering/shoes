import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const publicPaths = new Set([
  "/login",
  "/auth/callback",
  "/api/alerts/send",
  "/api/alerts/confirm",
  "/api/alerts/unsubscribe",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.has(pathname)) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Authentication is not configured on the server." },
      { status: 503 }
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data, error } = await supabase.auth.getUser();
  if (error && !isAuthSessionMissingError(error)) {
    console.error("Could not verify site login:", error);
    return NextResponse.json(
      { error: "Could not verify your login. Please try again." },
      { status: 503 }
    );
  }
  if (data.user) return response;

  if (pathname.startsWith("/api/")) {
    const unauthorized = NextResponse.json(
      { error: "Sign in to access this resource." },
      { status: 401 }
    );
    response.cookies.getAll().forEach((cookie) => unauthorized.cookies.set(cookie));
    return unauthorized;
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  const redirectResponse = NextResponse.redirect(loginUrl);
  response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
  return redirectResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico$|mao-banner\\.png$).*)"],
};
