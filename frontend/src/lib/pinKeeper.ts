/**
 * IPFS pin-redundancy keeper (issue #164).
 *
 * A single Pinata pin is a single point of failure: if it's lost, a
 * credential's document becomes unretrievable even though the on-chain
 * record and hash still exist. This module tracks pin health per
 * credential per provider (`public.credential_pins`, one row per
 * provider — see `supabase/migrations/` (credential_pins)) and periodically verifies and
 * repairs it.
 *
 * Split into a pure decision layer (`processPinCandidate` /
 * `runPinKeeperSweepPure` — no I/O, fully unit-testable) and a thin
 * Supabase-wired orchestration layer (`runPinKeeperSweep`) so the actual
 * repair/alerting logic can be tested exhaustively without fighting query
 * builder mocks. `worker/pinKeeper.ts` is the runnable entrypoint that
 * calls `runPinKeeperSweep` on a schedule.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    checkPinataPinStatus,
    getSecondaryPinStatus,
    isSecondaryPinningConfigured,
    pinCidToSecondaryProvider,
    pinJsonToPinata,
} from './ipfsServer';
import { captureException, recordMetric } from './debug';

export type PinProvider = 'pinata' | 'secondary';
export type PinStatus = 'pending' | 'pinned' | 'failed' | 'not_configured' | 'erased';

export interface PinCandidate {
    /** `credential_pins.id` */
    id: string;
    credentialId: string;
    cid: string;
    provider: PinProvider;
    status: PinStatus;
    providerRequestId: string | null;
    /** `credentials.metadata` for this credential — the exact bytes to re-pin on repair. */
    metadata: unknown;
}

export interface PinUpdate {
    id: string;
    credentialId: string;
    provider: PinProvider;
    status: PinStatus;
    providerRequestId: string | null;
    lastCheckedAt: string;
    lastError: string | null;
}

export interface PinSweepSummary {
    checked: number;
    healthy: number;
    repaired: number;
    stillFailing: number;
    erasedSkipped: number;
    /** Credentials where, after this sweep, zero providers report pinned — content is unretrievable. */
    criticalCredentialIds: string[];
    updates: PinUpdate[];
}

export interface PinKeeperDeps {
    checkPinataPinStatus: typeof checkPinataPinStatus;
    pinJsonToPinata: typeof pinJsonToPinata;
    isSecondaryPinningConfigured: typeof isSecondaryPinningConfigured;
    pinCidToSecondaryProvider: typeof pinCidToSecondaryProvider;
    getSecondaryPinStatus: typeof getSecondaryPinStatus;
    now: () => Date;
}

export const defaultPinKeeperDeps: PinKeeperDeps = {
    checkPinataPinStatus,
    pinJsonToPinata,
    isSecondaryPinningConfigured,
    pinCidToSecondaryProvider,
    getSecondaryPinStatus,
    now: () => new Date(),
};

/**
 * Sentinel the original `process_erasure()` wrote into credential metadata
 * (gdpr_erasure.sql). Erasure has been account-only since
 * 20261029020000_fix_account_erasure.sql and no longer writes it; the check
 * stays for any legacy row.
 */
export function isRedactedMetadata(metadata: unknown): boolean {
    return (
        Boolean(metadata) &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        (metadata as Record<string, unknown>).redacted === true
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function toUpdate(
    candidate: PinCandidate,
    nowIso: string,
    fields: { status: PinStatus; providerRequestId: string | null; lastError?: string | null },
): PinUpdate {
    return {
        id: candidate.id,
        credentialId: candidate.credentialId,
        provider: candidate.provider,
        status: fields.status,
        providerRequestId: fields.providerRequestId,
        lastCheckedAt: nowIso,
        lastError: fields.lastError ?? null,
    };
}

async function processPinataCandidate(
    candidate: PinCandidate,
    deps: PinKeeperDeps,
    nowIso: string,
): Promise<PinUpdate> {
    try {
        const status = await deps.checkPinataPinStatus(candidate.cid);
        if (status === 'pinned') {
            return toUpdate(candidate, nowIso, { status: 'pinned', providerRequestId: null });
        }

        // Missing from Pinata — repair by re-pinning the exact bytes we still
        // hold in Postgres (our own DB is itself a durable copy of the
        // content, so repair never depends on any pinning provider).
        const repairedCid = await deps.pinJsonToPinata(candidate.metadata);

        if (repairedCid !== candidate.cid) {
            // Re-pinning identical bytes is content-addressed and must
            // reproduce the identical CID. A mismatch means our stored
            // metadata no longer matches what was originally hashed
            // on-chain — a serious anomaly, not a routine repair failure.
            return toUpdate(candidate, nowIso, {
                status: 'failed',
                providerRequestId: null,
                lastError: `Re-pin produced CID ${repairedCid}, expected ${candidate.cid}. Stored metadata may no longer match the on-chain hash.`,
            });
        }

        return toUpdate(candidate, nowIso, { status: 'pinned', providerRequestId: null });
    } catch (error) {
        return toUpdate(candidate, nowIso, {
            status: 'failed',
            providerRequestId: candidate.providerRequestId,
            lastError: errorMessage(error),
        });
    }
}

async function processSecondaryCandidate(
    candidate: PinCandidate,
    deps: PinKeeperDeps,
    nowIso: string,
    /** Whether the pinata row for the same credential is healthy after this sweep pass — content must be discoverable somewhere for pin-by-CID to succeed. */
    pinataHealthyThisPass: boolean,
): Promise<PinUpdate> {
    if (!deps.isSecondaryPinningConfigured()) {
        return toUpdate(candidate, nowIso, { status: 'not_configured', providerRequestId: null });
    }

    try {
        if (candidate.providerRequestId) {
            const result = await deps.getSecondaryPinStatus(candidate.providerRequestId);
            if (result.status === 'pinned') {
                return toUpdate(candidate, nowIso, { status: 'pinned', providerRequestId: result.requestId });
            }
            if (result.status === 'queued' || result.status === 'pinning') {
                return toUpdate(candidate, nowIso, { status: 'pending', providerRequestId: result.requestId });
            }
            // 'failed' — fall through and re-submit below.
        }

        if (!pinataHealthyThisPass) {
            // Nothing to fetch: the content isn't currently discoverable
            // anywhere on the network. Re-check next sweep once Pinata
            // (this credential's only other provider) is healthy again.
            return toUpdate(candidate, nowIso, {
                status: 'pending',
                providerRequestId: candidate.providerRequestId,
                lastError: 'Deferred: primary provider does not currently have this content to fetch from.',
            });
        }

        const submitted = await deps.pinCidToSecondaryProvider(candidate.cid, `credential-${candidate.credentialId}`);
        if (submitted.status === 'failed') {
            return toUpdate(candidate, nowIso, {
                status: 'failed',
                providerRequestId: submitted.requestId,
                lastError: 'Secondary provider rejected or failed the pin request.',
            });
        }

        return toUpdate(candidate, nowIso, {
            status: submitted.status === 'pinned' ? 'pinned' : 'pending',
            providerRequestId: submitted.requestId,
        });
    } catch (error) {
        return toUpdate(candidate, nowIso, {
            status: 'failed',
            providerRequestId: candidate.providerRequestId,
            lastError: errorMessage(error),
        });
    }
}

export async function processPinCandidate(
    candidate: PinCandidate,
    deps: PinKeeperDeps,
    pinataHealthyThisPass: boolean,
): Promise<PinUpdate> {
    const nowIso = deps.now().toISOString();

    if (isRedactedMetadata(candidate.metadata)) {
        return toUpdate(candidate, nowIso, { status: 'erased', providerRequestId: candidate.providerRequestId });
    }

    if (candidate.provider === 'pinata') {
        return processPinataCandidate(candidate, deps, nowIso);
    }

    return processSecondaryCandidate(candidate, deps, nowIso, pinataHealthyThisPass);
}

/**
 * Pure sweep over an already-fetched batch of candidates. Callers must
 * include *every* provider row for any credential they include at all
 * (never a partial subset), so per-credential health can be judged
 * correctly — see `runPinKeeperSweep` for how candidates are fetched.
 */
export async function runPinKeeperSweepPure(
    candidates: PinCandidate[],
    deps: PinKeeperDeps = defaultPinKeeperDeps,
): Promise<PinSweepSummary> {
    const byCredential = new Map<string, PinCandidate[]>();
    for (const candidate of candidates) {
        const rows = byCredential.get(candidate.credentialId) ?? [];
        rows.push(candidate);
        byCredential.set(candidate.credentialId, rows);
    }

    const updates: PinUpdate[] = [];
    const criticalCredentialIds: string[] = [];
    let erasedSkipped = 0;

    await Promise.all(
        Array.from(byCredential.values()).map(async (rows) => {
            // Process 'pinata' first: if it needs repair, the secondary
            // provider's pin-by-CID request (processed next) can then
            // discover the freshly re-pinned content.
            const ordered = [...rows].sort((a, b) =>
                a.provider === 'pinata' ? -1 : b.provider === 'pinata' ? 1 : 0,
            );
            const rowUpdates: PinUpdate[] = [];
            let pinataHealthy = ordered.some((r) => r.provider === 'pinata' && r.status === 'pinned');

            for (const row of ordered) {
                const update = await processPinCandidate(row, deps, pinataHealthy);
                rowUpdates.push(update);
                updates.push(update);
                if (update.provider === 'pinata') {
                    pinataHealthy = update.status === 'pinned';
                }
            }

            if (rowUpdates.every((u) => u.status === 'erased')) {
                erasedSkipped += rowUpdates.length;
                return;
            }

            const anyHealthy = rowUpdates.some((u) => u.status === 'pinned');
            if (!anyHealthy) {
                criticalCredentialIds.push(rowUpdates[0].credentialId);
            }
        }),
    );

    const healthy = updates.filter((u) => u.status === 'pinned').length;
    const stillFailing = updates.filter((u) => u.status === 'failed').length;
    const repaired = updates.filter((update) => {
        const original = candidates.find((c) => c.id === update.id);
        return Boolean(original) && original!.status !== 'pinned' && update.status === 'pinned';
    }).length;

    if (criticalCredentialIds.length > 0) {
        captureException(
            new Error(`${criticalCredentialIds.length} credential(s) have zero healthy IPFS pins after sweep`),
            { context: 'pinKeeper.sweep', criticalCredentialIds },
        );
    }

    recordMetric('pin_keeper.sweep', updates.length, {
        healthy,
        repaired,
        stillFailing,
        erasedSkipped,
        critical: criticalCredentialIds.length,
    });

    return {
        checked: updates.length,
        healthy,
        repaired,
        stillFailing,
        erasedSkipped,
        criticalCredentialIds,
        updates,
    };
}

// ─── Supabase-wired orchestration ────────────────────────────────────────────

const DEFAULT_BATCH_SIZE = 25;
const STALE_PINNED_RECHECK_HOURS = 24;

interface CredentialPinRow {
    id: string;
    credential_id: string;
    cid: string;
    provider: PinProvider;
    status: PinStatus;
    provider_request_id: string | null;
    credentials: { metadata: unknown } | { metadata: unknown }[] | null;
}

function rowMetadata(row: CredentialPinRow): unknown {
    const credentials = row.credentials;
    if (Array.isArray(credentials)) {
        return credentials[0]?.metadata ?? null;
    }
    return credentials?.metadata ?? null;
}

function toCandidate(row: CredentialPinRow): PinCandidate {
    return {
        id: row.id,
        credentialId: row.credential_id,
        cid: row.cid,
        provider: row.provider,
        status: row.status,
        providerRequestId: row.provider_request_id,
        metadata: rowMetadata(row),
    };
}

/**
 * Fetches every `credential_pins` row for any credential that has at least
 * one row needing attention (unhealthy, or healthy but due for periodic
 * re-verification), then runs the pure sweep over the *complete* per-credential
 * sets and persists the resulting updates.
 */
export async function runPinKeeperSweep(
    supabase: SupabaseClient,
    options: { batchSize?: number; staleAfterHours?: number; deps?: PinKeeperDeps } = {},
): Promise<PinSweepSummary> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const staleAfterHours = options.staleAfterHours ?? STALE_PINNED_RECHECK_HOURS;
    const deps = options.deps ?? defaultPinKeeperDeps;
    const staleCutoffIso = new Date(deps.now().getTime() - staleAfterHours * 60 * 60 * 1000).toISOString();

    const [{ data: unresolvedRows, error: unresolvedError }, { data: staleRows, error: staleError }] =
        await Promise.all([
            supabase
                .from('credential_pins')
                .select('credential_id')
                .not('status', 'in', '(pinned,erased)')
                .limit(batchSize),
            supabase
                .from('credential_pins')
                .select('credential_id')
                .eq('status', 'pinned')
                .lt('last_checked_at', staleCutoffIso)
                .limit(batchSize),
        ]);

    if (unresolvedError || staleError) {
        const error = unresolvedError ?? staleError;
        captureException(new Error(`Failed to query due credential_pins: ${error?.message}`), {
            context: 'pinKeeper.fetchDueCredentialIds',
        });
        return { checked: 0, healthy: 0, repaired: 0, stillFailing: 0, erasedSkipped: 0, criticalCredentialIds: [], updates: [] };
    }

    const dueCredentialIds = Array.from(
        new Set([...(unresolvedRows ?? []), ...(staleRows ?? [])].map((row) => row.credential_id as string)),
    ).slice(0, batchSize);

    if (dueCredentialIds.length === 0) {
        return { checked: 0, healthy: 0, repaired: 0, stillFailing: 0, erasedSkipped: 0, criticalCredentialIds: [], updates: [] };
    }

    const { data: rows, error: rowsError } = await supabase
        .from('credential_pins')
        .select('id, credential_id, cid, provider, status, provider_request_id, credentials(metadata)')
        .in('credential_id', dueCredentialIds);

    if (rowsError) {
        captureException(new Error(`Failed to fetch credential_pins rows: ${rowsError.message}`), {
            context: 'pinKeeper.fetchCandidates',
        });
        return { checked: 0, healthy: 0, repaired: 0, stillFailing: 0, erasedSkipped: 0, criticalCredentialIds: [], updates: [] };
    }

    const candidates = ((rows ?? []) as CredentialPinRow[]).map(toCandidate);
    const summary = await runPinKeeperSweepPure(candidates, deps);

    await Promise.all(
        summary.updates.map((update) =>
            supabase
                .from('credential_pins')
                .update({
                    status: update.status,
                    provider_request_id: update.providerRequestId,
                    last_checked_at: update.lastCheckedAt,
                    last_error: update.lastError,
                    updated_at: update.lastCheckedAt,
                })
                .eq('id', update.id),
        ),
    );

    return summary;
}
