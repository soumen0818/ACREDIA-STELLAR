/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { debugLog, debugWarn, isDebugLoggingEnabled } from '../src/lib/debug';

const originalNodeEnv = process.env.NODE_ENV;
const originalDebugFlag = process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS;

afterEach(() => {
    (process.env as any).NODE_ENV = originalNodeEnv;
    if (typeof originalDebugFlag === 'undefined') {
        delete process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS;
    } else {
        process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS = originalDebugFlag;
    }
    vi.restoreAllMocks();
});

describe('debug logging', () => {
    it('stays disabled in production', () => {
        (process.env as any).NODE_ENV = 'production';
        process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS = 'true';

        expect(isDebugLoggingEnabled()).toBe(false);
    });

    it('stays disabled without the explicit debug flag', () => {
        (process.env as any).NODE_ENV = 'development';
        delete process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS;

        expect(isDebugLoggingEnabled()).toBe(false);
    });

    it('logs only when debug logging is explicitly enabled outside production', () => {
        (process.env as any).NODE_ENV = 'development';
        process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS = 'true';

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        debugLog('test log');
        debugWarn('test warn');

        expect(logSpy).toHaveBeenCalledWith('test log');
        expect(warnSpy).toHaveBeenCalledWith('test warn');
    });
});
