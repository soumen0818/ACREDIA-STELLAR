'use client';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useState } from 'react';
import {
    Building2,
    Shield,
    Upload,
    FileCheck,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Users,
    CheckCircle,
    ArrowRight,
    Lock,
    Zap,
    CloudUpload,
    BarChart3,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Globe,
    GraduationCap,
} from 'lucide-react';

export default function InstitutionSolutionsPage() {
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
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-teal-50 to-cyan-50">
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
                                                <div className="flex flex-col items-center space-y-2 sm:space-y-3 p-4 sm:p-6 rounded-xl hover:bg-teal-50 transition-all duration-300 border-2 border-teal-300 bg-teal-50 shadow-lg">
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
                                                        <div className="inline-flex items-center gap-2 text-xs text-teal-600 font-semibold bg-teal-100 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full">
                                                            Current Page
                                                        </div>
                                                    </div>
                                                </div>
                                            </Link>

                                            {/* For Students */}
                                            <Link
                                                href="/solutions/students"
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
                        <div className="inline-flex items-center gap-2 bg-teal-100 text-teal-700 px-4 py-2 rounded-full text-sm font-semibold">
                            <Building2 className="w-4 h-4" />
                            Solutions for Educational Institutions
                        </div>
                        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-tight">
                            <span className="text-gray-900">Streamline Credential</span>
                            <br />
                            <span className="bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent">
                                Management & Issuance
                            </span>
                        </h1>
                        <p className="text-lg sm:text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
                            Issue blockchain-secured credentials in minutes. Reduce administrative
                            burden, eliminate fraud, and give your students lifetime ownership of
                            their achievements.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
                            <Link href="/auth/register?role=institution">
                                <Button
                                    size="lg"
                                    className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white px-10 py-6 text-lg font-bold"
                                >
                                    Start Free Trial
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
                        Everything You Need to Issue Credentials
                    </h2>
                    <p className="text-xl text-gray-600">
                        Powerful tools designed for educational institutions
                    </p>
                </div>

                <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-teal-500 to-cyan-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Upload className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Bulk Upload</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Upload hundreds of credentials at once via CSV or Excel. Our system
                            automatically processes and validates all entries.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-cyan-500 to-blue-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Zap className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">One-Click Minting</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Issue blockchain NFT credentials with a single click. No blockchain
                            expertise required—we handle the complexity.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-purple-500 to-pink-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <CloudUpload className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">IPFS Storage</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Credentials are permanently stored on decentralized IPFS network,
                            ensuring they can never be lost or tampered with.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-orange-500 to-red-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <BarChart3 className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                            Analytics Dashboard
                        </h3>
                        <p className="text-gray-600 leading-relaxed">
                            Track credential issuance, verification requests, and usage statistics
                            in real-time with comprehensive analytics.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-green-500 to-emerald-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <Lock className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Access Control</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Role-based permissions ensure only authorized staff can issue
                            credentials, maintaining security and compliance.
                        </p>
                    </Card>

                    <Card className="p-6 border border-gray-200 hover:shadow-xl transition-all">
                        <div className="bg-gradient-to-br from-blue-500 to-indigo-500 w-14 h-14 rounded-xl flex items-center justify-center mb-6">
                            <FileCheck className="w-7 h-7 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Compliance Ready</h3>
                        <p className="text-gray-600 leading-relaxed">
                            Fully compliant with W3C, NAD, ABC, and NEP 2020 standards for
                            educational credentials.
                        </p>
                    </Card>
                </div>
            </section>

            {/* How It Works */}
            <section className="bg-white py-12">
                <div className="container mx-auto px-4">
                    <div className="text-center mb-10">
                        <h2 className="text-4xl font-bold text-gray-900 mb-4">How It Works</h2>
                        <p className="text-xl text-gray-600">
                            Issue credentials in three simple steps
                        </p>
                    </div>

                    <div className="max-w-4xl mx-auto space-y-6">
                        <div className="flex items-start space-x-4">
                            <div className="flex-shrink-0 w-11 h-11 bg-teal-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                1
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">
                                    Upload Credentials
                                </h3>
                                <p className="text-gray-600 text-base leading-relaxed">
                                    Upload student credentials via CSV, Excel, or manual entry. Our
                                    AI engine validates and processes the data automatically.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-4">
                            <div className="flex-shrink-0 w-11 h-11 bg-teal-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                2
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">
                                    Review & Approve
                                </h3>
                                <p className="text-gray-600 text-base leading-relaxed">
                                    Review the processed credentials in your dashboard. Make any
                                    necessary edits before minting to the blockchain.
                                </p>
                            </div>
                        </div>

                        <div className="flex items-start space-x-4">
                            <div className="flex-shrink-0 w-11 h-11 bg-teal-600 text-white rounded-full flex items-center justify-center font-bold text-lg">
                                3
                            </div>
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 mb-2">
                                    Mint to Blockchain
                                </h3>
                                <p className="text-gray-600 text-base leading-relaxed">
                                    Click to mint NFT credentials to the blockchain. Students
                                    receive instant notification and lifetime access to their
                                    credentials.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Benefits */}
            <section className="container mx-auto px-4 py-12">
                <div className="text-center mb-10">
                    <h2 className="text-4xl font-bold text-gray-900 mb-4">Why Choose Acredia?</h2>
                    <p className="text-xl text-gray-600">Benefits for your institution</p>
                </div>

                <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-teal-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Reduce Administrative Costs
                            </h3>
                            <p className="text-gray-600">
                                Eliminate manual credential verification requests. Automated
                                blockchain verification saves time and money.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-teal-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Enhance Institution Reputation
                            </h3>
                            <p className="text-gray-600">
                                Position your institution as a technology leader with cutting-edge
                                blockchain credentials.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-teal-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Prevent Fraud</h3>
                            <p className="text-gray-600">
                                Blockchain-secured credentials cannot be forged or tampered with,
                                protecting your institution's credibility.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start space-x-3">
                        <CheckCircle className="w-6 h-6 text-teal-600 mt-1 flex-shrink-0" />
                        <div>
                            <h3 className="text-lg font-bold text-gray-900 mb-2">
                                Global Recognition
                            </h3>
                            <p className="text-gray-600">
                                Credentials are instantly verifiable worldwide, increasing alumni
                                employability.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="container mx-auto px-4 py-12">
                <div className="bg-gradient-to-br from-teal-600 to-cyan-600 rounded-3xl p-10 md:p-12 text-center text-white">
                    <h2 className="text-3xl md:text-4xl font-bold mb-4">
                        Ready to Transform Your Credential Process?
                    </h2>
                    <p className="text-lg mb-8 max-w-2xl mx-auto opacity-90">
                        Join 500+ universities worldwide using Acredia for secure,
                        blockchain-verified credentials
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Link href="/auth/register?role=institution">
                            <Button
                                size="lg"
                                className="bg-white text-teal-600 hover:bg-gray-100 px-10 py-6 text-lg font-bold"
                            >
                                Start Free Trial
                                <ArrowRight className="w-5 h-5 ml-2" />
                            </Button>
                        </Link>
                        <Link href="/auth/login">
                            <Button
                                size="lg"
                                className="bg-white/20 backdrop-blur-sm border-2 border-white text-white hover:bg-white hover:text-teal-600 px-10 py-6 text-lg font-bold"
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
