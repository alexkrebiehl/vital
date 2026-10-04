// ── /api/analyst/stream (SPEC §8) ───────────────────────
//
// The streaming counterpart of POST /api/analyst. It runs the SAME validated,
// read-only service — the question is validated, retrieval selects the same
// context, and the assembled answer runs through the same parser and grounding
// audit — but the model's output is re-emitted to the browser as it is produced:
//
//   event: reasoning   the model's own working (display only, never an answer)
//   event: answer      fragments of the answer text
//   event: step        the answer text so far was not the answer: a plan tool is
//                      about to run ({tool}), or the reply is repaired ({tool:null})
//   event: result      ONE terminal frame: the finished response, the model
//                      attribution, the follow-ups, and what happened to the turn
//
// Re-emitting reasoning and answer as SEPARATE event types is the whole point:
// the UI styles them differently, and the answer is what gets validated. Raw
// reasoning is never promoted into an answer.
//
// The conversation store behaves exactly as the non-streaming route: the
// question and the answer that was ACTUALLY SHOWN are appended after the stream
// finishes, using the assembled response — never the partial frames. Nothing is
// saved when the question was refused.
//
// If the client disconnects, the upstream request is aborted, not left running.
// Responses are private and uncacheable: personal health context.

import { askAnalyst, streamAnalyst, publicConfigState, readAnalystConfig, validateQuery } from '@/lib/analyst';
import { appendExchange, memoryTurnsFor, resolveConversations } from '@/lib/analyst/conversations';
import { parsePageContextRef } from '@/lib/analyst/page-context-types';
import type { AnalystResponse } from '@/lib/analyst/types';
import type { UnitSystem } from '@/lib/prefs';
import { LiveDataUnavailableError, installDataset } from '@/lib/adapters/runtime';
import type { ProvenanceRow } from '@/lib/adapters/normalize';
import { tagResponse } from '@/lib/sources/tagging';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, private',
  Connection: 'keep-alive',
  // A proxy must not buffer the stream into one chunk, which would defeat it.
  'X-Accel-Buffering': 'no',
} as const;

/** Serialize one SSE frame. `\n\n` terminates it; JSON.stringify escapes newlines. */
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET() {
  // The same configuration STATE the non-streaming route reports, so a client
  // can tell whether a provider is configured before it asks.
  const state = publicConfigState(readAnalystConfig());
  return new Response(JSON.stringify(state), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'The request body must be JSON.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
    });
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const system: UnitSystem = raw.system === 'imperial' ? 'imperial' : 'metric';
  const { availability } = resolveConversations();

  let provenance: ProvenanceRow[] = [];
  try {
    provenance = (await installDataset()).meta.provenance;
  } catch (error) {
    const detail = error instanceof LiveDataUnavailableError ? error.detail : 'The dataset could not be loaded.';
    return new Response(JSON.stringify({ error: `The analyst cannot read the health data source: ${detail}` }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
    });
  }

  const hasConversation = raw.conversationId !== undefined && raw.conversationId !== null && raw.conversationId !== '';
  const history = hasConversation && availability.available ? await memoryTurnsFor({}, raw.conversationId) : [];
  const analystRequest = {
    query: raw.query as string,
    notes: raw.notes as string | undefined,
    system,
    history,
    // The page the question was asked from ("Discuss with analyst"); resolved
    // on the server, so the browser only names it.
    context: parsePageContextRef(raw.context),
  };

  // Drive the service generator inside the stream, so nothing is buffered: each
  // chunk is written the moment the model produces it.
  const { chunks, abort } = streamAnalyst(analystRequest);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(sseFrame(event, data)));
      };

      let final: AnalystResponse | null = null;
      // Once a plan tool ran, the question is never asked again: it could make
      // the same change twice.
      let toolRan = false;

      try {
        for await (const chunk of chunks) {
          if (closed) break;
          if (chunk.kind === 'reasoning') send('reasoning', { kind: 'reasoning', text: chunk.text });
          else if (chunk.kind === 'answer') send('answer', { kind: 'answer', text: chunk.text });
          else if (chunk.kind === 'step') {
            if (chunk.tool) toolRan = true;
            send('step', { kind: 'step', tool: chunk.tool });
          }
          else final = chunk.response;
        }
      } catch (error) {
        // The service already reports a broken stream as a result chunk; this
        // catches anything unexpected so the client always gets a terminal frame
        // and can fall back rather than hang.
        if (!closed && !final) {
          const message = error instanceof Error ? error.message : 'The analyst stream failed.';
          final = toolRan ? null : await askAnalyst(analystRequest).catch(() => null);
          if (!final) send('result', { kind: 'result', status: 'error', message, answer: null, model: null });
        }
      }

      if (!closed && final) {
        // Persist the exchange with the assembled response, exactly as the
        // non-streaming route does. A refused question is never saved.
        const question = validateQuery(raw.query);
        let outcome: Record<string, unknown> = {
          persisted: false,
          persistence: { ...availability, reason: 'Nothing was saved: the question was not accepted.' },
          conversation: null,
        };
        if (question.ok) {
          const saved = await appendExchange({}, raw.conversationId, question.query, final, await tagResponse(final, provenance));
          outcome = saved.ok
            ? { persisted: saved.outcome.persisted, persistence: { ...availability, reason: saved.outcome.reason }, conversation: saved.outcome.conversation }
            : { persisted: false, persistence: availability, error: saved.error };
        }
        send('result', { kind: 'result', ...final, ...outcome });
      }

      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          // The client went away between enqueue and close; nothing to do.
        }
      }
    },
    cancel() {
      // The browser disconnected mid-stream: cancel the upstream request so the
      // provider is not left generating into a socket nobody reads.
      closed = true;
      abort();
    },
  });

  // A client that disconnects does not always trigger `cancel`; the request
  // signal fires either way, so abort from there too.
  request.signal.addEventListener('abort', () => {
    closed = true;
    abort();
  });

  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
