import { probeRateLimiterHealth } from './rateLimit';
import { runtimeConfig } from './runtimeConfig';

/**
 * Public service health (Issue #312): whether each dependency Acredia relies
 * on is answering right now. Read by GET /api/health and the /status page, so
 * that a verifier whose check failed can tell an outage from a bad credential.
 *
 * Public by design, so the report holds fixed words only: no hostnames, URLs,
 * versions, response codes or error messages, whatever a probe sees.
 */

export type HealthState = 'operational' | 'degraded' | 'outage';

export type DependencyName = 'blockchain' | 'database' | 'auth' | 'storage' | 'rateLimiting';

export interface HealthReport {
    /** The worst state that matters to users; see `overallState`. */
    status: HealthState;
    /** When the probes ran (ISO 8601). Up to HEALTH_CACHE_SECONDS old. */
    checkedAt: string;
    dependencies: Record<DependencyName, HealthState>;
}

/** How long a report is reused, so neither the page nor the API probes on every request. */
export const HEALTH_CACHE_SECONDS = 30;

/** Per-probe bound, matching the other outbound calls in lib/. */
export const HEALTH_PROBE_TIMEOUT_MS = 3_000;

type Probe = () => Promise<HealthState>;

/** Resolves `true` for a response that passes `accept`, `false` for anything else, never throws. */
async function answers(
    url: string,
    init: RequestInit,
    accept: (response: Response) => boolean | Promise<boolean> = (response) => response.ok,
): Promise<boolean> {
    try {
        const response = await fetch(url, {
            ...init,
            cache: 'no-store',
            signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
        });
        return await accept(response);
    } catch {
        return false;
    }
}

const toState = (up: boolean): HealthState => (up ? 'operational' : 'outage');

/** Soroban RPC's own health method: verification reads the chain through it. */
const probeBlockchain: Probe = async () => {
    const url = runtimeConfig.stellar.sorobanRpcUrl;
    if (!url) return 'outage';
    const up = await answers(
        url,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
        },
        async (response) => {
            if (!response.ok) return false;
            const body = (await response.json()) as { result?: { status?: unknown } };
            return body.result?.status === 'healthy';
        },
    );
    return toState(up);
};

function supabaseProbe(path: string, accept?: (response: Response) => boolean): Probe {
    return async () => {
        const { url, anonKey } = runtimeConfig.supabase;
        if (!url || !anonKey) return 'outage';
        const up = await answers(
            `${url.replace(/\/+$/, '')}${path}`,
            { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
            accept,
        );
        return toState(up);
    };
}

/** A one-row read of the public issuer registry (anon key, under RLS). */
const probeDatabase = supabaseProbe('/rest/v1/institutions?select=id&limit=1');

/** Supabase Auth's health endpoint. */
const probeAuth = supabaseProbe('/auth/v1/health');

/**
 * Supabase Storage. Documents live in a private bucket the anon key may not
 * list, so any answer short of a server error means the service is up.
 */
const probeStorage = supabaseProbe('/storage/v1/bucket', (response) => response.status < 500);

/**
 * Upstash Redis. Without it, rate limits fall back to per-instance memory:
 * the product keeps working, so this is reported as degraded, never an outage.
 */
const probeRateLimiting: Probe = async () => ((await probeRateLimiterHealth()) ? 'operational' : 'degraded');

const PROBES: Record<DependencyName, Probe> = {
    blockchain: probeBlockchain,
    database: probeDatabase,
    auth: probeAuth,
    storage: probeStorage,
    rateLimiting: probeRateLimiting,
};

/**
 * The headline state. Verification (the chain) and the database behind every
 * console and share page are the product; either one down is an outage.
 * Anything else not operational is a degradation.
 */
export function overallState(dependencies: Record<DependencyName, HealthState>): HealthState {
    if (dependencies.blockchain === 'outage' || dependencies.database === 'outage') return 'outage';
    return Object.values(dependencies).every((state) => state === 'operational') ? 'operational' : 'degraded';
}

async function runProbes(now: Date): Promise<HealthReport> {
    const names = Object.keys(PROBES) as DependencyName[];
    const states = await Promise.all(
        // A probe that throws despite its own guards counts as down, and does
        // not take the others with it.
        names.map((name) => PROBES[name]().catch((): HealthState => 'outage')),
    );
    const dependencies = Object.fromEntries(names.map((name, i) => [name, states[i]])) as Record<
        DependencyName,
        HealthState
    >;
    return { status: overallState(dependencies), checkedAt: now.toISOString(), dependencies };
}

let cached: { report: HealthReport; expiresAt: number } | null = null;
let inflight: Promise<HealthReport> | null = null;

/**
 * The current report, probing at most once per HEALTH_CACHE_SECONDS per
 * instance. Concurrent callers share one round of probes. Never throws.
 */
export async function getServiceHealth(): Promise<HealthReport> {
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.report;
    if (inflight) return inflight;

    inflight = runProbes(new Date(now))
        .then((report) => {
            cached = { report, expiresAt: Date.now() + HEALTH_CACHE_SECONDS * 1000 };
            return report;
        })
        .finally(() => {
            inflight = null;
        });
    return inflight;
}

export function resetServiceHealthCacheForTests(): void {
    cached = null;
    inflight = null;
}
