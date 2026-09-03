import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { clientEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * The request proxy: reads cookies from the request and writes refreshed ones onto the response
 * that will be returned (the one next-intl produced), so the browser keeps a fresh session.
 */
export function createProxyClient(request: NextRequest, response: NextResponse) {
  const env = clientEnv();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );
}
