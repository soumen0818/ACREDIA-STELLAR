'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sha256Hex } from '@/lib/credentialDocuments';

type CheckState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'match'; objectUrl: string; fileName: string }
    | { kind: 'mismatch' }
    | { kind: 'error' };

const EXTENSION_BY_TYPE: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
};

/**
 * Opens a credential's document only after this browser has checked it
 * (review §3.11b): the file is downloaded through a short-lived signed URL,
 * hashed locally, and compared with the expected SHA-256. The check does not
 * rely on Acredia's server having served the right file.
 */
export function CredentialDocumentCheck({
    loadUrl,
    sha256,
    tokenId,
    anchored,
}: {
    /** Returns a fresh signed URL; called on each attempt, so a retry is never stale. */
    loadUrl: () => Promise<string>;
    sha256: string;
    tokenId: string;
    /**
     * True when `sha256` comes from content proven against the on-chain hash
     * (the share page); false when it is the digest recorded at issuance
     * (the holder's and institution's dashboards).
     */
    anchored: boolean;
}) {
    const [state, setState] = useState<CheckState>({ kind: 'idle' });

    useEffect(() => {
        return () => {
            if (state.kind === 'match') URL.revokeObjectURL(state.objectUrl);
        };
    }, [state]);

    async function check() {
        setState({ kind: 'checking' });
        try {
            const response = await fetch(await loadUrl());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const digest = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
            if (digest !== sha256) {
                setState({ kind: 'mismatch' });
                return;
            }
            const extension = EXTENSION_BY_TYPE[blob.type] ?? 'bin';
            setState({
                kind: 'match',
                objectUrl: URL.createObjectURL(blob),
                fileName: `credential-${tokenId}.${extension}`,
            });
        } catch {
            setState({ kind: 'error' });
        }
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                <span>Credential document</span>
            </div>

            {state.kind === 'idle' && (
                <Button variant="outline" size="sm" onClick={check}>
                    <FileText className="mr-2 h-4 w-4" /> View document
                </Button>
            )}

            {state.kind === 'checking' && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking the document against the
                    ledger…
                </p>
            )}

            {state.kind === 'match' && (
                <div className="space-y-3" role="status">
                    <p className="flex items-start gap-2 text-sm text-success">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                        {anchored
                            ? 'This file matches the fingerprint anchored on Stellar. It is the document the institution issued.'
                            : 'This file matches the fingerprint recorded when the credential was issued.'}
                    </p>
                    <div className="flex flex-wrap gap-3">
                        <Button asChild variant="outline" size="sm">
                            <a href={state.objectUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-2 h-4 w-4" /> Open document
                            </a>
                        </Button>
                        <Button asChild variant="outline" size="sm">
                            <a href={state.objectUrl} download={state.fileName}>
                                <Download className="mr-2 h-4 w-4" /> Download
                            </a>
                        </Button>
                    </div>
                </div>
            )}

            {state.kind === 'mismatch' && (
                <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    The file Acredia served does not match the credential&apos;s recorded
                    fingerprint. It is not shown. Do not rely on any copy of it, and contact the
                    issuing institution.
                </p>
            )}

            {state.kind === 'error' && (
                <div className="space-y-2" role="alert">
                    <p className="text-sm text-muted-foreground">
                        The document could not be loaded. Please try again.
                    </p>
                    <Button variant="outline" size="sm" onClick={check}>
                        Try again
                    </Button>
                </div>
            )}

            <p className="break-all font-mono text-xs text-muted-foreground">SHA-256: {sha256}</p>
        </div>
    );
}
