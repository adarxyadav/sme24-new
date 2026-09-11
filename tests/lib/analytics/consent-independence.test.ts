// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `src/lib/analytics/server.ts` is `server-only`, which throws on import outside a server
// component; the same neutralising mock the other server module suites use.
vi.mock("server-only", () => ({}));

/**
 * The claim the whole server side funnel rests on (spec 0017, AC-5, AC-8): the nine server events
 * fire whether or not the visitor accepted cookies, because they never touch the browser.
 *
 * `e2e/consent.spec.ts` proves the other half, that PostHog stays silent in the browser after a
 * rejection. Nothing proved this half, which is the more load bearing of the two: if it were false
 * the funnel would be biased by the consent rejection rate and nobody would see it, because a
 * missing event looks exactly like a client who did not act.
 *
 * Transmission cannot be proven on this machine (`NEXT_PUBLIC_POSTHOG_KEY` is empty locally, and a
 * capture that returns false on absence would pass against a broken build). So this suite pins the
 * structural claim instead, which is the one that can actually regress: the server capture path has
 * no way to read a consent answer, and it sends with a denied cookie present exactly as it does
 * with no cookie at all. The real risk is not a transport bug, it is someone later "fixing" the
 * funnel by threading a consent check into the server path to make the two halves agree.
 *
 * `covers: AC-5, AC-8`
 */

const posthog = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn(async () => undefined),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = posthog.capture;
    shutdown = posthog.shutdown;
  },
}));

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test" as string | undefined,
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.test" as string | undefined,
}));

vi.mock("@/lib/env", () => ({ serverEnv: () => env }));

const { captureServerEvent } = await import("@/lib/analytics/server");
const { CONSENT_COOKIE, consentCookieValue, readConsent, analyticsAllowed } = await import(
  "@/features/legal/consent"
);

const DISTINCT_ID = "11111111-1111-4111-8111-111111111111";

/** A valid `lookup.started` payload, the first step of the funnel and the one AC-5 names first. */
const LOOKUP = {
  organizationId: "22222222-2222-4222-8222-222222222222",
  companyId: "33333333-3333-4333-8333-333333333333",
  runId: "44444444-4444-4444-8444-444444444444",
  locale: "de",
} as const;

/**
 * The nine events AC-5 lists as server side and consent independent, each with a payload its own
 * schema accepts. Listed literally rather than derived from the catalogue: deriving the expectation
 * from the thing under test would assert nothing, and AC-5 names these nine specifically, which is
 * a different set from "every catalogued event" (`benchmark.viewed` is deliberately excluded, and
 * `expert.assigned` and `scaffold.test_event` are catalogued but are not funnel steps).
 */
const SERVER_EVENTS = [
  ["lookup.started", LOOKUP],
  [
    "research.finished",
    {
      organizationId: LOOKUP.organizationId,
      locale: "de",
      runId: LOOKUP.runId,
      status: "succeeded",
      kpiCount: 7,
      provider: "fixture",
      durationMs: 42_000,
    },
  ],
  [
    "benchmark.computed",
    {
      organizationId: LOOKUP.organizationId,
      locale: "de",
      companyId: LOOKUP.companyId,
      triggerKind: "research",
      kpisCompared: 5,
      modelVersion: "benchmark-model@3",
    },
  ],
  [
    "kpi.client_saved",
    {
      organizationId: LOOKUP.organizationId,
      locale: "de",
      companyId: LOOKUP.companyId,
      kpiKeysSent: 3,
      reportingYear: 2026,
    },
  ],
  [
    "kpi.client_cleared",
    {
      organizationId: LOOKUP.organizationId,
      locale: "de",
      companyId: LOOKUP.companyId,
      kpiKey: "lost_time_injury_rate",
    },
  ],
  [
    "checkout.started",
    {
      organizationId: LOOKUP.organizationId,
      locale: "de",
      orderId: "55555555-5555-4555-8555-555555555555",
      packageKey: "standard",
      grossRappen: 149_000,
    },
  ],
  [
    "payment.completed",
    {
      organizationId: LOOKUP.organizationId,
      locale: "de",
      orderId: "55555555-5555-4555-8555-555555555555",
      packageKey: "standard",
      grossRappen: 149_000,
      invoiceNumber: "2026-0001",
    },
  ],
  ["enquiry.sent", { locale: "de", topic: "retainer" }],
  ["expert.profile_completed", { locale: "de" }],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
});

describe("the server funnel does not depend on the consent answer (AC-5, AC-8)", () => {
  it("captures a lookup on a session that rejected analytics", async () => {
    // The rejected session, built the way the app itself reads one: a real denied cookie, parsed
    // by the real parser, confirmed to be a denial rather than merely an unparsed string.
    const cookieHeader = `${CONSENT_COOKIE}=${consentCookieValue("denied")}`;
    const consent = readConsent(cookieHeader);
    expect(consent?.choice).toBe("denied");
    expect(analyticsAllowed(consent)).toBe(false);

    // The browser gate is shut, and the server event fires anyway. That is the whole claim.
    await expect(
      captureServerEvent({ distinctId: DISTINCT_ID, event: "lookup.started", properties: LOOKUP }),
    ).resolves.toBe(true);

    expect(posthog.capture).toHaveBeenCalledWith(
      expect.objectContaining({ event: "lookup.started", distinctId: DISTINCT_ID }),
    );
  });

  it("captures all nine funnel events identically whatever the cookie says", async () => {
    // A funnel with one consent sensitive step would narrow at exactly that step and read as a
    // product problem rather than a measurement one, so every step is checked, not just the first.
    for (const [event, properties] of SERVER_EVENTS) {
      posthog.capture.mockClear();
      await expect(
        captureServerEvent({ distinctId: DISTINCT_ID, event, properties }),
        event,
      ).resolves.toBe(true);
      expect(posthog.capture, event).toHaveBeenCalledTimes(1);
    }
  });

  it("sends the same payload for a denied, a granted and an absent answer", async () => {
    // Not merely "it fires": it fires with identical properties. A capture that quietly dropped
    // `organizationId` when consent was denied would still pass a fires-or-not assertion while
    // making the German pilot client's rows unattributable.
    const payloads = [];
    for (const header of [
      `${CONSENT_COOKIE}=${consentCookieValue("denied")}`,
      `${CONSENT_COOKIE}=${consentCookieValue("granted")}`,
      undefined,
    ]) {
      // The header is read the way a request would read it, then deliberately not passed on:
      // there is nowhere to pass it, which is the point.
      readConsent(header);
      posthog.capture.mockClear();
      await captureServerEvent({
        distinctId: DISTINCT_ID,
        event: "lookup.started",
        properties: LOOKUP,
      });
      payloads.push(posthog.capture.mock.calls.at(0)?.[0]);
    }

    expect(payloads[0]).toEqual(payloads[1]);
    expect(payloads[1]).toEqual(payloads[2]);
  });
});

describe("the server capture path cannot read a consent answer (AC-5)", () => {
  it("neither the capture module nor the catalogue imports the consent module", async () => {
    // The structural guard, and the reason this suite exists. Every assertion above would still
    // pass if someone threaded a consent check into `captureServerEvent` and defaulted it to
    // allowed; this fails the moment the import appears, which is when the decision is being made
    // rather than after the funnel has already been biased for a month.
    const root = path.join(process.cwd(), "src", "lib", "analytics");
    for (const file of ["server.ts", "catalogue.ts"]) {
      const source = await readFile(path.join(root, file), "utf8");
      expect(source, file).not.toContain("features/legal/consent");
      expect(source, file).not.toContain(CONSENT_COOKIE);
      // `cookies()` from `next/headers` would be the other way in: a server action's capture is a
      // request scoped call, so the cookie jar is reachable if anyone goes looking for it.
      expect(source, file).not.toContain("next/headers");
    }
  });
});
