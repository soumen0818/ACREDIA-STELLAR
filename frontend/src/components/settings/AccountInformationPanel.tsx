'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Read-only account identity, shared by the member and admin settings pages.
 *
 * Extracted so the admin page can reuse it without inheriting the member page's
 * GDPR erasure flow, which does not apply to a platform operator.
 */
export function AccountInformationPanel() {
    const { user } = useAuth();

    return (
        <Card className="p-6">
            <h2 className="text-lg font-semibold text-foreground">Account information</h2>
            <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="truncate font-medium text-foreground">
                        {user?.email ?? '—'}
                    </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">User ID</dt>
                    <dd className="truncate font-mono text-xs text-muted-foreground">
                        {user?.id ?? '—'}
                    </dd>
                </div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-3 text-sm">
                <Link
                    href="/legal/privacy"
                    className="text-primary underline hover:text-primary/80"
                >
                    Privacy Policy
                </Link>
                <Link
                    href="/legal/terms"
                    className="text-primary underline hover:text-primary/80"
                >
                    Terms of Service
                </Link>
                <Link href="/legal/dpa" className="text-primary underline hover:text-primary/80">
                    Data Processing Agreement
                </Link>
            </div>
        </Card>
    );
}
