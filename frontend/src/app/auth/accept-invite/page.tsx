'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { cn } from '@/lib/utils';
import {
    getErrorMessage,
    getPasswordRequirements,
    getPasswordValidationError,
    sanitizeAuthRedirect,
} from '@/lib/authFlow';
import { safeGetSession, supabase, updatePassword } from '@/lib/supabase';
import { captureException } from '@/lib/debug';

/**
 * Invite acceptance for an institution member — the POC the admin console
 * provisions, or a colleague an owner invites from the Team page (Issue #307).
 *
 * The account is provisioned with no password and a single-use invite link is
 * emailed; following it establishes a session, and this page is where the
 * member chooses their own password. Neither Acredia staff nor the inviting
 * owner ever see it.
 */
function AcceptInviteForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextRedirect = sanitizeAuthRedirect(searchParams.get('next'));

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [checkingSession, setCheckingSession] = useState(true);
    const [hasInviteSession, setHasInviteSession] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [accepted, setAccepted] = useState(false);
    // What the membership activation returned, so the confirmation can say
    // what happened instead of assuming success (Issue #307).
    const [acceptance, setAcceptance] = useState<
        | { ok: true; role: string | null; institutionName: string | null }
        | { ok: false; message: string }
        | null
    >(null);

    const passwordRequirements = getPasswordRequirements(password);

    useEffect(() => {
        let mounted = true;
        let sessionTimeout: ReturnType<typeof setTimeout> | undefined;

        const finishChecking = (ready: boolean) => {
            if (!mounted) {
                return;
            }

            setHasInviteSession(ready);
            setCheckingSession(false);
        };

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || session?.user) {
                finishChecking(true);
            }
        });

        safeGetSession()
            .then(({ data: { session } }) => {
                if (session?.user) {
                    finishChecking(true);
                    return;
                }

                sessionTimeout = setTimeout(() => finishChecking(false), 1500);
            })
            .catch(() => {
                sessionTimeout = setTimeout(() => finishChecking(false), 1500);
            });

        return () => {
            mounted = false;
            subscription.unsubscribe();
            if (sessionTimeout) {
                clearTimeout(sessionTimeout);
            }
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        const passwordError = getPasswordValidationError(password);
        if (passwordError) {
            setError(passwordError);
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);

        try {
            const { error: updateError } = await updatePassword(password);

            if (updateError) {
                setError(updateError.message);
                return;
            }

            setPassword('');
            setConfirmPassword('');
            setAccepted(true);

            // Activate the membership. The password is already set either way;
            // what this decides is whether the account can act for the
            // institution, so its outcome is shown rather than assumed.
            try {
                const {
                    data: { session },
                } = await safeGetSession();

                if (session?.access_token) {
                    const response = await fetch('/api/auth/accept-invite', {
                        method: 'POST',
                        headers: {
                            Authorization: `Bearer ${session.access_token}`,
                        },
                    });
                    const payload = await response.json().catch(() => null);
                    setAcceptance(
                        response.ok && payload?.success
                            ? {
                                  ok: true,
                                  role: payload.role ?? null,
                                  institutionName: payload.institution?.name ?? null,
                              }
                            : {
                                  ok: false,
                                  message:
                                      payload?.error ??
                                      'Your password is set, but your invitation could not be completed. Sign in and contact whoever invited you.',
                              },
                    );
                }
            } catch (markError) {
                captureException(markError, { context: 'acceptInviteMark' });
            }
        } catch (err: unknown) {
            setError(getErrorMessage(err, 'Unable to set your password'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <AuthShell
            title="Set up your Acredia account"
            subtitle="Choose a password to finish activating your institution's account."
            footer={
                <p className="text-center text-sm text-muted-foreground">
                    <Link
                        href={`/auth/login?next=${encodeURIComponent(nextRedirect)}`}
                        className="font-semibold text-primary hover:underline"
                    >
                        Back to sign in
                    </Link>
                </p>
            }
        >
            {checkingSession && (
                <div
                    className="rounded-lg border border-info/25 bg-info/8 px-4 py-3 text-sm text-info"
                    role="status"
                >
                    Checking your invite link…
                </div>
            )}

            {!checkingSession && !hasInviteSession && (
                <div
                    className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                    role="alert"
                >
                    This invite link is invalid, has already been used, or has expired. Ask whoever
                    invited you — your institution&apos;s owner or Acredia — to send a new one.
                </div>
            )}

            {!checkingSession && hasInviteSession && !accepted && (
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="space-y-2">
                        <Label htmlFor="password">Choose a password</Label>
                        <Input
                            id="password"
                            type="password"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                            aria-describedby="password-requirements"
                        />
                        <ul id="password-requirements" className="mt-2 grid gap-1.5 text-sm">
                            {passwordRequirements.map((requirement) => (
                                <li
                                    key={requirement.id}
                                    className={cn(
                                        'flex items-center gap-2',
                                        requirement.isMet ? 'text-success' : 'text-muted-foreground',
                                    )}
                                >
                                    <CheckCircle2
                                        className={cn(
                                            'h-4 w-4',
                                            requirement.isMet
                                                ? 'text-success'
                                                : 'text-muted-foreground/40',
                                        )}
                                        aria-hidden="true"
                                    />
                                    <span>{requirement.label}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="confirm-password">Confirm password</Label>
                        <Input
                            id="confirm-password"
                            type="password"
                            placeholder="••••••••"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            autoComplete="new-password"
                            aria-invalid={Boolean(confirmPassword) && password !== confirmPassword}
                        />
                    </div>

                    {error && (
                        <div
                            className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                            role="alert"
                        >
                            {error}
                        </div>
                    )}

                    <Button type="submit" size="lg" disabled={loading} className="w-full">
                        {loading ? 'Activating account…' : 'Activate account'}
                    </Button>
                </form>
            )}

            {accepted && acceptance?.ok === false && (
                <div className="space-y-4">
                    <div
                        className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                        role="alert"
                    >
                        {acceptance.message}
                    </div>
                    <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        onClick={() => router.push('/auth/login')}
                        className="w-full"
                    >
                        Go to sign in
                    </Button>
                </div>
            )}

            {accepted && acceptance?.ok !== false && (
                <div className="space-y-4">
                    <div
                        className="rounded-lg border border-success/25 bg-success/8 px-4 py-3 text-sm text-success"
                        role="status"
                    >
                        Your account is active
                        {acceptance?.institutionName ? ` for ${acceptance.institutionName}` : ''}.
                        Issuing credentials also needs your institution&apos;s wallet to be
                        authorized by Acredia, if it isn&apos;t already.
                    </div>
                    {acceptance?.role === 'owner' && (
                        // The moment to fix the single point of contact is
                        // before it matters (Issue #307).
                        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm">
                            <p className="font-semibold text-foreground">
                                Recommended next step: add a second member
                            </p>
                            <p className="mt-1 text-muted-foreground">
                                If you are the only person who can issue and you are locked out or
                                leave, your institution stops issuing until Acredia steps in. Invite
                                a colleague now — it takes a minute.
                            </p>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-3"
                                onClick={() => router.push('/dashboard/team')}
                            >
                                Invite a colleague
                            </Button>
                        </div>
                    )}
                    <Button
                        type="button"
                        size="lg"
                        onClick={() => router.push(nextRedirect)}
                        className="w-full"
                    >
                        Continue to your dashboard
                    </Button>
                </div>
            )}
        </AuthShell>
    );
}

export default function AcceptInvitePage() {
    return (
        <Suspense
            fallback={
                <div className="flex min-h-screen items-center justify-center bg-background">
                    <div className="text-muted-foreground">Loading…</div>
                </div>
            }
        >
            <AcceptInviteForm />
        </Suspense>
    );
}
