'use client';

import Link from 'next/link';
import { ConsoleShell } from '@/components/console/ConsoleShell';
import { AdminAccessPanel } from '@/components/admin/AdminAccessPanel';
import { ChangePasswordPanel } from '@/components/settings/ChangePasswordPanel';
import { AccountInformationPanel } from '@/components/settings/AccountInformationPanel';
import { Card } from '@/components/ui/card';
import { CONSOLE_NAV } from '@/lib/consoleNav';
import { ProtectedRoute } from '@/contexts/AuthContext';

/**
 * Admin account settings — /admin/settings
 *
 * Deliberately NOT the member settings panels.
 *
 * The member page centres on GDPR Art. 17 self-service erasure, which is a
 * data-subject right belonging to students and institution contacts. The
 * Acredia administrator is the platform operator, not a data subject of the
 * platform, and "delete my account" is the wrong action for them in a way that
 * is actively dangerous:
 *
 *   - The admin account gates issuer authorization. If the last administrator
 *     deletes themselves, no institution can ever be authorized again, and the
 *     only recovery is direct database access.
 *   - It sat one click plus a typed confirmation away from that outcome, beside
 *     routine settings, with no warning that it was different in kind.
 *
 * Decommissioning a platform administrator is an operational action carried out
 * deliberately (see docs/support-procedures.md), not a self-service button.
 *
 * The page header is omitted because the sidebar already marks "Settings" as
 * the current page.
 */
export default function AdminSettingsPage() {
    return (
        <ProtectedRoute allowedRoles={['admin']}>
            <ConsoleShell nav={CONSOLE_NAV.admin}>
                <div className="mx-auto max-w-2xl space-y-8">
                    <AccountInformationPanel />
                    <ChangePasswordPanel />
                    <AdminAccessPanel />

                    <Card className="p-6">
                        <h2 className="text-lg font-semibold text-foreground">
                            Removing an administrator
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            Administrator accounts are provisioned and removed operationally, not
                            from this page. Removing the last administrator would leave no one able
                            to authorize institutions, so it is handled deliberately rather than
                            self-service.
                        </p>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground">
                            To transfer or revoke administrator access, follow the procedure in the{' '}
                            <Link href="/contact" className="text-primary underline">
                                support runbook
                            </Link>
                            : provision the replacement first, verify they can sign in, then revoke
                            the outgoing account.
                        </p>
                    </Card>
                </div>
            </ConsoleShell>
        </ProtectedRoute>
    );
}
