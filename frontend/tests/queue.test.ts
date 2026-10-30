/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Top-level mocks must be declared before any imports of the mocked modules.
vi.mock('@/lib/runtimeConfig', () => ({
    runtimeConfig: {
        supabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' },
        isProduction: false,
        stellar: {},
        contracts: {},
        debug: { enableLogs: false },
    },
    serverRuntimeConfig: {
        admin: { emailAllowlist: [] },
        auth: { serviceRoleKey: '' },
        verification: { hashSecret: '' },
        debug: { enableLogs: false },
    },
}));

describe('Background Job Queue client', async () => {
    const { enqueueJob, pollAndProcessJob } = await import('@/lib/queue');

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('enqueues a job successfully', async () => {
        const mockJob = {
            id: 'job-1',
            name: 'test_job',
            payload: { value: 123 },
            status: 'pending',
            attempts: 0,
            max_attempts: 3,
            run_at: new Date().toISOString(),
        };

        const mockClient = {
            from: vi.fn().mockReturnValue({
                insert: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockResolvedValue({ data: mockJob, error: null }),
            }),
        };

        const res = await enqueueJob(mockClient as any, 'test_job', { value: 123 });
        expect(res.success).toBe(true);
        expect(res.job?.name).toBe('test_job');
        expect(res.job?.payload.value).toBe(123);
    });

    it('handles unique constraint violation with idempotency key', async () => {
        const mockExistingJob = {
            id: 'existing-job',
            name: 'test_job',
            payload: { value: 456 },
            status: 'pending',
            attempts: 0,
            max_attempts: 3,
            idempotency_key: 'unique-key',
        };

        const mockClient = {
            from: vi.fn().mockImplementation((table) => {
                if (table === 'jobs') {
                    return {
                        insert: vi.fn().mockReturnThis(),
                        select: vi.fn().mockReturnThis(),
                        // Simulate unique violation error on insert
                        maybeSingle: vi.fn().mockResolvedValue({
                            data: null,
                            error: { code: '23505', message: 'duplicate key value' },
                        }),
                        eq: vi.fn().mockReturnThis(),
                    };
                }
                return {};
            }),
        };

        // Stub find call when unique violation happens
        mockClient.from = vi.fn().mockImplementation(() => {
            return {
                insert: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                maybeSingle: vi.fn().mockImplementation(async () => {
                    // First call is insert (which fails), second call is select existing
                    if (mockClient.from.mock.calls.length === 1) {
                        return { data: null, error: { code: '23505', message: 'duplicate key' } };
                    }
                    return { data: mockExistingJob, error: null };
                }),
            };
        });

        const res = await enqueueJob(mockClient as any, 'test_job', { value: 456 }, {
            idempotencyKey: 'unique-key',
        });

        expect(res.success).toBe(true);
        expect(res.job?.id).toBe('existing-job');
    });

    it('polls and processes next job successfully', async () => {
        const mockJob = {
            id: 'job-1',
            name: 'success_job',
            payload: { data: 'ok' },
            attempts: 1,
            max_attempts: 3,
        };

        const mockClient = {
            rpc: vi.fn().mockResolvedValue({ data: [mockJob], error: null }),
            from: vi.fn().mockReturnValue({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { ...mockJob, status: 'completed' }, error: null }),
            }),
        };

        const mockHandler = vi.fn().mockResolvedValue(undefined);
        const res = await pollAndProcessJob(mockClient as any, 'worker-1', {
            success_job: mockHandler,
        });

        expect(res.processed).toBe(true);
        expect(res.job?.status).toBe('completed');
        expect(mockHandler).toHaveBeenCalledWith({ data: 'ok' });
    });

    it('retries job on handler failure', async () => {
        const mockJob = {
            id: 'job-1',
            name: 'retry_job',
            payload: { value: 1 },
            attempts: 1,
            max_attempts: 3,
        };

        const mockClient = {
            rpc: vi.fn().mockResolvedValue({ data: [mockJob], error: null }),
            from: vi.fn().mockReturnValue({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { ...mockJob, status: 'pending', error_log: 'Error: Failed' }, error: null }),
            }),
        };

        const mockHandler = vi.fn().mockRejectedValue(new Error('Failed'));
        const res = await pollAndProcessJob(mockClient as any, 'worker-1', {
            retry_job: mockHandler,
        });

        expect(res.processed).toBe(true);
        expect(res.job?.status).toBe('pending');
        expect(res.job?.error_log).toContain('Error: Failed');
    });

    it('marks job as failed when attempts reach max_attempts', async () => {
        const mockJob = {
            id: 'job-1',
            name: 'fail_job',
            payload: { value: 1 },
            attempts: 3, // already reached max
            max_attempts: 3,
        };

        const mockClient = {
            rpc: vi.fn().mockResolvedValue({ data: [mockJob], error: null }),
            from: vi.fn().mockReturnValue({
                update: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({ data: { ...mockJob, status: 'failed', error_log: 'Error: Fatal' }, error: null }),
            }),
        };

        const mockHandler = vi.fn().mockRejectedValue(new Error('Fatal'));
        const res = await pollAndProcessJob(mockClient as any, 'worker-1', {
            fail_job: mockHandler,
        });

        expect(res.processed).toBe(true);
        expect(res.job?.status).toBe('failed');
        expect(res.job?.error_log).toContain('Error: Fatal');
    });
});
