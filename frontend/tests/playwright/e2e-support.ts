import type { Page } from '@playwright/test';
import type { E2eAdminInstitution, E2eAdminStats, E2eState } from '@/lib/e2e';
import { assessContinuity } from '../../src/lib/institutionContinuity';

export function createE2eState(overrides: Partial<E2eState> = {}): E2eState {
    return {
        enabled: true,
        session: {
            user: {
                id: 'user-1',
                email: 'user@acredia.test',
                user_metadata: { name: 'Acredia User' },
            },
            access_token: 'e2e-access-token',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
        role: 'institution',
        walletAddress: 'GAcrediaIssuerWallet0000000000000000000000000000001',
        contractOwner: 'GAcrediaAdminWallet00000000000000000000000000000001',
        authorizedIssuers: ['GAcrediaIssuerWallet0000000000000000000000000000001'],
        institution: {
            id: 'inst-1',
            name: 'Acredia Academy',
            walletAddress: 'GAcrediaIssuerWallet0000000000000000000000000000001',
        },
        stats: createAdminStats(),
        adminInstitutions: [createAdminInstitution()],
        nextTokenId: 1,
        issuedCredentials: [],
        ...overrides,
    };
}

export function createAdminStats(overrides: Partial<E2eAdminStats> = {}): E2eAdminStats {
    return {
        totalInstitutions: 1,
        authorizedInstitutions: 1,
        totalCredentials: 0,
        activeCredentials: 0,
        totalStudents: 1,
        verificationActivity: {
            totalAttempts: 0,
            attemptsLast24h: 0,
            resultCounts: {
                verified: 0,
                revoked: 0,
                not_found: 0,
                chain_unavailable: 0,
                mismatch: 0,
                invalid_request: 0,
                server_error: 0,
            },
        },
        ...overrides,
    };
}

export function createAdminInstitution(
    overrides: Partial<E2eAdminInstitution> = {},
): E2eAdminInstitution {
    return {
        id: 'inst-1',
        name: 'Acredia Academy',
        email: 'issuer@acredia.test',
        walletAddress: 'GAcrediaIssuerWallet0000000000000000000000000000001',
        verified: true,
        status: 'verified',
        authorizationTxHash: null,
        createdAt: new Date().toISOString(),
        credentialCount: 0,
        activeCredentialCount: 0,
        ...overrides,
    };
}

export async function seedE2eState(page: Page, state: E2eState) {
    await page.addInitScript((initialState) => {
        const stored = window.sessionStorage.getItem('__ACREDIA_E2E__');
        if (stored) {
            try {
                window.__ACREDIA_E2E__ = JSON.parse(stored);
                return;
            } catch {
                // Fall back to initial state on parse failure
            }
        }
        window.__ACREDIA_E2E__ = initialState as typeof window.__ACREDIA_E2E__;
        window.sessionStorage.setItem('__ACREDIA_E2E__', JSON.stringify(initialState));
    }, state);
}

/**
 * Replace the E2E state of an already-loaded page and reload it.
 *
 * `seedE2eState` deliberately keeps whatever is already in sessionStorage, so
 * that state a test mutated (an issued credential, say) survives navigation.
 * That also means calling it a second time is a no-op — switching roles
 * mid-test has to overwrite the stored state explicitly.
 */
export async function applyE2eState(page: Page, state: E2eState) {
    await page.evaluate((next) => {
        window.__ACREDIA_E2E__ = next as typeof window.__ACREDIA_E2E__;
        window.sessionStorage.setItem('__ACREDIA_E2E__', JSON.stringify(next));
    }, state);
    await page.reload();
}

/**
 * Read the in-page E2E state from inside a route handler.
 *
 * Route callbacks can still be in flight when a test finishes, at which point
 * `page.evaluate` throws "Test ended". Returning `null` instead lets the
 * handler fulfil with an empty payload rather than failing the whole run.
 */
async function readE2eState(page: Page) {
    try {
        return await page.evaluate(() => window.__ACREDIA_E2E__);
    } catch {
        return null;
    }
}

/** A member of the E2E institution's team, as the team API reports it. */
export interface E2eTeamMember {
    id: string;
    name: string;
    email: string;
    role: 'owner' | 'issuer' | 'viewer';
    status: 'active' | 'invited';
    isYou?: boolean;
}

/** The signed-in owner alone — the single-point-of-contact state (Issue #307). */
export function soloTeam(): E2eTeamMember[] {
    return [
        { id: 'member-1', name: 'Acredia User', email: 'user@acredia.test', role: 'owner', status: 'active', isYou: true },
    ];
}

/**
 * Stateful stand-in for the team API (Issue #307). Continuity is computed by
 * the app's own `assessContinuity`, and removals apply the same last-owner and
 * last-issuer refusals as the database guard, so the UI is exercised against
 * the real rules rather than canned responses.
 */
async function installTeamRoutes(page: Page, initial: E2eTeamMember[]) {
    const team = initial.map((member) => ({ ...member }));
    const inviteExpiresAt = () => new Date(Date.now() + 7 * 86_400_000).toISOString();
    const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const canIssue = (role: string) => role === 'owner' || role === 'issuer';

    await page.route('**/api/institution/members**', async (route) => {
        const request = route.request();
        const [, memberId, action] =
            new URL(request.url()).pathname.match(/\/api\/institution\/members(?:\/([^/]+))?(?:\/(resend))?$/) ?? [];

        if (request.method() === 'GET') {
            const members = team.map((member) => ({
                ...member,
                isYou: Boolean(member.isYou),
                invitedAt: null,
                inviteExpiresAt: member.status === 'invited' ? inviteExpiresAt() : null,
                acceptedAt: member.status === 'active' ? new Date().toISOString() : null,
            }));
            await route.fulfill(json(200, { success: true, canManage: true, members, continuity: assessContinuity(team) }));
            return;
        }

        if (request.method() === 'POST' && !memberId) {
            const body = request.postDataJSON() as { email: string; name: string; role: E2eTeamMember['role'] };
            team.push({ id: `member-${team.length + 1}`, name: body.name, email: body.email, role: body.role, status: 'invited' });
            await route.fulfill(json(201, { success: true, message: `Invitation emailed to ${body.email}. It expires in 7 days.` }));
            return;
        }

        const target = team.find((member) => member.id === memberId);
        if (!target) {
            await route.fulfill(json(404, { success: false, code: 'member_not_found', error: 'That member is not part of this institution.' }));
            return;
        }

        if (action === 'resend') {
            await route.fulfill(json(200, { success: true, message: `Invitation emailed again to ${target.email}.` }));
            return;
        }

        const newRole = request.method() === 'PATCH' ? (request.postDataJSON() as { role: E2eTeamMember['role'] }).role : null;
        const others = team.filter((member) => member !== target && member.status === 'active');
        if (target.status === 'active' && target.role === 'owner' && newRole !== 'owner' && !others.some((m) => m.role === 'owner')) {
            await route.fulfill(json(409, { success: false, code: 'last_owner', error: 'This is the only owner. Make another active member an owner first, so someone can still manage the team.' }));
            return;
        }
        if (target.status === 'active' && canIssue(target.role) && !(newRole && canIssue(newRole)) && !others.some((m) => canIssue(m.role))) {
            await route.fulfill(json(409, { success: false, code: 'last_issuer', error: 'This is the only member who can issue credentials. Give another active member issuing rights first.' }));
            return;
        }

        if (newRole) target.role = newRole;
        else team.splice(team.indexOf(target), 1);
        await route.fulfill(json(200, { success: true, member: { id: target.id, role: target.role, status: target.status } }));
    });
}

export async function installE2eRoutes(page: Page, { team = soloTeam() }: { team?: E2eTeamMember[] } = {}) {
    await installTeamRoutes(page, team);

    // Institution membership is resolved through `institution_users` (Issue
    // #238). Without this the request failed and the app used to fall back to
    // the legacy single-login column on the error path; that fallback now
    // fails closed (Issue #307), so the membership has to be served.
    await page.route('**/rest/v1/institution_users**', async (route) => {
        const state = await readE2eState(page);
        const institution = state?.institution;

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                institution && state?.role === 'institution'
                    ? [{ id: 'membership-1', institution_id: institution.id, role: 'owner', status: 'active' }]
                    : [],
            ),
        });
    });

    await page.route('**/rest/v1/institutions**', async (route) => {
        const state = await readE2eState(page);
        const institution = state?.institution;

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
                institution
                    ? [
                          {
                              id: institution.id,
                              wallet_address: institution.walletAddress,
                              auth_user_id: state?.session?.user.id ?? 'user-1',
                              email: state?.session?.user.email ?? 'user@acredia.test',
                              name: institution.name,
                              // The dashboard only exposes issuance to KYB-verified
                              // institutions, so the E2E fixture must be verified.
                              status: 'verified',
                              verified: true,
                          },
                      ]
                    : [],
            ),
        });
    });

    await page.route('**/api/institution/credentials**', async (route) => {
        const state = await readE2eState(page);
        const credentials = state?.issuedCredentials ?? [];

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                credentials,
                total: credentials.length,
                page: 1,
                totalPages: 1,
            }),
        });
    });

    // The list route only — `/api/admin/institutions/:id` is a different page.
    await page.route('**/api/admin/institutions', async (route) => {
        const state = await readE2eState(page);

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                institutions: state?.adminInstitutions ?? [],
            }),
        });
    });

    await page.route('**/api/admin/stats**', async (route) => {
        const state = await readE2eState(page);

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                stats: state?.stats ?? createAdminStats(),
            }),
        });
    });

    await page.route('**/api/admin/update-authorization**', async (route) => {
        const payload = route.request().postDataJSON() as { walletAddress?: string; transactionHash?: string };
        const state = await readE2eState(page);

        if (state && payload.walletAddress) {
            state.authorizedIssuers ??= [];
            if (!state.authorizedIssuers.includes(payload.walletAddress)) {
                state.authorizedIssuers.push(payload.walletAddress);
            }

            if (state.stats) {
                state.stats.authorizedInstitutions = state.authorizedIssuers.length;
            }
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                walletAddress: payload.walletAddress,
                transactionHash: payload.transactionHash ?? 'e2e-authorization-tx',
            }),
        });
    });

    await page.route('**/api/verify/**', async (route) => {
        const token = new URL(route.request().url()).pathname.split('/').pop() ?? '';
        const state = await readE2eState(page);
        const credential = state?.issuedCredentials?.find((entry) => entry.token_id === token) ?? null;

        if (!credential) {
            await route.fulfill({
                status: 404,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, error: 'Credential not found' }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                credential: {
                    tokenId: credential.token_id,
                    issuedAt: credential.issued_at,
                    revoked: credential.revoked,
                    revokedAt: credential.revoked ? credential.issued_at : null,
                    institutionName: state?.institution?.name ?? 'Acredia Academy',
                    credentialType: credential.metadata?.credentialData?.credentialType ?? 'diploma',
                    degree: credential.metadata?.credentialData?.degree ?? 'Degree',
                    major: credential.metadata?.credentialData?.major ?? null,
                    issueDate: credential.metadata?.credentialData?.issueDate ?? null,
                    studentWallet: credential.student_wallet_address ?? null,
                    institutionWallet: credential.issuer_wallet_address ?? null,
                    metadataSchemaVersion: null,
                    hashAlgorithm: null,
                    onChainHash: null,
                    blockchainHash: credential.blockchain_hash ?? null,
                    ipfsHash: credential.ipfs_hash ?? null,
                },
                verification: {
                    verified: !credential.revoked,
                    revoked: credential.revoked,
                    onChainMatch: true,
                    onChainFound: true,
                    issuerAuthorized: true,
                    issuerStatus: credential.revoked ? 'revoked' : 'active',
                    // E2E mode has no real IPFS/chain to fetch from — model
                    // the common happy path (document matches on-chain hash).
                    integrity: { status: 'match', cidResolved: true },
                },
            }),
        });
    });
}
