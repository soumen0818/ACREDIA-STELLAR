import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, requireAdminRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { isValidStellarAddress } from '@/lib/contracts';

export const dynamic = 'force-dynamic';

const ADMIN_INSTITUTIONS_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'admin-institutions',
} as const;

export interface AdminInstitution {
    id: string;
    name: string;
    email: string;
    walletAddress: string | null;
    verified: boolean;
    status: string;
    authorizationTxHash: string | null;
    createdAt: string | null;
    credentialCount: number;
    activeCredentialCount: number;
    /** invited -> active -> wallet_authorized, so half-finished onboarding is visible. */
    onboardingState: OnboardingState;
    invitedAt: string | null;
    inviteExpiresAt: string | null;
    inviteAcceptedAt: string | null;
}

export type OnboardingState = 'invited' | 'invite_expired' | 'active' | 'wallet_authorized';

/**
 * Derives how far an institution has progressed through onboarding.
 *
 * Wallet authorization is the last step and is proven by the on-chain
 * transaction hash — an institution is only "authorized" once the contract
 * owner has actually signed for it.
 */
function deriveOnboardingState(institution: {
    authorization_tx_hash?: string | null;
    invite_accepted_at?: string | null;
    invite_expires_at?: string | null;
}): OnboardingState {
    if (institution.authorization_tx_hash) {
        return 'wallet_authorized';
    }

    if (institution.invite_accepted_at) {
        return 'active';
    }

    const expiresAt = institution.invite_expires_at
        ? new Date(institution.invite_expires_at).getTime()
        : null;

    if (expiresAt && Number.isFinite(expiresAt) && expiresAt < Date.now()) {
        return 'invite_expired';
    }

    return 'invited';
}

/**
 * Lists every registered institution for the admin console.
 *
 * Credential totals are aggregated in one pass over the credentials index
 * rather than one query per institution, so the response cost stays flat as the
 * number of institutions grows.
 */
export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, ADMIN_INSTITUTIONS_RATE_LIMIT);
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const adminCheck = await requireAdminRequest(request);
        if (!adminCheck.ok) {
            return NextResponse.json(
                { success: false, error: adminCheck.error },
                { status: adminCheck.status },
            );
        }

        const supabase = getServiceRoleClient();

        const { data: institutions, error: institutionsError } = await supabase
            .from('institutions')
            .select(
                'id, name, email, wallet_address, verified, status, authorization_tx_hash, created_at, invited_at, invite_expires_at, invite_accepted_at',
            )
            .order('created_at', { ascending: false });

        if (institutionsError) {
            structuredLog('ERROR', 'Error fetching institutions', requestId, {
                error: institutionsError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to load institutions' },
                { status: 500 },
            );
        }

        const { data: credentials, error: credentialsError } = await supabase
            .from('credentials')
            .select('institution_id, revoked');

        if (credentialsError) {
            structuredLog('ERROR', 'Error fetching credential counts', requestId, {
                error: credentialsError,
            });
        }

        const totals = new Map<string, { total: number; active: number }>();
        for (const credential of credentials ?? []) {
            const key = credential.institution_id;
            if (!key) continue;
            const entry = totals.get(key) ?? { total: 0, active: 0 };
            entry.total += 1;
            if (!credential.revoked) {
                entry.active += 1;
            }
            totals.set(key, entry);
        }

        const payload: AdminInstitution[] = (institutions ?? []).map((institution) => {
            const counts = totals.get(institution.id) ?? { total: 0, active: 0 };
            return {
                id: institution.id,
                name: institution.name,
                email: institution.email,
                walletAddress: institution.wallet_address ?? null,
                verified: Boolean(institution.verified),
                status: institution.status ?? 'pending',
                authorizationTxHash: institution.authorization_tx_hash ?? null,
                createdAt: institution.created_at ?? null,
                credentialCount: counts.total,
                activeCredentialCount: counts.active,
                onboardingState: deriveOnboardingState(institution),
                invitedAt: institution.invited_at ?? null,
                inviteExpiresAt: institution.invite_expires_at ?? null,
                inviteAcceptedAt: institution.invite_accepted_at ?? null,
            };
        });

        return NextResponse.json({ success: true, institutions: payload });
    } catch (error) {
        captureException(error, { context: 'adminInstitutions' });
        return NextResponse.json(
            { success: false, error: 'Failed to load institutions' },
            { status: 500 },
        );
    }
}

const ADMIN_CREATE_INSTITUTION_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 10,
    prefix: 'admin-create-institution',
} as const;

/**
 * Invite links are valid for a week — long enough for a POC who is on leave,
 * short enough that a leaked link does not stay useful.
 */
const INVITE_TTL_DAYS = 7;

const createInstitutionSchema = z.object({
    name: z.string().trim().min(2, 'Institution name must be at least 2 characters').max(200),
    pocName: z.string().trim().min(2, 'POC name must be at least 2 characters').max(100),
    pocEmail: z.string().trim().email('Invalid POC email address').max(254),
    walletAddress: z
        .string()
        .trim()
        .refine(isValidStellarAddress, 'Not a valid Stellar public key (expected G…)'),
    country: z.string().trim().max(100).optional(),
    accreditationRef: z.string().trim().max(200).optional(),
    internalNotes: z.string().trim().max(1000).optional(),
});

/**
 * Provisions a new institution from the admin console.
 *
 * Creates the institution row as `pending`, provisions the POC's auth user with
 * **no password**, links the two through `institution_users`, and returns a
 * single-use invite link the admin can copy. The POC sets their own password on
 * first use, so no Acredia staff member ever knows it.
 *
 * Deliberately does **not** authorize the wallet on-chain — that stays a
 * separate, owner-signed step in `/admin/authorize`.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(
            request,
            ADMIN_CREATE_INSTITUTION_RATE_LIMIT,
        );
        if (rateLimitResponse) {
            return rateLimitResponse;
        }

        const adminCheck = await requireAdminRequest(request);
        if (!adminCheck.ok) {
            return NextResponse.json(
                { success: false, error: adminCheck.error },
                { status: adminCheck.status },
            );
        }

        const body = await request.json().catch(() => ({}));
        const parsed = createInstitutionSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Invalid institution payload',
                    details: parsed.error.flatten(),
                },
                { status: 400 },
            );
        }

        const { name, pocName, pocEmail, walletAddress, country, accreditationRef, internalNotes } =
            parsed.data;
        const normalizedEmail = pocEmail.toLowerCase();

        const supabase = getServiceRoleClient();

        // 1. Reject duplicates up front so we never orphan a freshly created
        //    auth user against an insert that the unique constraints would
        //    always have rejected. Two `eq` queries rather than one `or(...)`
        //    string, so no user-supplied value is ever spliced into a
        //    PostgREST filter expression.
        const [emailMatch, walletMatch] = await Promise.all([
            supabase
                .from('institutions')
                .select('id, name')
                .eq('email', normalizedEmail)
                .maybeSingle(),
            supabase
                .from('institutions')
                .select('id, name')
                .eq('wallet_address', walletAddress)
                .maybeSingle(),
        ]);

        if (emailMatch.error || walletMatch.error) {
            structuredLog('ERROR', 'Failed to check for an existing institution', requestId, {
                error: emailMatch.error ?? walletMatch.error,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to verify institution uniqueness' },
                { status: 500 },
            );
        }

        const conflict = emailMatch.data ?? walletMatch.data;
        if (conflict) {
            const duplicateField = emailMatch.data ? 'email' : 'wallet address';
            return NextResponse.json(
                {
                    success: false,
                    error: `An institution with this ${duplicateField} already exists (${conflict.name}).`,
                },
                { status: 409 },
            );
        }

        // 2. Provision the POC auth user with no password set. `email_confirm`
        //    marks the address as verified so the invite link is the only thing
        //    between the POC and choosing their own password.
        let authUserId: string | null = null;

        const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
            email: normalizedEmail,
            email_confirm: true,
            user_metadata: {
                name: pocName,
                role: 'institution',
            },
        });

        if (createUserError) {
            if (createUserError.message.toLowerCase().includes('already')) {
                const { data: listData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
                const existing = listData?.users.find(
                    (user) => user.email?.toLowerCase() === normalizedEmail,
                );
                authUserId = existing?.id ?? null;
            }

            if (!authUserId) {
                structuredLog('ERROR', 'Failed to provision the POC auth user', requestId, {
                    error: createUserError,
                });
                return NextResponse.json(
                    {
                        success: false,
                        error: `Failed to provision POC account: ${createUserError.message}`,
                    },
                    { status: 500 },
                );
            }
        } else {
            authUserId = createdUser.user?.id ?? null;
        }

        if (!authUserId) {
            return NextResponse.json(
                { success: false, error: 'Could not resolve the POC user identifier' },
                { status: 500 },
            );
        }

        // 3. Profile record carrying the institution role.
        const { error: profileError } = await supabase.from('profiles').upsert(
            {
                id: authUserId,
                email: normalizedEmail,
                role: 'institution',
                full_name: pocName,
                is_active: true,
            },
            { onConflict: 'id' },
        );

        if (profileError) {
            structuredLog('WARN', 'Failed to upsert the POC profile', requestId, {
                error: profileError,
                authUserId,
            });
        }

        // 4. Institution row — pending, and explicitly unauthorized on-chain.
        const invitedAt = new Date();
        const inviteExpiresAt = new Date(
            invitedAt.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
        );

        const { data: institution, error: insertError } = await supabase
            .from('institutions')
            .insert({
                name,
                email: normalizedEmail,
                poc_name: pocName,
                wallet_address: walletAddress,
                auth_user_id: authUserId,
                status: 'pending',
                verified: false,
                country: country || null,
                accreditation_ref: accreditationRef || null,
                internal_notes: internalNotes || null,
                created_by_admin_id: adminCheck.userId,
                invited_at: invitedAt.toISOString(),
                invite_expires_at: inviteExpiresAt.toISOString(),
            })
            .select('id, name, email, wallet_address, status, created_at')
            .single();

        if (insertError || !institution) {
            structuredLog('ERROR', 'Failed to insert the institution row', requestId, {
                error: insertError,
            });
            return NextResponse.json(
                { success: false, error: 'Failed to create the institution record' },
                { status: 500 },
            );
        }

        // 5. Link the POC through institution_users so the institution is never
        //    dependent on a single denormalised column.
        const { error: linkError } = await supabase.from('institution_users').upsert(
            {
                institution_id: institution.id,
                auth_user_id: authUserId,
                role: 'owner',
                // `invited` until they accept — the resolver only grants access
                // to active members, so the invite is what activates them.
                status: 'invited',
                invited_by: adminCheck.userId,
            },
            { onConflict: 'institution_id,auth_user_id' },
        );

        if (linkError) {
            structuredLog('WARN', 'Failed to link the POC to the institution', requestId, {
                error: linkError,
                institutionId: institution.id,
            });
        }

        // 6. Single-use invite link. Supabase mails it as well, but an admin
        //    must never be unable to onboard because of a mail problem, so the
        //    link is returned for copying too.
        const origin = request.nextUrl.origin || 'http://localhost:3000';
        const redirectTo = `${origin}/auth/accept-invite?next=/dashboard`;

        const { data: linkData, error: linkGenerationError } =
            await supabase.auth.admin.generateLink({
                type: 'invite',
                email: normalizedEmail,
                options: { redirectTo },
            });

        const inviteLink = linkData?.properties?.action_link ?? null;

        if (linkGenerationError) {
            structuredLog('WARN', 'Invite link generation failed after provisioning', requestId, {
                error: linkGenerationError,
                institutionId: institution.id,
            });
        }

        // 7. Audit trail: who provisioned this, when, and on what basis.
        const { error: auditError } = await supabase.from('admin_audit_logs').insert({
            action: 'create_institution',
            actor_admin_id: adminCheck.userId,
            target_institution_id: institution.id,
            new_poc_email: normalizedEmail,
            new_poc_id: authUserId,
            details: {
                institutionName: name,
                pocName,
                walletAddress,
                country: country || null,
                accreditationRef: accreditationRef || null,
                notes: internalNotes || null,
                inviteGenerated: Boolean(inviteLink),
                inviteExpiresAt: inviteExpiresAt.toISOString(),
                walletAuthorizedOnChain: false,
            },
        });

        if (auditError) {
            structuredLog('WARN', 'Failed to record the provisioning audit log', requestId, {
                error: auditError,
            });
        }

        structuredLog('INFO', 'Provisioned institution', requestId, {
            institutionId: institution.id,
            adminId: adminCheck.userId,
            inviteGenerated: Boolean(inviteLink),
        });

        return NextResponse.json(
            {
                success: true,
                institution: {
                    id: institution.id,
                    name: institution.name,
                    email: institution.email,
                    walletAddress: institution.wallet_address ?? null,
                    status: institution.status ?? 'pending',
                    createdAt: institution.created_at ?? null,
                },
                inviteLink,
                inviteExpiresAt: inviteExpiresAt.toISOString(),
                message: inviteLink
                    ? 'Institution provisioned. Copy the single-use invite link for the POC.'
                    : 'Institution provisioned, but the invite link could not be generated. Regenerate it from the institution page.',
            },
            { status: 201 },
        );
    } catch (error) {
        captureException(error, { context: 'adminCreateInstitution', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to create institution' },
            { status: 500 },
        );
    }
}
