'use client';

import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { runtimeConfig } from '@/lib/runtimeConfig';
import { activeNetwork } from '@/lib/stellar';
import { useContractOwner } from '@/hooks/useContractOwner';
import { useAuth } from '@/contexts/AuthContext';

function Row({
    label,
    value,
    state,
    hint,
}: {
    label: string;
    value: string;
    state: 'ok' | 'warn';
    hint?: string;
}) {
    return (
        <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-0">
            <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{label}</p>
                {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
            </div>
            <div
                className={`flex shrink-0 items-center gap-1.5 text-sm ${
                    state === 'ok' ? 'text-success' : 'text-warning'
                }`}
            >
                {state === 'ok' ? (
                    <CheckCircle2 className="h-4 w-4" />
                ) : (
                    <ShieldAlert className="h-4 w-4" />
                )}
                <span className="max-w-[16rem] truncate font-mono text-xs">{value}</span>
            </div>
        </div>
    );
}

/**
 * Shows the administrator their own access state.
 *
 * Admin access passes through three independent gates — a valid session, the
 * server-side email allowlist, and the on-chain contract owner wallet — and
 * failing any one of them produces a different, easily-confused error. Surfacing
 * them together turns "why am I locked out?" into something answerable without
 * reading server logs.
 */
export function AdminAccessPanel() {
    const { user } = useAuth();
    const { address, isOwner, isChecking, contractOwner } = useContractOwner();

    const shorten = (value: string | null | undefined) =>
        value && value.length > 12 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value || '—';

    return (
        <Card className="p-6">
            <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                    <h2 className="text-lg font-semibold text-foreground">Administrator access</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Admin actions pass three independent checks. All three must hold.
                    </p>
                </div>
            </div>

            <div className="mt-5">
                <Row
                    label="Signed-in account"
                    hint="Your authenticated Supabase session"
                    value={user?.email ?? '—'}
                    state={user?.email ? 'ok' : 'warn'}
                />
                <Row
                    label="Admin role"
                    hint="profiles.role, resolved server-side"
                    value="admin"
                    state="ok"
                />
                <Row
                    label="Contract owner wallet"
                    hint={
                        isChecking
                            ? 'Checking the connected wallet against the contract…'
                            : isOwner
                              ? 'Connected wallet owns the credential contract'
                              : 'Connect the deploying wallet to authorize issuers'
                    }
                    value={
                        isChecking
                            ? 'checking…'
                            : isOwner
                              ? shorten(address)
                              : shorten(contractOwner) || 'not connected'
                    }
                    state={isOwner ? 'ok' : 'warn'}
                />
                <Row
                    label="Network"
                    hint="Switching networks is a deployment configuration change"
                    value={activeNetwork.networkName}
                    state={activeNetwork.kind === 'mainnet' ? 'ok' : 'warn'}
                />
                <Row
                    label="Credential contract"
                    hint="The contract this deployment reads and writes"
                    value={shorten(runtimeConfig.contracts.CREDENTIAL_NFT)}
                    state={runtimeConfig.contracts.CREDENTIAL_NFT ? 'ok' : 'warn'}
                />
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
                The email allowlist (<span className="font-mono">ADMIN_EMAIL_ALLOWLIST</span>) is
                enforced server-side and is never exposed to the browser.
            </p>
        </Card>
    );
}
