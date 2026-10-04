import { describe, expect, it } from 'vitest';
import { OURA_AUTHORIZE_URL, type OuraConfig } from './config';
import {
  ACCESS_EXPIRY_MARGIN_MS,
  OuraAuthError,
  buildAuthorizeUrl,
  exchangeCode,
  pkceChallenge,
  pkcePair,
  refreshTokens,
  revoke,
} from './oauth';

const cfg: OuraConfig = {
  clientId: 'sample-client',
  clientSecret: 'sample-secret',
  redirectUri: 'http://localhost:8080/api/sources/oura/callback',
  scopes: ['daily', 'heartrate', 'workout', 'spo2'],
  apiUrl: 'https://api.example.test',
  cacheTtlSeconds: 300,
  heartrateLookbackDays: 30,
  heartrateChunkDays: 7,
  preferredFor: [],
};
const NOW = Date.parse('2026-10-04T12:00:00Z');

interface Call {
  url: string;
  init: RequestInit;
}
function mock(status: number, body: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('PKCE', () => {
  it("matches Oura's documented test vector", () => {
    expect(pkceChallenge('QUW2bsoMYITWSSPUgCDEc4CXCBfcVyu8TkujreHe8CXP4K4d4463gRztuxfo96YP')).toBe(
      '43Kb1gELSIjkvwzrPtAg0Lz2HqCG3BtS_SUMAQhjv7c'
    );
  });

  it('makes a 64-character unreserved verifier whose challenge is unpadded base64url of its sha256', () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9\-._~]{64}$/);
    expect(a.challenge).toBe(pkceChallenge(a.verifier));
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
  });
});

describe('buildAuthorizeUrl', () => {
  it('carries every required parameter', () => {
    const url = new URL(buildAuthorizeUrl(cfg, 'state-1', 'challenge-1'));
    expect(`${url.origin}${url.pathname}`).toBe(OURA_AUTHORIZE_URL);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'sample-client',
      redirect_uri: cfg.redirectUri,
      scope: 'daily heartrate workout spo2',
      state: 'state-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
    });
  });
});

describe('token calls', () => {
  const reply = { access_token: 'sample-at', refresh_token: 'sample-rt', expires_in: 86400, scope: 'daily spo2' };
  const basic = `Basic ${Buffer.from('sample-client:sample-secret').toString('base64')}`;

  it('exchangeCode posts the exact form body and headers, and returns the tokens and granted scopes', async () => {
    const { fetchImpl, calls } = mock(200, reply);
    const out = await exchangeCode(cfg, 'code-1', 'verifier-1', { fetchImpl, now: () => NOW });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.example.test/oauth/token');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: basic,
    });
    expect(calls[0].init.body).toBe(
      'grant_type=authorization_code&code=code-1&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fapi%2Fsources%2Foura%2Fcallback&code_verifier=verifier-1'
    );
    expect(out.accessToken).toBe('sample-at');
    expect(out.refreshToken).toBe('sample-rt');
    expect(out.scopes).toEqual(['daily', 'spo2']);
    expect(out.expiresAt.getTime()).toBe(NOW + 86400_000 - ACCESS_EXPIRY_MARGIN_MS);
  });

  it('refreshTokens posts a refresh_token grant', async () => {
    const { fetchImpl, calls } = mock(200, reply);
    await refreshTokens(cfg, 'old-rt', { fetchImpl, now: () => NOW });
    expect(calls[0].init.body).toBe('grant_type=refresh_token&refresh_token=old-rt');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(basic);
  });

  it('reports scopes as null when the reply omits them', async () => {
    const { scope: _s, ...noScope } = reply;
    const { fetchImpl } = mock(200, noScope);
    expect((await refreshTokens(cfg, 'rt', { fetchImpl, now: () => NOW })).scopes).toBeNull();
  });

  it('maps 400/401 to a "rejected" error with no token or secret in the message', async () => {
    for (const status of [400, 401]) {
      const { fetchImpl } = mock(status, { error: 'invalid_grant', error_description: 'refresh-token-leak sample-secret' });
      const err = await refreshTokens(cfg, 'refresh-token-leak', { fetchImpl }).catch(e => e);
      expect(err).toBeInstanceOf(OuraAuthError);
      expect(err.kind).toBe('rejected');
      expect(err.httpStatus).toBe(status);
      expect(err.message).toContain('invalid_grant');
      for (const secret of ['refresh-token-leak', 'sample-secret', 'sample-client', basic]) {
        expect(err.message).not.toContain(secret);
      }
    }
  });

  it('maps other statuses to http_error and drops an error code that is not plain', async () => {
    const { fetchImpl } = mock(503, { error: 'Bad token sample-at!' });
    const err = await exchangeCode(cfg, 'code-1', 'v', { fetchImpl }).catch(e => e);
    expect(err.kind).toBe('http_error');
    expect(err.message).not.toContain('sample-at');
  });

  it('rejects a 200 reply that lacks the tokens', async () => {
    const { fetchImpl } = mock(200, { access_token: 'sample-at' });
    const err = await refreshTokens(cfg, 'rt', { fetchImpl }).catch(e => e);
    expect(err.kind).toBe('invalid_payload');
    expect(err.message).not.toContain('sample-at');
  });

  it('maps a network failure and a timeout without leaking the underlying message', async () => {
    const boom = (async () => {
      throw new Error('connect failed for sample-secret');
    }) as unknown as typeof fetch;
    const net = await refreshTokens(cfg, 'rt', { fetchImpl: boom }).catch(e => e);
    expect(net.kind).toBe('network_error');
    expect(net.message).not.toContain('sample-secret');

    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    const slow = await refreshTokens(cfg, 'rt', { fetchImpl: hang, timeoutMs: 5 }).catch(e => e);
    expect(slow.kind).toBe('timeout');
  });
});

describe('revoke', () => {
  it('GETs the revoke URL with the encoded access token', async () => {
    const { fetchImpl, calls } = mock(200, {});
    await revoke(cfg, 'a b/c', { fetchImpl });
    expect(calls[0].url).toBe('https://api.example.test/oauth/revoke?access_token=a%20b%2Fc');
    expect(calls[0].init.method).toBe('GET');
  });

  it('throws without the token in the message when refused', async () => {
    const { fetchImpl } = mock(401, {});
    const err = await revoke(cfg, 'sample-at', { fetchImpl }).catch(e => e);
    expect(err).toBeInstanceOf(OuraAuthError);
    expect(err.message).not.toContain('sample-at');
  });

  it('does not leak the token in a network error either', async () => {
    const boom = (async (url: string) => {
      throw new Error(`failed ${url}`);
    }) as unknown as typeof fetch;
    const err = await revoke(cfg, 'sample-at', { fetchImpl: boom }).catch(e => e);
    expect(err.kind).toBe('network_error');
    expect(err.message).not.toContain('sample-at');
  });
});

describe('parseGrantedScopes', () => {
  it('reads space-separated, comma-separated and list forms', async () => {
    const { parseGrantedScopes } = await import('./oauth');
    expect(parseGrantedScopes('daily spo2')).toEqual(['daily', 'spo2']);
    expect(parseGrantedScopes('daily,heartrate, workout')).toEqual(['daily', 'heartrate', 'workout']);
    expect(parseGrantedScopes(['daily', 'spo2'])).toEqual(['daily', 'spo2']);
  });
  it('treats empty or missing as not stated, not as nothing granted', async () => {
    const { parseGrantedScopes } = await import('./oauth');
    for (const v of ['', '  ', [], undefined, null, 5]) expect(parseGrantedScopes(v)).toBeNull();
  });
});
