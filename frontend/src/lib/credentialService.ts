import { supabase } from './supabase';
import { uploadToIPFS, uploadJSONToIPFS, getIPFSUrl } from './ipfs';
import {
    issueCredentialOnStellar,
    generateCredentialHash,
    revokeCredentialOnStellar,
} from './contracts';
import { CREDENTIAL_HASH_ALGORITHM, CREDENTIAL_METADATA_SCHEMA_VERSION } from './credentialHash';
import { debugLog, captureException } from './debug';

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
    subjects?: Subject[];
    institutionId: string;
    institutionName: string;
    institutionWallet: string;
    file: File;
}

export interface CredentialMetadata {
    name: string;
    description: string;
    image: string;
    attributes: Array<{
        trait_type: string;
        value: string;
    }>;
    credentialData: {
        studentName: string;
        studentWallet: string;
        degree: string;
        major?: string;
        gpa?: string;
        issueDate: string;
        institutionName: string;
        credentialType: string;
        subjects?: Subject[];
    };
}

export type CredentialIssueProgressStep = 'upload-ipfs' | 'sign-transaction' | 'save-database';

export async function issueCredential(
    data: CredentialData,
    issuerAddress: string,
    onProgress?: (step: CredentialIssueProgressStep) => void,
): Promise<{
    tokenId: string;
    transactionHash: string;
    ipfsHash: string;
    metadataHash: string;
}> {
    try {
        onProgress?.('upload-ipfs');
        debugLog('Uploading credential file to IPFS.');
        const fileCID = await uploadToIPFS(data.file);
        const fileUrl = getIPFSUrl(fileCID);
        debugLog('Credential file uploaded to IPFS.');

        debugLog('Generating credential metadata.');
        const metadata: CredentialMetadata = {
            name: `${data.credentialType} - ${data.studentName}`,
            description: `Academic credential issued by ${data.institutionName} to ${data.studentName}`,
            image: fileUrl,
            attributes: [
                {
                    trait_type: 'Credential Type',
                    value: data.credentialType,
                },
                {
                    trait_type: 'Degree',
                    value: data.degree,
                },
                {
                    trait_type: 'Institution',
                    value: data.institutionName,
                },
                {
                    trait_type: 'Issue Date',
                    value: data.issueDate,
                },
                ...(data.major
                    ? [
                          {
                              trait_type: 'Major',
                              value: data.major,
                          },
                      ]
                    : []),
                ...(data.gpa
                    ? [
                          {
                              trait_type: 'GPA',
                              value: data.gpa,
                          },
                      ]
                    : []),
                ...(data.subjects && data.subjects.length > 0
                    ? [
                          {
                              trait_type: 'Total Subjects',
                              value: data.subjects.length.toString(),
                          },
                      ]
                    : []),
            ],
            credentialData: {
                studentName: data.studentName,
                studentWallet: data.studentWallet,
                degree: data.degree,
                major: data.major,
                gpa: data.gpa,
                issueDate: data.issueDate,
                institutionName: data.institutionName,
                credentialType: data.credentialType,
                subjects: data.subjects,
            },
        };

        debugLog('Uploading credential metadata to IPFS.');
        const metadataPath = await uploadJSONToIPFS(metadata);
        const metadataUrl = `ipfs://${metadataPath}`;
        debugLog('Credential metadata uploaded to IPFS.');

        debugLog('Generating credential hash.');
        const credentialHash = await generateCredentialHash(metadata);
        debugLog('Credential hash generated.');

        debugLog('Issuing credential on Stellar network.');
        onProgress?.('sign-transaction');
        const { tokenId, transactionHash } = await issueCredentialOnStellar(
            data.studentWallet,
            credentialHash,
            metadataUrl,
            issuerAddress,
        );
        // eslint-disable-next-line no-console
        console.log('✅ Credential issued! Token ID:', tokenId);
        // eslint-disable-next-line no-console
        console.log('✅ Transaction:', transactionHash);

        // Step 5: (Skipped) Registry handled atomically by Stellar contract

        // Step 6: Save to Supabase database
        // eslint-disable-next-line no-console
        console.log('💾 Saving to database...');

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

        const { error: dbError } = await supabase.from('credentials').insert({
            student_id: studentData?.id || null,
            student_wallet_address: data.studentWallet,
            institution_id: data.institutionId,
            issuer_wallet_address: data.institutionWallet, // Store issuer wallet
            token_id: tokenId,
            ipfs_hash: metadataPath, // Store full path (CID/filename)
            blockchain_hash: transactionHash,
            metadata,
            metadata_schema_version: CREDENTIAL_METADATA_SCHEMA_VERSION,
            hash_algorithm: CREDENTIAL_HASH_ALGORITHM,
            issued_at: new Date().toISOString(),
            revoked: false,
        });

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

        return {
            tokenId,
            transactionHash,
            ipfsHash: fileCID,
            metadataHash: metadataPath,
        };
    } catch (error) {
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
    issuerAddress: string,
): Promise<void> {
    try {
        const credential = await getCredentialById(credentialId);
        if (!credential) {
            throw new Error('Credential not found');
        }

        if (credential.revoked) {
            throw new Error('Credential is already revoked');
        }

        const connectedWallet = issuerAddress?.toLowerCase();
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
            await revokeCredentialOnStellar(credential.token_id, issuerAddress);
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