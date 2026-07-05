'use client';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { BrandSectionHeader } from '@/components/marketing/BrandSectionHeader';
import { ABOUT_HIGHLIGHTS } from '@/lib/marketingContent';
import {
    Shield,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Globe,
    Lock,
    Fingerprint,
    Eye,
    Database,
    FileCheck,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Zap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Users,
    Building2,
    GraduationCap,
    CheckCircle,
    ArrowRight,
    Coins,
    Network,
    CloudUpload,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    QrCode,
    Search,
} from 'lucide-react';

export default function AboutPage() {
    const [showSolutions, setShowSolutions] = useState(false);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user, userRole } = useAuth();
    const router = useRouter();
    let closeTimeout: NodeJS.Timeout;

    const handleMouseEnter = () => {
        if (closeTimeout) clearTimeout(closeTimeout);
        setShowSolutions(true);
    };

    const handleMouseLeave = () => {
        closeTimeout = setTimeout(() => {
            setShowSolutions(false);
        }, 500); // Increased to 500ms delay before closing
    };

    const handleDashboardClick = (
        e: React.MouseEvent,
        dashboardType: 'student' | 'institution',
    ) => {
        e.preventDefault();

        // Navigate to solution pages instead of dashboard
        if (dashboardType === 'student') {
            router.push('/solutions/students');
        } else {
            router.push('/solutions/institutions');
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50">
            {/* Navigation */}
            <nav className="border-b border-gray-200 bg-white/90 backdrop-blur-lg sticky top-0 z-50 shadow-sm">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Link href="/" className="flex items-center space-x-3">
                            <Image
                                src="/logo.png"
                                alt="Acredia Logo"
                                width={40}
                                height={40}
                                className="rounded-lg"
                            />
                            <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                                ACREDIA
                            </span>
                        </Link>
                        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap sm:space-x-4">
                            {/* Solutions Dropdown */}
                            <div
                                className="relative"
                                onMouseEnter={handleMouseEnter}
                                onMouseLeave={handleMouseLeave}
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setShowSolutions((prev) => !prev)}
                                    className="text-gray-700 hover:text-teal-600 flex items-center gap-1 text-sm sm:text-base"
                                >
                                    Solutions
                                    <svg
                                        className={`w-4 h-4 transition-transform duration-200 ${showSolutions ? 'rotate-180' : ''}`}
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M19 9l-7 7-7-7"
                                        />
                                    </svg>
                                </Button>

                                {/* Dropdown Menu */}
                                {showSolutions && (
                                    <div
                                        className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-[95vw] sm:w-[500px] max-w-[500px] bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 sm:p-6 animate-in fade-in slide-in-from-top-5 duration-200"
                                        onMouseEnter={handleMouseEnter}
                                        onMouseLeave={handleMouseLeave}
                                    >
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
                                            {/* For Universities */}
                                            <button
                                                onClick={(e) =>
                                                    handleDashboardClick(e, 'institution')
                                                }
                                                className="group text-left w-full"
                                            >
                                                <div className="flex flex-col items-center space-y-2 sm:space-y-3 p-4 sm:p-6 rounded-xl hover:bg-teal-50 transition-all duration-300 border-2 border-transparent hover:border-teal-300 hover:shadow-lg">
                                                    <div className="bg-gradient-to-br from-teal-500 to-cyan-500 p-3 sm:p-4 rounded-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                                                        <Building2 className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                                                    </div>
                                                    <div className="text-center">
                                                        <h3 className="font-bold text-gray-900 mb-1 sm:mb-2 group-hover:text-teal-600 transition-colors text-base sm:text-lg">
                                                            For Institutions
                                                        </h3>
                                                        <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3 px-2">
                                                            Issue and manage credentials for your
                                                            students
                                                        </p>
                                                        <div className="inline-flex items-center gap-2 text-xs text-teal-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity bg-teal-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                                                            Learn More
                                                            <ArrowRight className="w-3 h-3" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>

                                            {/* For Students */}
                                            <button
                                                onClick={(e) => handleDashboardClick(e, 'student')}
                                                className="group text-left w-full"
                                            >
                                                <div className="flex flex-col items-center space-y-2 sm:space-y-3 p-4 sm:p-6 rounded-xl hover:bg-cyan-50 transition-all duration-300 border-2 border-transparent hover:border-cyan-300 hover:shadow-lg">
                                                    <div className="bg-gradient-to-br from-cyan-500 to-blue-500 p-3 sm:p-4 rounded-2xl shadow-lg group-hover:scale-110 transition-transform duration-300">
                                                        <GraduationCap className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                                                    </div>
                                                    <div className="text-center">
                                                        <h3 className="font-bold text-gray-900 mb-1 sm:mb-2 group-hover:text-cyan-600 transition-colors text-base sm:text-lg">
                                                            For Students
                                                        </h3>
                                                        <p className="text-xs sm:text-sm text-gray-600 mb-2 sm:mb-3 px-2">
                                                            View and share your academic credentials
                                                        </p>
                                                        <div className="inline-flex items-center gap-2 text-xs text-cyan-600 font-semibold opacity-0 group-hover:opacity-100 transition-opacity bg-cyan-50 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                                                            Learn More
                                                            <ArrowRight className="w-3 h-3" />
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        </div>

                                        {/* Bottom CTA */}
                                        <div className="mt-4 sm:mt-6 pt-4 sm:pt-6 border-t border-gray-200">
                                            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0">
                                                <div className="text-center sm:text-left">
                                                    <p className="text-sm font-semibold text-gray-900">
                                                        New to Acredia?
                                                    </p>
                                                    <p className="text-xs text-gray-600">
                                                        Join 500+ universities worldwide
                                                    </p>
                                                </div>
                                                <Link href="/auth/register">
                                                    <Button className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white shadow-lg hover:shadow-xl transition-all text-sm sm:text-base w-full sm:w-auto">
                                                        Get Started
                                                        <ArrowRight className="w-4 h-4 ml-2" />
                                                    </Button>
                                                </Link>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <Link href="/about">
                                <Button
                                    variant="ghost"
                                    className="text-gray-700 hover:text-teal-600 text-sm sm:text-base px-3 sm:px-4"
                                >
                                    About
                                </Button>
                            </Link>
                            <Link href="/auth/login">
                                <Button
                                    variant="ghost"
                                    className="text-gray-700 hover:text-teal-600 text-sm sm:text-base px-3 sm:px-4"
                                >
                                    Sign In
                                </Button>
                            </Link>
                            <Link href="/verify">
                                <Button className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white text-sm sm:text-base px-3 sm:px-4">
                                    <Shield className="w-4 h-4 mr-2" />
                                    Verify
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="container mx-auto px-4 py-20">
                <div className="mx-auto max-w-4xl space-y-6 text-center">
                    <h1 className="text-4xl font-bold leading-tight sm:text-5xl md:text-6xl">
                        <span className="text-gray-900">About </span>
                        <span className="bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                            Acredia
                        </span>
                    </h1>
                    <p className="text-lg leading-relaxed text-gray-600 sm:text-xl">
                        The world's first comprehensive blockchain-powered academic credential
                        platform combining Soulbound NFTs, Zero-Knowledge Proofs, and AI-driven
                        verification for secure, tamper-proof, and globally recognized educational
                        credentials.
                    </p>
                </div>
            </section>

            <section className="container mx-auto px-4 py-16">
                <BrandSectionHeader
                    title="Why institutions and contributors choose Acredia"
                    description="The experience stays approachable while the platform remains secure, modular, and ready for open-source collaboration."
                    eyebrow="Why it stands out"
                />
                <div className="mt-10 grid gap-6 md:grid-cols-3">
                    {ABOUT_HIGHLIGHTS.map((item) => (
                        <Card
                            key={item.title}
                            className="border border-gray-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-lg"
                        >
                            <h3 className="mb-3 text-xl font-semibold text-gray-900">{item.title}</h3>
                            <p className="text-sm leading-7 text-gray-600">{item.description}</p>
                        </Card>
                    ))}
                </div>
            </section>

            {/* Trust Badges - Animated Marquee */}
            <section className="bg-white py-12 border-y border-gray-200">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-6">
                        <p className="text-sm text-gray-500 uppercase tracking-wide font-semibold">
                            Trusted by Leading Universities Worldwide
                        </p>
                    </div>

                    <div className="overflow-hidden">
                        <div className="trust-marquee flex items-center gap-8 py-4">
                            <div className="flex items-center gap-8">
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/mit.svg"
                                        alt="MIT"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/oxford.svg"
                                        alt="Oxford"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/stanford.svg"
                                        alt="Stanford"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/harvard.svg"
                                        alt="Harvard"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/cambridge.svg"
                                        alt="Cambridge"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/iit.svg"
                                        alt="IIT"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                            </div>

                            {/* duplicate for seamless loop */}
                            <div className="flex items-center gap-8">
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/mit.svg"
                                        alt="MIT"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/oxford.svg"
                                        alt="Oxford"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/stanford.svg"
                                        alt="Stanford"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/harvard.svg"
                                        alt="Harvard"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/cambridge.svg"
                                        alt="Cambridge"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                                <div className="min-w-[160px] flex items-center justify-center">
                                    <Image
                                        src="/logos/iit.svg"
                                        alt="IIT"
                                        width={160}
                                        height={140}
                                        className="object-contain h-20"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* marquee CSS - responsive durations and pause-on-hover */}
                <style jsx>{`
                    .trust-marquee {
                        display: flex;
                        gap: 2rem;
                        align-items: center;
                        animation: marquee 18s linear infinite;
                        will-change: transform;
                    }
                    .trust-marquee:hover {
                        animation-play-state: paused;
                    }
                    @keyframes marquee {
                        0% {
                            transform: translateX(0%);
                        }
                        100% {
                            transform: translateX(-50%);
                        }
                    }
                    @media (max-width: 1024px) {
                        .trust-marquee {
                            animation-duration: 14s;
                        }
                    }
                    @media (max-width: 640px) {
                        .trust-marquee {
                            animation-duration: 10s;
                        }
                    }
                `}</style>
            </section>

            {/* System Overview */}
            <section className="container mx-auto px-4 py-16">
                <div className="bg-white rounded-3xl shadow-xl border border-gray-200 overflow-hidden">
                    <div className="bg-gradient-to-r from-teal-600 to-cyan-600 px-8 py-6">
                        <h2 className="text-3xl font-bold text-white">System Overview</h2>
                    </div>
                    <div className="p-8 space-y-6">
                        <p className="text-lg text-gray-700 leading-relaxed">
                            Acredia revolutionizes academic credential management through a
                            sophisticated blockchain-based ecosystem. Our platform ensures
                            credentials are permanently verifiable, cannot be forged, and remain
                            under the control of students while being globally accessible to
                            institutions and employers.
                        </p>

                        <div className="grid md:grid-cols-3 gap-6 pt-6">
                            <div className="text-center space-y-2">
                                <div className="text-4xl font-bold text-teal-600">500+</div>
                                <div className="text-gray-600">Partner Universities</div>
                            </div>
                            <div className="text-center space-y-2">
                                <div className="text-4xl font-bold text-teal-600">1M+</div>
                                <div className="text-gray-600">Issued Credentials</div>
                            </div>
                            <div className="text-center space-y-2">
                                <div className="text-4xl font-bold text-teal-600">150+</div>
                                <div className="text-gray-600">Countries</div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Core Components */}
            <section className="container mx-auto px-4 py-16">
                <div className="text-center mb-12">
                    <h2 className="text-4xl font-bold text-gray-900 mb-4">
                        Core System Components
                    </h2>
                    <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                        Four integrated modules powering the future of academic credentials
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-8">
                    {/* Institution Dashboard */}
                    <Card className="bg-white border border-gray-200 p-8 hover:shadow-2xl transition-all">
                        <div className="bg-gradient-to-br from-teal-500 to-cyan-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
                            <Building2 className="w-11 h-11 text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-4">
                            Institution Dashboard
                        </h3>
                        <p className="text-gray-600 mb-6 leading-relaxed">
                            Complete credential management system for educational institutions to
                            issue, track, and manage blockchain-secured credentials.
                        </p>
                        <div className="space-y-3">
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Bulk credential upload via CSV/Excel
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    IPFS decentralized storage integration
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    One-click NFT minting to blockchain
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Real-time credential status tracking
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-teal-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Analytics and compliance reporting
                                </span>
                            </div>
                        </div>
                    </Card>

                    {/* Student Web Wallet */}
                    <Card className="bg-white border border-gray-200 p-8 hover:shadow-2xl transition-all">
                        <div className="bg-gradient-to-br from-cyan-500 to-blue-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
                            <GraduationCap className="w-11 h-11 text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-4">
                            Student Web Wallet
                        </h3>
                        <p className="text-gray-600 mb-6 leading-relaxed">
                            Personal credential wallet where students own and control their
                            educational achievements forever.
                        </p>
                        <div className="space-y-3">
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-cyan-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    View all issued NFT credentials
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-cyan-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">Generate shareable QR codes</span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-cyan-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Selective disclosure with Zero-Knowledge Proofs
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-cyan-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Export to digital wallets (MetaMask, etc.)
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-cyan-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Download PDF/digital certificates
                                </span>
                            </div>
                        </div>
                    </Card>

                    {/* Verification Portal */}
                    <Card className="bg-white border border-gray-200 p-8 hover:shadow-2xl transition-all">
                        <div className="bg-gradient-to-br from-purple-500 to-pink-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
                            <Search className="w-11 h-11 text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-4">
                            Global Verification Portal
                        </h3>
                        <p className="text-gray-600 mb-6 leading-relaxed">
                            Public verification interface for employers, institutions, and agencies
                            to instantly verify credentials.
                        </p>
                        <div className="space-y-3">
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">QR code scanning verification</span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">Wallet address lookup</span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Real-time blockchain verification
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Detailed credential information display
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Verification audit trail logging
                                </span>
                            </div>
                        </div>
                    </Card>

                    {/* AI Credential Engine */}
                    <Card className="bg-white border border-gray-200 p-8 hover:shadow-2xl transition-all">
                        <div className="bg-gradient-to-br from-orange-500 to-red-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
                            <Database className="w-11 h-11 text-white" />
                        </div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-4">
                            AI Credential Engine
                        </h3>
                        <p className="text-gray-600 mb-6 leading-relaxed">
                            Intelligent automation system for credential processing, validation, and
                            university matching.
                        </p>
                        <div className="space-y-3">
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    OCR document scanning and extraction
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    NLP-powered credential parsing
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Global university database matching
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">
                                    Fraud detection and anomaly analysis
                                </span>
                            </div>
                            <div className="flex items-start space-x-3">
                                <CheckCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                                <span className="text-gray-700">Automated compliance checking</span>
                            </div>
                        </div>
                    </Card>
                </div>
            </section>

            {/* Technology Stack */}
            <section className="bg-white py-20">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-12">
                        <h2 className="text-4xl font-bold text-gray-900 mb-4">
                            Advanced Technology Stack
                        </h2>
                        <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                            Built on cutting-edge blockchain and AI technologies
                        </p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        <Card className="border border-gray-200 p-8 text-center hover:shadow-xl transition-all">
                            <div className="bg-gradient-to-br from-violet-500 to-purple-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                                <Fingerprint className="w-11 h-11 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 mb-3">
                                Soulbound NFTs
                            </h3>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                Non-transferable Soroban-based credential tokens permanently bound
                                to student Stellar addresses, ensuring true ownership and preventing
                                fraud or resale.
                            </p>
                            <div className="text-sm font-semibold text-teal-600">
                                Soroban / Stellar Network
                            </div>
                        </Card>

                        <Card className="border border-gray-200 p-8 text-center hover:shadow-xl transition-all">
                            <div className="bg-gradient-to-br from-cyan-500 to-blue-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                                <Eye className="w-11 h-11 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 mb-3">
                                Zero-Knowledge Proofs
                            </h3>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                Privacy-preserving verification allowing students to prove
                                credentials without revealing sensitive information, using zkSNARKs
                                cryptography.
                            </p>
                            <div className="text-sm font-semibold text-teal-600">
                                zkSNARKs Powered
                            </div>
                        </Card>

                        <Card className="border border-gray-200 p-8 text-center hover:shadow-xl transition-all">
                            <div className="bg-gradient-to-br from-pink-500 to-rose-500 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                                <Database className="w-11 h-11 text-white" />
                            </div>
                            <h3 className="text-2xl font-bold text-gray-900 mb-3">
                                AI Verification
                            </h3>
                            <p className="text-gray-600 leading-relaxed mb-4">
                                Machine learning-powered OCR and NLP engines for automated
                                credential processing, university matching, and fraud detection.
                            </p>
                            <div className="text-sm font-semibold text-teal-600">
                                ML & NLP Powered
                            </div>
                        </Card>
                    </div>
                </div>
            </section>

            {/* Blockchain Architecture */}
            <section className="container mx-auto px-4 py-20">
                <div className="bg-gradient-to-br from-teal-600 to-cyan-600 rounded-3xl p-12 text-white">
                    <div className="max-w-4xl mx-auto">
                        <div className="text-center mb-12">
                            <Network className="w-16 h-16 mx-auto mb-6" />
                            <h2 className="text-4xl font-bold mb-4">Blockchain Architecture</h2>
                            <p className="text-xl text-teal-100">
                                Decentralized infrastructure ensuring security and permanence
                            </p>
                        </div>

                        <div className="grid md:grid-cols-2 gap-8">
                            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                                <CloudUpload className="w-11 h-11 mb-4" />
                                <h3 className="text-xl font-bold mb-3">IPFS Storage</h3>
                                <p className="text-teal-50">
                                    Credentials stored on InterPlanetary File System (IPFS) via
                                    Pinata, ensuring decentralized, permanent, and
                                    censorship-resistant storage.
                                </p>
                            </div>

                            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                                <Coins className="w-11 h-11 mb-4" />
                                <h3 className="text-xl font-bold mb-3">Smart Contracts</h3>
                                <p className="text-teal-50">
                                    Single unified AcrediaCredential Soroban contract handles
                                    credential issuance, authorization, and revocation — all in one
                                    Rust-powered smart contract.
                                </p>
                            </div>

                            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                                <Lock className="w-11 h-11 mb-4" />
                                <h3 className="text-xl font-bold mb-3">Stellar Testnet</h3>
                                <p className="text-teal-50">
                                    Deployed on Stellar Testnet via Soroban — ultra-low fees (~0.001
                                    XLM per transaction) with 5-second finality and mainnet-ready
                                    architecture.
                                </p>
                            </div>

                            <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
                                <Shield className="w-11 h-11 mb-4" />
                                <h3 className="text-xl font-bold mb-3">Access Control</h3>
                                <p className="text-teal-50">
                                    Role-based permissions managed through smart contracts ensuring
                                    only authorized institutions can issue credentials.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Compliance Standards */}
            <section className="container mx-auto px-4 py-20">
                <div className="text-center mb-12">
                    <FileCheck className="w-16 h-16 mx-auto text-teal-600 mb-6" />
                    <h2 className="text-4xl font-bold text-gray-900 mb-4">
                        Compliance & Standards
                    </h2>
                    <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                        Fully compliant with international educational and technical standards
                    </p>
                </div>

                <div className="grid md:grid-cols-4 gap-6 max-w-5xl mx-auto">
                    <Card className="border border-gray-200 p-6 text-center hover:shadow-lg transition-all">
                        <div className="text-3xl font-bold text-teal-600 mb-2">W3C</div>
                        <div className="text-sm text-gray-600 mb-3">Verifiable Credentials</div>
                        <p className="text-xs text-gray-500">
                            Adheres to W3C DID and Verifiable Credentials standards for
                            interoperability
                        </p>
                    </Card>

                    <Card className="border border-gray-200 p-6 text-center hover:shadow-lg transition-all">
                        <div className="text-3xl font-bold text-teal-600 mb-2">NAD</div>
                        <div className="text-sm text-gray-600 mb-3">Academic Bank</div>
                        <p className="text-xs text-gray-500">
                            Compliant with National Academic Depository regulations for Indian
                            institutions
                        </p>
                    </Card>

                    <Card className="border border-gray-200 p-6 text-center hover:shadow-lg transition-all">
                        <div className="text-3xl font-bold text-teal-600 mb-2">ABC</div>
                        <div className="text-sm text-gray-600 mb-3">Credit Framework</div>
                        <p className="text-xs text-gray-500">
                            Supports Academic Bank of Credits for credit transfer and accumulation
                        </p>
                    </Card>

                    <Card className="border border-gray-200 p-6 text-center hover:shadow-lg transition-all">
                        <div className="text-3xl font-bold text-teal-600 mb-2">NEP 2020</div>
                        <div className="text-sm text-gray-600 mb-3">Education Policy</div>
                        <p className="text-xs text-gray-500">
                            Aligned with National Education Policy 2020 digital credential
                            requirements
                        </p>
                    </Card>
                </div>
            </section>

            {/* Trust Badges - can be added after System Overview if desired */}
            <section className="bg-white py-12 border-y border-gray-200">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-8">
                        <p className="text-sm text-gray-500 uppercase tracking-wide font-semibold">
                            Trusted by Leading Universities Worldwide
                        </p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 max-w-6xl mx-auto">
                        <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 p-4 flex items-center justify-center overflow-hidden">
                            <Image
                                src="/logos/mit.svg"
                                alt="MIT"
                                width={160}
                                height={140}
                                className="object-contain w-full h-24"
                            />
                        </div>
                        <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 p-4 flex items-center justify-center overflow-hidden">
                            <Image
                                src="/logos/oxford.svg"
                                alt="Oxford University"
                                width={160}
                                height={140}
                                className="object-contain w-full h-24"
                            />
                        </div>
                        <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 p-4 flex items-center justify-center overflow-hidden">
                            <Image
                                src="/logos/stanford.svg"
                                alt="Stanford University"
                                width={160}
                                height={140}
                                className="object-contain w-full h-24"
                            />
                        </div>
                        <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 p-4 flex items-center justify-center overflow-hidden">
                            <Image
                                src="/logos/harvard.svg"
                                alt="Harvard University"
                                width={160}
                                height={140}
                                className="object-contain w-full h-24"
                            />
                        </div>
                        <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 p-4 flex items-center justify-center overflow-hidden">
                            <Image
                                src="/logos/cambridge.svg"
                                alt="Cambridge University"
                                width={160}
                                height={140}
                                className="object-contain w-full h-24"
                            />
                        </div>
                        <div className="bg-white rounded-xl shadow-md hover:shadow-xl transition-shadow duration-300 p-4 flex items-center justify-center overflow-hidden">
                            <Image
                                src="/logos/iit.svg"
                                alt="IIT"
                                width={160}
                                height={140}
                                className="object-contain w-full h-24"
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="container mx-auto px-4 py-20">
                <div className="bg-gradient-to-br from-gray-50 to-teal-50 rounded-3xl p-12 md:p-16 text-center border border-gray-200">
                    <h2 className="text-4xl md:text-5xl font-bold text-gray-900 mb-6">
                        Ready to Join Acredia?
                    </h2>
                    <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
                        Be part of the blockchain credential revolution with 500+ universities
                        worldwide
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/auth/register?role=institution">
                            <Button
                                size="lg"
                                className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white px-10 py-6 text-lg"
                            >
                                <Building2 className="w-5 h-5 mr-2" />
                                For Institutions
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </Link>
                        <Link href="/auth/register?role=student">
                            <Button
                                size="lg"
                                variant="outline"
                                className="border-2 border-gray-300 hover:bg-gray-100 px-10 py-6 text-lg"
                            >
                                <GraduationCap className="w-5 h-5 mr-2" />
                                For Students
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="bg-gray-900 text-white py-16">
                <div className="container mx-auto px-4">
                    <div className="grid md:grid-cols-4 gap-8 mb-12">
                        <div>
                            <div className="flex items-center space-x-3 mb-4">
                                <Image
                                    src="/Acredia.png"
                                    alt="Acredia Logo"
                                    width={32}
                                    height={32}
                                    className="rounded-lg"
                                />
                                <span className="text-xl font-bold">ACREDIA</span>
                            </div>
                            <p className="text-gray-400 text-sm">
                                Blockchain-powered academic credentials for the future of education
                            </p>
                        </div>

                        <div>
                            <h4 className="font-semibold mb-4">Product</h4>
                            <ul className="space-y-2 text-sm text-gray-400">
                                <li>
                                    <Link
                                        href="/about"
                                        className="hover:text-white transition-colors"
                                    >
                                        About
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/verify"
                                        className="hover:text-white transition-colors"
                                    >
                                        Verification
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        API Docs
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Pricing
                                    </Link>
                                </li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-semibold mb-4">Company</h4>
                            <ul className="space-y-2 text-sm text-gray-400">
                                <li>
                                    <Link
                                        href="/about"
                                        className="hover:text-white transition-colors"
                                    >
                                        About Us
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Blog
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Careers
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Contact
                                    </Link>
                                </li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-semibold mb-4">Legal</h4>
                            <ul className="space-y-2 text-sm text-gray-400">
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Privacy
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Terms
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Security
                                    </Link>
                                </li>
                                <li>
                                    <Link href="#" className="hover:text-white transition-colors">
                                        Compliance
                                    </Link>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
                        <p>&copy; 2026 Acredia. Built with ❤️. All rights reserved.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
