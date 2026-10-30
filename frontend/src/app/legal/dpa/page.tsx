import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT_EMAIL } from '@/lib/contact';

export const metadata: Metadata = {
    title: 'Data Processing Agreement — Acredia',
    description:
        'Data Processing Agreement (DPA) template for institutions using Acredia as a data processor.',
};

const LAST_UPDATED = '30 October 2026';

export default function DpaPage() {
    return (
        <div className="container-shell py-16 sm:py-24">
            <div className="mx-auto max-w-3xl">
                {/* Header */}
                <div className="mb-12">
                    <p className="text-sm font-medium text-muted-foreground">Legal</p>
                    <h1 className="mt-2 text-4xl font-bold tracking-tight text-foreground">
                        Data Processing Agreement
                    </h1>
                    <p className="mt-3 text-muted-foreground leading-7">
                        This Data Processing Agreement ("DPA") template applies between Acredia
                        ("<strong>Processor</strong>") and an institution using the Acredia platform
                        ("<strong>Controller</strong>"). To execute a binding DPA, contact us at{' '}
                        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                            {CONTACT_EMAIL}
                        </a>.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Template version: {LAST_UPDATED}
                    </p>

                    <div className="mt-6 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-muted-foreground">
                        <strong className="text-foreground">Note:</strong> This is a template for
                        illustrative purposes. Institutions should have legal counsel review any DPA
                        before execution. Contact{' '}
                        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline">
                            {CONTACT_EMAIL}
                        </a>{' '}
                        to request a countersigned copy.
                    </div>
                </div>

                <div className="space-y-10 text-foreground">

                    {/* Service-stage notice */}
                    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
                        <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                            Service stage: Stellar test network
                        </p>
                        <p className="mt-2 text-sm leading-7 text-muted-foreground">
                            Acredia currently operates on the <strong>Stellar test network</strong> on a
                            beta basis. Controllers should not process production student records
                            through the Service until it moves to the Stellar public network.
                        </p>
                    </div>

                    <section aria-labelledby="definitions">
                        <h2 id="definitions" className="text-2xl font-semibold">1. Definitions</h2>
                        <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li><strong className="text-foreground">"Controller"</strong> — the institution that determines the purposes and means of processing student personal data.</li>
                            <li><strong className="text-foreground">"Processor"</strong> — Acredia, which processes personal data on behalf of the Controller.</li>
                            <li><strong className="text-foreground">"Personal Data"</strong> — any information relating to an identified or identifiable natural person, as defined in GDPR Art. 4(1).</li>
                            <li><strong className="text-foreground">"Processing"</strong> — any operation performed on personal data, including storage, retrieval, and deletion.</li>
                            <li><strong className="text-foreground">"Sub-processor"</strong> — a third party engaged by the Processor to process personal data (see Schedule B).</li>
                        </ul>
                    </section>

                    <section aria-labelledby="scope">
                        <h2 id="scope" className="text-2xl font-semibold">2. Subject matter &amp; scope</h2>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            Acredia processes student personal data solely to provide the credential
                            issuance and verification services described in the Terms of Service. The
                            categories of personal data processed and the purposes of processing are set
                            out in <strong>Schedule A</strong>.
                        </p>
                    </section>

                    <section aria-labelledby="processor-obligations">
                        <h2 id="processor-obligations" className="text-2xl font-semibold">3. Processor obligations</h2>
                        <p className="mt-4 text-muted-foreground leading-7">Acredia shall:</p>
                        <ul className="mt-2 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li>Process personal data only on documented instructions from the Controller, unless required by law.</li>
                            <li>Ensure that persons authorised to process personal data have committed to confidentiality.</li>
                            <li>Implement appropriate technical and organisational security measures (Art. 32 GDPR).</li>
                            <li>Not engage sub-processors without prior general or specific written authorisation.</li>
                            <li>Assist the Controller in fulfilling data-subject rights requests.</li>
                            <li>Delete or return all personal data upon termination of the agreement, subject to legal retention requirements.</li>
                            <li>Make available all information necessary to demonstrate compliance and allow audits.</li>
                        </ul>
                    </section>

                    <section aria-labelledby="controller-obligations">
                        <h2 id="controller-obligations" className="text-2xl font-semibold">4. Controller obligations</h2>
                        <p className="mt-4 text-muted-foreground leading-7">The Controller shall:</p>
                        <ul className="mt-2 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li>Ensure there is a valid lawful basis to issue credentials containing student personal data.</li>
                            <li>Provide accurate data and promptly notify Acredia of corrections.</li>
                            <li>Inform students that their credential data will be stored on Acredia and anchored on the Stellar blockchain.</li>
                        </ul>
                    </section>

                    <section aria-labelledby="on-chain-immutability">
                        <h2 id="on-chain-immutability" className="text-2xl font-semibold">5. On-chain data &amp; erasure</h2>
                        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
                            <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                                Blockchain immutability notice
                            </p>
                            <p className="mt-2 text-sm leading-7 text-muted-foreground">
                                Credential issuance writes a SHA-256 hash (not personal data) to the Stellar
                                blockchain. This record is technically immutable. Both parties acknowledge
                                that this hash is pseudonymous and relies on the Art. 17(3)(b) GDPR
                                exemption. Personal data held in Acredia&apos;s database and private
                                storage is handled on a valid erasure request as set out in the Privacy
                                Policy, but the on-chain hash cannot be removed.
                            </p>
                        </div>
                    </section>

                    <section aria-labelledby="security">
                        <h2 id="security" className="text-2xl font-semibold">6. Security measures (Art. 32)</h2>
                        <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground leading-7">
                            <li>TLS 1.2+ encryption for all data in transit.</li>
                            <li>Credential documents held in private storage and served only through short-lived signed links.</li>
                            <li>Row Level Security (RLS) enforced at the database layer.</li>
                            <li>API rate limiting and bearer-token authentication on all data endpoints.</li>
                            <li>Regular security reviews and a responsible-disclosure process for reported vulnerabilities.</li>
                        </ul>
                    </section>

                    <section aria-labelledby="breach">
                        <h2 id="breach" className="text-2xl font-semibold">7. Personal data breach notification</h2>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            Acredia shall notify the Controller <strong>without undue delay</strong> and,
                            where feasible, within <strong>48 hours</strong> of becoming aware of a
                            personal data breach affecting the Controller&apos;s data. The notification
                            will describe, to the extent known: the nature of the breach and the
                            categories and approximate number of data subjects and records concerned;
                            the likely consequences; and the measures taken or proposed to address it
                            and mitigate its effects.
                        </p>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            Acredia shall provide reasonable assistance to enable the Controller to meet
                            its own obligations under <strong>Art. 33 and 34 GDPR</strong>, including
                            any notification to a supervisory authority or to affected data subjects.
                            Reporting a breach is not an admission of fault or liability by either
                            party.
                        </p>
                    </section>

                    <section aria-labelledby="transfers">
                        <h2 id="transfers" className="text-2xl font-semibold">8. International transfers</h2>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            The Controller acknowledges that Acredia&apos;s database and authentication
                            sub-processor hosts data, including credential documents, in the{' '}
                            <strong className="text-foreground">Asia-Pacific region</strong> (see
                            Schedule B). Personal data processed under this DPA is therefore stored
                            outside the EEA and the UK.
                        </p>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            Each such transfer is made under an appropriate safeguard permitted by
                            Chapter V GDPR — principally the European Commission&apos;s{' '}
                            <strong className="text-foreground">Standard Contractual Clauses</strong>{' '}
                            (and the UK International Data Transfer Addendum where applicable),
                            incorporated through Acredia&apos;s agreement with each sub-processor. On
                            request, Acredia will provide the Controller with the information needed to
                            complete a transfer impact assessment.
                        </p>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            The Controller acknowledges that the <strong>Stellar network</strong> is a
                            public, globally distributed system whose node locations cannot be
                            controlled by either party. Only irreversible hashes, wallet addresses and
                            dates are published to it; no credential content or documents are
                            transferred to it.
                        </p>
                    </section>

                    <section aria-labelledby="duration">
                        <h2 id="duration" className="text-2xl font-semibold">9. Duration &amp; termination</h2>
                        <p className="mt-4 leading-7 text-muted-foreground">
                            This DPA takes effect when the Controller begins using the Service and
                            remains in force for as long as Acredia processes personal data on the
                            Controller&apos;s behalf. On termination, Acredia will delete or return the
                            Controller&apos;s personal data at the Controller&apos;s choice, save where
                            storage is required by law and save for the immutable on-chain hashes
                            described in §5. Clauses which by their nature should survive termination
                            (including confidentiality and §5) continue to apply.
                        </p>
                    </section>

                    <section aria-labelledby="sub-processors">
                        <h2 id="sub-processors" className="text-2xl font-semibold">Schedule A — Data categories</h2>
                        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-secondary/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Category</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Subjects</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Purpose</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-muted-foreground">
                                    <tr>
                                        <td className="px-4 py-3">Name, email</td>
                                        <td className="px-4 py-3">Students, institution staff</td>
                                        <td className="px-4 py-3">Account creation &amp; credential association</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Credential metadata (degree, grade, dates)</td>
                                        <td className="px-4 py-3">Students</td>
                                        <td className="px-4 py-3">Credential issuance &amp; verification</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3">Stellar wallet address</td>
                                        <td className="px-4 py-3">Students, institutions</td>
                                        <td className="px-4 py-3">Blockchain credential anchoring</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section aria-labelledby="schedule-b">
                        <h2 id="schedule-b" className="text-2xl font-semibold">Schedule B — Sub-processors</h2>
                        <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                                <thead className="bg-secondary/50">
                                    <tr>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Sub-processor</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Country</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Purpose</th>
                                        <th className="px-4 py-3 text-left font-semibold text-foreground">Safeguard</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border text-muted-foreground">
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Supabase</td>
                                        <td className="px-4 py-3">Asia-Pacific</td>
                                        <td className="px-4 py-3">Database, auth &amp; document storage</td>
                                        <td className="px-4 py-3">DPA + SCCs</td>
                                    </tr>
                                    <tr>
                                        <td className="px-4 py-3 font-medium text-foreground">Stellar Network</td>
                                        <td className="px-4 py-3">Global (decentralised)</td>
                                        <td className="px-4 py-3">Blockchain anchoring</td>
                                        <td className="px-4 py-3">No PII on-chain (hashes only)</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    {/* Related links */}
                    <div className="mt-12 flex flex-wrap gap-4 border-t border-border pt-8 text-sm text-muted-foreground">
                        <Link href="/legal/privacy" className="text-primary underline hover:text-primary/80">
                            Privacy Policy →
                        </Link>
                        <Link href="/legal/terms" className="text-primary underline hover:text-primary/80">
                            Terms of Service →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
