import { NextRequest, NextResponse } from 'next/server';
import { Account, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from '@stellar/stellar-sdk';
import { getServiceRoleClient } from '@/lib/serverAuth';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { captureException, structuredLog, recordMetric } from '@/lib/debug';
import { runtimeConfig } from '@/lib/runtimeConfig';
import { planCredentialSweep } from '@/lib/ttlKeeper';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const TTL_THRESHOLD_LEDGERS = 3_110_400;
const KEEPER_MIN_BALANCE_XLM = 5;

interface KeeperRunSummary {
    runId: string;
    totalCredentials: number;
    indexedCredentials: number | null;
    indexGap: boolean;
    capacityExceeded: boolean;
    nextTokenId: number;
    bumpAttempted: number;
    bumpSucceeded: number;
    bumpFailed: number;
    bumpSkipped: number;
    minRemainingTtlLedgers: number | null;
    keeperBalanceXlm: number;
    lowBalance: boolean;
    durationMs: number;
    failedTokenIds: string[];
}

function credentialStorageKey(tokenId: string): xdr.ScVal {
    return xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Credential'),
        nativeToScVal(BigInt(tokenId), { type: 'u64' }),
    ]);
}

async function getBalance(address: string): Promise<number> {
    const response = await fetch(`${runtimeConfig.stellar.horizonUrl}/accounts/${address}`);
    if (!response.ok) throw new Error(`Keeper balance lookup failed: HTTP ${response.status}`);
    const data = await response.json() as { balances?: Array<{ asset_type: string; balance: string }> };
    const balance = Number(data.balances?.find((item) => item.asset_type === 'native')?.balance);
    if (!Number.isFinite(balance)) throw new Error('Keeper native balance unavailable');
    return balance;
}

async function readTotalCredentials(server: rpc.Server, contractId: string, source: string): Promise<number> {
    const tx = new TransactionBuilder(new Account(source, '0'), {
        fee: '100', networkPassphrase: runtimeConfig.stellar.networkPassphrase,
    }).addOperation(new Contract(contractId).call('total_credentials')).setTimeout(30).build();
    const result = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(result) || !result.result?.retval) {
        throw new Error('Could not read total_credentials from the chain');
    }
    const total = Number(scValToNative(result.result.retval));
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid total_credentials value');
    return total;
}

async function remainingTtl(server: rpc.Server, contractId: string, tokenId: string, latestLedger: number): Promise<number> {
    // Soroban contracttype DataKey::Credential(u64) is [symbol, u64].
    const entry = await server.getContractData(contractId, credentialStorageKey(tokenId), rpc.Durability.Persistent);
    if (entry.liveUntilLedgerSeq == null) throw new Error(`TTL unavailable for token ${tokenId}`);
    return entry.liveUntilLedgerSeq - latestLedger;
}

async function bumpCredential(server: rpc.Server, contractId: string, tokenId: string, signer: Keypair): Promise<void> {
    // Sequential calls always load the latest account sequence before submitting.
    const account = await server.getAccount(signer.publicKey());
    const tx = new TransactionBuilder(account, {
        fee: '100', networkPassphrase: runtimeConfig.stellar.networkPassphrase,
    }).addOperation(new Contract(contractId).call('bump_credential', nativeToScVal(BigInt(tokenId), { type: 'u64' })))
        .setTimeout(60).build();
    const simulation = await server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) throw new Error(`Simulation failed for token ${tokenId}`);
    const prepared = rpc.assembleTransaction(tx, simulation).build();
    prepared.sign(signer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') throw new Error(`Submission failed for token ${tokenId}`);
    for (let attempt = 0; attempt < 10; attempt++) {
        const confirmed = await server.getTransaction(sent.hash);
        if (confirmed.status === rpc.Api.GetTransactionStatus.SUCCESS) return;
        if (confirmed.status === rpc.Api.GetTransactionStatus.FAILED) break;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    throw new Error(`Transaction ${sent.hash} did not confirm for token ${tokenId}`);
}

export async function GET(request: NextRequest) {
    const auth = authorizeCronRequest(request);
    const runId = crypto.randomUUID();
    const requestId = request.headers.get('x-request-id') || runId;
    if (!auth.ok) {
        structuredLog('WARN', 'Rejected cron invocation of TTL keeper', requestId, { status: auth.status });
        return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const startedAt = Date.now();
    let lockClient: ReturnType<typeof getServiceRoleClient> | null = null;
    let lockHeld = false;
    try {
        lockClient = getServiceRoleClient();
        const { data: claimed, error: lockError } = await lockClient.rpc('claim_ttl_keeper_lock', { p_run_id: runId });
        if (lockError) throw new Error(`Keeper lock unavailable: ${lockError.message}`);
        if (claimed !== true) return NextResponse.json({ success: false, error: 'Keeper run already active' }, { status: 409 });
        lockHeld = true;
        const secret = process.env.TTL_KEEPER_ACCOUNT_SECRET;
        const address = process.env.TTL_KEEPER_ACCOUNT_PUBLIC;
        if (!secret || !address) throw new Error('TTL keeper signing account is not configured');
        const signer = Keypair.fromSecret(secret);
        if (signer.publicKey() !== address) throw new Error('TTL keeper public and secret keys disagree');
        const contractId = runtimeConfig.contracts.CREDENTIAL_NFT;
        const server = new rpc.Server(runtimeConfig.stellar.sorobanRpcUrl);
        const keeperBalanceXlm = await getBalance(address);
        const lowBalance = keeperBalanceXlm < KEEPER_MIN_BALANCE_XLM;
        const supabase = lockClient;
        const { data: previous, error: previousError } = await supabase.from('cron_run_log')
            .select('summary, completed_at').eq('job_name', 'ttl-keeper')
            .order('completed_at', { ascending: false }).limit(1).maybeSingle();
        if (previousError) throw new Error(`Keeper cursor read failed: ${previousError.message}`);
        const previousSummary = previous?.summary as Partial<KeeperRunSummary> | null | undefined;
        const cursor = previousSummary?.nextTokenId ?? 1;
        if (previous?.completed_at && Date.now() - Date.parse(previous.completed_at) > 25 * 60 * 60 * 1000) {
            captureException(new Error('TTL keeper previous run was more than 25 hours ago'), { context: 'ttlKeeper.missedRun', runId });
        }
        const totalCredentials = await readTotalCredentials(server, contractId, address);
        const retryIds = (previousSummary?.failedTokenIds ?? [])
            .filter((tokenId) => /^\d+$/.test(tokenId) && Number(tokenId) <= totalCredentials)
            .slice(0, 10);
        const page = planCredentialSweep(totalCredentials, cursor, 50 - retryIds.length);
        const tokenIds = [...new Set([...retryIds, ...page.tokenIds])];
        const { nextTokenId, capacityExceeded } = page;
        const { count: indexedCredentials, error: countError } = await supabase.from('credentials')
            .select('*', { count: 'exact', head: true });
        if (countError) throw new Error(`Credential index count failed: ${countError.message}`);
        const indexGap = indexedCredentials !== totalCredentials;
        const latest = await server.getLatestLedger();
        let bumpSucceeded = 0;
        let bumpSkipped = 0;
        let minRemainingTtlLedgers: number | null = null;
        const failedTokenIds: string[] = [];
        for (const tokenId of tokenIds) {
            try {
                const remaining = await remainingTtl(server, contractId, tokenId, latest.sequence);
                minRemainingTtlLedgers = Math.min(minRemainingTtlLedgers ?? remaining, remaining);
                if (remaining > TTL_THRESHOLD_LEDGERS) {
                    bumpSkipped++;
                    continue;
                }
                await bumpCredential(server, contractId, tokenId, signer);
                bumpSucceeded++;
            } catch (error) {
                failedTokenIds.push(tokenId);
                captureException(error, { context: 'ttlKeeper.token', runId, tokenId });
            }
        }
        const summary: KeeperRunSummary = {
            runId, totalCredentials, indexedCredentials, indexGap, capacityExceeded,
            nextTokenId, bumpAttempted: bumpSucceeded + failedTokenIds.length,
            bumpSucceeded, bumpFailed: failedTokenIds.length, bumpSkipped,
            minRemainingTtlLedgers, keeperBalanceXlm, lowBalance,
            durationMs: Date.now() - startedAt, failedTokenIds,
        };
        const healthy = !lowBalance && !indexGap && !capacityExceeded && failedTokenIds.length === 0;
        const { error: persistenceError } = await supabase.from('cron_run_log').insert({
            job_name: 'ttl-keeper', run_id: runId, status: healthy ? 'succeeded' : 'partial',
            summary: summary as unknown as Record<string, unknown>, completed_at: new Date().toISOString(),
        });
        if (persistenceError) throw new Error(`Keeper run could not be recorded: ${persistenceError.message}`);
        structuredLog(healthy ? 'INFO' : 'ERROR', 'TTL keeper run completed', requestId, summary as unknown as Record<string, unknown>);
        recordMetric('ttl_keeper.run', totalCredentials, {
            bumpSucceeded, bumpFailed: failedTokenIds.length, bumpSkipped,
            lowBalance: lowBalance ? 1 : 0, durationMs: summary.durationMs,
        });
        if (!healthy) captureException(new Error('TTL keeper run requires attention'), { context: 'ttlKeeper.run', ...summary });
        return NextResponse.json({ success: healthy, ...summary }, { status: healthy ? 200 : 503 });
    } catch (error) {
        captureException(error, { requestId, context: 'GET /api/cron/ttl-keeper' });
        if (lockHeld && lockClient) {
            const { error: logError } = await lockClient.from('cron_run_log').insert({
                job_name: 'ttl-keeper', run_id: runId, status: 'failed',
                summary: { error: error instanceof Error ? error.message : 'Unknown error' },
                completed_at: new Date().toISOString(),
            });
            if (logError) captureException(logError, { context: 'ttlKeeper.logFailedRun', runId });
        }
        return NextResponse.json({ success: false, error: 'TTL keeper run failed', details: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
    } finally {
        if (lockHeld && lockClient) {
            const { error } = await lockClient.rpc('release_ttl_keeper_lock', { p_run_id: runId });
            if (error) captureException(error, { context: 'ttlKeeper.releaseLock', runId });
        }
    }
}
