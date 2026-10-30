'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import {
    Award,
    Building2,
    Calendar,
    CheckCircle2,
    Clock,
    Download,
    QrCode,
    Share2,
    Shield,
    User,
    XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import QRCodeModal from './QRCodeModal';
import { CredentialDocumentCheck } from './CredentialDocumentCheck';
import { buildStandardsExportDocument, downloadJsonFile, getLinkedInShareUrl } from '@/lib/standardsExport';
import { formatValidThrough, type CredentialStatus } from '@/lib/credentialStatus';
import { shareUrl as buildShareUrl } from '@/lib/sharedCredential';
import type { SharedCredentialDetails } from '@/lib/sharedCredential';
import { captureException } from '@/lib/debug';

/**
 * A credential as its holder's share link shows it (review §3.11b). Only
 * built from content the share API proved against the on-chain hash.
 */
export interface PublicCredentialCardData {
    shareToken: string;
    tokenId: string;
    status: CredentialStatus;
    issuedAt: string | null;
    expiresAt: string | null;
    revocationSource: 'issuer' | 'platform' | null;
    institutionName: string;
    issuerWallet: string;
    studentWallet: string;
    onChainHash: string;
    transactionHash: string | null;
    details: SharedCredentialDetails;
    metadata: unknown;
    metadataSchemaVersion: number | null;
    hashAlgorithm: string | null;
    document: { url: string; sha256: string } | null;
    documentStatus: 'available' | 'none' | 'unavailable';
}

function StatusBadge({ credential }: { credential: PublicCredentialCardData }) {
    if (credential.status === 'revoked') {
        return (
            <Badge variant="destructive" className="flex items-center gap-1">
                <XCircle className="h-3.5 w-3.5" />
                {credential.revocationSource === 'platform'
                    ? 'Revoked by platform'
                    : credential.revocationSource === 'issuer'
                      ? 'Revoked by issuer'
                      : 'Revoked'}
            </Badge>
        );
    }
    if (credential.status === 'expired') {
        return (
            <Badge variant="outline" className="flex items-center gap-1 text-warning border-warning/30 bg-warning/10">
                <Clock className="h-3.5 w-3.5" /> Expired
            </Badge>
        );
    }
    return (
        <Badge variant="outline" className="flex items-center gap-1 text-success border-success/30 bg-success/10">
            <CheckCircle2 className="h-3.5 w-3.5" /> Blockchain Verified
        </Badge>
    );
}

function Field({ icon: Icon, label, value }: { icon: typeof Award; label: string; value: string }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" />
                <span>{label}:</span>
            </div>
            <p className="font-semibold text-foreground">{value}</p>
        </div>
    );
}

export function PublicCredentialCard({ credential }: { credential: PublicCredentialCardData }) {
    const [qrOpen, setQrOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const { details } = credential;
    const documentAttempts = useRef(0);

    // The page's signed URL expires after a few minutes, so a retry asks the
    // share API for a fresh one.
    const loadDocumentUrl = async () => {
        documentAttempts.current += 1;
        if (documentAttempts.current === 1 && credential.document) {
            return credential.document.url;
        }
        const response = await fetch(`/api/credentials/share/${encodeURIComponent(credential.shareToken)}`);
        const payload = await response.json().catch(() => null);
        const url = payload?.credential?.document?.url;
        if (!response.ok || typeof url !== 'string') {
            throw new Error('Document unavailable');
        }
        return url;
    };

    const shareUrl = typeof window !== 'undefined' ? buildShareUrl(window.location.origin, credential.shareToken) : '';
    const linkedInUrl = getLinkedInShareUrl({
        title: details.degree,
        institutionName: credential.institutionName,
        issueDate: details.issueDate,
        tokenId: credential.tokenId,
        certUrl: shareUrl,
    });

    const handleCopyLink = () => {
        if (!shareUrl) return;
        void navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownloadVc = async () => {
        setDownloading(true);
        try {
            // The exact anchored credential: its hash is the one on-chain.
            const document = await buildStandardsExportDocument({
                tokenId: credential.tokenId,
                shareToken: credential.shareToken,
                metadata: credential.metadata,
                metadataSchemaVersion: credential.metadataSchemaVersion,
                hashAlgorithm: credential.hashAlgorithm,
                blockchainHash: credential.transactionHash,
                onChainHash: credential.onChainHash,
                studentName: details.studentName,
                studentWallet: credential.studentWallet,
                institutionName: credential.institutionName,
                issuerWallet: credential.issuerWallet,
                degree: details.degree,
                credentialType: details.credentialType,
                issueDate: details.issueDate,
            });
            downloadJsonFile(document, `credential-${credential.tokenId}-verifiable-credential.json`);
        } catch (err) {
            captureException(err, { context: 'PublicCredentialCard_downloadVc' });
            alert('Failed to build the Verifiable Credential export. Please try again.');
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="space-y-6">
            <Card className="p-8 md:p-10 space-y-6 bg-card/90 backdrop-blur shadow-xl border-2">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
                    <div className="flex items-center space-x-3">
                        <div className="rounded-full bg-primary/10 p-3">
                            <Award className="h-8 w-8 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-foreground">{details.degree}</h2>
                            <p className="text-sm text-muted-foreground">{credential.institutionName}</p>
                        </div>
                    </div>
                    <StatusBadge credential={credential} />
                </div>

                {/* Grid Info */}
                <div className="grid md:grid-cols-2 gap-6 pt-2">
                    <Field icon={User} label="Awarded to" value={details.studentName} />
                    <Field icon={Building2} label="Issuing Institution" value={credential.institutionName} />
                    {details.major && <Field icon={Award} label="Field of study" value={details.major} />}
                    {details.gpa && <Field icon={Award} label="GPA" value={details.gpa} />}
                    <Field icon={Calendar} label="Issue Date" value={details.issueDate} />
                    <Field
                        icon={Clock}
                        label="Valid through"
                        value={
                            credential.expiresAt
                                ? `${formatValidThrough(credential.expiresAt)} (UTC)`
                                : 'Does not expire'
                        }
                    />
                </div>

                {details.subjects.length > 0 && (
                    <div className="border-t border-border pt-6">
                        <h2 className="mb-3 text-sm font-semibold text-foreground">Subjects</h2>
                        <ul className="divide-y divide-border text-sm">
                            {details.subjects.map((subject) => (
                                <li key={subject.name} className="flex justify-between gap-4 py-2">
                                    <span className="text-foreground">{subject.name}</span>
                                    <span className="text-muted-foreground">
                                        {subject.marks}/{subject.maxMarks}
                                        {subject.grade ? ` (${subject.grade})` : ''}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {credential.document && (
                    <div className="border-t border-border pt-6">
                        <CredentialDocumentCheck
                            loadUrl={loadDocumentUrl}
                            sha256={credential.document.sha256}
                            tokenId={credential.tokenId}
                            anchored
                        />
                    </div>
                )}
                {credential.documentStatus === 'unavailable' && (
                    <p className="border-t border-border pt-6 text-sm text-muted-foreground">
                        The credential document cannot be shown right now. The details above are
                        still verified against the ledger.
                    </p>
                )}

                {/* Actions Bar */}
                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-6">
                    <Button asChild variant="default" size="sm">
                        <Link href={`/verify?token=${credential.tokenId}`}>
                            <Shield className="mr-2 h-4 w-4" /> Verify Credential
                        </Link>
                    </Button>

                    <Button onClick={() => setQrOpen(true)} variant="outline" size="sm">
                        <QrCode className="mr-2 h-4 w-4" /> QR Code
                    </Button>

                    <Button asChild variant="outline" size="sm">
                        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer">
                            <Share2 className="mr-2 h-4 w-4" /> Add to LinkedIn
                        </a>
                    </Button>

                    <Button onClick={handleCopyLink} variant="secondary" size="sm">
                        <Share2 className="mr-2 h-4 w-4" /> {copied ? 'Copied Link!' : 'Copy Share Link'}
                    </Button>

                    <Button onClick={handleDownloadVc} variant="outline" size="sm" disabled={downloading}>
                        <Download className="mr-2 h-4 w-4" />
                        {downloading ? 'Preparing...' : 'Download Verifiable Credential (.json)'}
                    </Button>
                </div>
            </Card>

            <QRCodeModal
                open={qrOpen}
                onClose={() => setQrOpen(false)}
                credential={{
                    token_id: credential.tokenId,
                    share_token: credential.shareToken,
                    blockchain_hash: credential.transactionHash || '',
                    metadata: {
                        credentialData: {
                            credentialType: details.credentialType,
                            institutionName: credential.institutionName,
                        },
                    },
                    student_wallet_address: credential.studentWallet,
                }}
            />
        </div>
    );
}
