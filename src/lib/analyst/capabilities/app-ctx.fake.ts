// ── A capability context with every app reader faked ────────────────────────

import { appCtx } from './app.fake';
import { allReaders } from './app-state.fake';
import type { AppReaders } from './reads/app-readers';
import type { CapabilityContext } from './types';

/** The context of a get_app_data read: all readers working unless replaced. */
export function appCtxWith(readers: Partial<AppReaders> = allReaders(), over: Partial<CapabilityContext> = {}): CapabilityContext {
  return appCtx(readers, over);
}
