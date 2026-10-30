'use client';

import {
    Award,
    Download,
    Fingerprint,
    Globe2,
    GraduationCap,
    Infinity as InfinityIcon,
    Share2,
    ShieldCheck,
    Smartphone,
    Zap,
} from 'lucide-react';
import { SolutionPage } from '@/components/marketing/SolutionPage';

export default function StudentsSolutionPage() {
    return (
        <SolutionPage
            eyebrow="For students"
            eyebrowIcon={GraduationCap}
            title="Own your academic"
            titleHighlight="achievements forever."
            description="Your credentials, your control. Access, share, and verify your academic achievements anytime, anywhere — permanently secured on the Stellar blockchain."
            primaryCta={{ label: 'Learn more', href: '/contact?role=student' }}
            features={[
                {
                    icon: InfinityIcon,
                    title: 'Lifetime access',
                    description:
                        'Your credentials belong to you for life — no expiry, no dependence on a single portal.',
                },
                {
                    icon: Share2,
                    title: 'Instant sharing',
                    description:
                        'Share a verifiable link or QR code with employers and institutions in one tap.',
                },
                {
                    icon: Fingerprint,
                    title: 'Privacy control',
                    description:
                        'Verification uses cryptographic proofs, so your sensitive data stays private.',
                },
                {
                    icon: Smartphone,
                    title: 'Works everywhere',
                    description:
                        'A responsive dashboard that works beautifully on phone, tablet, and desktop.',
                },
                {
                    icon: Download,
                    title: 'Export anytime',
                    description:
                        'Download your credential and QR code to attach to a CV or portfolio.',
                },
                {
                    icon: Globe2,
                    title: 'Global recognition',
                    description:
                        'Blockchain-anchored proof that any employer worldwide can trust instantly.',
                },
            ]}
            steps={[
                {
                    title: 'Create your account',
                    description:
                        'Sign up as a student and link your Stellar wallet to claim ownership of your records.',
                },
                {
                    title: 'Receive your credentials',
                    description:
                        'Institutions issue credentials directly to you — they appear in your dashboard.',
                },
                {
                    title: 'Share & get verified',
                    description:
                        'Send a link or QR code; anyone can confirm authenticity in seconds.',
                },
            ]}
            benefits={[
                {
                    icon: ShieldCheck,
                    title: 'Never lose a credential',
                    description:
                        'Anchored immutably on-chain and shared only through your own link — impossible to forge.',
                },
                {
                    icon: Zap,
                    title: 'Faster job applications',
                    description:
                        'Skip slow verification back-and-forth; employers verify instantly.',
                },
                {
                    icon: Award,
                    title: 'Portable & recognized',
                    description:
                        'Carry your achievements across borders and institutions with confidence.',
                },
                {
                    icon: Fingerprint,
                    title: 'You stay in control',
                    description: 'Decide when and with whom you share each credential.',
                },
            ]}
            ctaTitle="Take ownership of your achievements"
            ctaDescription="Create your free student account and start collecting verifiable credentials today."
        />
    );
}
