/**
 * The keyset cursor of the ops lists (spec 0006, AC-9; spec 0009, AC-12): `created_at|id`
 * encoded as base64url, so a page link carries where the next page starts and a malformed value
 * falls back to the first page. Pure, server only (Buffer).
 */
export type Cursor = { readonly createdAt: string; readonly id: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encodes the keyset cursor `created_at|id` as base64url. Pure, server only. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

/** Decodes a cursor; a malformed value gives null (the first page). Pure, server only. */
export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return null;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!UUID_PATTERN.test(id) || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

/** True when `value` is a UUID, the shape of every row id. Pure. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The PostgREST `or` filter that continues a keyset page after `cursor`, for a list ordered by
 * `created_at desc, id desc`. Pure.
 */
export function afterCursorFilter(cursor: Cursor): string {
  return `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`;
}
