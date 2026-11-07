'use client';

import { toast } from 'sonner';
import { InstitutionConsolePage } from '@/components/console/InstitutionConsolePage';
import { CredentialUploadForm } from '@/components/institution/CredentialUploadForm';
import { ProtectedRoute } from '@/contexts/AuthContext';

/** Issue a single credential — /dashboard/issue (formerly the "Issue credential" tab). */
function IssueCredentialContent() {
    return (
        <InstitutionConsolePage
            title="Issue credential"
            subtitle="Upload a document and mint a credential on-chain"
            requireVerified
            walletPrompt="Connect your wallet to issue credentials on the blockchain — use the “Connect Wallet” button in the sidebar."
        >
            {(profile) => (
                <CredentialUploadForm
                    institutionId={profile.institutionId}
                    institutionName={profile.institutionName}
                    institutionWallet={profile.institutionWallet}
                    onSuccess={() =>
                        toast.success('Credential issued — find it under Issued credentials.')
                    }
                />
            )}
        </InstitutionConsolePage>
    );
}

export default function IssueCredentialPage() {
    return (
        <ProtectedRoute allowedRoles={['institution']}>
            <IssueCredentialContent />
        </ProtectedRoute>
    );
}
