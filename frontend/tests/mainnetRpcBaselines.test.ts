import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEEPER_COVERAGE_WINDOW_DAYS, KEEPER_PAGE_SIZE } from '../src/lib/ttlKeeper';

/**
 * Issue #314: the committed mainnet-latency baselines
 * (tests/mainnet-rpc-baselines.json, measured by
 * scripts/measure-rpc-baselines.ts) stay consistent with the code they were
 * measured against. These tests make no network calls; they fail when the
 * code moves past what the numbers cover, so the numbers are re-measured
 * rather than silently stale.
 */

const ROOT = join(process.cwd(), '..');
const baselines = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'mainnet-rpc-baselines.json'), 'utf8'));
const contractSource = readFileSync(join(ROOT, 'contracts', 'src', 'lib.rs'), 'utf8');

function contractConstant(name: string): number {
    const match = contractSource.match(new RegExp(`const ${name}: u32 = ([\\d_]+);`));
    if (!match) throw new Error(`${name} not found in contracts/src/lib.rs`);
    return Number(match[1].replace(/_/g, ''));
}

describe('mainnet RPC baselines (#314)', () => {
    it('records when and how they were measured', () => {
        expect(Date.parse(baselines.capturedAt)).not.toBeNaN();
        expect(existsSync(join(ROOT, baselines.tool))).toBe(true);
        expect(baselines.networks.mainnet.passphrase).toBe('Public Global Stellar Network ; September 2015');
        expect(baselines.parameters.samples).toBeGreaterThanOrEqual(30);
    });

    it('measured every verification call on both networks, without errors outside the soak', () => {
        for (const network of ['mainnet', 'testnet']) {
            const calls = baselines.latency[network];
            expect(calls['cold-cache verification (3 sequential reads)'].latencyMs.p95).toBeGreaterThan(0);
            for (const call of Object.values(calls) as Array<{ latencyMs: { n: number } | null }>) {
                expect(call.latencyMs?.n).toBeGreaterThan(0);
            }
        }
    });

    it('covers MAX_BATCH_SIZE: the contract value is within the measured mainnet ceiling', () => {
        const maxBatch = contractConstant('MAX_BATCH_SIZE');
        const [resource, binding] = baselines.batch.bindingResource.mainnet;
        expect(typeof resource).toBe('string');
        // A larger batch than the measured ceiling would fail on mainnet.
        expect(maxBatch).toBeLessThanOrEqual(binding.maxRows);
        // The scan reached the contract's own maximum, so the fit is not an extrapolation below it.
        expect(Math.max(...baselines.batch.scan.map((point: { size: number }) => point.size))).toBe(maxBatch);
    });

    it("matches the keeper it priced: page size and coverage window", () => {
        expect(baselines.keeper.pageSize).toBe(KEEPER_PAGE_SIZE);
        expect(baselines.keeper.capacityCredentials).toBe(KEEPER_PAGE_SIZE * KEEPER_COVERAGE_WINDOW_DAYS);
    });

    it('measured the TTL credentials actually get: within the network maximum', () => {
        const { effectiveTtlLedgers, contractBumpAmount } = baselines.storage;
        expect(contractBumpAmount).toBe(contractConstant('PERSISTENT_BUMP_AMOUNT'));
        expect(effectiveTtlLedgers).toBeLessThan(baselines.limits.mainnet.maxEntryTtl);
    });

    it('estimates fees at three credential volumes', () => {
        for (const volume of ['1000', '10000', '100000']) {
            const projection = baselines.projections[volume];
            expect(projection.issuanceOneTimeXlm).toBeGreaterThan(0);
            expect(projection.rentPerYearXlm).toBeGreaterThan(0);
            expect(projection.batchedKeeper.txPerYear).toBeGreaterThan(0);
        }
    });

    it('is referenced from the mainnet readiness document', () => {
        const readiness = readFileSync(join(ROOT, 'docs', 'mainnet-readiness.md'), 'utf8');
        expect(readiness).toContain('testing/mainnet-rpc-baselines.md');
        const writeUp = readFileSync(join(ROOT, 'docs', 'testing', 'mainnet-rpc-baselines.md'), 'utf8');
        expect(writeUp).toContain('frontend/tests/mainnet-rpc-baselines.json');
        expect(writeUp).toContain(baselines.capturedAt.slice(0, 10));
    });
});
