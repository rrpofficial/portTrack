/**
 * The SPA's only contact with the backend.
 *
 * Same-origin `/api` in both development and the container, so there is no base
 * URL to configure and no chance of a build pointing at the wrong host.
 */
export interface ApiError {
  readonly code: string;
  readonly message: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const failure = (body as { error?: ApiError }).error;
      return {
        ok: false,
        error: failure ?? { code: 'HTTP_ERROR', message: `request failed (${String(response.status)})` },
      };
    }
    return { ok: true, value: body as T };
  } catch {
    // The backend is reachable only over the internal network; a failure here is
    // the API being down, never a CORS or cross-origin problem.
    return { ok: false, error: { code: 'UNREACHABLE', message: 'the portTrack API is not responding' } };
  }
}

export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export interface ValuedPosition {
  readonly assetId: string;
  readonly assetClass: string;
  readonly jurisdiction: string;
  readonly quantity: string;
  readonly marketValue: Money;
  readonly costBasis: Money;
}

export interface Valuation {
  readonly asOf: string;
  readonly positions: readonly ValuedPosition[];
  readonly grossAssets: Money;
  readonly totalLiabilities: Money;
  readonly netWorth: Money;
  readonly byAssetClass: Readonly<Record<string, Money>>;
}

export const api = {
  unlock: (passphrase: string) =>
    request<{ unlocked: boolean }>('/vault/unlock', {
      method: 'POST',
      body: JSON.stringify({ passphrase }),
    }),
  valuation: () => request<Valuation>('/portfolio/valuation'),
  ready: () => request<{ status: string }>('/health/ready'),
};
