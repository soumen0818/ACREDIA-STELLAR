import { afterEach, describe, expect, it, vi } from 'vitest';
import { getE2eState, isE2eBuild, updateE2eState, type E2eState } from '../src/lib/e2e';

/**
 * E2E test mode is a build-time switch (review §3.5).
 *
 * It used to turn on whenever `window.__ACREDIA_E2E__` existed, so anyone
 * could set it in devtools on production and render a fake "Verified"
 * credential.
 */

const fakeState: E2eState = { enabled: true, role: 'student' };

function withPageState(state: E2eState) {
    const sessionStorage = { setItem: vi.fn() };
    vi.stubGlobal('window', { __ACREDIA_E2E__: state, sessionStorage });
    return sessionStorage;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('E2E test mode gate', () => {
    it('ignores a page that sets __ACREDIA_E2E__ when the build is not an E2E build', () => {
        vi.stubEnv('NEXT_PUBLIC_E2E', '');
        const sessionStorage = withPageState(fakeState);

        expect(isE2eBuild()).toBe(false);
        expect(getE2eState()).toBeNull();
        expect(updateE2eState((s) => void (s.role = 'admin'))).toBeNull();
        expect(sessionStorage.setItem).not.toHaveBeenCalled();
    });

    it('stays off in a production build even if NEXT_PUBLIC_E2E is set by mistake', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_E2E', 'true');
        withPageState(fakeState);

        expect(isE2eBuild()).toBe(false);
        expect(getE2eState()).toBeNull();
    });

    it('reads the page state in a non-production build with NEXT_PUBLIC_E2E=true', () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('NEXT_PUBLIC_E2E', 'true');
        const sessionStorage = withPageState({ ...fakeState });

        expect(getE2eState()).toMatchObject({ enabled: true, role: 'student' });
        expect(updateE2eState((s) => void (s.role = 'admin'))).toMatchObject({ role: 'admin' });
        expect(sessionStorage.setItem).toHaveBeenCalledOnce();
    });

    it('returns nothing on the server, whatever the flags', () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('NEXT_PUBLIC_E2E', 'true');

        expect(getE2eState()).toBeNull();
    });
});
