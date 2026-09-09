"use client";

import { useSyncExternalStore } from "react";
import { type Consent, readConsent } from "./consent";

/**
 * The browser's live view of the consent cookie (spec 0015, AC-3, AC-4). One store the bar and
 * the analytics gate both subscribe to, so pressing accept loads PostHog and withdrawing clears
 * it in the same tab without a reload. Browser only.
 */

const listeners = new Set<() => void>();

// The snapshot must be referentially stable between notifications: `useSyncExternalStore` compares
// with `Object.is` and would loop forever on a fresh object per read.
let snapshot: Consent = null;
let raw: string | null = null;

function read(): Consent {
  const cookieHeader = document.cookie;
  if (cookieHeader !== raw) {
    raw = cookieHeader;
    snapshot = readConsent(cookieHeader);
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-reads the cookie and wakes every subscriber. Call after a write. Browser. */
export function refreshConsent() {
  raw = null;
  read();
  for (const listener of listeners) listener();
}

// The server renders no answer, so the bar's server HTML is the hidden state and the gate loads
// nothing (AC-5): a visitor who already chose never sees the bar flash.
const serverSnapshot = (): Consent => null;

/** The current answer, or `null` while hydrating and whenever no current answer exists. Browser. */
export function useConsent(): Consent {
  return useSyncExternalStore(subscribe, read, serverSnapshot);
}

const subscribeNever = () => () => {};
const mountedOnClient = () => true;
const mountedOnServer = () => false;

/**
 * False while rendering on the server and through hydration, true afterwards. The bar needs it
 * because `useConsent` cannot tell "no answer yet" from "not read yet": both are `null`, and a bar
 * that showed on the second would flash on every load for a visitor who already chose (AC-5).
 * Browser.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribeNever, mountedOnClient, mountedOnServer);
}
