import { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { queryError } from "@/lib/supabase/query-error";

// supabase-js types the `error` of a `{ data, error }` result as `PostgrestError` but hands back
// the parsed PostgREST body, a plain object, at runtime. Thrown as is it reaches the Next.js
// error boundary as "[object Object]" (code E394), which is what the `/app` dashboard showed.
describe("queryError", () => {
  it("wraps the plain object supabase-js returns into a real Error that keeps the PostgREST fields", () => {
    const raw = { message: "JWT expired", code: "PGRST301", details: null, hint: null };
    const error = queryError(raw);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(PostgrestError);
    expect(error.message).toBe("JWT expired");
    expect(error).toMatchObject({ code: "PGRST301", details: "", hint: "" });
    expect(String(error)).toContain("JWT expired");
  });

  it("keeps a body without PostgREST fields throwable", () => {
    const error = queryError({ message: "<html>502 Bad Gateway</html>" });
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("<html>502 Bad Gateway</html>");
  });

  it("returns an Error unchanged so identity and subclasses survive", () => {
    const original = new Error("connection reset");
    expect(queryError(original)).toBe(original);
  });
});
