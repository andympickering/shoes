import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { getSafeRedirectPath } from "@/lib/auth-redirect";

function isSupportedOtpType(value: string | null): value is "invite" | "recovery" {
  return value === "invite" || value === "recovery";
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const otpType = requestUrl.searchParams.get("type");
  const next = getSafeRedirectPath(
    requestUrl.searchParams.get("next"),
    requestUrl.origin
  );
  const destination =
    otpType === "invite" || otpType === "recovery"
      ? `/set-password?next=${encodeURIComponent(next)}`
      : next;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Authentication is not configured on the server." },
      { status: 503 }
    );
  }

  if (!tokenHash || !isSupportedOtpType(otpType)) {
    return NextResponse.redirect(new URL("/login?error=invalid-link", requestUrl.origin));
  }

  let response = NextResponse.redirect(new URL(destination, requestUrl.origin));
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.redirect(new URL(destination, requestUrl.origin));
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: otpType,
  });
  if (error) {
    console.error("Could not verify authentication link:", error);
    return NextResponse.redirect(new URL("/login?error=invalid-link", requestUrl.origin));
  }

  response.headers.set("Cache-Control", "no-store");
  return response;
}
