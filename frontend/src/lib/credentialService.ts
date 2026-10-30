import { supabase } from './supabase';
import { uploadCredentialDocument } from './credentialDocumentUpload';
import { documentEvidenceId } from './credentialDocuments';
import { expiryDateToTimestamp } from './credentialValidation';
import {
    issueCredentialOnStellar,
    generateCredentialHash,
    revokeCredentialOnStellar,
} from './contracts';
import { CREDENTIAL_HASH_ALGORITHM, CREDENTIAL_METADATA_SCHEMA_VERSION } from './credentialHash';
import { buildAcrediaVerifiableCredential, type AcrediaVerifiableCredential } from './verifiableCredential';
import { validateVerifiableCredential } from './schemas';
import { runtimeConfig } from './runtimeConfig';
import { debugLog, captureException, recordMetric } from './debug';
import { getE2eState, updateE2eState } from './e2e';
import type { StellarSigner } from './stellarSigner';

export interface Subject {
    id: string;
    name: string;
    marks: string;
    maxMarks: string;
    grade?: string;
}

export interface CredentialData {
    studentName: string;
    studentWallet: string;
    studentEmail?: string;
    credentialType: string;
    degree: string;
    major?: string;
    gpa?: string;
    issueDate: string;
    /** Optional `YYYY-MM-DD`; the credential is valid through this date (UTC). */
    expiresAt?: string;
    subjects?: Subject[];
    institutionId: string;
    institutionName: string;
    institutionWallet: string;
    file: File;
}

/**
 * Credential metadata is modeled as a W3C Verifiable Credential / Open
 * Badges 3.0 JSON-LD document (see verifiableCredential.ts). This alias is
 * kept so existing imports of `CredentialMetadata` from this module keep
 * working.
 */
export type CredentialMetadata = AcrediaVerifiableCredential;

export type CredentialIssueProgressStep = 'store-document' | 'sign-transaction' | 'save-database';

export async function issueCredential(
    data: CredentialData,
    issuer: StellarSigner,
    onProgress?: (step: CredentialIssueProgressStep) => void,
): Promise<{
    tokenId: string;
    transactionHash: string;
}> {
    const expiresAt = data.expiresAt?.trim() ? expiryDateToTimestamp(data.expiresAt.trim()) : null;
    const e2eState = getE2eState();
    if (e2eState?.enabled) {
        onProgress?.('store-document');
        const tokenId = String(e2eState.nextTokenId ?? 1);
        const transactionHash = `e2e-tx-${tokenId}`;

        updateE2eState((state) => {
            state.nextTokenId = (state.nextTokenId ?? 1) + 1;
            state.issuedCredentials ??= [];
            state.issuedCredentials.unshift({
                id: `cred-${tokenId}`,
                token_id: tokenId,
                share_token: crypto.randomUUID(),
                ipfs_hash: null,
                blockchain_hash: transactionHash,
                metadata: {
                    credentialData: {
                        studentName: data.studentName,
                        degree: data.degree,
                        major: data.major,
                        gpa: data.gpa,
                        issueDate: data.issueDate,
                        credentialType: data.credentialType,
                    },
                },
                issued_at: new Date().toISOString(),
                expires_at:
                    expiresAt === null ? null : new Date(expiresAt * 1000).toISOString(),
                revoked: false,
                issuer_wallet_address: data.institutionWallet,
                student_wallet_address: data.studentWallet,
            });
            if (state.stats) {
                state.stats.totalCredentials += 1;
                state.stats.activeCredentials += 1;
            }
        });

        onProgress?.('save-database');

        return { tokenId, transactionHash };
    }

    try {
        onProgress?.('store-document');
        debugLog('Storing the credential document privately.');
        const document = await uploadCredentialDocument(data.file);
        debugLog('Credential document stored.');

        debugLog('Generating credential metadata as a W3C VC / Open Badges 3.0 document.');
        const metadata: CredentialMetadata = buildAcrediaVerifiableCredential(
            {
                studentName: data.studentName,
                studentWallet: data.studentWallet,
                degree: data.degree,
                major: data.major,
                gpa: data.gpa,
                issueDate: data.issueDate,
                credentialType: data.credentialType,
                institutionName: data.institutionName,
                institutionWallet: data.institutionWallet,
                subjects: data.subjects,
            },
            runtimeConfig.stellar.explorerBaseUrl,
            {
                id: documentEvidenceId(document.sha256),
                description: `SHA-256 of the source document uploaded by ${data.institutionName} at issuance. The document is held privately by Acredia.`,
            },
        );
        validateVerifiableCredential(metadata);

        debugLog('Generating credential hash.');
        const credentialHash = await generateCredentialHash(metadata);
        debugLog('Credential hash generated.');

        debugLog('Issuing credential on Stellar network.');
        onProgress?.('sign-transaction');
        const { tokenId, transactionHash } = await issueCredentialOnStellar(
            data.studentWallet,
            credentialHash,
            expiresAt,
            issuer,
        );
        debugLog(`Credential issued on Stellar. Token ID: ${tokenId}`);

        if (!data.institutionId) {
            throw new Error('Missing institution ID. Please refresh and try again.');
        }

        debugLog('Saving issued credential to the database.');
        onProgress?.('save-database');
        const { data: studentData } = await supabase
            .from('students')
            .select('id')
            .eq('wallet_address', data.studentWallet)
            .maybeSingle();

        // An upsert, not an insert: the indexer may already have written a
        // status-only row for this token from the chain event (review §3.11c).
        const { error: dbError } = await supabase.from('credentials').upsert({
            student_id: studentData?.id || null,
            student_wallet_address: data.studentWallet,
            institution_id: data.institutionId,
            issuer_wallet_address: data.institutionWallet, // Store issuer wallet
            token_id: tokenId,
            // No IPFS content: only the hash is on-chain (review §3.11).
            ipfs_hash: null,
            document_path: document.path,
            document_sha256: document.sha256,
            expires_at: expiresAt === null ? null : new Date(expiresAt * 1000).toISOString(),
            blockchain_hash: transactionHash,
            metadata,
            metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
            hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
            issued_at: new Date().toISOString(),
            revoked: false,
        }, { onConflict: 'token_id' });

        if (dbError) {
            captureException(dbError, { context: 'db_save_credential' });
            const details = [dbError.code, dbError.message, dbError.details]
                .filter(Boolean)
                .join(' | ');
            throw new Error(
                `Failed to save credential to database: ${details || 'Unknown database error'}`,
            );
        }

        debugLog('Credential saved to the database.');
        recordMetric('issuance.success', 1, {
            credentialType: data.credentialType,
            institutionId: data.institutionId,
        });

        // Trigger transactional email
        fetch('/api/notifications/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'issued', tokenId }),
        }).catch((err) => captureException(err, { context: 'triggerIssuedEmail' }));

        return { tokenId, transactionHash };
    } catch (error) {
        recordMetric('issuance.failure', 1, {
            credentialType: data.credentialType,
            institutionId: data.institutionId,
        });
        captureException(error, { context: 'issueCredential_service' });
        throw error;
    }
}

export async function getInstitutionCredentials(institutionId: string) {
    try {
        const { data, error } = await supabase
            .from('credentials')
            .select('*')
            .eq('institution_id', institutionId)
            .order('issued_at', { ascending: false });

        if (error) throw error;

        return data;
    } catch (error) {
        captureException(error, { context: 'getInstitutionCredentials_service' });
        throw error;
    }
}

export async function getCredentialById(credentialId: string) {
    try {
        const { data, error } = await supabase
            .from('credentials')
            .select('*')
            .eq('id', credentialId)
            .single();

        if (error) throw error;

        return data;
    } catch (error) {
        captureException(error, { context: 'getCredentialById_service' });
        throw error;
    }
}

export async function revokeCredentialById(
    credentialId: string,
    issuer: StellarSigner,
): Promise<void> {
    const e2eState = getE2eState();
    if (e2eState?.enabled) {
        updateE2eState((state) => {
            const credential = state.issuedCredentials?.find((entry) => entry.id === credentialId);
            if (!credential) {
                throw new Error('Credential not found');
            }

            if (credential.revoked) {
                throw new Error('Credential is already revoked');
            }

            credential.revoked = true;
            credential.blockchain_hash = credential.blockchain_hash || `e2e-revoke-${credential.token_id}`;
            if (state.stats) {
                state.stats.activeCredentials = Math.max(0, state.stats.activeCredentials - 1);
            }
        });
        return;
    }

    try {
        const credential = await getCredentialById(credentialId);
        if (!credential) {
            throw new Error('Credential not found');
        }

        if (credential.revoked) {
            throw new Error('Credential is already revoked');
        }

        const connectedWallet = issuer.address?.toLowerCase();
        const storedIssuerWallet = credential.issuer_wallet_address?.toLowerCase();

        debugLog('Validating wallet authorization for credential revocation.');

        if (!connectedWallet) {
            throw new Error('No wallet connected. Please connect your wallet first.');
        }

        if (connectedWallet !== storedIssuerWallet) {
            throw new Error(
                `Authorization failed: You must use the same wallet that issued this credential.\n` +
                    `Expected: ${storedIssuerWallet}\n` +
                    `Connected: ${connectedWallet}`,
            );
        }

        if (credential.token_id) {
            await revokeCredentialOnStellar(credential.token_id, issuer);
            debugLog('Credential revoked on Stellar network.');
        }

        const { error } = await supabase
            .from('credentials')
            .update({
                revoked: true,
                revoked_at: new Date().toISOString(),
            })
            .eq('id', credentialId);

        if (error) throw error;

        debugLog('Credential revocation saved to the database.');
    } catch (error) {
        captureException(error, { context: 'revokeCredentialById_service' });
        throw error;
    }
}

// ─── Paginated functions for Issue #82 ───────────────────────────────────────

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface CredentialFilters {
  search?: string;
  status?: 'active' | 'revoked' | 'all';
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginatedResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getInstitutionCredentialsPaginated(
  institutionId: string,
  pagination: PaginationParams,
  filters: CredentialFilters = {}
): Promise<PaginatedResult> {
  const { page, pageSize } = pagination;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('credentials')
    .select('*', { count: 'exact' })
    .eq('institution_id', institutionId)
    .order('issued_at', { ascending: false });

  if (filters.status && filters.status !== 'all') {
    query = query.eq('revoked', filters.status === 'revoked');
  }
  if (filters.dateFrom) {
    query = query.gte('issued_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('issued_at', filters.dateTo + 'T23:59:59Z');
  }
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    query = query.or(
      `token_id.ilike.%${term}%,` +
      `metadata->credentialData->>studentName.ilike.%${term}%,` +
      `metadata->credentialData->>degree.ilike.%${term}%,` +
      `metadata->credentialData->>credentialType.ilike.%${term}%`
    );
  }

  query = query.range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message ?? String(error));

  return {
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

export async function getStudentCredentialsPaginated(
  studentId: string,
  pagination: PaginationParams,
  filters: CredentialFilters = {}
): Promise<PaginatedResult> {
  const { page, pageSize } = pagination;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('credentials')
    .select('*', { count: 'exact' })
    .eq('student_id', studentId)
    .order('issued_at', { ascending: false });

  if (filters.status && filters.status !== 'all') {
    query = query.eq('revoked', filters.status === 'revoked');
  }
  if (filters.dateFrom) {
    query = query.gte('issued_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('issued_at', filters.dateTo + 'T23:59:59Z');
  }
  if (filters.search?.trim()) {
    const term = filters.search.trim();
    query = query.or(
      `metadata->credentialData->>institutionName.ilike.%${term}%,` +
      `metadata->credentialData->>credentialType.ilike.%${term}%,` +
      `metadata->credentialData->>degree.ilike.%${term}%,` +
      `token_id.ilike.%${term}%`
    );
  }

  query = query.range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message ?? String(error));

  return {
    data: data ?? [],
    total: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}
