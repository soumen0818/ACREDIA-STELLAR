'use client';

import { InstitutionConsolePage } from '@/components/console/InstitutionConsolePage';
import { BatchCredentialImport } from '@/components/institution/BatchCredentialImport';
import { ProtectedRoute } from '@/contexts/AuthContext';

/** Bulk issuance from CSV — /dashboard/batch-import (formerly the "Bulk import" tab). */
function BatchImportContent() {
    return (
        <InstitutionConsolePage
            title="Batch import"
            subtitle="Issue many credentials at once from a CSV file"
            requireVerified
            walletPrompt="Connect your wallet to issue credentials on the blockchain — use the “Connect Wallet” button in the sidebar."
        >
            {(profile) => (
                <BatchCredentialImport
                    institutionId={profile.institutionId}
                    institutionName={profile.institutionName}
                    institutionWallet={profile.institutionWallet}
                    account={profile.address}
                />
            )}
        </InstitutionConsolePage>
    );
}

export default function BatchImportPage() {
    return (
        <ProtectedRoute allowedRoles={['institution']}>
            <BatchImportContent />
        </ProtectedRoute>
    );
}
