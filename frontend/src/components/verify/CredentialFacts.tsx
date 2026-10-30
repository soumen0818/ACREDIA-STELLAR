'use client';

import { Card } from '@/components/ui/card';
import { formatValidThrough } from '@/lib/credentialStatus';
import type { CredentialStatusRecord } from '@/hooks/useCredentialVerification';

function formatDate(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

function Fact({
    label,
    value,
}: {
    label: string;
    value: string;
}) {
    return (
        <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
            </dt>
            <dd className="mt-1 text-base font-semibold text-foreground">{value}</dd>
        </div>
    );
}

/**
 * The primary tier: what a token ID is allowed to tell a stranger.
 *
 * A token ID shows status only (review §3.11b): who issued the credential,
 * when, and until when. Who holds it and what it certifies are only shown
 * through the holder's share link, so a guessed ID reveals nothing personal.
 */
export function CredentialFacts({ credential }: { credential: CredentialStatusRecord }) {
    return (
        <Card className="p-5 sm:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Credential
            </h2>

            <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
                <Fact
                    label="Issuing institution"
                    value={credential.institution_name ?? 'Not registered with Acredia'}
                />
                <Fact label="Issued on" value={formatDate(credential.issued_at)} />
                <Fact
                    label="Valid through"
                    value={
                        credential.expires_at
                            ? `${formatValidThrough(credential.expires_at)} (UTC)`
                            : 'Does not expire'
                    }
                />
                <Fact label="Token ID" value={`#${credential.token_id}`} />
            </dl>

            <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
                A token ID shows a credential&apos;s status only. To see who holds it and what it
                certifies, ask the credential holder for their share link.
            </p>
        </Card>
    );
}
