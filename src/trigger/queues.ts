import { queue } from "@trigger.dev/sdk";

/**
 * The queues more than one task shares. A queue lives here rather than beside the first task that
 * used it so a second task can join it without importing that task's module, which would pull its
 * whole dependency graph (and its `server-only` imports) into every caller. Task only.
 */

/**
 * The research queue: five runs at a time across the project (spec 0007, AC-4). Both the client
 * research run and the peer search of spec 0022 sit on it, so a burst of research cannot open more
 * than five provider runs at once whichever kind they are.
 */
export const researchQueue = queue({ name: "research", concurrencyLimit: 5 });
