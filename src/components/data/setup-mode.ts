'use client';

// The live-read failure while the app is in setup mode, shared by the gate (which
// provides it) and Settings (which shows it above its tabs). Null means the app
// is not in setup mode: demo mode, or live mode with a working source.

import { createContext, useContext } from 'react';

export interface SetupFailure {
  /** Short headline. */
  title: string;
  /** What failed, in plain language. */
  message: string;
  /** Host being read, or null when unconfigured. */
  host: string | null;
  /** Optional extra context (a remediation hint). */
  hint?: string;
}

export const SetupFailureContext = createContext<SetupFailure | null>(null);

export function useSetupFailure(): SetupFailure | null {
  return useContext(SetupFailureContext);
}
