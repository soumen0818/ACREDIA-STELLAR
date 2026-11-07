'use client';

import { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { safeGetSession } from '@/lib/supabase';

type ApiKey = {
    id: string;
    key_prefix: string;
    name: string;
    revoked: boolean;
    created_at: string;
};

export function ApiKeysManager() {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newKeyName, setNewKeyName] = useState('');
    const [createdCleartextKey, setCreatedCleartextKey] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetchKeys();
    }, []);

    const fetchKeys = async () => {
        setLoading(true);
        try {
            const { data } = await safeGetSession();
            const token = data.session?.access_token;
            if (!token) return;

            const res = await fetch('/api/institution/apikeys', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                const body = await res.json();
                if (body.success) setKeys(body.apiKeys);
            }
        } catch {
            toast.error('Failed to load API keys');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateKey = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newKeyName.trim()) return;

        setCreating(true);
        try {
            const { data } = await safeGetSession();
            const token = data.session?.access_token;
            if (!token) return;

            const res = await fetch('/api/institution/apikeys', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newKeyName }),
            });

            const body = await res.json();
            if (res.ok && body.success) {
                setKeys([body.apiKey, ...keys]);
                setCreatedCleartextKey(body.cleartextKey);
                setNewKeyName('');
                toast.success('API key created');
            } else {
                toast.error(body.error || 'Failed to create API key');
            }
        } catch {
            toast.error('An unexpected error occurred');
        } finally {
            setCreating(false);
        }
    };

    const handleRevokeKey = async (id: string) => {
        if (!confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) return;

        try {
            const { data } = await safeGetSession();
            const token = data.session?.access_token;
            if (!token) return;

            const res = await fetch('/api/institution/apikeys', {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ id }),
            });

            if (res.ok) {
                setKeys(keys.map(k => k.id === id ? { ...k, revoked: true } : k));
                toast.success('API key revoked');
            } else {
                toast.error('Failed to revoke API key');
            }
        } catch {
            toast.error('An unexpected error occurred');
        }
    };

    const copyToClipboard = () => {
        if (!createdCleartextKey) return;
        navigator.clipboard.writeText(createdCleartextKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card className="p-6">
            <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Key className="h-5 w-5" />
                </span>
                <div className="flex-1">
                    <h2 className="text-lg font-semibold text-foreground">API Keys</h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Manage API keys for programmatic verification. Never share your API keys or commit them to version control.
                    </p>
                </div>
            </div>

            {createdCleartextKey && (
                <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                    <p className="text-sm font-medium text-foreground">
                        Your new API key is ready. Copy it now, as you won't be able to see it again!
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                        <code className="flex-1 rounded bg-background px-3 py-2 text-sm font-mono border">
                            {createdCleartextKey}
                        </code>
                        <Button variant="outline" size="sm" onClick={copyToClipboard}>
                            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </Button>
                    </div>
                    <Button 
                        variant="ghost" 
                        size="sm" 
                        className="mt-2"
                        onClick={() => setCreatedCleartextKey(null)}
                    >
                        I've copied it
                    </Button>
                </div>
            )}

            <form onSubmit={handleCreateKey} className="mt-6 flex items-end gap-3">
                <div className="flex-1">
                    <label htmlFor="key-name" className="block text-sm font-medium text-foreground mb-1">
                        New API Key Name
                    </label>
                    <input
                        id="key-name"
                        type="text"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        placeholder="e.g. Production Backend"
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        required
                    />
                </div>
                <Button type="submit" disabled={creating || !newKeyName.trim()}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Key
                </Button>
            </form>

            <div className="mt-8">
                <h3 className="text-sm font-medium text-foreground mb-4">Active API Keys</h3>
                {loading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                ) : keys.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No API keys generated yet.</p>
                ) : (
                    <div className="space-y-3">
                        {keys.map((apiKey) => (
                            <div key={apiKey.id} className="flex items-center justify-between rounded-lg border border-border bg-background p-4">
                                <div>
                                    <p className="font-medium text-foreground flex items-center gap-2">
                                        {apiKey.name}
                                        {apiKey.revoked && (
                                            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Revoked</span>
                                        )}
                                    </p>
                                    <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                                        <code className="font-mono">{apiKey.key_prefix}</code>
                                        <span>•</span>
                                        <span>Created {new Date(apiKey.created_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                {!apiKey.revoked && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                        onClick={() => handleRevokeKey(apiKey.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}
