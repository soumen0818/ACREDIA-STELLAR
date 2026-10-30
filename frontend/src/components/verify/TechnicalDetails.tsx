'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CopyableValue } from '@/components/verify/CopyableValue';
import { cn } from '@/lib/utils';
import { activeNetwork, getExplorerAddressUrl } from '@/lib/stellar';
import { runtimeConfig } from '@/lib/runtimeConfig';
import type { CredentialStatusRecord } from '@/hooks/useCredentialVerification';

/**
 * The tertiary tier: cryptographic proof, on demand.
 *
 * Verifiers need the human facts first; hashes and addresses matter only to the
 * minority who audit them. Collapsed by default, but always rendered so a
 * printed record carries the full proof (`print:block`).
 */
export function TechnicalDetails({ credential }: { credential: CredentialStatusRecord }) {
    const [open, setOpen] = useState(false);

    const rows: Array<{ label: string; value: string; href?: string; hrefLabel?: string }> = [
        { label: 'Token ID', value: credential.token_id },
        { label: 'Credential contract', value: runtimeConfig.contracts.CREDENTIAL_NFT },
    ];

    if (credential.on_chain_hash) {
        rows.push({ label: 'On-chain credential hash', value: credential.on_chain_hash });
    }
    if (credential.issuer_wallet_address) {
        rows.push({
            label: 'Issuer wallet',
            value: credential.issuer_wallet_address,
            href: getExplorerAddressUrl(credential.issuer_wallet_address),
            hrefLabel: 'View',
        });
    }
    // No holder wallet or issuance transaction: both identify the holder, and
    // a token ID shows status only (review §3.11b).

    return (
        <Card className="p-5 sm:p-6">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                aria-controls="technical-details"
                className="flex w-full items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 print:hidden"
            >
                <span className="min-w-0">
                    <span className="block text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Technical details
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                        Hashes, addresses, and ledger links for independent auditing.
                    </span>
                </span>
                <ChevronDown
                    className={cn(
                        'h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                        open && 'rotate-180',
                    )}
                />
            </button>

            {/* Printed records include the proof even when collapsed on screen. */}
            <h2 className="hidden text-sm font-semibold uppercase tracking-wide text-muted-foreground print:block">
                Technical details
            </h2>

            <div
                id="technical-details"
                className={cn('print:mt-4 print:block', open ? 'mt-5' : 'hidden')}
            >
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {rows.map((row) => (
                        <CopyableValue
                            key={row.label}
                            label={row.label}
                            value={row.value}
                            href={row.href}
                            hrefLabel={row.hrefLabel}
                        />
                    ))}
                </dl>
                <p className="mt-4 text-xs text-muted-foreground">
                    Network: {activeNetwork.networkName}
                </p>
            </div>
        </Card>
    );
}
