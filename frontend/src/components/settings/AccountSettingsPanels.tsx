'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ShieldOff, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';
import { safeGetSession } from '@/lib/supabase';
import { ApiKeysManager } from '@/app/dashboard/settings/ApiKeysManager';
import { AccountInformationPanel } from '@/components/settings/AccountInformationPanel';

/**
 * Account settings panels, shared by the member dashboard and the admin console.
 *
 * Only the panels live here — each shell supplies its own chrome (top bar or
 * sidebar), so an admin never gets bounced out of the admin console just to
 * change a setting.
 *
 * Includes the GDPR Art. 17 "delete my account" flow:
 *   1. User reads the warning about on-chain immutability.
 *   2. User types "DELETE" to confirm intent.
 *   3. Client POSTs /api/account/erase with the current bearer token.
 *   4. On 204, the client signs out and redirects to the home page.
 */
export function AccountSettingsPanels() {
    const { user, signOut: ctxSignOut } = useAuth();
    const router = useRouter();

    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);

    const handleDeleteAccount = async () => {
        if (confirmText !== 'DELETE') return;

        setDeleting(true);
        try {
            const { data } = await safeGetSession();
            const token = data.session?.access_token;

            if (!token) {
                toast.error('Session expired. Please sign in again.');
                setDeleting(false);
                return;
            }

            const response = await fetch('/api/account/erase', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (response.status === 204) {
                toast.success('Your account has been deleted. Redirecting…');
                // Sign out locally — auth user is already deleted server-side.
                await ctxSignOut();
                router.push('/');
            } else {
                const body = await response.json().catch(() => ({}));
                toast.error(body?.error ?? 'Account deletion failed. Please contact support.');
                setDeleting(false);
            }
        } catch {
            toast.error('An unexpected error occurred. Please try again or contact support.');
            setDeleting(false);
        }
    };

    return (
        <div className="mx-auto max-w-2xl space-y-8">
            <AccountInformationPanel />

            {/* API Keys (for institutions) */}
            {user?.user_metadata?.role === 'institution' && <ApiKeysManager />}

            {/* Danger zone — delete account */}
            <Card className="border-destructive/30 p-6">
                <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                        <ShieldOff className="h-5 w-5" />
                    </span>
                    <div>
                        <h2 className="text-lg font-semibold text-foreground">Delete my account</h2>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                            Permanently remove your personal data from Acredia in accordance with
                            GDPR Art. 17 (right to erasure).
                        </p>
                    </div>
                </div>

                {/* What gets deleted */}
                <div className="mt-5 rounded-lg bg-secondary/50 p-4 text-sm">
                    <p className="font-medium text-foreground">What will be deleted / scrubbed:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        <li>Your personal login credentials, email, and profile data from our database</li>
                        <li>For students: your student account link and personal notification preferences</li>
                        <li>For institution admins: your administrative user account access is revoked</li>
                    </ul>
                    <p className="mt-3 font-medium text-foreground">What is retained and why:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                        <li>
                            <strong className="text-foreground">Issued academic credentials</strong> — credentials
                            issued to students are official business and academic records owned by the recipient
                            graduates. Deleting an administrator account does not delete, revoke, or invalidate
                            credentials issued to third parties (retained under GDPR Art. 17(3)(b) &amp; (d)).
                        </li>
                        <li>
                            <strong className="text-foreground">On-chain records</strong> — cryptographic SHA-256
                            hashes and token IDs anchored on the Stellar blockchain are immutable by design and
                            do not contain readable personal data. They are retained under GDPR Art. 17(3)(b).{' '}
                            <Link href="/legal/privacy#on-chain" className="text-primary underline">
                                Learn more →
                            </Link>
                        </li>
                    </ul>
                </div>

                {!showDeleteDialog ? (
                    <Button
                        id="btn-show-delete-dialog"
                        variant="destructive"
                        className="mt-5"
                        onClick={() => setShowDeleteDialog(true)}
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete my account
                    </Button>
                ) : (
                    <div className="mt-5 space-y-4 rounded-lg border border-destructive/40 bg-destructive/5 p-5">
                        <div className="flex items-start gap-2 text-sm text-destructive">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>
                                <strong>This action is irreversible.</strong> Your account and all
                                associated personal data will be permanently deleted.
                            </span>
                        </div>

                        <div>
                            <label
                                htmlFor="delete-confirm-input"
                                className="block text-sm font-medium text-foreground"
                            >
                                Type <strong>DELETE</strong> to confirm
                            </label>
                            <input
                                id="delete-confirm-input"
                                type="text"
                                value={confirmText}
                                onChange={(e) => setConfirmText(e.target.value)}
                                placeholder="DELETE"
                                className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-destructive focus:outline-none focus:ring-1 focus:ring-destructive"
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>

                        <div className="flex gap-3">
                            <Button
                                id="btn-confirm-delete"
                                variant="destructive"
                                disabled={confirmText !== 'DELETE' || deleting}
                                onClick={handleDeleteAccount}
                            >
                                {deleting ? 'Deleting…' : 'Permanently delete account'}
                            </Button>
                            <Button
                                id="btn-cancel-delete"
                                variant="outline"
                                onClick={() => {
                                    setShowDeleteDialog(false);
                                    setConfirmText('');
                                }}
                                disabled={deleting}
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
