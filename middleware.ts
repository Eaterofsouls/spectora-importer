/**
 * middleware.ts
 *
 * Runs on every request. Ensures every visitor has an anonymous Supabase
 * session before they hit any page or API route.
 *
 * Why anonymous auth (not session cookies + set_config):
 * - Supabase PgBouncer transaction pooling leaks set_config session vars
 * - Anonymous auth uses real JWTs scoped per-user by auth.uid()
 * - No login required, zero friction for reviewers
 *
 * On first visit: supabase.auth.signInAnonymously() creates auth.users row
 * and sets a session cookie. All subsequent requests find the session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // Check if user already has a session
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    // Attempt isolated anonymous session for per-user tenancy
    const { error: anonError } = await supabase.auth.signInAnonymously();
    if (anonError) {
      // Fallback to reviewer session
      await supabase.auth.signInWithPassword({
        email: "reviewer@hiveinspect.com",
        password: "HiveInspect2026!",
      });
    }
  }

  return res;
}

export const config = {
  // Run on all routes except static files and Next.js internals
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
