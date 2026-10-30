'use client';

import { Card } from '@/components/ui/card';
import { formatValidThrough } from '@/lib/credentialStatus';
import { cn } from '@/lib/utils';
import type { CredentialStatusRecord } from '@/hooks/useCredentialVerification';

type Tone = 'positive' | 'negative' | 'caution' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
    positive: 'border-success/30 bg-success/10 text-success',
    negative: 'border-destructive/30 bg-destructive/10 text-destructive',
    caution: 'border-warning/30 bg-warning/10 text-warning',
    neutral: 'border-border bg-secondary text-muted-foreground',
};

interface Signal {
    label: string;
    /** The verdict for this one signal, in the wording verifiers see. */
    state: string;
    tone: Tone;
    /** What this signal establishes. */
    means: string;
    /** What it explicitly does *not* establish — the part people get wrong. */
    doesNotMean: string;
}

function SignalRow({ signal }: { signal: Signal }) {
    return (
        <div className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h3 className="text-sm font-semibold text-foreground">{signal.label}</h3>
                <span
                    className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                        TONE_CLASS[signal.tone],
                    )}
                >
                    {signal.state}
                </span>
            </div>
            <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
                {signal.means}{' '}
                <span className="text-foreground">It does not mean {signal.doesNotMean}</span>
            </p>
        </div>
    );
}

/**
 * The secondary tier: the independent signals behind the verdict, each read
 * from the contract (review §3.11b).
 *
 * Revocation, expiry and issuer authorization are genuinely separate facts,
 * so each gets its own label, its own state, and an explicit line on what it
 * does *not* establish (ACREDIA-STELLAR#226). A token ID only answers status;
 * whether a particular document is the one issued is checked on the holder's
 * share page.
 */
export function VerificationSignals({
    credential,
    checkedAt,
}: {
    credential: CredentialStatusRecord;
    checkedAt: string;
}) {
    const signals: Signal[] = [
        {
            label: 'Blockchain record',
            state: 'Found on Stellar',
            tone: 'positive',
            means: 'This credential, its issuer and its dates were read directly from the Acredia contract on the Stellar ledger, not from Acredia’s database.',
            doesNotMean:
                'anything about who holds it or what it certifies — ask the holder for their share link.',
        },
    ];

    const revoked = credential.status === 'revoked';
    const revocationSource = credential.revocation_source;
    signals.push({
        label: 'Revocation status',
        state: revoked
            ? revocationSource === 'platform'
                ? 'Revoked by platform'
                : revocationSource === 'issuer'
                  ? 'Revoked by issuer'
                  : 'Revoked'
            : 'Not revoked',
        tone: revoked ? 'caution' : 'positive',
        means: revoked
            ? revocationSource === 'platform'
                ? 'Acredia (the platform) revoked this credential, not the issuing institution. This override is reserved for incident response — such as a compromised issuer key — and is recorded under a separate on-chain event.'
                : revocationSource === 'issuer'
                  ? 'The issuing institution has withdrawn this credential.'
                  : 'This credential has been withdrawn.'
            : 'The issuing institution has not withdrawn this credential.',
        doesNotMean: revoked
            ? revocationSource === 'platform'
                ? 'the issuing institution withdrew it — a platform revocation is attributed to Acredia, never silently to the issuer.'
                : 'the document was forged — revocation is a decision by the issuer, not a tampering signal.'
            : 'it has not expired — that is the expiry signal below.',
    });

    const expired = credential.status === 'expired';
    const validThrough = credential.expires_at ? formatValidThrough(credential.expires_at) : null;
    signals.push({
        label: 'Expiry',
        state: expired ? 'Expired' : validThrough ? `Valid through ${validThrough}` : 'Does not expire',
        tone: expired ? 'caution' : 'positive',
        means: expired
            ? `The issuer set this credential to be valid through ${validThrough} (UTC), and that date has passed.`
            : validThrough
              ? `The issuer set this credential to be valid through ${validThrough} (UTC). The expiry date was fixed at issuance and cannot be changed.`
              : 'The issuer did not set an expiry date for this credential.',
        doesNotMean: expired
            ? 'it was revoked — expiry is set when a credential is issued, not a later decision by the issuer.'
            : 'it cannot be revoked — that is the revocation signal above.',
    });

    signals.push({
        label: 'Issuer authorization',
        state:
            credential.issuer_authorized === true
                ? 'Authorized'
                : credential.issuer_authorized === false
                  ? 'Not authorized'
                  : 'Unknown',
        tone:
            credential.issuer_authorized === true
                ? 'positive'
                : credential.issuer_authorized === false
                  ? 'caution'
                  : 'neutral',
        means:
            credential.issuer_authorized === true
                ? 'The institution that issued this credential is currently authorized to issue on-chain.'
                : credential.issuer_authorized === false
                  ? 'The issuing institution is no longer authorized to issue new credentials.'
                  : 'The issuer’s current authorization could not be determined.',
        doesNotMean:
            credential.issuer_authorized === false
                ? 'this credential is void — it was validly issued at the time.'
                : 'anything about whether this particular credential was revoked.',
    });

    return (
        <Card className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Verification signals
                </h2>
                <p className="text-xs text-muted-foreground">Checked {checkedAt}</p>
            </div>

            <div className="mt-4 divide-y divide-border">
                {signals.map((signal) => (
                    <SignalRow key={signal.label} signal={signal} />
                ))}
            </div>
        </Card>
    );
}
