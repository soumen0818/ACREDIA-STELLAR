'use client';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useState } from 'react';
import {
    GraduationCap,
    Shield,
    QrCode,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Share2,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    FileCheck,
    CheckCircle,
    ArrowRight,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Lock,
    Eye,
    Smartphone,
    Download,
    Globe,
    Building2,
} from 'lucide-react';

export default function StudentSolutionsPage() {
    const [showSolutions, setShowSolutions] = useState(false);
    let closeTimeout: NodeJS.Timeout;

    const handleMouseEnter = () => {
        if (closeTimeout) clearTimeout(closeTimeout);
        setShowSolutions(true);
    };

    const handleMouseLeave = () => {
        closeTimeout = setTimeout(() => {
            setShowSolutions(false);
        }, 500);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-cyan-50 to-blue-50">
            {/* Navigation */}
            <nav className="border-b border-gray-200 bg-white/90 backdrop-blur-lg sticky top-0 z-50 shadow-sm">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <Link href="/" className="flex items-center space-x-3">
                            <Image
                                src="/Acredia.png"
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
                                            {/* For Institutions */}
                                            <Link
                                                href="/solutions/institutions"
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
                                            </Link>

                                            {/* For Students */}
                                            <Link
                                                href="/solutions/students"
                                                className="group text-left w-full"
                                            >
                                                <div className="flex flex-col items-center space-y-2 sm:space-y-3 p-4 sm:p-6 rounded-xl hover:bg-cyan-50 transition-all duration-300 border-2 border-cyan-300 bg-cyan-50 shadow-lg">
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
                                                        <div className="inline-flex items-center gap-2 text-xs text-cyan-600 font-semibold bg-cyan-100 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                                                            Current Page
                                                        </div>
                                                    </div>
                                                </div>
                                            </Link>
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
            <section className="container mx-auto px-4 py-12">
                <div className="max-w-5xl mx-auto">
                    <div className="text-center space-y-4 mb-12">
                        <div className="inline-flex items-center gap-2 bg-cyan-100 text-cyan-700 px-4 py-2 rounded-full text-sm font-semibold">
                            <GraduationCap className="w-4 h-4" />
                            Solutions for Students
                        </div>
                        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight">
                            <span className="text-gray-900">Own Your Academic</span>
                            <br />
                            <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                                Achievements Forever
                            </span>
                        </h1>
                        <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
                            Your credentials, your control. Access, share, and verify your academic
                            achievements anytime, anywhere with blockchain-secured digital
                            credentials.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
                            <Link href="/auth/register?role=student">
                                <Button
                                    size="lg"
                                    className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white px-10 py-6 text-lg"
                                >
                                    Create Free Account
                                    <ArrowRight className="w-5 h-5 ml-2" />
                                </Button>
                            </Link>
                            <Link href="/auth/login">
                                <Button
                                    size="lg"
                                    className="bg-blue-600 border-2 border-blue-700 text-white hover:bg-blue-700 px-10 py-6 text-lg font-bold"
                                >
                                    Sign In to Dashboard
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* Key Features */}
            <section className="container mx-auto px-4 py-12">
                <div className="text-center mb-10">
                    <h2 className="text-4xl font-bold text-gray-900 mb-4">
                        Your Digital Credential Wallet
                    </h2>
                    <p className="text-xl text-gray-600">
                        Everything you need to manage and share your credentials
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-cyan-500 to-blue-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Shield className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Lifetime Access</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Your credentials are stored on the blockchain forever. No institution
                            can revoke or modify them without your knowledge.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-blue-500 to-purple-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <QrCode className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Easy Sharing</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Generate QR codes or shareable links to instantly verify your
                            credentials with employers, universities, or agencies.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-purple-500 to-pink-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Eye className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Privacy Control</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Use Zero-Knowledge Proofs to verify specific details without revealing
                            your entire academic record.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-green-500 to-emerald-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Smartphone className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Mobile Friendly</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Access your credentials on any device. Your wallet works seamlessly on
                            desktop, tablet, and mobile.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-orange-500 to-red-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Download className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Export Options</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Download your credentials as PDFs or export to external wallets like
                            MetaMask for complete ownership.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-teal-500 to-cyan-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Globe className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Global Recognition</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Your blockchain credentials are recognized worldwide. Apply to jobs and
                            universities anywhere.
                        </p>
                    </Card>
                </div>
            </section>

            {/* How It Works */}
            <section className="bg-white py-12">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-10">
                        <h2 className="text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
                        <p className="text-xl text-gray-600">Get started in three simple steps</p>
                    </div>

                    <div className="max-w-4xl mx-auto space-y-6">
                        <div className="flex items-start space-x-4">
                            <div className="flex-shrink-0 w-11 h-11 bg-cyan-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                1
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">
                                    Create Your Wallet
                                </h3>
                                <p className="text-gray-600 text-base leading-relaxed">
                                    Sign up with your email and connect your blockchain wallet.
                                    We'll guide you through the simple setup process.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-4">
                            <div className="flex-shrink-0 w-11 h-11 bg-cyan-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                2
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">
                                    Receive Credentials
                                </h3>
                                <p className="text-gray-600 text-base leading-relaxed">
                                    When your institution issues a credential, you'll receive it
                                    instantly as an NFT in your wallet with a notification.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-4">
                            <div className="flex-shrink-0 w-11 h-11 bg-cyan-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                3
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">
                                    Share & Verify
                                </h3>
                                <p className="text-gray-600 text-base leading-relaxed">
                                    Generate QR codes or links to share with employers. They can
                                    instantly verify your credentials on the blockchain.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Benefits */}
            <section className="container mx-auto px-4 py-12">
                <div className="text-center mb-10">
                    <h2 className="text-4xl font-bold text-gray-900 mb-4">
                        Why Students Love Acredia
                    </h2>
                    <p className="text-xl text-gray-600">
                        Take control of your academic achievements
                    </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-cyan-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Never Lose Your Credentials
                            </h3>
                            <p className="text-gray-600">
                                Blockchain storage means your credentials exist forever, even if
                                your institution closes or systems fail.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-cyan-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Instant Verification
                            </h3>
                            <p className="text-gray-600">
                                Employers can verify your credentials in seconds, speeding up job
                                applications and admissions.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-cyan-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Stand Out to Employers
                            </h3>
                            <p className="text-gray-600">
                                Blockchain credentials demonstrate tech-savviness and provide
                                verified proof of your achievements.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-cyan-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Complete Privacy
                            </h3>
                            <p className="text-gray-600">
                                Choose exactly what information to share. Your full academic record
                                remains private unless you decide to reveal it.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="container mx-auto px-4 py-12">
                <div className="bg-gradient-to-br from-cyan-600 to-blue-600 rounded-3xl p-10 md:p-12 text-center text-white">
                    <h2 className="text-3xl md:text-4xl font-bold mb-4">
                        Start Building Your Digital Credential Wallet
                    </h2>
                    <p className="text-lg mb-8 max-w-2xl mx-auto opacity-90">
                        Join millions of students worldwide who own and control their academic
                        achievements
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/auth/register?role=student">
                            <Button
                                size="lg"
                                className="bg-white text-cyan-600 hover:bg-gray-100 px-10 py-6 text-lg font-bold"
                            >
                                Create Free Account
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </Link>
                        <Link href="/auth/login">
                            <Button
                                size="lg"
                                className="bg-white/20 backdrop-blur-sm border-2 border-white text-white hover:bg-white hover:text-cyan-600 px-10 py-6 text-lg font-bold"
                            >
                                Sign In
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
                                    <Link
                                        href="/solutions/institutions"
                                        className="hover:text-white transition-colors"
                                    >
                                        For Institutions
                                    </Link>
                                </li>
                                <li>
                                    <Link
                                        href="/solutions/students"
                                        className="hover:text-white transition-colors"
                                    >
                                        For Students
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
                            </ul>
                        </div>
                    </div>

                    <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
                        <p>&copy; 2025 Acredia. Built with ❤️. All rights reserved.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
