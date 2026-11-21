#!/usr/bin/env tsx
/**
 * Issue #314 — RPC baselines against mainnet-latency RPC, MAX_BATCH_SIZE
 * re-derived from simulated resource costs, fee estimates, and a cold-cache
 * verification soak.
 *
 *     npx tsx scripts/measure-rpc-baselines.ts [options]
 *
 *   --samples N         latency samples per call (default 40)
 *   --soak-seconds N    soak duration per network (default 120)
 *   --soak-rps N        verifications started per second during the soak (default 2)
 *   --out PATH          JSON output (default tests/mainnet-rpc-baselines.json)
 *   --mainnet-rpc URL   default https://mainnet.sorobanrpc.com (or MAINNET_RPC_URL)
 *   --testnet-rpc URL   default https://soroban-testnet.stellar.org (or TESTNET_RPC_URL)
 *
 * What touches which network:
 *   - Mainnet: read-only calls only (getNetwork, getHealth, getFeeStats,
 *     getLedgerEntries, simulateTransaction). Nothing is signed or submitted
 *     and nothing costs anything. The Acredia contract is not on mainnet, so
 *     its reads are modelled with the same shape of read on the native XLM
 *     Stellar Asset Contract (instance + one persistent entry).
 *   - Testnet: deploys a throwaway instance of the WASM already deployed for
 *     Acredia (same hash, nothing built or uploaded), owned by throwaway
 *     friendbot-funded keys, then issues test credentials and bumps them.
 *     This is the only way to measure real issuance and storage costs: the
 *     production testnet contract has no authorized issuer and no
 *     credentials. Throwaway secret keys are never written to disk.
 *
 * Every number in the output says how it was obtained. Fees are in stroops
 * (1 XLM = 10,000,000 stroops).
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
    Account,
    Address,
    Asset,
    Contract,
    Keypair,
    Networks,
    Operation,
    SorobanDataBuilder,
    TransactionBuilder,
    contract as sorobanContract,
    nativeToScVal,
    rpc,
    scValToNative,
    xdr,
} from '@stellar/stellar-sdk';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function option(name: string, fallback: string): string {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const SAMPLES = Number(option('samples', '40'));
const SOAK_SECONDS = Number(option('soak-seconds', '120'));
const SOAK_RPS = Number(option('soak-rps', '2'));
const OUT = option('out', 'tests/mainnet-rpc-baselines.json');
const MAINNET_RPC = option('mainnet-rpc', process.env.MAINNET_RPC_URL ?? 'https://mainnet.sorobanrpc.com');
const TESTNET_RPC = option('testnet-rpc', process.env.TESTNET_RPC_URL ?? 'https://soroban-testnet.stellar.org');

/** The deployed Acredia testnet contract (docs/deployments/2026-10-30-testnet.md). */
const ACREDIA_TESTNET_CONTRACT = 'CD3NAUTBD5JXFNJVB7DGJW2ALLLEEYBYC5PQ3IQIL7JSSGBDL2VZOY4U';
/** Its WASM, as recorded in that deployment record. */
const ACREDIA_WASM_SHA256 = '52b340df46b8a6c85d957660d1e11a8aebfda28bf2634961cf1f374a4bd7d4a5';

/** contracts/src/lib.rs */
const CONTRACT = {
    MAX_BATCH_SIZE: 20,
    PERSISTENT_BUMP_AMOUNT: 6_312_000,
    PERSISTENT_THRESHOLD: 3_110_400,
} as const;

/** src/lib/contractReads.ts — the app's per-request RPC bound. */
const APP_RPC_TIMEOUT_MS = 4_000;
/** src/lib/ttlKeeper.ts + the cron route. */
const KEEPER = { PAGE_SIZE: 50, COVERAGE_WINDOW_DAYS: 90, RUNS_PER_DAY: 1 } as const;

const BATCH_SIZES = [1, 2, 4, 8, 12, 16, 20];
const VOLUMES = [1_000, 10_000, 100_000];

const log = (...parts: unknown[]) => console.error('[baselines]', ...parts);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface Distribution {
    n: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    max: number;
    mean: number;
}

function distribution(values: number[]): Distribution | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    // Nearest-rank percentile.
    const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
    const round = (value: number) => Math.round(value);
    return {
        n: sorted.length,
        p50: round(at(50)),
        p90: round(at(90)),
        p95: round(at(95)),
        p99: round(at(99)),
        max: round(sorted[sorted.length - 1]),
        mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    };
}

/** Least-squares fit y = intercept + slope · x. */
function linearFit(points: Array<[number, number]>) {
    const n = points.length;
    const sx = points.reduce((s, [x]) => s + x, 0);
    const sy = points.reduce((s, [, y]) => s + y, 0);
    const sxx = points.reduce((s, [x]) => s + x * x, 0);
    const sxy = points.reduce((s, [x, y]) => s + x * y, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    const maxResidual = Math.max(...points.map(([x, y]) => Math.abs(y - (intercept + slope * x))));
    return { intercept, slope, maxResidual };
}

// ---------------------------------------------------------------------------
// XDR helpers
// ---------------------------------------------------------------------------

/**
 * SDK 17's decoded XDR objects have camelCase properties but serialise to
 * snake_case JSON. Read everything through this JSON form, with integer
 * strings and bigints as numbers, so field names are stable.
 */
function plain(value: unknown): Record<string, unknown> {
    return numeric(JSON.parse(JSON.stringify(value, (_key, inner) => (typeof inner === 'bigint' ? inner.toString() : inner)))) as Record<string, unknown>;
}

/** Plain decoded XDR with its integer strings and bigints as numbers. */
function numeric(value: unknown): unknown {
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
    if (Array.isArray(value)) return value.map(numeric);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, numeric(inner)]));
    }
    return value;
}

/**
 * An XDR enum member. js-xdr exposes them as functions in some versions and
 * as plain member objects in others (the SDK 17 build here), so accept both.
 */
function enumMember<T>(holder: unknown, name: string): T {
    const member = (holder as Record<string, unknown>)[name];
    if (member === undefined) throw new Error(`no XDR enum member ${name}`);
    return (typeof member === 'function' ? (member as () => T)() : member) as T;
}

function u64(value: number | bigint): xdr.ScVal {
    return nativeToScVal(BigInt(value), { type: 'u64' });
}

function persistentKey(contractId: string, key: xdr.ScVal): xdr.LedgerKey {
    return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
            contract: new Address(contractId).toScAddress(),
            key,
            durability: enumMember<xdr.ContractDataDurability>(xdr.ContractDataDurability, 'persistent'),
        }),
    );
}

/** `DataKey::Credential(token_id)` and `DataKey::HashIndex(hash)` as the contract encodes them. */
function credentialKeys(contractId: string, tokenId: bigint, hashHex: string) {
    return {
        credential: persistentKey(contractId, xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Credential'), u64(tokenId)])),
        hashIndex: persistentKey(
            contractId,
            xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('HashIndex'), xdr.ScVal.scvBytes(Buffer.from(hashHex, 'hex'))]),
        ),
    };
}

function instanceKey(contractId: string): xdr.LedgerKey {
    return persistentKey(contractId, xdr.ScVal.scvLedgerKeyContractInstance());
}

interface SimResources {
    instructions: number;
    diskReadBytes: number;
    writeBytes: number;
    readOnlyEntries: number;
    readWriteEntries: number;
    footprintEntries: number;
    writeEntries: number;
    contractEventsBytes: number;
    minResourceFee: number;
}

function resourcesOf(sim: rpc.Api.SimulateTransactionSuccessResponse): SimResources {
    const data = plain(sim.transactionData.build()) as {
        resources: {
            instructions: number;
            disk_read_bytes?: number;
            read_bytes?: number;
            write_bytes: number;
            footprint: { read_only: unknown[]; read_write: unknown[] };
        };
    };
    const { resources } = data;
    const readOnly = resources.footprint.read_only.length;
    const readWrite = resources.footprint.read_write.length;
    // Contract events (not diagnostic ones) count towards the network limit.
    const contractEventsBytes = (sim.events ?? [])
        .filter((event) => {
            const json = plain(event) as { in_successful_contract_call: boolean; event: { type: string } };
            return json.event.type === 'contract' && json.in_successful_contract_call;
        })
        .reduce((sum, event) => sum + (event as unknown as { event: { toXDR(): Buffer } }).event.toXDR().length, 0);
    return {
        instructions: resources.instructions,
        diskReadBytes: resources.disk_read_bytes ?? resources.read_bytes ?? 0,
        writeBytes: resources.write_bytes,
        readOnlyEntries: readOnly,
        readWriteEntries: readWrite,
        footprintEntries: readOnly + readWrite,
        writeEntries: readWrite,
        contractEventsBytes,
        minResourceFee: Number(sim.minResourceFee),
    };
}

// ---------------------------------------------------------------------------
// Network access
// ---------------------------------------------------------------------------

interface Network {
    name: 'mainnet' | 'testnet';
    url: string;
    passphrase: string;
    server: rpc.Server;
}

function network(name: Network['name'], url: string, passphrase: string): Network {
    // Same per-request bound as the app (src/lib/contractReads.ts).
    return { name, url, passphrase, server: new rpc.Server(url, { timeout: APP_RPC_TIMEOUT_MS }) };
}

const MAINNET = network('mainnet', MAINNET_RPC, Networks.PUBLIC);
const TESTNET = network('testnet', TESTNET_RPC, Networks.TESTNET);

function readTx(net: Network, contractId: string, method: string, args: xdr.ScVal[] = [], source = sorobanContract.NULL_ACCOUNT) {
    return new TransactionBuilder(new Account(source, '0'), { fee: '100', networkPassphrase: net.passphrase })
        .addOperation(new Contract(contractId).call(method, ...args))
        .setTimeout(0)
        .build();
}

async function simulate(net: Network, tx: ReturnType<typeof readTx>) {
    const sim = await net.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation error: ${String(sim.error).slice(0, 200)}`);
    return sim as rpc.Api.SimulateTransactionSuccessResponse;
}

async function read(net: Network, contractId: string, method: string, args: xdr.ScVal[] = []) {
    const sim = await simulate(net, readTx(net, contractId, method, args));
    return sim.result ? scValToNative(sim.result.retval) : null;
}

async function networkInfo(net: Network) {
    const [health, info, fees] = await Promise.all([
        net.server.getHealth() as Promise<rpc.Api.GetHealthResponse & Record<string, unknown>>,
        net.server.getNetwork(),
        net.server.getFeeStats(),
    ]);
    const latest = Number(health.latestLedger);
    const oldest = Number(health.oldestLedger);
    const latestClose = Number(health.latestLedgerCloseTime);
    const oldestClose = Number(health.oldestLedgerCloseTime);
    const secondsPerLedger = latest > oldest ? (latestClose - oldestClose) / (latest - oldest) : null;
    const percentilesOf = (stats: Record<string, string>) =>
        Object.fromEntries(['p50', 'p70', 'p90', 'p95', 'p99', 'max', 'mode'].map((key) => [key, Number(stats[key])]));
    return {
        rpcUrl: net.url,
        passphrase: info.passphrase,
        protocolVersion: info.protocolVersion,
        latestLedger: latest,
        secondsPerLedger: secondsPerLedger === null ? null : Number(secondsPerLedger.toFixed(3)),
        ledgersPerYear: secondsPerLedger ? Math.round((365 * 24 * 3600) / secondsPerLedger) : null,
        sorobanInclusionFeeStroops: percentilesOf(fees.sorobanInclusionFee as unknown as Record<string, string>),
        sorobanInclusionFeeLedgerCount: Number((fees.sorobanInclusionFee as unknown as Record<string, string>).ledgerCount),
    };
}

/** The network's own Soroban limits and fee schedule, read from its ledger. */
async function configSettings(net: Network) {
    const wanted = [
        'configSettingContractMaxSizeBytes',
        'configSettingContractComputeV0',
        'configSettingContractLedgerCostV0',
        'configSettingContractLedgerCostExtV0',
        'configSettingContractHistoricalDataV0',
        'configSettingContractEventsV0',
        'configSettingContractBandwidthV0',
        'configSettingContractDataKeySizeBytes',
        'configSettingContractDataEntrySizeBytes',
        'configSettingStateArchival',
    ];
    const available = wanted.filter((name) => (xdr.ConfigSettingId as unknown as Record<string, unknown>)[name] !== undefined);
    const keys = available.map((name) =>
        xdr.LedgerKey.configSetting(
            new xdr.LedgerKeyConfigSetting({ configSettingId: enumMember<xdr.ConfigSettingId>(xdr.ConfigSettingId, name) }),
        ),
    );
    const { entries } = await net.server.getLedgerEntries(...keys);
    const settings: Record<string, unknown> = {};
    for (const entry of entries) {
        // SDK 17 decodes a config setting to a plain object keyed by its XDR
        // arm, e.g. { contract_compute_v0: { tx_max_instructions: "400000000", … } }.
        const setting = plain((entry.val as unknown as { configSetting: unknown }).configSetting);
        for (const [arm, value] of Object.entries(setting)) settings[arm] = value;
    }
    return settings;
}

/** The per-transaction ceilings that bound a batch, from the settings above. */
function transactionLimits(settings: Record<string, unknown>) {
    const get = (setting: string, field: string): number | null => {
        const value = (settings[setting] as Record<string, unknown> | undefined)?.[field];
        return typeof value === 'number' ? value : null;
    };
    const first = (...candidates: Array<[string, string]>) => {
        for (const [setting, field] of candidates) {
            const value = get(setting, field);
            if (value !== null) return value;
        }
        return null;
    };
    return {
        instructions: get('contract_compute_v0', 'tx_max_instructions'),
        diskReadBytes: first(['contract_ledger_cost_v0', 'tx_max_disk_read_bytes'], ['contract_ledger_cost_v0', 'tx_max_read_bytes']),
        diskReadEntries: first(['contract_ledger_cost_v0', 'tx_max_disk_read_entries'], ['contract_ledger_cost_v0', 'tx_max_read_ledger_entries']),
        writeBytes: get('contract_ledger_cost_v0', 'tx_max_write_bytes'),
        writeEntries: get('contract_ledger_cost_v0', 'tx_max_write_ledger_entries'),
        footprintEntries: get('contract_ledger_cost_ext_v0', 'tx_max_footprint_entries'),
        contractEventsBytes: get('contract_events_v0', 'tx_max_contract_events_size_bytes'),
        txSizeBytes: get('contract_bandwidth_v0', 'tx_max_size_bytes'),
        maxEntryTtl: get('state_archival', 'max_entry_ttl'),
    };
}

// ---------------------------------------------------------------------------
// Latency and soak
// ---------------------------------------------------------------------------

type Call = () => Promise<unknown>;

/** `samples` sequential, spaced runs of `call`, timed. */
async function sample(label: string, call: Call, samples = SAMPLES, spacingMs = 150) {
    const latencies: number[] = [];
    const errors: string[] = [];
    for (let i = 0; i < samples; i++) {
        const start = performance.now();
        try {
            await call();
            latencies.push(performance.now() - start);
        } catch (error) {
            errors.push(classify(error));
        }
        await sleep(spacingMs);
    }
    log(`${label}: ${latencies.length}/${samples} ok`);
    return { latencyMs: distribution(latencies), errors: tally(errors) };
}

function classify(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (/timeout/i.test(message)) return 'timeout';
    if (/429|too many/i.test(message)) return 'rate-limited (429)';
    if (/5\d\d/.test(message)) return 'server error (5xx)';
    if (/simulation error/i.test(message)) return 'simulation error';
    return 'other';
}

function tally(values: string[]) {
    return values.reduce<Record<string, number>>((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});
}

/**
 * Cold-cache verification at a sustained rate: a new verification starts
 * every 1/rps seconds whether or not the previous one finished, as requests
 * would arrive. Each is the app's three sequential reads.
 */
async function soak(label: string, verification: Call) {
    const latencies: number[] = [];
    const errors: string[] = [];
    const inFlight: Promise<void>[] = [];
    const total = Math.round(SOAK_SECONDS * SOAK_RPS);
    const started = performance.now();
    for (let i = 0; i < total; i++) {
        const due = started + (i * 1000) / SOAK_RPS;
        await sleep(Math.max(0, due - performance.now()));
        inFlight.push(
            (async () => {
                const start = performance.now();
                try {
                    await verification();
                    latencies.push(performance.now() - start);
                } catch (error) {
                    errors.push(classify(error));
                }
            })(),
        );
    }
    await Promise.all(inFlight);
    const elapsedSeconds = (performance.now() - started) / 1000;
    log(`${label}: ${latencies.length}/${total} verifications ok`);
    // Thirds of the run, to show whether latency drifts as the soak goes on.
    const third = Math.ceil(latencies.length / 3);
    return {
        rps: SOAK_RPS,
        seconds: SOAK_SECONDS,
        verifications: total,
        rpcCalls: total * 3,
        succeeded: latencies.length,
        errorRate: Number((errors.length / total).toFixed(4)),
        errors: tally(errors),
        verificationLatencyMs: distribution(latencies),
        drift: [0, 1, 2].map((part) => distribution(latencies.slice(part * third, (part + 1) * third))?.p50 ?? null),
        elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
    };
}

// ---------------------------------------------------------------------------
// Testnet: a throwaway instance of the deployed WASM
// ---------------------------------------------------------------------------

async function friendbot(publicKey: string) {
    const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
    if (!response.ok) throw new Error(`friendbot ${response.status}`);
}

/** Prepares, signs, submits and waits for `operation`; returns the confirmed result. */
async function submit(net: Network, signer: Keypair, operation: xdr.Operation) {
    const account = await net.server.getAccount(signer.publicKey());
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: net.passphrase })
        .addOperation(operation)
        .setTimeout(120)
        .build();
    const prepared = await net.server.prepareTransaction(tx);
    prepared.sign(signer);
    const sent = await net.server.sendTransaction(prepared);
    if (sent.status === 'ERROR') throw new Error(`send failed: ${sent.errorResult?.toXDR('base64')}`);
    for (let attempt = 0; attempt < 60; attempt++) {
        const result = await net.server.getTransaction(sent.hash);
        if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
            // prepareTransaction adds the resource fee to our 1,000,000-stroop
            // inclusion bid; feeCharged is what was actually taken after refunds.
            const resourceFee = Number(prepared.fee) - 1_000_000;
            const charged = plain(result.resultXdr) as { fee_charged: number };
            return {
                hash: sent.hash,
                ledger: result.ledger,
                feeChargedStroops: Number(charged.fee_charged),
                declaredResourceFeeStroops: resourceFee,
                envelopeBytes: prepared.toEnvelope().toXDR().length,
                returnValue: result.returnValue ? scValToNative(result.returnValue) : null,
            };
        }
        if (result.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`tx ${sent.hash} failed`);
        await sleep(1000);
    }
    throw new Error(`tx ${sent.hash} not confirmed`);
}

function randomHashHex(): string {
    return randomBytes(32).toString('hex');
}

function batchRow(hashHex: string) {
    return xdr.ScVal.scvMap(
        [
            ['credential_hash', xdr.ScVal.scvBytes(Buffer.from(hashHex, 'hex'))],
            ['expires_at', xdr.ScVal.scvVoid()],
            ['student', new Address(Keypair.random().publicKey()).toScVal()],
        ].map(
            ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key as string), val: val as xdr.ScVal }),
        ),
    );
}

async function deployThrowawayInstance() {
    const wasm = await TESTNET.server.getContractWasmByContractId(ACREDIA_TESTNET_CONTRACT);
    const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
    if (wasmSha256 !== ACREDIA_WASM_SHA256) {
        throw new Error(`deployed WASM is ${wasmSha256}, the deployment record says ${ACREDIA_WASM_SHA256}`);
    }
    const owner = Keypair.random();
    const issuer = Keypair.random();
    await friendbot(owner.publicKey());
    await friendbot(issuer.publicKey());
    log('funded throwaway owner and issuer');

    const deploy = await submit(
        TESTNET,
        owner,
        Operation.createCustomContract({
            address: new Address(owner.publicKey()),
            wasmHash: Buffer.from(wasmSha256, 'hex'),
            constructorArgs: [new Address(owner.publicKey()).toScVal()],
            salt: randomBytes(32),
        }),
    );
    const contractId = String(deploy.returnValue);
    log('deployed throwaway instance', contractId);

    await submit(
        TESTNET,
        owner,
        new Contract(contractId).call('authorize_issuer', new Address(issuer.publicKey()).toScVal()),
    );
    log('authorized throwaway issuer');
    return { contractId, owner, issuer, wasmSha256, deploy };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    const capturedAt = new Date().toISOString();
    log(`samples=${SAMPLES} soak=${SOAK_RPS} rps × ${SOAK_SECONDS}s`);

    // 1. Networks, limits and fee schedules -------------------------------------
    const [mainnetInfo, testnetInfo, mainnetSettings, testnetSettings] = await Promise.all([
        networkInfo(MAINNET),
        networkInfo(TESTNET),
        configSettings(MAINNET),
        configSettings(TESTNET),
    ]);
    const limits = { mainnet: transactionLimits(mainnetSettings), testnet: transactionLimits(testnetSettings) };
    log('network limits', JSON.stringify(limits));

    // 2. Throwaway testnet instance, with real credentials ----------------------
    const instance = await deployThrowawayInstance();
    const { contractId, issuer } = instance;
    const issuerScVal = new Address(issuer.publicKey()).toScVal();

    const singleIssues = [];
    const issued: Array<{ tokenId: bigint; hashHex: string }> = [];
    for (let i = 0; i < 3; i++) {
        const hashHex = randomHashHex();
        const result = await submit(
            TESTNET,
            issuer,
            // issue_credential(student, issuer, credential_hash, expires_at)
            new Contract(contractId).call(
                'issue_credential',
                new Address(Keypair.random().publicKey()).toScVal(),
                issuerScVal,
                xdr.ScVal.scvBytes(Buffer.from(hashHex, 'hex')),
                xdr.ScVal.scvVoid(),
            ),
        );
        issued.push({ tokenId: BigInt(result.returnValue as bigint), hashHex });
        singleIssues.push(result);
    }
    log('issued 3 single credentials');

    const batchHashes = Array.from({ length: CONTRACT.MAX_BATCH_SIZE }, randomHashHex);
    const batch = await submit(
        TESTNET,
        issuer,
        new Contract(contractId).call('batch_issue_credential', issuerScVal, xdr.ScVal.scvVec(batchHashes.map(batchRow))),
    );
    const batchResults = batch.returnValue as Array<{ success: boolean; token_id: bigint }>;
    batchResults.forEach((row, index) => {
        if (row.success) issued.push({ tokenId: BigInt(row.token_id), hashHex: batchHashes[index] });
    });
    log(`issued a batch of ${CONTRACT.MAX_BATCH_SIZE}: ${batchResults.filter((row) => row.success).length} succeeded`);

    // Storage actually written per credential, and the TTL it was given.
    const sample0 = issued[0];
    const keys0 = credentialKeys(contractId, sample0.tokenId, sample0.hashHex);
    const { entries: written, latestLedger: ledgerAfterIssue } = await TESTNET.server.getLedgerEntries(
        keys0.credential,
        keys0.hashIndex,
    );
    const entrySizes = written.map((entry) => entry.val.toXDR().length);
    const credentialStorageBytes = entrySizes.reduce((sum, size) => sum + size, 0);
    const issueLedger = singleIssues[0].ledger;
    const liveUntil = Math.min(...written.map((entry) => Number(entry.liveUntilLedgerSeq)));
    const effectiveTtlLedgers = liveUntil - issueLedger;
    log(`credential storage ${entrySizes.join(' + ')} bytes, TTL ${effectiveTtlLedgers} ledgers`);

    // Keeper duration: one step exactly as src/app/api/cron/ttl-keeper/route.ts
    // runs it per token (TTL read, account load, simulate, assemble, sign,
    // send, poll every 2 s), timed, on distinct tokens.
    const KEEPER_TIMED_STEPS = 12;
    const keeperStepMs: number[] = [];
    const keeperStepFees: number[] = [];
    for (const { tokenId } of issued.slice(0, KEEPER_TIMED_STEPS)) {
        const start = performance.now();
        await TESTNET.server.getContractData(
            contractId,
            xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Credential'), u64(tokenId)]),
            rpc.Durability.Persistent,
        );
        const account = await TESTNET.server.getAccount(issuer.publicKey());
        const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: TESTNET.passphrase })
            .addOperation(new Contract(contractId).call('bump_credential', u64(tokenId)))
            .setTimeout(60)
            .build();
        const simulation = await TESTNET.server.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(simulation)) throw new Error('keeper step simulation failed');
        const prepared = rpc.assembleTransaction(tx, simulation).build();
        prepared.sign(issuer);
        const sent = await TESTNET.server.sendTransaction(prepared);
        if (sent.status === 'ERROR') throw new Error('keeper step submission failed');
        let confirmed = false;
        for (let attempt = 0; attempt < 10 && !confirmed; attempt++) {
            const result = await TESTNET.server.getTransaction(sent.hash);
            if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
                confirmed = true;
                keeperStepFees.push(Number((plain(result.resultXdr) as { fee_charged: number }).fee_charged));
            } else if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
                break;
            } else {
                await sleep(2_000);
            }
        }
        if (!confirmed) throw new Error(`keeper step ${sent.hash} did not confirm`);
        keeperStepMs.push(performance.now() - start);
    }
    const keeperStep = distribution(keeperStepMs);
    log(`keeper step p50 ${keeperStep?.p50} ms over ${keeperStepMs.length} tokens`);

    // 3. MAX_BATCH_SIZE from simulated resources --------------------------------
    const scan: Array<SimResources & { size: number; txSizeBytes: number }> = [];
    for (const size of BATCH_SIZES) {
        const rows = Array.from({ length: size }, () => batchRow(randomHashHex()));
        const tx = readTx(TESTNET, contractId, 'batch_issue_credential', [issuerScVal, xdr.ScVal.scvVec(rows)], issuer.publicKey());
        const sim = await simulate(TESTNET, tx);
        const assembled = rpc.assembleTransaction(tx, sim).build();
        // + one 72-byte envelope signature; the auth entry is source-account
        // credentials, which carry no separate signature.
        scan.push({ size, ...resourcesOf(sim), txSizeBytes: assembled.toEnvelope().toXDR().length + 72 });
    }
    const resources = ['instructions', 'diskReadBytes', 'writeBytes', 'writeEntries', 'footprintEntries', 'contractEventsBytes', 'txSizeBytes'] as const;
    const fits = Object.fromEntries(
        resources.map((resource) => [resource, linearFit(scan.map((point) => [point.size, point[resource]] as [number, number]))]),
    );
    const limitFor: Record<(typeof resources)[number], keyof ReturnType<typeof transactionLimits>> = {
        instructions: 'instructions',
        diskReadBytes: 'diskReadBytes',
        writeBytes: 'writeBytes',
        writeEntries: 'writeEntries',
        footprintEntries: 'footprintEntries',
        contractEventsBytes: 'contractEventsBytes',
        txSizeBytes: 'txSizeBytes',
    };
    const maxRowsUnder = (networkLimits: ReturnType<typeof transactionLimits>) =>
        Object.fromEntries(
            resources.map((resource) => {
                const limit = networkLimits[limitFor[resource]];
                const { intercept, slope } = fits[resource];
                const rows = limit === null || slope <= 0 ? null : Math.floor((limit - intercept) / slope);
                return [resource, { limit, perRow: Number(slope.toFixed(2)), fixed: Math.round(intercept), maxRows: rows }];
            }),
        );
    const derived = { mainnet: maxRowsUnder(limits.mainnet), testnet: maxRowsUnder(limits.testnet) };
    const binding = (perResource: ReturnType<typeof maxRowsUnder>) =>
        Object.entries(perResource)
            .filter(([, value]) => value.maxRows !== null)
            .sort(([, a], [, b]) => (a.maxRows as number) - (b.maxRows as number))[0];

    // 4. Fees ---------------------------------------------------------------------
    // a) bump_credential as the keeper runs it, right after issuance (TTL above
    //    the threshold, so nothing is extended: the keeper's no-op cost).
    // Any funded account can send it, as the keeper's own account does.
    const bumpNoop = await submit(TESTNET, issuer, new Contract(contractId).call('bump_credential', u64(sample0.tokenId)));

    // b) Rent, measured without a formula: simulate extending the same entries
    //    to two TTLs and difference the fees. Both targets are above the
    //    entries' current TTL, so the difference is pure rent for the extra ledgers.
    async function extendFee(net: Network, keysToExtend: xdr.LedgerKey[], extendTo: number) {
        const tx = new TransactionBuilder(new Account(sorobanContract.NULL_ACCOUNT, '0'), {
            fee: '100',
            networkPassphrase: net.passphrase,
        })
            .addOperation(Operation.extendFootprintTtl({ extendTo }))
            .setSorobanData(new SorobanDataBuilder().setReadOnly(keysToExtend).build())
            .setTimeout(0)
            .build();
        const sim = await simulate(net, tx);
        return Number(sim.minResourceFee);
    }

    async function rentRate(net: Network, keysToExtend: xdr.LedgerKey[], maxEntryTtl: number) {
        const { entries, latestLedger } = await net.server.getLedgerEntries(...keysToExtend);
        const bytes = entries.reduce((sum, entry) => sum + entry.val.toXDR().length, 0);
        const remaining = Math.max(...entries.map((entry) => Number(entry.liveUntilLedgerSeq) - latestLedger));
        const high = maxEntryTtl - 1;
        const low = Math.max(remaining + 10_000, high - 1_000_000);
        if (low >= high) return { bytes, remaining, note: 'entry TTL already near the maximum; rent not measurable', perByteLedger: null };
        const [feeHigh, feeLow] = [await extendFee(net, keysToExtend, high), await extendFee(net, keysToExtend, low)];
        const perLedger = (feeHigh - feeLow) / (high - low);
        return {
            bytes,
            remaining,
            extendToLow: low,
            extendToHigh: high,
            feeLowStroops: feeLow,
            feeHighStroops: feeHigh,
            perLedgerStroops: perLedger,
            perByteLedger: perLedger / bytes,
        };
    }

    const testnetMaxTtl = limits.testnet.maxEntryTtl ?? CONTRACT.PERSISTENT_BUMP_AMOUNT;
    const mainnetMaxTtl = limits.mainnet.maxEntryTtl ?? CONTRACT.PERSISTENT_BUMP_AMOUNT;

    type RentMeasurement = Awaited<ReturnType<typeof rentRate>> & { entry?: string };
    /** The first candidate entry with TTL headroom gives the network's rent rate. */
    async function firstMeasurableRent(net: Network, candidates: Array<{ label: string; keys: xdr.LedgerKey[] }>, maxTtl: number) {
        let result: RentMeasurement = { bytes: 0, remaining: 0, note: 'no candidate measured', perByteLedger: null };
        for (const candidate of candidates) {
            try {
                const measured = await rentRate(net, candidate.keys, maxTtl);
                result = { ...measured, entry: candidate.label };
                if (measured.perByteLedger !== null) break;
            } catch (error) {
                log(`${net.name} rent on ${candidate.label} failed:`, error instanceof Error ? error.message : error);
            }
        }
        return result;
    }

    // Fresh credentials already sit at the maximum TTL, so their own rent
    // cannot be differenced; persistent instance entries with headroom can.
    // Rent is charged per byte, so the rate carries over to credential entries.
    const testnetRent = await firstMeasurableRent(
        TESTNET,
        [
            { label: 'Acredia production testnet contract instance', keys: [instanceKey(ACREDIA_TESTNET_CONTRACT)] },
            { label: 'native XLM SAC instance', keys: [instanceKey(Asset.native().contractId(Networks.TESTNET))] },
        ],
        testnetMaxTtl,
    );

    // Mainnet has no Acredia entries: Stellar Asset Contract instances.
    const mainnetCandidates = [
        { label: 'native XLM SAC instance', contractId: Asset.native().contractId(Networks.PUBLIC) },
        {
            label: 'USDC SAC instance',
            contractId: new Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN').contractId(Networks.PUBLIC),
        },
        {
            label: 'EURC SAC instance',
            contractId: new Asset('EURC', 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2').contractId(Networks.PUBLIC),
        },
    ];
    const mainnetRent = await firstMeasurableRent(
        MAINNET,
        mainnetCandidates.map(({ label, contractId: id }) => ({ label, keys: [instanceKey(id)] })),
        mainnetMaxTtl,
    );

    // c) A multi-entry TTL extension (what a batched keeper would send), for
    //    the per-credential share of the fixed transaction cost.
    const multiExtend = [];
    for (const credentials of [1, 5, 10, Math.min(20, issued.length)]) {
        const keysToExtend = issued.slice(0, credentials).flatMap(({ tokenId, hashHex }) => {
            const k = credentialKeys(contractId, tokenId, hashHex);
            return [k.credential, k.hashIndex];
        });
        multiExtend.push({ credentials, entries: keysToExtend.length, minResourceFeeStroops: await extendFee(TESTNET, keysToExtend, testnetMaxTtl - 1) });
    }

    // 5. Latency --------------------------------------------------------------------
    const tokenArg = u64(sample0.tokenId);
    const testnetCalls: Record<string, Call> = {
        getLatestLedger: () => TESTNET.server.getLatestLedger(),
        'simulate get_credential (found)': () => read(TESTNET, contractId, 'get_credential', [tokenArg]),
        'simulate is_revoked': () => read(TESTNET, contractId, 'is_revoked', [tokenArg]),
        'simulate is_authorized_issuer': () => read(TESTNET, contractId, 'is_authorized_issuer', [issuerScVal]),
    };
    const sac = Asset.native().contractId(Networks.PUBLIC);
    const usdcSac = mainnetCandidates[1].contractId;
    const holder = new Address(usdcSac).toScVal();
    const mainnetCalls: Record<string, Call> = {
        getLatestLedger: () => MAINNET.server.getLatestLedger(),
        'simulate SAC balance (instance + persistent read)': () => read(MAINNET, sac, 'balance', [holder]),
        'simulate SAC decimals (instance read)': () => read(MAINNET, sac, 'decimals'),
        'getLedgerEntries (1 contract-data key)': () => MAINNET.server.getLedgerEntries(instanceKey(sac)),
    };
    const testnetVerification: Call = async () => {
        await read(TESTNET, contractId, 'get_credential', [tokenArg]);
        await read(TESTNET, contractId, 'is_revoked', [tokenArg]);
        await read(TESTNET, contractId, 'is_authorized_issuer', [issuerScVal]);
    };
    const mainnetVerification: Call = async () => {
        await read(MAINNET, sac, 'balance', [holder]);
        await read(MAINNET, sac, 'balance', [holder]);
        await read(MAINNET, sac, 'decimals');
    };

    const latency: Record<string, Record<string, unknown>> = { mainnet: {}, testnet: {} };
    for (const [name, call] of Object.entries(mainnetCalls)) latency.mainnet[name] = await sample(`mainnet ${name}`, call);
    for (const [name, call] of Object.entries(testnetCalls)) latency.testnet[name] = await sample(`testnet ${name}`, call);
    latency.mainnet['cold-cache verification (3 sequential reads)'] = await sample('mainnet verification', mainnetVerification, Math.ceil(SAMPLES / 2));
    latency.testnet['cold-cache verification (3 sequential reads)'] = await sample('testnet verification', testnetVerification, Math.ceil(SAMPLES / 2));

    // 6. Soak ---------------------------------------------------------------------
    const soakResults = {
        mainnet: await soak('mainnet soak', mainnetVerification),
        testnet: await soak('testnet soak', testnetVerification),
    };

    // 6b. Rent on the credential entries themselves. They were created at the
    //     maximum TTL; by now enough ledgers have passed to difference two
    //     extensions (remaining + 1 vs maximum) on the exact entries.
    const credentialRent = await (async () => {
        const keysToExtend = [keys0.credential, keys0.hashIndex];
        const { entries, latestLedger } = await TESTNET.server.getLedgerEntries(...keysToExtend);
        const remaining = Math.max(...entries.map((entry) => Number(entry.liveUntilLedgerSeq) - latestLedger));
        const high = testnetMaxTtl - 1;
        const low = remaining + 1;
        if (high - low < 100) return { remaining, note: 'fewer than 100 ledgers of headroom; not measured', perLedgerStroops: null };
        const feeHigh = await extendFee(TESTNET, keysToExtend, high);
        const feeLow = await extendFee(TESTNET, keysToExtend, low);
        const perLedger = (feeHigh - feeLow) / (high - low);
        return {
            remaining,
            extendToLow: low,
            extendToHigh: high,
            feeLowStroops: feeLow,
            feeHighStroops: feeHigh,
            perLedgerStroops: perLedger,
            perByteLedger: perLedger / credentialStorageBytes,
        };
    })();
    log(`credential rent ${credentialRent.perLedgerStroops} stroops/ledger`);

    // 7. Projections --------------------------------------------------------------
    const perCredentialBatchFee = batch.feeChargedStroops / CONTRACT.MAX_BATCH_SIZE;
    const ledgersPerYear = mainnetInfo.ledgersPerYear ?? 6_307_200;
    const rentRatio =
        mainnetRent.perByteLedger && testnetRent.perByteLedger ? mainnetRent.perByteLedger / testnetRent.perByteLedger : null;
    // Ongoing rent per credential: measured on its own entries (testnet), and
    // priced for mainnet with the ratio of the two networks' rates measured on
    // like entries (instance entries on both), which cancels entry kind.
    const annualRentTestnet =
        credentialRent.perLedgerStroops === null ? null : credentialRent.perLedgerStroops * ledgersPerYear;
    const annualRentMainnet = annualRentTestnet === null || rentRatio === null ? null : annualRentTestnet * rentRatio;
    // Issuance is used as measured. It prepays the first ~180 days of rent, but
    // at less than an extension over the same ledgers costs, so it is not split
    // into rent and the rest. Budget with the testnet figure (conservative:
    // mainnet's rent rate is lower); the scaled figure is the expected one.
    const mainnetIssuePerCredential = rentRatio === null ? null : perCredentialBatchFee * rentRatio;
    const inclusionP90 = mainnetInfo.sorobanInclusionFeeStroops.p90;
    const batchedExtend = multiExtend[multiExtend.length - 1];
    const keeperCurrentTxPerYear = KEEPER.PAGE_SIZE * 365 * KEEPER.RUNS_PER_DAY;
    const keeperCapacity = KEEPER.PAGE_SIZE * KEEPER.COVERAGE_WINDOW_DAYS;

    const projections = Object.fromEntries(
        VOLUMES.map((volume) => {
            const issuanceStroops =
                volume * perCredentialBatchFee + Math.ceil(volume / CONTRACT.MAX_BATCH_SIZE) * inclusionP90;
            const issuanceExpectedStroops =
                mainnetIssuePerCredential === null
                    ? null
                    : volume * mainnetIssuePerCredential + Math.ceil(volume / CONTRACT.MAX_BATCH_SIZE) * inclusionP90;
            // Batched keeper: extend every entry to the maximum TTL once per
            // coverage window, `batchedExtend.credentials` credentials per tx.
            const extendsPerYear = Math.ceil(365 / KEEPER.COVERAGE_WINDOW_DAYS);
            const batchedTxPerYear = Math.ceil(volume / batchedExtend.credentials) * extendsPerYear;
            const batchedOverheadStroops = batchedTxPerYear * (batchedExtend.minResourceFeeStroops + inclusionP90);
            const currentOverheadStroops = keeperCurrentTxPerYear * (bumpNoop.feeChargedStroops + inclusionP90);
            return [
                volume,
                {
                    issuanceOneTimeXlm: Number((issuanceStroops / 1e7).toFixed(2)),
                    issuanceOneTimeExpectedXlm:
                        issuanceExpectedStroops === null ? null : Number((issuanceExpectedStroops / 1e7).toFixed(2)),
                    rentPerYearXlm: annualRentMainnet === null ? null : Number(((annualRentMainnet * volume) / 1e7).toFixed(2)),
                    currentKeeper: {
                        coversAllCredentials: volume <= keeperCapacity,
                        txPerYear: keeperCurrentTxPerYear,
                        txOverheadPerYearXlm: Number((currentOverheadStroops / 1e7).toFixed(2)),
                    },
                    batchedKeeper: {
                        credentialsPerTx: batchedExtend.credentials,
                        txPerYear: batchedTxPerYear,
                        txOverheadPerYearXlm: Number((batchedOverheadStroops / 1e7).toFixed(2)),
                    },
                },
            ];
        }),
    );

    const output = {
        capturedAt,
        tool: 'frontend/scripts/measure-rpc-baselines.ts',
        parameters: { samples: SAMPLES, soakSeconds: SOAK_SECONDS, soakRps: SOAK_RPS, appRpcTimeoutMs: APP_RPC_TIMEOUT_MS },
        networks: { mainnet: mainnetInfo, testnet: testnetInfo },
        limits,
        feeSchedules: {
            mainnet: pickFees(mainnetSettings),
            testnet: pickFees(testnetSettings),
        },
        throwawayTestnetInstance: {
            contractId,
            wasmSha256: instance.wasmSha256,
            deployTx: instance.deploy.hash,
            owner: instance.owner.publicKey(),
            issuer: issuer.publicKey(),
            credentialsIssued: issued.length,
        },
        latency,
        soak: soakResults,
        keeper: {
            method: 'one step per token exactly as the cron route runs it, timed on testnet',
            stepMs: keeperStep,
            pageSize: KEEPER.PAGE_SIZE,
            maxDurationSeconds: 300,
            // Sequential, so a page takes about pageSize steps.
            projectedPageSecondsAtP50: keeperStep ? Math.round((keeperStep.p50 * KEEPER.PAGE_SIZE) / 1000) : null,
            projectedPageSecondsAtP95: keeperStep ? Math.round((keeperStep.p95 * KEEPER.PAGE_SIZE) / 1000) : null,
            maxStepsIn300sAtP95: keeperStep ? Math.floor(300_000 / keeperStep.p95) : null,
            inclusionFeeBidStroops: 100,
            capacityCredentials: KEEPER.PAGE_SIZE * KEEPER.COVERAGE_WINDOW_DAYS,
        },
        batch: {
            scan,
            fits,
            maxRowsByResource: derived,
            bindingResource: {
                mainnet: binding(derived.mainnet),
                testnet: binding(derived.testnet),
            },
        },
        storage: {
            entryBytes: entrySizes,
            credentialStorageBytes,
            issueLedger,
            liveUntilLedger: liveUntil,
            effectiveTtlLedgers,
            contractBumpAmount: CONTRACT.PERSISTENT_BUMP_AMOUNT,
            contractThreshold: CONTRACT.PERSISTENT_THRESHOLD,
            ledgerAfterIssue,
        },
        fees: {
            singleIssue: singleIssues.map((tx) => ({ hash: tx.hash, feeChargedStroops: tx.feeChargedStroops })),
            batchIssue: {
                rows: CONTRACT.MAX_BATCH_SIZE,
                hash: batch.hash,
                feeChargedStroops: batch.feeChargedStroops,
                perCredentialStroops: Math.round(perCredentialBatchFee),
                mainnetExpectedPerCredentialStroops: mainnetIssuePerCredential === null ? null : Math.round(mainnetIssuePerCredential),
            },
            bumpCredentialNoExtension: { hash: bumpNoop.hash, feeChargedStroops: bumpNoop.feeChargedStroops },
            keeperStepFeeChargedStroops: distribution(keeperStepFees),
            rent: {
                credentialEntriesTestnet: credentialRent,
                instanceEntryTestnet: testnetRent,
                instanceEntryMainnet: mainnetRent,
                mainnetToTestnetRatio: rentRatio,
            },
            annualRentPerCredentialStroops: {
                testnet: annualRentTestnet === null ? null : Math.round(annualRentTestnet),
                mainnet: annualRentMainnet === null ? null : Math.round(annualRentMainnet),
            },
            multiEntryExtendSimulated: multiExtend,
            // A batched keeper's credentials-per-transaction ceiling: two
            // read-only footprint entries per credential.
            maxCredentialsPerExtendTx: {
                byFootprintEntries: limits.mainnet.footprintEntries === null ? null : Math.floor(limits.mainnet.footprintEntries / 2),
                byDiskReadBytes: limits.mainnet.diskReadBytes === null ? null : Math.floor(limits.mainnet.diskReadBytes / credentialStorageBytes),
            },
            mainnetSorobanInclusionFeeP90Stroops: inclusionP90,
        },
        projections,
    };

    writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`);
    log(`wrote ${OUT}`);
}

/** The fee-rate fields, for comparing the two networks' schedules side by side. */
function pickFees(settings: Record<string, unknown>) {
    const fees: Record<string, unknown> = {};
    for (const [setting, value] of Object.entries(settings)) {
        if (!value || typeof value !== 'object') continue;
        for (const [field, inner] of Object.entries(value as Record<string, unknown>)) {
            if (/fee|rent|rate|denominator|soroban_state_target|growth/i.test(field)) fees[`${setting}.${field}`] = inner;
        }
    }
    return fees;
}

main().catch((error) => {
    console.error('[baselines] failed:', error);
    process.exit(1);
});
