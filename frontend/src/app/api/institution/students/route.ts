import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServiceRoleClient, requireAuthenticatedRequest } from '@/lib/serverAuth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { structuredLog, captureException } from '@/lib/debug';
import { canWrite, resolveInstitutionForUser } from '@/lib/institutionMembership';
import { isValidStellarAddress } from '@/lib/contracts';
import { MAX_STUDENT_IMPORT_ROWS } from '@/lib/studentRosterImport';

export const dynamic = 'force-dynamic';

const STUDENTS_READ_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 60,
    prefix: 'institution-students-read',
} as const;

const STUDENTS_WRITE_RATE_LIMIT = {
    windowSeconds: 60,
    maxRequests: 20,
    prefix: 'institution-students-write',
} as const;

const PAGE_SIZE = 50;

const studentInputSchema = z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
    email: z.string().trim().email('Invalid email address').max(254),
    studentRef: z.string().trim().max(64).optional(),
    walletAddress: z
        .string()
        .trim()
        .refine(isValidStellarAddress, 'Not a valid Stellar address')
        .optional(),
});

const createSchema = z.object({
    students: z.array(studentInputSchema).min(1).max(MAX_STUDENT_IMPORT_ROWS),
});

export interface InstitutionStudent {
    id: string;
    name: string;
    email: string;
    studentRef: string | null;
    walletAddress: string | null;
    status: string;
    hasAccount: boolean;
    invitedAt: string | null;
    inviteAcceptedAt: string | null;
    claimedAt: string | null;
    deactivatedAt: string | null;
    createdAt: string | null;
}

function toStudent(row: Record<string, unknown>): InstitutionStudent {
    return {
        id: row.id as string,
        name: (row.name as string) ?? '',
        email: (row.email as string) ?? '',
        studentRef: (row.student_ref as string) ?? null,
        walletAddress: (row.wallet_address as string) ?? null,
        status: (row.status as string) ?? 'invited',
        hasAccount: Boolean(row.auth_user_id),
        invitedAt: (row.invited_at as string) ?? null,
        inviteAcceptedAt: (row.invite_accepted_at as string) ?? null,
        claimedAt: (row.claimed_at as string) ?? null,
        deactivatedAt: (row.deactivated_at as string) ?? null,
        createdAt: (row.created_at as string) ?? null,
    };
}

/**
 * Resolves the caller's institution, rejecting anyone who is not an active
 * member of one. `write` additionally requires a role that may modify the
 * roster — a viewer may read it but not change it.
 */
async function requireInstitution(
    request: NextRequest,
    { write }: { write: boolean },
): Promise<
    | { ok: true; institutionId: string; userId: string }
    | { ok: false; response: NextResponse }
> {
    const authCheck = await requireAuthenticatedRequest(request);
    if (!authCheck.ok) {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: authCheck.error },
                { status: authCheck.status },
            ),
        };
    }

    const supabase = getServiceRoleClient();
    const membership = await resolveInstitutionForUser(supabase, authCheck.userId);

    if (!membership) {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: 'Institution access required' },
                { status: 403 },
            ),
        };
    }

    if (write && !canWrite(membership.role)) {
        return {
            ok: false,
            response: NextResponse.json(
                { success: false, error: 'Your role does not permit managing students' },
                { status: 403 },
            ),
        };
    }

    return { ok: true, institutionId: membership.institutionId, userId: authCheck.userId };
}

/**
 * Lists the calling institution's students, with optional search.
 *
 * Scoping is by `institution_id` resolved from the caller's own membership, so
 * an institution can never page through another institution's roster even if
 * it guesses ids.
 */
export async function GET(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, STUDENTS_READ_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const auth = await requireInstitution(request, { write: false });
        if (!auth.ok) return auth.response;

        const { searchParams } = new URL(request.url);
        const search = (searchParams.get('search') ?? '').trim();
        const status = (searchParams.get('status') ?? '').trim();
        const page = Math.max(0, Number(searchParams.get('page') ?? '0') || 0);

        const supabase = getServiceRoleClient();

        let query = supabase
            .from('students')
            .select(
                'id, name, email, student_ref, wallet_address, status, auth_user_id, invited_at, invite_accepted_at, claimed_at, deactivated_at, created_at',
                { count: 'exact' },
            )
            .eq('institution_id', auth.institutionId);

        if (status && ['invited', 'active', 'deactivated'].includes(status)) {
            query = query.eq('status', status);
        }

        if (search) {
            // Escape PostgREST's `or` delimiters so a search term can never
            // break out of the filter expression it is embedded in.
            const safe = search.replace(/[,()\\]/g, ' ').trim();
            if (safe) {
                query = query.or(
                    `name.ilike.%${safe}%,email.ilike.%${safe}%,student_ref.ilike.%${safe}%,wallet_address.ilike.%${safe}%`,
                );
            }
        }

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

        if (error) {
            structuredLog('ERROR', 'Failed to list institution students', requestId, { error });
            return NextResponse.json(
                { success: false, error: 'Failed to load students' },
                { status: 500 },
            );
        }

        return NextResponse.json({
            success: true,
            students: (data ?? []).map(toStudent),
            total: count ?? 0,
            page,
            pageSize: PAGE_SIZE,
        });
    } catch (error) {
        captureException(error, { context: 'institutionStudentsList', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to load students' },
            { status: 500 },
        );
    }
}

/**
 * Provisions one or many students onto the calling institution's roster.
 *
 * Takes an array in both cases, so the single-add form and the CSV bulk import
 * share one code path and one set of per-row error semantics. No auth user is
 * created here: a student record exists first, and the account arrives later
 * through an invite or a wallet claim.
 */
export async function POST(request: NextRequest) {
    const requestId = request.headers.get('x-request-id') || 'unknown';

    try {
        const rateLimitResponse = await enforceRateLimit(request, STUDENTS_WRITE_RATE_LIMIT);
        if (rateLimitResponse) return rateLimitResponse;

        const auth = await requireInstitution(request, { write: true });
        if (!auth.ok) return auth.response;

        const body = await request.json().catch(() => ({}));
        const parsed = createSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'Invalid student payload',
                    details: parsed.error.flatten(),
                },
                { status: 400 },
            );
        }

        const supabase = getServiceRoleClient();
        const { students } = parsed.data;

        // Conflicts are reported per row rather than failing the whole import,
        // so a 500-row file with three bad rows still onboards 497 students.
        const emails = students.map((s) => s.email.toLowerCase());
        const wallets = students.map((s) => s.walletAddress).filter(Boolean) as string[];

        const [{ data: emailRows }, { data: walletRows }] = await Promise.all([
            supabase.from('students').select('email').in('email', emails),
            wallets.length
                ? supabase.from('students').select('wallet_address').in('wallet_address', wallets)
                : Promise.resolve({ data: [] as Array<{ wallet_address: string }> }),
        ]);

        const takenEmails = new Set(
            (emailRows ?? []).map((r) => (r.email as string).toLowerCase()),
        );
        const takenWallets = new Set(
            (walletRows ?? []).map((r) => r.wallet_address as string).filter(Boolean),
        );

        const rejected: Array<{ email: string; error: string }> = [];
        const toInsert: Array<Record<string, unknown>> = [];

        for (const student of students) {
            const email = student.email.toLowerCase();

            if (takenEmails.has(email)) {
                rejected.push({
                    email: student.email,
                    error: 'A student with this email already exists.',
                });
                continue;
            }

            if (student.walletAddress && takenWallets.has(student.walletAddress)) {
                rejected.push({
                    email: student.email,
                    error: 'This wallet address is already linked to another student.',
                });
                continue;
            }

            takenEmails.add(email);
            if (student.walletAddress) takenWallets.add(student.walletAddress);

            toInsert.push({
                institution_id: auth.institutionId,
                name: student.name,
                email,
                student_ref: student.studentRef || null,
                wallet_address: student.walletAddress || null,
                status: 'invited',
                provisioning_origin: 'institution',
                created_by: auth.userId,
            });
        }

        let created: InstitutionStudent[] = [];

        if (toInsert.length > 0) {
            const { data, error } = await supabase
                .from('students')
                .insert(toInsert)
                .select(
                    'id, name, email, student_ref, wallet_address, status, auth_user_id, invited_at, invite_accepted_at, claimed_at, deactivated_at, created_at',
                );

            if (error) {
                structuredLog('ERROR', 'Failed to insert students', requestId, { error });
                return NextResponse.json(
                    { success: false, error: 'Failed to create students' },
                    { status: 500 },
                );
            }

            created = (data ?? []).map(toStudent);
        }

        const { error: auditError } = await supabase.from('admin_audit_logs').insert({
            action: students.length > 1 ? 'bulk_import_students' : 'create_student',
            actor_admin_id: auth.userId,
            target_institution_id: auth.institutionId,
            details: {
                requested: students.length,
                created: created.length,
                rejected: rejected.length,
                rejectedReasons: rejected.slice(0, 20),
            },
        });

        if (auditError) {
            structuredLog('WARN', 'Failed to audit student provisioning', requestId, {
                error: auditError,
            });
        }

        return NextResponse.json(
            {
                success: true,
                created,
                rejected,
                summary: {
                    requested: students.length,
                    created: created.length,
                    rejected: rejected.length,
                },
            },
            { status: created.length > 0 ? 201 : 200 },
        );
    } catch (error) {
        captureException(error, { context: 'institutionStudentsCreate', requestId });
        return NextResponse.json(
            { success: false, error: 'Failed to create students' },
            { status: 500 },
        );
    }
}
