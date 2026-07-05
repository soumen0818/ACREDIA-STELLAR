import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';

describe('design system button variants', () => {
    it('exposes semantic brand and surface variants for shared UI', () => {
        const brandClasses = buttonVariants({ variant: 'brand' });
        const surfaceClasses = buttonVariants({ variant: 'surface' });

        expect(brandClasses).toContain('bg-primary');
        expect(surfaceClasses).toContain('bg-card');
        expect(surfaceClasses).toContain('border-border');
    });
});
