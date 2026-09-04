/** The `query` shape next-intl's `Link` and router accept beside a pathname. */
export type Query = Readonly<Record<string, string | readonly string[]>>;

/**
 * Turns URL search params into the `query` object for a next-intl href, so a locale switch keeps
 * the current query string; a repeated key becomes an array. `null` (no router context) yields an
 * empty query. Pure, runs anywhere.
 */
export function searchParamsToQuery(params: URLSearchParams | null | undefined): Query {
  if (!params) return {};
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      const [first] = values;
      return [key, values.length === 1 && first !== undefined ? first : values];
    }),
  );
}
