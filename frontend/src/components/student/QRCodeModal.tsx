'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Copy, Download, Share2 } from 'lucide-react';
import { debugLog, debugWarn, captureException } from '@/lib/debug';
import { shareUrl } from '@/lib/sharedCredential';

interface QRCodeModalProps {
    open: boolean;
    onClose: () => void;
    credential: {
        token_id: string;
        /** The holder's share token; without it the QR code only checks status. */
        share_token?: string | null;
        blockchain_hash: string;
        metadata: {
            credentialData?: {
                credentialType?: string;
                institutionName?: string;
            }
        } | null;
        student_wallet_address?: string;
    };
}

export default function QRCodeModal({ open, onClose, credential }: QRCodeModalProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [copied, setCopied] = useState(false);

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    // The share link shows the credential's details and document (review
    // §3.11b); a bare token ID only shows its status.
    const verificationUrl = credential?.share_token
        ? shareUrl(origin, credential.share_token)
        : `${origin}/verify?token=${credential?.token_id || ''}`;

    useEffect(() => {
        if (!open || !credential?.token_id) {
            return;
        }

        const timer = setTimeout(() => {
            if (!canvasRef.current) {
                debugWarn('QR canvas is not ready.');
                return;
            }

            const canvas = canvasRef.current;
            const qrUrl = verificationUrl;
            const ctx = canvas.getContext('2d');

            if (ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            debugLog('Generating credential QR code.');
            QRCode.toCanvas(
                canvas,
                qrUrl,
                {
                    width: 240,
                    margin: 2,
                    errorCorrectionLevel: 'H',
                    color: {
                        dark: '#0A2540',
                        light: '#FFFFFF',
                    },
                },
                (error) => {
                    if (error) {
                        captureException(error, { context: 'toCanvas_QR' });
                        return;
                    }

                    debugLog('Credential QR code generated.');
                },
            );
        }, 100);

        return () => clearTimeout(timer);
    }, [open, credential?.token_id, verificationUrl]);

    const handleDownload = () => {
        if (!canvasRef.current) return;

        canvasRef.current.toBlob((blob) => {
            if (!blob) return;

            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${credential.metadata?.credentialData?.credentialType || 'credential'}-${credential.token_id}-qr.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        });
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(verificationUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            captureException(error, { context: 'handleCopyLink' });
        }
    };

    const handleShare = async () => {
        const credType = credential.metadata?.credentialData?.credentialType || 'Credential';
        if (!navigator.share) {
            handleCopyLink();
            return;
        }

        try {
            await navigator.share({
                title: `Verify My ${credType}`,
                text: `Scan this QR code or visit the link to verify my ${credType} from ${credential.metadata?.credentialData?.institutionName || 'institution'}`,
                url: verificationUrl,
            });
        } catch (error) {
            debugLog('Credential share sheet was dismissed or failed.', error);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="w-[95vw] max-w-[560px] overflow-hidden p-5 sm:p-6">
                <DialogHeader className="space-y-1">
                    <DialogTitle className="text-xl font-semibold">Share Credential</DialogTitle>
                    <DialogDescription className="text-sm">
                        {credential?.share_token
                            ? 'Anyone with this QR code or link can see this credential’s details and document. Share it only with people you want to verify it.'
                            : 'Anyone can scan this QR code to check your credential’s status'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex justify-center rounded-lg border border-border bg-secondary/40 p-4">
                        <canvas
                            ref={canvasRef}
                            width={240}
                            height={240}
                            role="img"
                            aria-label={`QR code for verifying credential token ${credential?.token_id || 'unknown'}`}
                            style={{
                                display: 'block',
                                width: '240px',
                                maxWidth: '100%',
                                height: 'auto',
                            }}
                        />
                    </div>

                    <div className="flex flex-col gap-1 rounded-md bg-secondary/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-xs text-muted-foreground">Token ID:</span>
                        <span className="break-all text-sm font-mono font-semibold text-foreground sm:text-right">
                            #{credential?.token_id || 'N/A'}
                        </span>
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="verification-link-input" className="text-xs font-medium text-foreground">
                            {credential?.share_token ? 'Share Link' : 'Verification Link'}
                        </label>
                        <div className="flex min-w-0 gap-2">
                            <Input
                                id="verification-link-input"
                                value={verificationUrl}
                                readOnly
                                className="h-9 min-w-0 truncate font-mono text-xs"
                            />
                            <Button
                                onClick={handleCopyLink}
                                variant="outline"
                                size="sm"
                                className="h-9 w-9 shrink-0 p-0"
                                aria-label={
                                    copied ? 'Verification link copied' : 'Copy verification link'
                                }
                            >
                                {copied ? (
                                    <Check className="h-3.5 w-3.5 text-success" />
                                ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                )}
                            </Button>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-2 sm:flex-row">
                        <Button
                            onClick={handleDownload}
                            variant="outline"
                            size="sm"
                            className="h-9 flex-1 text-sm"
                        >
                            <Download className="mr-1.5 h-3.5 w-3.5" />
                            Download
                        </Button>
                        <Button
                            onClick={handleShare}
                            size="sm"
                            className="h-9 flex-1 text-sm"
                        >
                            <Share2 className="mr-1.5 h-3.5 w-3.5" />
                            Share
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
