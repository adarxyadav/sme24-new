import { sweepTestAccounts } from "./db";

/**
 * Playwright global setup and teardown: removes the test accounts and orphaned organizations an
 * earlier run left on the local stack (a timeout kills the worker before its cleanup runs), so
 * `pnpm test:db` finds only the seed afterwards. Playwright needs the default export here.
 */
export default async function sweep() {
  const { users, organizations } = await sweepTestAccounts();
  if (users > 0 || organizations > 0) {
    console.log(
      `[e2e] swept ${users} stale test account(s) and ${organizations} orphaned organization(s)`,
    );
  }
}
