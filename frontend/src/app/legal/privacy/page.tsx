import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT_EMAIL } from '@/lib/contact';

export const metadata: Metadata = {
    title: 'Privacy Policy — Acredia',
    description:
        'How Acredia collects, uses, and protects your personal data, your GDPR rights, and how on-chain immutability is handled.',
};

const LAST_UPDATED = '30 October 2026';

export default function PrivacyPolicyPage() {
    return (
        <div className="container-shell py-16 sm:py-24">
            <div className="mx-auto max-w-3xl">
                {/* Header */}
                <div className="mb-12">
                    <p className="text-sm font-medium text-muted-foreground">Legal</p>
                    <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">
                        Privacy Policy
                    </h1>
                    <p className="mt-3 text-sm text-muted-foreground">
                        Last updated: {LAST_UPDATED}
                    </p>
                </div>

                <div className="prose prose-neutral dark:prose-invert max-w-none space-y-10 text-foreground">

                    {/* Service-stage notice */}
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
                        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                            Service stage: Stellar test network
                        </p>
                        <p className="mt-2 text-sm leading-7 text-muted-foreground">
                            Acredia currently operates on the <strong>Stellar test network</strong>.
                            Credentials issued today are for evaluation and demonstration purposes and
                            should not be relied upon as authoritative academic records. Test networks
                            may be reset by their operators, which can make on-chain records
                            unavailable. This notice will be updated when the service moves to the
                            Stellar public network.
                        </p>
                    </div>

                    {/* 1 - Who we are */}
                    <section aria-labelledby="who-we-are">
                        <h2 id="who-we-are" className="text-2xl font-semibold">1. Who we are</h2>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            Acredia ("<strong>Acredia</strong>", "we", "us", or "our") is the data controller
                            for personal data processed through this platform. You can reach our privacy
                            team at{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                                {CONTACT_EMAIL}
                            </a>.
                        </p>
                    </section>

                    {/* 2 - Data we collect */}
                    <section aria-labelledby="data-collected">
                        <h2 id="data-collected" className="text-2xl font-semibold">2. Personal data we collect</h2>
                        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-secondary/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Category</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Data</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Lawful basis</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Where stored</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-muted-foreground">
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Account</td>
                                        <td className="px-4 py-3">Email address, display name, role (student / institution)</td>
                                        <td className="px-4 py-3">Contract (Art. 6(1)(b))</td>
                                        <td className="px-4 py-3">Supabase DB (Asia-Pacific region)</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Wallet</td>
                                        <td className="px-4 py-3">Stellar public key (wallet address)</td>
                                        <td className="px-4 py-3">Contract</td>
                                        <td className="px-4 py-3">Supabase DB + Stellar blockchain</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Credential metadata</td>
                                        <td className="px-4 py-3">Student name, degree, grade, institution name (in JSONB metadata field)</td>
                                        <td className="px-4 py-3">Contract</td>
                                        <td className="px-4 py-3">Supabase DB; uploaded credential documents in private Supabase Storage</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Verification logs</td>
                                        <td className="px-4 py-3">Verifier-supplied email / organisation (optional), verification outcome</td>
                                        <td className="px-4 py-3">Legitimate interest (fraud prevention, Art. 6(1)(f))</td>
                                        <td className="px-4 py-3">Supabase DB — deleted 90 days after the verification attempt</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Contact form</td>
                                        <td className="px-4 py-3">Name, email address, message content, hashed IP address, browser user-agent</td>
                                        <td className="px-4 py-3">Legitimate interest (responding to your enquiry, Art. 6(1)(f))</td>
                                        <td className="px-4 py-3">Supabase DB — deleted 24 months after the last correspondence</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">On-chain record</td>
                                        <td className="px-4 py-3">SHA-256 hash of the credential, holder and issuer wallet addresses, issue time and optional expiry time</td>
                                        <td className="px-4 py-3">Public interest / legal obligation (Art. 6(1)(e), 17(3)(b))</td>
                                        <td className="px-4 py-3">Stellar blockchain — immutable (see §7)</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* 3 - How we use data */}
                    <section aria-labelledby="how-used">
                        <h2 id="how-used" className="text-2xl font-semibold">3. How we use your data</h2>
                        <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li>Create and manage your account and session.</li>
                            <li>Issue and display academic credentials to students.</li>
                            <li>Allow institutions to issue credentials to their students.</li>
                            <li>Enable third-party verifiers to confirm credential authenticity.</li>
                            <li>Detect and prevent fraud, abuse, and unauthorised access.</li>
                            <li>Comply with legal obligations.</li>
                        </ul>
                    </section>

                    {/* 4 - Data sharing */}
                    <section aria-labelledby="data-sharing">
                        <h2 id="data-sharing" className="text-2xl font-semibold">4. Data sharing &amp; sub-processors</h2>
                        <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li>
                                <strong className="text-foreground">Supabase</strong> — database,
                                authentication and private file storage for credential documents, hosted in the{' '}
                                <strong className="text-foreground">Asia-Pacific region</strong>.
                                Supabase&apos;s Data Processing Addendum, which incorporates the EU
                                Standard Contractual Clauses, governs this processing (see §5).
                            </li>
                            <li>
                                <strong className="text-foreground">Stellar Network</strong> — public, permissionless
                                blockchain. Only non-PII hashes and wallet addresses (which you control) are written
                                on-chain.
                            </li>
                        </ul>
                        <p className="mt-4 text-muted-foreground leading-7">
                            We do not sell personal data to third parties.
                        </p>
                    </section>

                    {/* 5 - International transfers */}
                    <section aria-labelledby="transfers">
                        <h2 id="transfers" className="text-2xl font-semibold">5. International data transfers</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            Our primary database and authentication provider (Supabase) hosts data in
                            the <strong className="text-foreground">Asia-Pacific region</strong>. If
                            you are located in the European Economic Area or the United Kingdom, this
                            means your personal data is{' '}
                            <strong className="text-foreground">
                                transferred and stored outside the EEA/UK
                            </strong>
                            .
                        </p>
                        <p className="mt-4 text-muted-foreground leading-7">
                            Such transfers are made under the safeguards permitted by Chapter V GDPR —
                            principally the European Commission&apos;s{' '}
                            <strong className="text-foreground">Standard Contractual Clauses</strong>{' '}
                            (and the UK International Data Transfer Addendum where applicable),
                            incorporated through our agreements with each sub-processor. You may
                            request a copy of the relevant safeguards at any time.
                        </p>
                        <p className="mt-4 text-muted-foreground leading-7">
                            Note that the <strong className="text-foreground">Stellar network</strong> is a
                            public, distributed system: data written to it is replicated across nodes
                            worldwide and its geographic location cannot be controlled. Only irreversible
                            hashes, wallet addresses and dates are published to it — never credential
                            content or documents. You can request details of our current
                            transfer safeguards at{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                                {CONTACT_EMAIL}
                            </a>
                            .
                        </p>
                    </section>

                    {/* 5 - Retention */}
                    <section aria-labelledby="retention">
                        <h2 id="retention" className="text-2xl font-semibold">6. Data retention</h2>
                        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-secondary/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Data</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Retention</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-muted-foreground">
                                    <tr>
                                        <td className="px-4 py-3">Account profile &amp; user login</td>
                                        <td className="px-4 py-3">Lifetime of account; deleted/scrubbed on erasure request</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Issued academic credentials</td>
                                        <td className="px-4 py-3">Retained as permanent academic business records under GDPR Art. 17(3)(b) &amp; (d) to protect third-party graduate entitlements</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Verification logs</td>
                                        <td className="px-4 py-3">90 days, then deleted by an automated purge that runs nightly at 03:00 UTC</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Credential documents</td>
                                        <td className="px-4 py-3">Private storage, retained with the issued credential</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">On-chain hash record</td>
                                        <td className="px-4 py-3">Permanent immutable blockchain record (see §7)</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Contact form messages</td>
                                        <td className="px-4 py-3">24 months from the last correspondence, then deleted by the same nightly purge</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Erasure request records</td>
                                        <td className="px-4 py-3">7 years (legal compliance)</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* 6 - On-chain immutability */}
                    <section aria-labelledby="on-chain">
                        <h2 id="on-chain" className="text-2xl font-semibold">7. On-chain data &amp; immutability</h2>
                        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
                            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                                Important notice about blockchain data
                            </p>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">
                                When a credential is issued, a <strong>SHA-256 hash</strong> of the credential
                                metadata is written to the <strong>Stellar blockchain</strong>. This hash is
                                cryptographically irreversible — it does not reveal the credential content — and
                                is considered <strong>non-personal data</strong> under GDPR Recital 26 (data
                                that, without disproportionate effort, cannot be attributed to an identified
                                natural person without additional information).
                            </p>
                            <p className="mt-3 text-sm leading-7 text-muted-foreground">
                                Because blockchain records are technically immutable, this data cannot be erased.
                                We rely on the exemption in <strong>Art. 17(3)(b) GDPR</strong> (necessity for
                                compliance with a legal obligation and the exercise of official authority) and
                                the design principle of pseudonymisation to justify retention. The hash alone
                                reveals nothing about the credential holder without the original credential,
                                which is held only in Acredia&apos;s private storage.
                            </p>
                        </div>
                        <p className="mt-4 text-sm leading-7 text-muted-foreground">
                            For the full technical data-model documentation, or a copy of our
                            records-of-processing, contact us at{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                                {CONTACT_EMAIL}
                            </a>
                            .
                        </p>
                    </section>

                    {/* 7 - Your rights */}
                    <section aria-labelledby="your-rights">
                        <h2 id="your-rights" className="text-2xl font-semibold">8. Your rights</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            Under GDPR you have the following rights:
                        </p>
                        <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li><strong className="text-foreground">Access</strong> — request a copy of your personal data.</li>
                            <li><strong className="text-foreground">Rectification</strong> — correct inaccurate personal data.</li>
                            <li>
                                <strong className="text-foreground">Erasure</strong> — students can delete their
                                account via Dashboard → Settings → Delete my account; institution staff and
                                administrators can request removal by emailing us. Deletion removes your personal user
                                account, profile, and personal preferences. Academic credentials previously issued to students are retained
                                under Art. 17(3)(b) and (d) as records belonging to the recipient data subjects, and
                                on-chain cryptographic hashes are permanent non-PII records (see §7).
                            </li>
                            <li><strong className="text-foreground">Portability</strong> — export your credential data in JSON/PDF via the dashboard.</li>
                            <li><strong className="text-foreground">Restriction</strong> — restrict processing in certain circumstances.</li>
                            <li><strong className="text-foreground">Objection</strong> — object to processing based on legitimate interest.</li>
                        </ul>
                        <p className="mt-4 text-muted-foreground leading-7">
                            To exercise any right, email{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                                {CONTACT_EMAIL}
                            </a>. We will respond within 30 days.
                        </p>
                    </section>

                    {/* 8 - Cookies */}
                    <section aria-labelledby="cookies">
                        <h2 id="cookies" className="text-2xl font-semibold">9. Cookies &amp; analytics</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            Acredia uses only strictly-necessary session cookies required for authentication
                            (Supabase auth tokens stored in browser localStorage). No third-party analytics
                            or advertising cookies are currently deployed. If analytics are added in future,
                            this policy will be updated and a consent banner will be displayed.
                        </p>
                    </section>

                    {/* 9 - Security */}
                    <section aria-labelledby="security">
                        <h2 id="security" className="text-2xl font-semibold">10. Security</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            All data in transit is encrypted with TLS. Credential documents are held in
                            private storage and served only through short-lived signed links: to the
                            credential holder, to the issuing institution, and to anyone the holder gives
                            their credential&apos;s share link, which shows the credential&apos;s details and
                            document. A credential&apos;s token ID alone shows only its issuer, dates and
                            status. Database access is protected by
                            Row Level Security (RLS) policies. We follow responsible disclosure — if
                            you believe you have found a vulnerability, please report it privately to{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                                {CONTACT_EMAIL}
                            </a>{' '}
                            rather than disclosing it publicly.
                        </p>
                    </section>

                    {/* Children's data */}
                    <section aria-labelledby="children">
                        <h2 id="children" className="text-2xl font-semibold">11. Children&apos;s data</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            Acredia is not directed at children. Accounts are intended for users aged{' '}
                            <strong className="text-foreground">16 or over</strong> (or the minimum
                            age of digital consent in your jurisdiction, where higher). We do not
                            knowingly collect personal data from children below that age. Where an
                            institution issues a credential relating to a minor, the institution acts
                            as controller for that record and is responsible for obtaining any
                            necessary parental consent. If you believe a child has provided us with
                            personal data, contact us and we will delete it promptly.
                        </p>
                    </section>

                    {/* Automated decision-making */}
                    <section aria-labelledby="automated">
                        <h2 id="automated" className="text-2xl font-semibold">12. Automated decision-making</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            We do not carry out automated decision-making or profiling that produces
                            legal effects concerning you, or that similarly significantly affects you,
                            within the meaning of <strong className="text-foreground">Art. 22 GDPR</strong>.
                            Credential verification is a deterministic cryptographic comparison — it
                            checks whether a hash matches an on-chain record and does not evaluate,
                            score, or profile individuals.
                        </p>
                    </section>

                    {/* Changes */}
                    <section aria-labelledby="changes">
                        <h2 id="changes" className="text-2xl font-semibold">13. Changes to this policy</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            We may update this Privacy Policy to reflect changes to the service, our
                            sub-processors, or applicable law. The &ldquo;Last updated&rdquo; date at
                            the top of this page always reflects the current version. Where a change
                            materially affects how we process your personal data, we will provide
                            notice — for example by email or an in-app notice — before it takes
                            effect.
                        </p>
                    </section>

                    {/* Contact */}
                    <section aria-labelledby="contact">
                        <h2 id="contact" className="text-2xl font-semibold">14. Contact &amp; complaints</h2>
                        <p className="mt-4 text-muted-foreground leading-7">
                            For any privacy-related query, contact us at{' '}
                            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                                {CONTACT_EMAIL}
                            </a>.
                            If you believe we have not addressed your concern, you have the right to lodge a
                            complaint with your local supervisory authority (e.g. the ICO in the UK or the
                            relevant EU data protection authority).
                        </p>
                    </section>

                    {/* Related links */}
                    <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-8 text-sm text-muted-foreground">
                        <Link href="/legal/terms" className="text-primary underline hover:text-primary/80">
                            Terms of Service →
                        </Link>
                        <Link href="/legal/dpa" className="text-primary underline hover:text-primary/80">
                            Data Processing Agreement →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
