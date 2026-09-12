"use client";

import { createContext, useContext, useState } from "react";

type DirectoryState = {
  readonly balance: number;
  readonly setBalance: (balance: number) => void;
};

const DirectoryContext = createContext<DirectoryState | null>(null);

/**
 * The one piece of state the directory page shares between the header and the rows: the
 * caller's credit balance, seeded from the server read and moved by an unlock in the click
 * handler that awaited it (spec 0018, AC-12), so the header badge changes the moment a row is
 * revealed and no `useEffect` watches an action result. Browser.
 */
export function DirectoryProvider({
  balance: initial,
  children,
}: {
  readonly balance: number;
  readonly children: React.ReactNode;
}) {
  const [balance, setBalance] = useState(initial);
  return (
    <DirectoryContext.Provider value={{ balance, setBalance }}>
      {children}
    </DirectoryContext.Provider>
  );
}

/** The shared balance and its setter; throws outside the provider, which is a wiring bug. */
export function useDirectoryBalance(): DirectoryState {
  const state = useContext(DirectoryContext);
  if (!state) throw new Error("useDirectoryBalance needs a DirectoryProvider above it");
  return state;
}
