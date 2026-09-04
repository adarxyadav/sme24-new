import { describe, expect, it } from "vitest";
import { searchParamsToQuery } from "@/i18n/query";

describe("searchParamsToQuery (locale switch keeps the query string)", () => {
  it("maps single keys to strings and repeated keys to arrays", () => {
    const query = searchParamsToQuery(new URLSearchParams("page=2&status=open&status=closed"));
    expect(query).toEqual({ page: "2", status: ["open", "closed"] });
  });

  it("keeps a third value of a repeated key", () => {
    const query = searchParamsToQuery(new URLSearchParams("s=a&s=b&s=c"));
    expect(query).toEqual({ s: ["a", "b", "c"] });
  });

  it("returns an empty query without params or outside a router context", () => {
    expect(searchParamsToQuery(new URLSearchParams())).toEqual({});
    expect(searchParamsToQuery(null)).toEqual({});
    expect(searchParamsToQuery(undefined)).toEqual({});
  });
});
