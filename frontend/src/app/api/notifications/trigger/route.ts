import { NextRequest, NextResponse } from 'next/server';
import { getServiceRoleClient, requireAuthenticatedRequest } from '@/lib/serverAuth';
import { getSiteUrl } from '@/lib/siteUrl';
import { structuredLog } from '@/lib/debug';
import { enforceRateLimit } from '@/lib/rateLimit';
import { canWrite, resolveInstitutionForUser } from '@/lib/institutionMembership';

// Coarse per-IP guard against anonymous floods before auth runs.
const NOTIFICATIONS_TRIGGER_IP_LIMIT = {
    windowSeconds: 60,
    maxRequests: 30,
    prefix: 'notifications-trigger-ip',
} as const;

// Each call queues a send_email job; keep this bounded per-account so a
// compromised or careless institution cannot mail-bomb its students and
// exhaust the shared SMTP quota for every tenant.
const NOTIFICATIONS_TRIGGER_USER_QUOTA = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'notifications-trigger-user',
} as const;

export async function POST(request: NextRequest) {
    try {
        const ipRateLimitResponse = await enforceRateLimit(request, NOTIFICATIONS_TRIGGER_IP_LIMIT);
        if (ipRateLimitResponse) return ipRateLimitResponse;

        const authCheck = await requireAuthenticatedRequest(request);
        if (!authCheck.ok) {
            return NextResponse.json({ success: false, error: authCheck.error }, { status: authCheck.status });
        }

        const userRateLimitResponse = await enforceRateLimit(request, {
            ...NOTIFICATIONS_TRIGGER_USER_QUOTA,
            identifier: authCheck.userId,
        });
        if (userRateLimitResponse) return userRateLimitResponse;

        const body = await request.json();
        const { type, tokenId } = body;

        if (!['issued', 'revoked'].includes(type) || !tokenId) {
            return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
        }

        const supabase = getServiceRoleClient();

        // Verify institution membership and credential
        const membership = await resolveInstitutionForUser(supabase, authCheck.userId);

        if (!membership) {
            return NextResponse.json({ success: false, error: 'Institution not found' }, { status: 404 });
        }

        // Issuance and revocation notifications follow a write action, so
        // read-only members may not send them.
        if (!canWrite(membership.role)) {
            return NextResponse.json(
                { success: false, error: 'Your role does not permit sending notifications' },
                { status: 403 },
            );
        }

        const { data: institution } = await supabase
            .from('institutions')
            .select('id, name')
            .eq('id', membership.institutionId)
            .single();

        if (!institution) {
            return NextResponse.json({ success: false, error: 'Institution not found' }, { status: 404 });
        }

        const { data: credential } = await supabase
            .from('credentials')
            .select('*, students(id, email, auth_user_id)')
            .eq('token_id', tokenId)
            .eq('institution_id', institution.id)
            .single();

        if (!credential) {
            return NextResponse.json({ success: false, error: 'Credential not found' }, { status: 404 });
        }

        const studentEmail = credential.students?.email || credential.metadata?.credentialData?.studentEmail;
        if (!studentEmail) {
            return NextResponse.json({ success: false, error: 'Student email not available' }, { status: 400 });
        }

        const appUrl = getSiteUrl();
        const credentialUrl = `${appUrl}/verify/${tokenId}`;
        const studentName = credential.metadata?.credentialData?.studentName || 'Student';

        const jobPayload = {
            to: studentEmail,
            subject: type === 'issued' ? 'New Credential Issued' : 'Credential Revoked',
            type,
            userId: credential.students?.auth_user_id || null, // pass user ID for preference checking
            payload: {
                studentName,
                institutionName: institution.name,
                credentialUrl,
            }
        };

        const { error: jobError } = await supabase
            .from('jobs')
            .insert({
                name: 'send_email',
                payload: jobPayload
            });

        if (jobError) {
            throw jobError;
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        structuredLog('ERROR', 'Failed to trigger notification', 'system', { error: String(error) });
        return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
    }
}
