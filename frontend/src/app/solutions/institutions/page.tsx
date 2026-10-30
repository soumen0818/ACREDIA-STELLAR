'use client';

import {
    Award,
    Building2,
    Database,
    FileCheck2,
    KeyRound,
    RefreshCw,
    ShieldCheck,
    TrendingDown,
    Upload,
    Zap,
} from 'lucide-react';
import { SolutionPage } from '@/components/marketing/SolutionPage';

export default function InstitutionsSolutionPage() {
    return (
        <SolutionPage
            eyebrow="For institutions"
            eyebrowIcon={Building2}
            title="Streamline credential"
            titleHighlight="issuance & management."
            description="Issue blockchain-secured credentials in minutes. Reduce administrative burden, eliminate fraud, and give your students lifetime ownership of their achievements."
            primaryCta={{ label: 'Request access', href: '/contact?role=institution' }}
            features={[
                {
                    icon: Upload,
                    title: 'Fast issuance',
                    description:
                        'Upload credential details and documents through a clean, guided form.',
                },
                {
                    icon: Zap,
                    title: 'One-click minting',
                    description:
                        'Anchor each credential to Stellar with a single, low-cost transaction.',
                },
                {
                    icon: Database,
                    title: 'Private document storage',
                    description:
                        'Credential documents are stored privately, with their fingerprint anchored on-chain.',
                },
                {
                    icon: ShieldCheck,
                    title: 'Instant verification',
                    description:
                        'Every credential you issue is publicly verifiable by a link or QR code.',
                },
                {
                    icon: KeyRound,
                    title: 'Access control',
                    description:
                        'Only authorized issuers can mint under your institution — with a full audit trail.',
                },
                {
                    icon: RefreshCw,
                    title: 'Revocation',
                    description:
                        'Revoke a credential when needed; the status is reflected everywhere instantly.',
                },
            ]}
            steps={[
                {
                    title: 'Register & get authorized',
                    description:
                        'Create your institution account and get approved as a verified issuer.',
                },
                {
                    title: 'Upload & issue',
                    description:
                        'Enter credential details, attach documents, and mint to the blockchain.',
                },
                {
                    title: 'Manage & revoke',
                    description:
                        'Track everything you’ve issued and revoke credentials from one dashboard.',
                },
            ]}
            benefits={[
                {
                    icon: ShieldCheck,
                    title: 'Prevent credential fraud',
                    description:
                        'Tamper-proof records make forged degrees and transcripts impossible.',
                },
                {
                    icon: TrendingDown,
                    title: 'Reduce admin overhead',
                    description:
                        'Cut down verification requests and manual paperwork dramatically.',
                },
                {
                    icon: Award,
                    title: 'Strengthen your reputation',
                    description:
                        'Signal innovation and trust with modern, verifiable credentials.',
                },
                {
                    icon: FileCheck2,
                    title: 'Auditable by design',
                    description:
                        'Every issuance and revocation is logged for clear accountability.',
                },
            ]}
            ctaTitle="Modernize how you issue credentials"
            ctaDescription="Get your institution set up and start issuing tamper-proof credentials your graduates will value for life."
        />
    );
}
