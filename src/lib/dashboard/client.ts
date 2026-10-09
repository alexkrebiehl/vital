// ── Dashboard cards: the browser's reads and writes ─────
//
// Everything the Dashboard page asks the server for. Every request is
// same-origin; the browser never sends a mode (the server decides it). A
// failure is reported as the route's own message, never as an empty dashboard.
// A 409 exposes the card as it is now on `error.current`.

import type { CardRecord, CardSize } from './types';

export class DashboardRequestError extends Error {
  /** The card as it is now, when the route refused a stale revision. */
  current?: CardRecord;
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DashboardRequestError';
  }
}

/** What a create sends; an edit sends the same without a type. */
export interface CardInput {
  type: string;
  spec: unknown;
  size?: CardSize;
}
export type CardEditInput = Omit<CardInput, 'type'>;

export interface DashboardResponse {
  mode: 'demo' | 'live';
  cards: CardRecord[];
  limits: { maxCards: number };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const obj = body && typeof body === 'object' ? (body as { error?: unknown; card?: unknown }) : {};
    const error = new DashboardRequestError(
      typeof obj.error === 'string' ? obj.error : `The request failed (HTTP ${res.status}).`,
      res.status
    );
    if (res.status === 409 && obj.card && typeof obj.card === 'object') error.current = obj.card as CardRecord;
    throw error;
  }
  return body as T;
}

const COLLECTION = '/api/dashboard/cards';

export function fetchDashboard(): Promise<DashboardResponse> {
  return request<DashboardResponse>(COLLECTION);
}

export async function createCardRequest(input: CardInput): Promise<CardRecord> {
  return (await request<{ card: CardRecord }>(COLLECTION, { method: 'POST', body: JSON.stringify(input) })).card;
}

export async function replaceCardRequest(id: string, input: CardEditInput, revision: number): Promise<CardRecord> {
  return (
    await request<{ card: CardRecord }>(`${COLLECTION}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, revision }),
    })
  ).card;
}

export async function deleteCardRequest(id: string, revision: number): Promise<void> {
  await request(`${COLLECTION}/${encodeURIComponent(id)}?revision=${revision}`, { method: 'DELETE' });
}

export async function reorderCardsRequest(order: string[]): Promise<CardRecord[]> {
  return (await request<{ cards: CardRecord[] }>(COLLECTION, { method: 'PUT', body: JSON.stringify({ order }) })).cards;
}
