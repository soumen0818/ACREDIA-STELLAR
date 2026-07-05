'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';

interface DiagnosticResults {
    wallet?: string;
    timestamp?: string;
    totalCredentials?: number;
    allCredentials?: Array<{
        id: string;
        token_id: string;
        student_wallet_address?: string;
        student_id?: string;
    }>;
    allCredentialsError?: string;
    ilikeMatchCount?: number;
    ilikeMatchData?: unknown[];
    ilikeMatchError?: string;
    tableColumns?: string[];
    hasWalletColumn?: boolean;
    error?: string;
}

/**
 * Diagnostic Tool - Add this temporarily to your dashboard to debug
 * This will show you exactly what's in the database
 */
export default function CredentialDiagnostic({ studentWallet }: { studentWallet?: string }) {
    const [results, setResults] = useState<DiagnosticResults | null>(null);
    const [loading, setLoading] = useState(false);

    const runDiagnostic = async () => {
        setLoading(true);
        const diagnostics: DiagnosticResults = {
            wallet: studentWallet,
            timestamp: new Date().toISOString(),
        };

        try {
            // 1. Check all credentials (no filter)
            const { data: allCreds, error: allError } = await supabase
                .from('credentials')
                .select('id, token_id, student_wallet_address, student_id, institution_id');

            diagnostics.totalCredentials = allCreds?.length || 0;
            diagnostics.allCredentials = allCreds as DiagnosticResults['allCredentials'];
            diagnostics.allCredentialsError = allError?.message;

            // 2. Check credentials with wallet address (case-insensitive)
            if (studentWallet) {
                const { data: ilikeMatch, error: ilikeError } = await supabase
                    .from('credentials')
                    .select('*')
                    .ilike('student_wallet_address', studentWallet);

                diagnostics.ilikeMatchCount = ilikeMatch?.length || 0;
                diagnostics.ilikeMatchData = ilikeMatch || [];
                diagnostics.ilikeMatchError = ilikeError?.message;
            }

            // 3. Check table structure
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { data: tableInfo, error: tableError } = await supabase
                .from('credentials')
                .select('*')
                .limit(1);

            const tableColumns = tableInfo?.[0] ? Object.keys(tableInfo[0]) : [];
            diagnostics.tableColumns = tableColumns;
            diagnostics.hasWalletColumn = tableColumns.includes('student_wallet_address');
        } catch (err: unknown) {
            diagnostics.error = (err instanceof Error ? err.message : String(err));
        }

        setResults(diagnostics);
        setLoading(false);
    };

    return (
        <Card className="p-6 border-blue-200 bg-blue-50">
            <h3 className="text-lg font-bold text-blue-800 mb-2">Diagnostic Tool</h3>
            <p className="text-sm text-blue-600 mb-4">
                Run this to check database connection and credential existence.
            </p>

            <Button
                onClick={runDiagnostic}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white"
            >
                {loading ? 'Running...' : 'Run Diagnostics'}
            </Button>

            {results && (
                <div className="mt-4 space-y-4">
                    <div className="bg-white p-4 rounded border">
                        <h4 className="font-bold">Your Wallet:</h4>
                        <p className="font-mono text-sm">{results.wallet || 'Not connected'}</p>
                    </div>

                    <div className="bg-white p-4 rounded border">
                        <h4 className="font-bold">Total Credentials in Database:</h4>
                        <p className="text-2xl font-bold">{results.totalCredentials}</p>
                    </div>

                    <div className="bg-white p-4 rounded border">
                        <h4 className="font-bold">Column Check:</h4>
                        <p>
                            Has student_wallet_address column:{' '}
                            <strong>{results.hasWalletColumn ? '✅ YES' : '❌ NO'}</strong>
                        </p>
                        <p className="text-xs mt-2">
                            Available columns: {results.tableColumns?.join(', ')}
                        </p>
                    </div>

                    {results.wallet && (
                        <>
                            <div className="bg-white p-4 rounded border">
                                <h4 className="font-bold">Credentials Matching Your Wallet:</h4>
                                <p className="text-2xl">
                                    {results.ilikeMatchCount || 0} credentials
                                </p>
                                {results.ilikeMatchError && (
                                    <p className="text-red-600 text-sm mt-2">
                                        Error: {results.ilikeMatchError}
                                    </p>
                                )}
                                {(results.ilikeMatchCount === 0) && (results.totalCredentials ?? 0) > 0 && (
                                    <p className="text-orange-600 text-sm mt-2">
                                        ⚠️ Credentials exist but none match your wallet address
                                    </p>
                                )}
                            </div>
                        </>
                    )}

                    <div className="bg-white p-4 rounded border">
                        <h4 className="font-bold">All Credentials (wallet addresses):</h4>
                        <div className="text-xs font-mono mt-2 space-y-1 max-h-60 overflow-y-auto">
                            {(results.allCredentials && results.allCredentials.length > 0) ? (
                                results.allCredentials.map((cred) => (
                                    <div key={cred.id} className="border-b pb-1">
                                        <div>Token: {cred.token_id}</div>
                                        <div>Wallet: {cred.student_wallet_address || '(null)'}</div>
                                        <div>Student ID: {cred.student_id || '(null)'}</div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-gray-500">No credentials in database</p>
                            )}
                        </div>
                    </div>

                    <details className="bg-gray-100 p-4 rounded border">
                        <summary className="font-bold cursor-pointer">
                            Full Diagnostic Data (Click to expand)
                        </summary>
                        <pre className="text-xs mt-2 overflow-auto max-h-96">
                            {JSON.stringify(results, null, 2)}
                        </pre>
                    </details>
                </div>
            )}
        </Card>
    );
}
