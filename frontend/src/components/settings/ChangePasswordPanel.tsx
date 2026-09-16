'use client';

import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updatePassword } from '@/lib/supabase';
import { captureException } from '@/lib/debug';

/** Matches the minimum enforced by Supabase Auth. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * Self-service password change.
 *
 * Acredia accounts are provisioned rather than self-registered, so the only
 * other route to a new password is an emailed reset link — which depends on
 * mail delivery that may be delayed, filtered, or rate-limited. A signed-in
 * user changing their own password needs none of that, which matters most for
 * the administrator: they are the account that cannot simply be re-provisioned
 * by someone else.
 */
export function ChangePasswordPanel() {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
    const mismatch = confirm.length > 0 && password !== confirm;
    const canSubmit =
        password.length >= MIN_PASSWORD_LENGTH && password === confirm && !saving;

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!canSubmit) return;

        setSaving(true);
        try {
            const { error } = await updatePassword(password);

            if (error) {
                toast.error(error.message || 'Could not update your password.');
                return;
            }

            toast.success('Password updated.');
            setPassword('');
            setConfirm('');
        } catch (error) {
            captureException(error, { context: 'ChangePasswordPanel' });
            toast.error('An unexpected error occurred. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="p-6">
            <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <KeyRound className="h-5 w-5" />
                </span>
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Change password</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Sets a new password for this account immediately — no email required.
                    </p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                        id="new-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        aria-invalid={tooShort}
                        aria-describedby="new-password-hint"
                    />
                    <p id="new-password-hint" className="text-xs text-muted-foreground">
                        {tooShort
                            ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
                            : `Minimum ${MIN_PASSWORD_LENGTH} characters.`}
                    </p>
                </div>

                <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm new password</Label>
                    <Input
                        id="confirm-password"
                        type="password"
                        value={confirm}
                        onChange={(event) => setConfirm(event.target.value)}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        aria-invalid={mismatch}
                    />
                    {mismatch && (
                        <p className="text-xs text-destructive">Passwords do not match.</p>
                    )}
                </div>

                <Button type="submit" disabled={!canSubmit}>
                    {saving ? 'Updating…' : 'Update password'}
                </Button>
            </form>
        </Card>
    );
}
