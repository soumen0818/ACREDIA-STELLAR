import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';

/**
 * Credential notification emails link to a page that exists: the holder's
 * share page (review §5.6 #5, §3.11b). They used to link to `/verify/{id}`,
 * which was a 404.
 */

const SHARE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const state = vi.hoisted(() => ({
    credential: null as Record<string, unknown> | null,
    jobInsert: vi.fn(),
}));

vi.mock('@/lib/siteUrl', () => ({ getSiteUrl: () => 'https://acredia.example' }));

vi.mock('@/lib/institutionMembership', () => ({
    resolveInstitutionForUser: async () => ({ institutionId: 'inst-1', role: 'issuer', status: 'active' }),
    canWrite: () => true,
}));

vi.mock('@/lib/serverAuth', () => ({
    requireAuthenticatedRequest: async () => ({ ok: true, userId: 'user-1' }),
    getServiceRoleClient: () => ({
        from: (table: string) => {
            if (table === 'jobs') {
                return { insert: state.jobInsert };
            }
            const query = {
                select: () => query,
                eq: () => query,
                single: async () => ({
                    data: table === 'institutions' ? { id: 'inst-1', name: 'Uni Example' } : state.credential,
                    error: null,
                }),
            };
            return query;
        },
    }),
}));

import { POST } from '@/app/api/notifications/trigger/route';

let ip = 0;
async function notify(type: 'issued' | 'revoked') {
    ip += 1;
    const response = await POST(
        new NextRequest('http://localhost/api/notifications/trigger', {
            method: 'POST',
            headers: { 'x-forwarded-for': `192.0.2.${ip % 250}`, 'content-type': 'application/json' },
            body: JSON.stringify({ type, tokenId: '7' }),
        }),
    );
    return response;
}

function emailedUrl(): string {
    return state.jobInsert.mock.calls.at(-1)?.[0]?.payload?.payload?.credentialUrl;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    state.jobInsert.mockResolvedValue({ error: null });
    state.credential = {
        token_id: '7',
        share_token: SHARE,
        metadata: { credentialData: { studentName: 'Ada' } },
        students: { id: 'student-1', email: 'ada@uni.test', auth_user_id: 'auth-ada' },
    };
});

describe('credential notification links', () => {
    it.each(['issued', 'revoked'] as const)('the %s email links to the holder’s share page', async (type) => {
        expect((await notify(type)).status).toBe(200);
        expect(emailedUrl()).toBe(`https://acredia.example/credentials/${SHARE}`);
    });

    it('falls back to the status check when a credential has no share token', async () => {
        state.credential = { ...state.credential, share_token: null };
        await notify('issued');
        expect(emailedUrl()).toBe('https://acredia.example/verify?token=7');
    });

    it('links only to routes that exist', async () => {
        await notify('issued');
        const path = new URL(emailedUrl()).pathname;

        expect(path).toMatch(/^\/credentials\/[0-9a-f-]{36}$/);
        expect(existsSync(join(process.cwd(), 'src/app/credentials/[token]/page.tsx'))).toBe(true);
        // The old link's route never existed.
        expect(existsSync(join(process.cwd(), 'src/app/verify/[token]'))).toBe(false);
    });
});
