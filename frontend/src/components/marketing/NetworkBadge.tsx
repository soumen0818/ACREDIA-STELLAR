import { activeNetwork } from '@/lib/stellar';
import { cn } from '@/lib/utils';

/**
 * The single source of truth for the "which Stellar network am I on?" badge.
 *
 * Every surface that displays network status must use this component. Several
 * places previously hardcoded the string "Live on Stellar Testnet", which would
 * have silently told users they were on testnet after a mainnet cutover — the
 * most damaging kind of wrong, because the whole product is a trust claim.
 *
 * Deriving the label from `activeNetwork` means switching
 * `NEXT_PUBLIC_STELLAR_NETWORK` updates every badge at once.
 */
const NETWORK_LABELS: Record<string, string> = {
    testnet: 'Live on Stellar Testnet',
    mainnet: 'Live on Stellar Mainnet',
    custom: 'Custom Stellar network',
};

export function networkLabel(): string {
    return NETWORK_LABELS[activeNetwork.kind] ?? `Stellar ${activeNetwork.networkName}`;
}

interface NetworkBadgeProps {
    className?: string;
    /** Dot + label colouring for dark backgrounds (e.g. the auth panel). */
    tone?: 'default' | 'inverted';
}

export function NetworkBadge({ className, tone = 'default' }: NetworkBadgeProps) {
    // Only testnet gets the "this is not real" amber treatment. Mainnet is the
    // normal, unremarkable state and should not look like a warning.
    const isTestnet = activeNetwork.kind === 'testnet';
    const inverted = tone === 'inverted';

    return (
        <div
            className={cn(
                'inline-flex items-center gap-2 text-xs font-medium',
                inverted
                    ? 'text-white/60'
                    : 'rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground',
                className,
            )}
        >
            <span className="relative flex h-2 w-2">
                <span
                    className={cn(
                        'absolute inline-flex h-full w-full animate-ping rounded-full',
                        isTestnet ? 'bg-warning/60' : 'bg-success/60',
                    )}
                />
                <span
                    className={cn(
                        'relative inline-flex h-2 w-2 rounded-full',
                        isTestnet ? 'bg-warning' : 'bg-success',
                    )}
                />
            </span>
            {networkLabel()}
        </div>
    );
}
