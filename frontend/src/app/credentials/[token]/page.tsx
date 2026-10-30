import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getServiceRoleClient } from '@/lib/serverAuth';
import { isShareToken } from '@/lib/sharedCredential';
import { CredentialClientView } from './CredentialClientView';

/** Old links used the public token ID, which now shows status only (review §3.11b). */
const TOKEN_ID = /^\d{1,20}$/;

// A share page carries personal data the holder chose to share with
// whoever has the link. It is never meant for search engines.
const NOT_INDEXED: Metadata['robots'] = { index: false, follow: false };

interface Props {
    params: Promise<{
        token: string;
    }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { token } = await params;
    const cleanToken = token?.trim().toLowerCase() ?? '';

    if (!isShareToken(cleanToken)) {
        return {
            title: 'Academic Credential',
            description: 'Verify and view academic credentials on the Stellar blockchain.',
            robots: NOT_INDEXED,
        };
    }

    try {
        const supabase = getServiceRoleClient();
        const { data: credential } = await supabase
            .from('credentials')
            .select(
                `
                token_id,
                metadata,
                revoked,
                institution:institutions!credentials_institution_id_fkey (
                    name
                )
            `,
            )
            .eq('share_token', cleanToken)
            .maybeSingle();

        if (credential) {
            const rawMeta = (credential.metadata as Record<string, unknown> | null) ?? {};
            const credData = (rawMeta.credentialData as Record<string, unknown> | null) ?? {};

            const degree =
                (credData.degree as string) ||
                (credData.credentialType as string) ||
                'Academic Credential';
            const instData = Array.isArray(credential.institution)
                ? credential.institution[0]
                : credential.institution;
            const institutionName =
                instData?.name ||
                (credData.institutionName as string) ||
                'Authorized Institution';
            const studentName = (credData.studentName as string) || 'Credential Holder';
            const isRevoked = Boolean(credential.revoked);

            const title = `${degree} — ${institutionName}`;
            const description = isRevoked
                ? `Academic credential issued to ${studentName} by ${institutionName} (Revoked). Verified on Stellar blockchain.`
                : `Verified ${degree} issued to ${studentName} by ${institutionName}. Tamper-proof and authenticated on the Stellar blockchain.`;

            return {
                title: `${degree} | Verified Credential`,
                description,
                robots: NOT_INDEXED,
                alternates: {
                    canonical: `/credentials/${encodeURIComponent(cleanToken)}`,
                },
                openGraph: {
                    title,
                    description,
                    url: `/credentials/${encodeURIComponent(cleanToken)}`,
                    siteName: 'Acredia',
                    type: 'article',
                },
                twitter: {
                    card: 'summary_large_image',
                    title,
                    description,
                },
            };
        }
    } catch {
        // Fall back gracefully if DB is unreachable during crawler request
    }

    return {
        title: 'Academic Credential',
        description: 'View and verify an academic credential on the Stellar blockchain.',
        robots: NOT_INDEXED,
    };
}

export default async function PublicCredentialPage({ params }: Props) {
    const { token } = await params;
    const cleanToken = token?.trim() ?? '';
    if (TOKEN_ID.test(cleanToken)) {
        redirect(`/verify?token=${cleanToken}`);
    }
    return <CredentialClientView token={cleanToken.toLowerCase()} />;
}
