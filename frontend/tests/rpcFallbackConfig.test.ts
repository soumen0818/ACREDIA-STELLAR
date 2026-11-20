/**
 * Issue #313 — SOROBAN_RPC_FALLBACK_URLS validation (src/lib/runtimeConfig.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_SOROBAN_RPC_FALLBACK_URLS, parseSorobanRpcFallbackUrls } from '../src/lib/runtimeConfig';

const PRIMARY = 'https://soroban-testnet.stellar.org';

describe('parseSorobanRpcFallbackUrls', () => {
    it('is empty when unset', () => {
        expect(parseSorobanRpcFallbackUrls(undefined, PRIMARY, true)).toEqual([]);
        expect(parseSorobanRpcFallbackUrls('  ', PRIMARY, true)).toEqual([]);
    });

    it('keeps the configured order, splitting on commas and whitespace', () => {
        expect(
            parseSorobanRpcFallbackUrls(' https://rpc-a.test/ ,https://rpc-b.test/v1\nhttps://rpc-c.test ', PRIMARY, true),
        ).toEqual(['https://rpc-a.test', 'https://rpc-b.test/v1', 'https://rpc-c.test']);
    });

    it('drops duplicates and the primary itself', () => {
        expect(
            parseSorobanRpcFallbackUrls(`https://rpc-a.test, ${PRIMARY}/, https://rpc-a.test/`, PRIMARY, true),
        ).toEqual(['https://rpc-a.test']);
    });

    it('requires HTTPS in production', () => {
        expect(() => parseSorobanRpcFallbackUrls('http://rpc-a.test', PRIMARY, true)).toThrow(/HTTPS URL in production/);
    });

    it('allows plain HTTP outside production, for a local RPC', () => {
        expect(parseSorobanRpcFallbackUrls('http://localhost:8000/soroban/rpc', PRIMARY, false)).toEqual([
            'http://localhost:8000/soroban/rpc',
        ]);
    });

    it.each(['not a url', 'ftp://rpc-a.test', 'wss://rpc-a.test'])('rejects %s', (entry) => {
        expect(() => parseSorobanRpcFallbackUrls(entry, PRIMARY, false)).toThrow(/\[runtime-config\]/);
    });

    it('rejects a placeholder left from the example env file', () => {
        expect(() => parseSorobanRpcFallbackUrls('https://your-project-rpc.test', PRIMARY, true)).toThrow(/placeholder/);
    });

    it(`allows at most ${MAX_SOROBAN_RPC_FALLBACK_URLS} endpoints`, () => {
        const four = ['a', 'b', 'c', 'd'].map((name) => `https://rpc-${name}.test`).join(',');
        expect(() => parseSorobanRpcFallbackUrls(four, PRIMARY, true)).toThrow(/at most 3/);
    });

    it('never repeats an entry in its error: a provider URL can carry an API key', () => {
        try {
            parseSorobanRpcFallbackUrls('https://rpc-a.test, http://rpc-b.test/apikey/SECRET123', PRIMARY, true);
            expect.unreachable();
        } catch (error) {
            expect((error as Error).message).toContain('entry 2');
            expect((error as Error).message).not.toContain('SECRET123');
        }
    });
});

describe('serverRuntimeConfig.stellar', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('reads SOROBAN_RPC_FALLBACK_URLS on the server', async () => {
        vi.stubEnv('SOROBAN_RPC_FALLBACK_URLS', 'https://rpc-a.test,https://rpc-b.test');
        const { serverRuntimeConfig } = await import('../src/lib/runtimeConfig');
        expect(serverRuntimeConfig.stellar.sorobanRpcFallbackUrls).toEqual(['https://rpc-a.test', 'https://rpc-b.test']);
    });

    it('fails the boot on an invalid entry rather than silently running without failover', async () => {
        vi.stubEnv('SOROBAN_RPC_FALLBACK_URLS', 'not a url');
        await expect(import('../src/lib/runtimeConfig')).rejects.toThrow(/SOROBAN_RPC_FALLBACK_URLS/);
    });

    it('is not a public variable: the browser keeps its single RPC URL', async () => {
        const source = (await import('node:fs')).readFileSync('src/lib/runtimeConfig.ts', 'utf8');
        expect(source).not.toContain('NEXT_PUBLIC_SOROBAN_RPC_FALLBACK');
    });
});
